require("dotenv").config();
const { Pool } = require("pg");
const crypto = require("crypto");

let pool = null;
let isInitialized = false;

function getConnectionString() {
  return process.env.DATABASE_URL || process.env.PGDATABASE_URL || "";
}

function getPool() {
  if (pool) {
    return pool;
  }

  const connectionString = getConnectionString();
  if (!connectionString) {
    return null;
  }

  try {
    const isLocalhost = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
    pool = new Pool({
      connectionString,
      ssl: isLocalhost
        ? false
        : {
            rejectUnauthorized: false
          }
    });

    pool.on("error", (err) => {
      console.error("[PostgreSQL] Unexpected pool error:", err.message);
    });

    return pool;
  } catch (error) {
    console.error("[PostgreSQL] Failed to initialize connection pool:", error.message);
    return null;
  }
}

async function initDb() {
  if (isInitialized) {
    return true;
  }

  const p = getPool();
  if (!p) {
    console.log("[PostgreSQL] No DATABASE_URL found in .env. Running in local-first fallback mode.");
    return false;
  }

  try {
    const createTablesQuery = `
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        google_id VARCHAR(128) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        avatar_url TEXT,
        xp INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

      CREATE TABLE IF NOT EXISTS reviewers (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        flashcards JSONB NOT NULL DEFAULT '[]'::jsonb,
        multiple_choice JSONB NOT NULL DEFAULT '[]'::jsonb,
        progress JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE reviewers ADD COLUMN IF NOT EXISTS user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE reviewers ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;

      CREATE INDEX IF NOT EXISTS idx_reviewers_created_at ON reviewers(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reviewers_user_id ON reviewers(user_id);
    `;

    await p.query(createTablesQuery);
    isInitialized = true;
    console.log("[PostgreSQL (Neon)] Successfully connected and initialized users & reviewers tables.");
    return true;
  } catch (error) {
    console.error("[PostgreSQL] Database initialization error:", error.message);
    return false;
  }
}

async function findOrCreateGoogleUser({ googleId, email, name, avatarUrl }) {
  const p = getPool();
  if (!p) return null;

  try {
    const existing = await p.query(
      `SELECT id, google_id AS "googleId", email, name, avatar_url AS "avatarUrl", xp, created_at AS "createdAt" FROM users WHERE google_id = $1 LIMIT 1;`,
      [googleId]
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      await p.query(
        `UPDATE users SET name = $1, avatar_url = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3;`,
        [name || user.name, avatarUrl || user.avatarUrl, user.id]
      );
      return { ...user, name: name || user.name, avatarUrl: avatarUrl || user.avatarUrl };
    }

    const newId = `usr-${crypto.randomBytes(8).toString("hex")}`;
    const insertQuery = `
      INSERT INTO users (id, google_id, email, name, avatar_url, xp, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, google_id AS "googleId", email, name, avatar_url AS "avatarUrl", xp, created_at AS "createdAt";
    `;

    const result = await p.query(insertQuery, [newId, googleId, email, name, avatarUrl]);
    return result.rows[0] || null;
  } catch (error) {
    console.error("[PostgreSQL] Error in findOrCreateGoogleUser:", error.message);
    return null;
  }
}

async function getUserById(userId) {
  const p = getPool();
  if (!p || !userId) return null;

  try {
    const result = await p.query(
      `SELECT id, google_id AS "googleId", email, name, avatar_url AS "avatarUrl", xp, created_at AS "createdAt" FROM users WHERE id = $1 LIMIT 1;`,
      [userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error("[PostgreSQL] Error in getUserById:", error.message);
    return null;
  }
}

async function updateUserXp(userId, xp) {
  const p = getPool();
  if (!p || !userId) return null;

  try {
    const result = await p.query(
      `UPDATE users SET xp = GREATEST(xp, $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING xp;`,
      [Number(xp) || 0, userId]
    );
    return result.rows[0]?.xp || 0;
  } catch (error) {
    console.error("[PostgreSQL] Error in updateUserXp:", error.message);
    return 0;
  }
}

async function saveReviewerToDb(reviewer, userId = null) {
  const p = getPool();
  if (!p) {
    return null;
  }

  if (!reviewer || !reviewer.id || !reviewer.title) {
    return null;
  }

  try {
    const query = `
      INSERT INTO reviewers (id, user_id, title, summary, flashcards, multiple_choice, progress, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, reviewers.user_id),
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        flashcards = EXCLUDED.flashcards,
        multiple_choice = EXCLUDED.multiple_choice,
        progress = COALESCE(EXCLUDED.progress, reviewers.progress),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const values = [
      reviewer.id,
      userId || reviewer.userId || null,
      reviewer.title,
      reviewer.summary || "",
      JSON.stringify(reviewer.flashcards || []),
      JSON.stringify(reviewer.multipleChoice || []),
      JSON.stringify(reviewer.progress || {}),
      reviewer.createdAt ? new Date(reviewer.createdAt) : new Date()
    ];

    const result = await p.query(query, values);
    return result.rows[0] || null;
  } catch (error) {
    console.error("[PostgreSQL] Error saving reviewer to database:", error.message);
    return null;
  }
}

async function getReviewerFromDb(id) {
  const p = getPool();
  if (!p || !id) {
    return null;
  }

  try {
    const query = `SELECT id, user_id AS "userId", title, summary, flashcards, multiple_choice AS "multipleChoice", progress, created_at AS "createdAt" FROM reviewers WHERE id = $1 LIMIT 1;`;
    const result = await p.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      summary: row.summary,
      flashcards: Array.isArray(row.flashcards) ? row.flashcards : [],
      multipleChoice: Array.isArray(row.multipleChoice) ? row.multipleChoice : [],
      progress: row.progress || {},
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString()
    };
  } catch (error) {
    console.error("[PostgreSQL] Error getting reviewer from database:", error.message);
    return null;
  }
}

async function getUserReviewers(userId) {
  const p = getPool();
  if (!p || !userId) return [];

  try {
    const query = `
      SELECT id, user_id AS "userId", title, summary, flashcards, multiple_choice AS "multipleChoice", progress, created_at AS "createdAt"
      FROM reviewers
      WHERE user_id = $1
      ORDER BY created_at DESC;
    `;
    const result = await p.query(query, [userId]);
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      title: row.title,
      summary: row.summary,
      flashcards: Array.isArray(row.flashcards) ? row.flashcards : [],
      multipleChoice: Array.isArray(row.multipleChoice) ? row.multipleChoice : [],
      progress: row.progress || {},
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString()
    }));
  } catch (error) {
    console.error("[PostgreSQL] Error in getUserReviewers:", error.message);
    return [];
  }
}

async function syncUserReviewers(userId, reviewersList, totalXp = 0) {
  if (!userId || !Array.isArray(reviewersList)) return [];

  if (totalXp > 0) {
    await updateUserXp(userId, totalXp);
  }

  const saved = [];
  for (const r of reviewersList) {
    if (r && r.id && r.title) {
      const res = await saveReviewerToDb(r, userId);
      if (res) saved.push(res);
    }
  }
  return saved;
}

function isDbConnected() {
  return Boolean(getConnectionString() && pool);
}

module.exports = {
  initDb,
  findOrCreateGoogleUser,
  getUserById,
  updateUserXp,
  saveReviewerToDb,
  getReviewerFromDb,
  getUserReviewers,
  syncUserReviewers,
  isDbConnected
};
