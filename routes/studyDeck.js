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
    console.log("[StudyDeck] extractTextFromGemini: payload is null");
    return "";
  }

  if (typeof payload === "string") {
    console.log("[StudyDeck] extractTextFromGemini: payload is already a string");
    return payload;
  }

  if (typeof payload !== "object") {
    console.log("[StudyDeck] extractTextFromGemini: payload is not an object");
    return "";
  }

  console.log("[StudyDeck] extractTextFromGemini: payload keys:", Object.keys(payload));

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
      console.log("[StudyDeck] extractTextFromGemini: found string at key:", key);
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
      console.log("[StudyDeck] extractTextFromGemini: found Gemini candidates format");
      return parts.map((part) => (part && part.text) || "").join("\n");
    }
  }

  if (payload.title && payload.flashcards && payload.multipleChoice) {
    console.log("[StudyDeck] extractTextFromGemini: payload looks like valid deck structure, converting to JSON");
    return JSON.stringify(payload);
  }

  console.log("[StudyDeck] extractTextFromGemini: could not extract text from payload");
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
    console.error("[StudyDeck] Initial JSON parse failed, attempting brace extraction:", _error?.message);
  }

  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) {
    console.error("[StudyDeck] No valid JSON braces found in response");
    throw new Error("invalid-json");
  }

  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid-json");
    }
    return parsed;
  } catch (err) {
    console.error("[StudyDeck] JSON parse from extracted braces failed:", err?.message);
    throw err;
  }
}

function validateAndNormalizeDeck(raw, requestedTitle) {
  const title = asNonEmptyString(raw.title) || asNonEmptyString(requestedTitle);
  const summary = asNonEmptyString(raw.summary);

  if (!title || !summary) {
    console.error("[StudyDeck] Missing title or summary. Title:", !!title, "Summary:", !!summary);
    throw new Error("invalid-shape");
  }

  if (!Array.isArray(raw.flashcards) || !Array.isArray(raw.multipleChoice)) {
    console.error("[StudyDeck] Invalid arrays. Flashcards is array:", Array.isArray(raw.flashcards), "MCQ is array:", Array.isArray(raw.multipleChoice));
    throw new Error("invalid-shape");
  }

  console.log(`[StudyDeck] Processing ${raw.flashcards.length} flashcards and ${raw.multipleChoice.length} MCQ items`);

  const usedIds = new Set();

  const flashcards = raw.flashcards.map((card, index) => {
    if (!card || typeof card !== "object") {
      console.error(`[StudyDeck] Invalid flashcard at index ${index}:`, card);
      throw new Error("invalid-flashcard");
    }

    const front = asNonEmptyString(card.front);
    const back = asNonEmptyString(card.back);
    let id = asNonEmptyString(card.id) || `fc-${String(index + 1).padStart(3, "0")}`;

    if (!front || !back) {
      console.error(`[StudyDeck] Flashcard ${index} missing front or back. Front:`, !!front, "Back:", !!back);
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
      console.error(`[StudyDeck] Invalid MCQ at index ${index}:`, item);
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
      console.error(`[StudyDeck] MCQ ${index} invalid. Question:`, !!question, "Explanation:", !!explanation, "Options count:", options.length);
      throw new Error("invalid-mcq");
    }

    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
      console.error(`[StudyDeck] MCQ ${index} has invalid answerIndex:`, answerIndex);
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

function getGeminiApiKeys() {
  return (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

function getGeminiModel() {
  return process.env.GEMINI_MODEL || "gemini-3.6-flash";
}

async function requestFromGemini(apiKey, prompt, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const model = encodeURIComponent(getGeminiModel());
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = errorBody;
      try {
        errorMessage = JSON.parse(errorBody)?.error?.message || errorBody;
      } catch (_error) {
        // Keep the plain-text upstream response when it is not JSON.
      }
      throw new Error(`upstream-${response.status}: ${String(errorMessage).slice(0, 240)}`);
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
      console.error("[StudyDeck] Failed to load system prompt:", _error?.message || _error);
      return sendFailure(req, res);
    }

    const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS) || 90000;
    const fullPrompt = buildPrompt(systemPrompt, title, content);
    let timedOut = false;
    const apiKeys = getGeminiApiKeys();
    if (!apiKeys.length) {
      console.error("[StudyDeck] No Gemini API keys configured");
      return res.status(503).json({
        success: false,
        error: "AI generation is not configured. Add a Gemini API key to the server environment."
      });
    }

    console.log(`[StudyDeck] Attempting generation with ${apiKeys.length} Gemini API key(s) using ${getGeminiModel()}`);

    for (let index = 0; index < apiKeys.length; index += 1) {
      try {
        console.log(`[StudyDeck] Calling Gemini key ${index + 1}/${apiKeys.length}`);
        const payload = await requestFromGemini(apiKeys[index], fullPrompt, timeoutMs);
        console.log(`[StudyDeck] Received payload:`, JSON.stringify(payload).substring(0, 200));
        
        const rawText = extractTextFromGemini(payload);
        console.log(`[StudyDeck] Extracted text:`, rawText?.substring(0, 200) || "(empty)");
        
        const parsed = parseJsonObject(rawText || payload);
        console.log(`[StudyDeck] Parsed JSON successfully`);
        
        const reviewer = validateAndNormalizeDeck(parsed, title);
        console.log(`[StudyDeck] Validated deck successfully`);

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
        const errorMsg = error?.message || String(error);
        console.error(`[StudyDeck] Error with Gemini key ${index + 1}:`, errorMsg);
        
        if (error && error.name === "AbortError") {
          timedOut = true;
          console.warn(`[StudyDeck] Request timed out for Gemini key ${index + 1}`);
        }
      }
    }

    if (timedOut) {
      return res.status(504).json({
        success: false,
        error: "The reviewer took too long to generate. Please try again."
      });
    }

    console.error("[StudyDeck] All Gemini API keys failed to generate reviewer");
    return sendFailure(req, res);
  } catch (_error) {
    console.error("[StudyDeck] Unexpected error in generateStudyDeck:", _error?.message || _error);
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
