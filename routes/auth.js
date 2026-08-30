const crypto = require("crypto");
const {
  findOrCreateGoogleUser,
  getUserById,
  getUserReviewers,
  syncUserReviewers
} = require("../db");

const SECRET = process.env.SESSION_SECRET || "revia-toy-session-secret-key-2026";
const COOKIE_NAME = "revia_session";
const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function createSignedToken(userId) {
  const expiresAt = Date.now() + TOKEN_MAX_AGE_MS;
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt })).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySignedToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expectedSig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");

  if (signature !== expectedSig) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.userId || !data.expiresAt || data.expiresAt < Date.now()) {
      return null;
    }
    return data.userId;
  } catch (_e) {
    return null;
  }
}

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers && req.headers.cookie;
  if (!cookieHeader) return list;

  cookieHeader.split(";").forEach((cookie) => {
    let [name, ...rest] = cookie.split("=");
    name = name && name.trim();
    if (!name) return;
    const value = rest.join("=").trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function authMiddleware(req, _res, next) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME] || (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ""));
  const userId = verifySignedToken(token);
  req.userId = userId || null;
  next();
}

function getAuthConfig(req, res) {
  return res.json({
    success: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    isGoogleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID)
  });
}

async function handleGoogleLogin(req, res) {
  try {
    const credential = req.body && req.body.credential;
    if (!credential) {
      return res.status(400).json({
        success: false,
        error: "Missing Google credential token."
      });
    }

    // Verify token with Google tokeninfo endpoint
    const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
    const googleRes = await fetch(verifyUrl);
    
    if (!googleRes.ok) {
      return res.status(401).json({
        success: false,
        error: "Google token verification failed."
      });
    }

    const payload = await googleRes.json();
    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || payload.given_name || "Study Hero";
    const avatarUrl = payload.picture || null;

    if (!googleId || !email) {
      return res.status(400).json({
        success: false,
        error: "Invalid profile data from Google."
      });
    }

    // Find or create in Neon PostgreSQL
    const user = await findOrCreateGoogleUser({
      googleId,
      email,
      name,
      avatarUrl
    });

    if (!user) {
      return res.status(500).json({
        success: false,
        error: "Failed to save user account."
      });
    }

    // Issue Session Cookie
    const token = createSignedToken(user.id);
    const isSecure = req.secure || req.headers["x-forwarded-proto"] === "https";

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      maxAge: TOKEN_MAX_AGE_MS,
      path: "/"
    });

    return res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error("[Auth] Google Login Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Unable to complete Google sign-in."
    });
  }
}

async function getMe(req, res) {
  if (!req.userId) {
    return res.json({
      success: true,
      user: null
    });
  }

  try {
    const user = await getUserById(req.userId);
    return res.json({
      success: true,
      user: user || null
    });
  } catch (_error) {
    return res.json({
      success: true,
      user: null
    });
  }
}

function handleLogout(_req, res) {
  res.clearCookie(COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "lax"
  });
  return res.json({
    success: true
  });
}

async function handleSyncReviewers(req, res) {
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required to sync reviewers."
    });
  }

  try {
    const reviewersList = Array.isArray(req.body && req.body.reviewers) ? req.body.reviewers : [];
    const saved = await syncUserReviewers(req.userId, reviewersList);
    return res.json({
      success: true,
      syncedCount: saved.length
    });
  } catch (error) {
    console.error("[Auth] Sync error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to sync study decks."
    });
  }
}

async function handleGetUserReviewers(req, res) {
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required."
    });
  }

  try {
    const reviewers = await getUserReviewers(req.userId);
    return res.json({
      success: true,
      reviewers
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve user decks."
    });
  }
}

module.exports = {
  authMiddleware,
  getAuthConfig,
  handleGoogleLogin,
  getMe,
  handleLogout,
  handleSyncReviewers,
  handleGetUserReviewers
};
