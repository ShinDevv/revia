require("dotenv").config();

const express = require("express");
const path = require("path");
const { initDb } = require("./db");
const { generateStudyDeck, getReviewerById, shareReviewer } = require("./routes/studyDeck");
const {
  authMiddleware,
  getAuthConfig,
  handleGoogleLogin,
  getMe,
  handleLogout,
  handleSyncReviewers,
  handleGetUserReviewers
} = require("./routes/auth");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(authMiddleware);
app.use(express.static(path.join(__dirname, "public")));

// Auth & User Routes
app.get("/api/auth/config", getAuthConfig);
app.post("/api/auth/google", handleGoogleLogin);
app.get("/api/auth/me", getMe);
app.post("/api/auth/logout", handleLogout);
app.post("/api/user/sync", handleSyncReviewers);
app.get("/api/user/reviewers", handleGetUserReviewers);

// Study Deck Routes
app.post("/api/study-deck", generateStudyDeck);
app.get("/api/reviewer/:id", getReviewerById);
app.post("/api/reviewer/share", shareReviewer);

// Page Routing
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return next();
  }

  const pageRoutes = {
    "/create": "pages/create.html",
    "/library": "pages/library.html",
    "/reviewer": "pages/reviewer.html"
  };

  const page = pageRoutes[req.path];
  if (page) {
    return res.sendFile(path.join(__dirname, "public", page));
  }

  return next();
});

// Error handling
app.use((err, _req, res, _next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      error: "Unable to parse request."
    });
  }

  return res.status(500).json({
    success: false,
    error: "Internal server error."
  });
});

// Start Server and Initialize Database
app.listen(port, async () => {
  console.log(`Revia is running at http://localhost:${port}`);
  await initDb();
});
