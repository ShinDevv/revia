# Revia · AI Study Buddy & Reviewer 🌟

Revia turns study notes into an AI-powered study reviewer with flashcards, multiple-choice quizzes, gamified progression, shareable study decks, and **Google Accounts** powered by **Neon.tech PostgreSQL**.

---

## Features

- **Google User Accounts**: Sign in with Google to save study decks to your cloud account and access them across all your devices.
- **Automatic Guest-to-User Sync**: Existing local reviewers merge into your Google cloud account upon signing in.
- **AI Reviewer Generator**: Generates concise summaries, flashcards, and multiple-choice questions from pasted lecture notes.
- **Neon PostgreSQL Cloud Storage**: Persists decks in PostgreSQL so materials can be shared across devices via unique links.
- **Shareable Study Links**: One-click link copying (`/reviewer?id=...`) to share any study deck with friends or classmates.
- **Save to Library**: Visitors studying a shared deck can save it to their local library with one click.
- **Gamified Study Room**: Interactive 3D flashcards (with keyboard shortcuts & flip physics), multiple-choice quizzes with star ratings (⭐⭐⭐), and daily study streaks.
- **Playful Children's UI**: 3D pressable buttons, chunky sticker cards, vibrant toy colors, and the cute **Revy** mascot delivering encouragement in comic speech bubbles.
- **Offline PWA Shell**: Fully installable Progressive Web App with offline shell caching.

---

## Requirements

- Node.js 18 or newer
- (Optional) A [Neon.tech](https://neon.tech) PostgreSQL connection string
- (Optional) [Google Cloud Console](https://console.cloud.google.com/) OAuth Client ID for Google Login
- An AI endpoint that accepts standard prompt requests

---

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables (`.env`)**:
   Create a `.env` file in the project root:

   ```env
   # Neon.tech PostgreSQL Connection String
   DATABASE_URL=postgresql://username:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require

   # Google OAuth 2.0 Credentials
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   SESSION_SECRET=revia-super-secret-toy-key-2026

   # AI Endpoints (comma-separated for failover)
   AI_API_URLS=https://ceddsrestapi.vercel.app/ai/chatgpt

   # Port
   PORT=3000
   ```

   > **Note:** If `DATABASE_URL` or `GOOGLE_CLIENT_ID` are omitted, Revia gracefully runs in local-first guest mode using browser `localStorage`.

---

## Run

Start the server:
```bash
npm start
```

For development with hot reload:
```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## Database Schema (Auto-Created)

Revia automatically creates both the `users` and `reviewers` tables in Neon PostgreSQL upon startup:

```sql
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

CREATE TABLE IF NOT EXISTS reviewers (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    flashcards JSONB NOT NULL DEFAULT '[]'::jsonb,
    multiple_choice JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Routes

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `GET /api/auth/config` | `GET` | Get public Google Client ID configuration |
| `POST /api/auth/google` | `POST` | Authenticate with Google ID token & set session cookie |
| `GET /api/auth/me` | `GET` | Get current logged-in user profile & cloud stats |
| `POST /api/auth/logout` | `POST` | Clear session cookie |
| `POST /api/user/sync` | `POST` | Merge client local reviewers into user cloud account |
| `GET /api/user/reviewers` | `GET` | Retrieve all cloud reviewers owned by the user |
| `POST /api/study-deck` | `POST` | Generate reviewer from notes & attach to user |
| `GET /api/reviewer/:id` | `GET` | Fetch reviewer by ID from PostgreSQL for shared links |
| `POST /api/reviewer/share` | `POST` | Upload/sync a reviewer to PostgreSQL to generate a shareable link |
