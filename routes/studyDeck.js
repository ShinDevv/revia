const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { saveReviewerToDb, getReviewerFromDb } = require("../db");

const GENERIC_ERROR = "Unable to generate reviewer.";
const MIN_CONTENT_LENGTH = 20;
const MAX_CONTENT_LENGTH = 20000;
const MIN_FLASHCARDS = 3;
const MIN_MCQ = 3;

function loadSystemPrompt() {
  const promptPath = path.join(__dirname, "..", "prompts", "studyDeckPrompt.txt");
  return fs.readFileSync(promptPath, "utf8").trim();
}

function uniqueId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function asNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function extractTextFromGemini(payload) {
  if (payload == null) {
    return "";
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (typeof payload !== "object") {
    return "";
  }

  const nestedKeys = [
    "response",
    "text",
    "output",
    "result",
    "message",
    "content",
    "data",
    "answer",
    "generated_text",
    "output_text"
  ];

  for (const key of nestedKeys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (value && typeof value === "object") {
      const nested = extractTextFromGemini(value);
      if (nested) {
        return nested;
      }
    }
  }

  if (Array.isArray(payload.candidates) && payload.candidates[0]) {
    const parts = payload.candidates[0].content && payload.candidates[0].content.parts;
    if (Array.isArray(parts)) {
      return parts.map((part) => (part && part.text) || "").join("\n");
    }
  }

  if (payload.title && payload.flashcards && payload.multipleChoice) {
    return JSON.stringify(payload);
  }

  return "";
}

function parseJsonObject(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    throw new Error("empty");
  }

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(unfenced);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_error) {
    // Fall through to brace extraction.
  }

  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("invalid-json");
  }

  const parsed = JSON.parse(unfenced.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid-json");
  }
  return parsed;
}

function validateAndNormalizeDeck(raw, requestedTitle) {
  const title = asNonEmptyString(raw.title) || asNonEmptyString(requestedTitle);
  const summary = asNonEmptyString(raw.summary);

  if (!title || !summary) {
    throw new Error("invalid-shape");
  }

  if (!Array.isArray(raw.flashcards) || !Array.isArray(raw.multipleChoice)) {
    throw new Error("invalid-shape");
  }

  const usedIds = new Set();

  const flashcards = raw.flashcards.map((card, index) => {
    if (!card || typeof card !== "object") {
      throw new Error("invalid-flashcard");
    }

    const front = asNonEmptyString(card.front);
    const back = asNonEmptyString(card.back);
    let id = asNonEmptyString(card.id) || `fc-${String(index + 1).padStart(3, "0")}`;

    if (!front || !back) {
      throw new Error("invalid-flashcard");
    }

    if (usedIds.has(id)) {
      id = `fc-${String(index + 1).padStart(3, "0")}-${crypto.randomBytes(2).toString("hex")}`;
    }
    usedIds.add(id);

    return { id, front, back };
  });

  const multipleChoice = raw.multipleChoice.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error("invalid-mcq");
    }

    const question = asNonEmptyString(item.question);
    const explanation = asNonEmptyString(item.explanation);
    const options = Array.isArray(item.options)
      ? item.options.map((option) => asNonEmptyString(option)).filter(Boolean)
      : [];
    const answerIndex = Number(item.answerIndex);
    let id = asNonEmptyString(item.id) || `mcq-${String(index + 1).padStart(3, "0")}`;

    if (!question || !explanation || options.length !== 4) {
      throw new Error("invalid-mcq");
    }

    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
      throw new Error("invalid-mcq");
    }

    if (usedIds.has(id)) {
      id = `mcq-${String(index + 1).padStart(3, "0")}-${crypto.randomBytes(2).toString("hex")}`;
    }
    usedIds.add(id);

    return { id, question, options, answerIndex, explanation };
  });

  if (flashcards.length < MIN_FLASHCARDS || multipleChoice.length < MIN_MCQ) {
    throw new Error("insufficient-items");
  }

  return {
    id: uniqueId("reviewer"),
    title,
    summary,
    flashcards,
    multipleChoice,
    createdAt: new Date().toISOString()
  };
}

