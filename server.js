require("dotenv").config();

const express = require("express");
const path = require("path");
const { generateStudyDeck, expandStudyDeck } = require("./routes/studyDeck");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/study-deck", generateStudyDeck);
app.post("/api/study-deck/expand", expandStudyDeck);

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

app.use((err, _req, res, _next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      error: "Unable to generate reviewer."
    });
  }

  return res.status(500).json({
    success: false,
    error: "Unable to generate reviewer."
  });
});

app.listen(port, () => {
  console.log(`Revia is running at http://localhost:${port}`);
});