function buildPrompt(systemPrompt, title, content) {
  const topicLine = title ? `Preferred title/topic: ${title}\n\n` : "";
  const promptLines = systemPrompt.split("\n").map((line) => line.trim()).filter(Boolean);
  const schemaStart = promptLines.indexOf("JSON schema:");
  const rulesStart = promptLines.indexOf("Rules:");
  const schema = schemaStart >= 0 ? promptLines.slice(schemaStart, rulesStart >= 0 ? rulesStart : schemaStart + 12) : [];
  const rules = rulesStart >= 0 ? promptLines.slice(rulesStart, rulesStart + 5) : [];
  const compactPrompt = [...schema, ...rules].join("\n");
  return `${compactPrompt}\n${topicLine}Study material:\n${content}\nReturn ONLY valid JSON. Do not use Markdown or code fences.`;
}

function sendFailure(_req, res) {
  return res.status(502).json({
    success: false,
    error: GENERIC_ERROR
  });
}

function getApiEndpoints() {
  const configured = process.env.AI_API_URLS || process.env.GEMINI_API_URL;
  return (configured || "https://smfahim.xyz/ai/gemini/v3")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

async function requestFromEndpoint(endpoint, prompt, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`upstream-${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function generateStudyDeck(req, res) {
  try {
    const content = asNonEmptyString(req.body && req.body.content);
    const title = asNonEmptyString(req.body && req.body.title);

    if (!content || content.length < MIN_CONTENT_LENGTH) {
      return res.status(400).json({
        success: false,
        error: "Please enter more study material before generating a reviewer."
      });
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({
        success: false,
        error: "Study material is too long. Please shorten it and try again."
      });
    }

    let systemPrompt;
    try {
      systemPrompt = loadSystemPrompt();
    } catch (_error) {
      return sendFailure(req, res);
    }

    const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS) || 90000;
    const fullPrompt = buildPrompt(systemPrompt, title, content);
    let timedOut = false;

    for (const endpoint of getApiEndpoints()) {
      try {
        const payload = await requestFromEndpoint(endpoint, fullPrompt, timeoutMs);
        const rawText = extractTextFromGemini(payload);
        const parsed = parseJsonObject(rawText || payload);
        const reviewer = validateAndNormalizeDeck(parsed, title);

        // Persist to PostgreSQL if configured
        try {
          await saveReviewerToDb(reviewer, req.userId);
        } catch (_dbErr) {
          // Gracefully continue if DB fails
        }

        return res.json({
          success: true,
          reviewer
        });
      } catch (error) {
        if (error && error.name === "AbortError") {
          timedOut = true;
        }
      }
    }

    if (timedOut) {
      return res.status(504).json({
        success: false,
        error: "The reviewer took too long to generate. Please try again."
      });
    }

    return sendFailure(req, res);
  } catch (_error) {
    return sendFailure(req, res);
  }
}

async function getReviewerById(req, res) {
  try {
    const id = asNonEmptyString(req.params && req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Reviewer ID is required."
      });
    }

    const reviewer = await getReviewerFromDb(id);
    if (!reviewer) {
      return res.status(404).json({
        success: false,
        error: "Reviewer not found."
      });
    }

    return res.json({
      success: true,
      reviewer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve reviewer."
    });
  }
}

async function shareReviewer(req, res) {
  try {
    const raw = req.body && req.body.reviewer;
    if (!raw || !raw.id || !raw.title) {
      return res.status(400).json({
        success: false,
        error: "Invalid reviewer data."
      });
    }

    // Persist/Sync to PostgreSQL
    const saved = await saveReviewerToDb(raw, req.userId);
    const host = req.get("host") || "localhost:3000";
    const protocol = req.protocol || "http";
    const shareUrl = `${protocol}://${host}/reviewer?id=${encodeURIComponent(raw.id)}`;

    return res.json({
      success: true,
      shareUrl,
      savedToCloud: Boolean(saved)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Failed to share reviewer."
    });
  }
}

module.exports = {
  generateStudyDeck,
  getReviewerById,
  shareReviewer
};
