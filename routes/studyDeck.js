const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

  if ((payload.title && payload.flashcards && payload.multipleChoice) || payload.flashcards || payload.multipleChoice) {
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
  return `${systemPrompt}\n\n${topicLine}Study material:\n${content}`;
}

function normalizeComparable(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicate(candidate, existing) {
  if (candidate === existing || !candidate || !existing) return candidate === existing;
  const candidateWords = new Set(candidate.split(" "));
  const existingWords = new Set(existing.split(" "));
  const shared = [...candidateWords].filter((word) => existingWords.has(word)).length;
  return shared / Math.max(candidateWords.size, existingWords.size) >= 0.85;
}

function extractExpansion(raw) {
  const flashcards = Array.isArray(raw.flashcards) ? raw.flashcards : [];
  const multipleChoice = Array.isArray(raw.multipleChoice) ? raw.multipleChoice : [];
  return {
    flashcards: flashcards.filter((card) => asNonEmptyString(card?.front) && asNonEmptyString(card?.back)).map((card) => ({
      id: uniqueId("fc"),
      front: asNonEmptyString(card.front),
      back: asNonEmptyString(card.back),
      stats: { correct: 0, incorrect: 0, streak: 0, mastered: false }
    })),
    multipleChoice: multipleChoice.filter((item) => (
      asNonEmptyString(item?.question) &&
      asNonEmptyString(item?.explanation) &&
      Array.isArray(item.options) && item.options.length === 4 && item.options.every((option) => asNonEmptyString(option)) &&
      Number.isInteger(Number(item.answerIndex)) && Number(item.answerIndex) >= 0 && Number(item.answerIndex) <= 3
    )).map((item) => ({
      id: uniqueId("mcq"),
      question: asNonEmptyString(item.question),
      options: item.options.map(asNonEmptyString),
      answerIndex: Number(item.answerIndex),
      explanation: asNonEmptyString(item.explanation)
    }))
  };
}

function filterExpansion(existing, addition) {
  const flashcardKeys = new Set((existing.flashcards || []).map((card) => normalizeComparable(`${card.front} ${card.back}`)));
  const questionKeys = new Set((existing.multipleChoice || []).map((item) => normalizeComparable(`${item.question} ${item.options?.[item.answerIndex] || ""}`)));
  const flashcards = [];
  const multipleChoice = [];

  addition.flashcards.forEach((card) => {
    const key = normalizeComparable(`${card.front} ${card.back}`);
    if (key && ![...flashcardKeys].some((existing) => isNearDuplicate(key, existing))) {
      flashcardKeys.add(key);
      flashcards.push(card);
    }
  });
  addition.multipleChoice.forEach((item) => {
    const key = normalizeComparable(`${item.question} ${item.options[item.answerIndex]}`);
    if (key && ![...questionKeys].some((existing) => isNearDuplicate(key, existing))) {
      questionKeys.add(key);
      multipleChoice.push(item);
    }
  });
  return { flashcards, multipleChoice };
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

async function requestFromEndpoint(endpoint, prompt, timeoutMs, context = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt, ...context }),
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

async function expandStudyDeck(req, res) {
  try {
    const reviewer = req.body && req.body.reviewer;
    const request = asNonEmptyString(req.body && req.body.request);
    if (!reviewer || !request) {
      return res.status(400).json({ success: false, error: "Please describe what to add." });
    }

    const systemPrompt = loadSystemPrompt();
    const expansionPrompt = `${systemPrompt}

You are expanding an existing study deck. Return ONLY a raw JSON object with "flashcards" and "multipleChoice" arrays. Create genuinely new material and NEVER repeat, rephrase, or test the same fact as the existing content. Existing title: ${reviewer.title}
Existing summary: ${reviewer.summary}
Existing flashcards: ${JSON.stringify(reviewer.flashcards || [])}
Existing multiple-choice questions: ${JSON.stringify(reviewer.multipleChoice || [])}
User expansion request: ${request}
Return only the new flashcards and questions. It is acceptable to return fewer items than requested if no more unique material is supported.`;

    let timedOut = false;
    for (const endpoint of getApiEndpoints()) {
      try {
        const payload = await requestFromEndpoint(
          endpoint,
          expansionPrompt,
          Number(process.env.GEMINI_TIMEOUT_MS) || 90000,
          { mode: "expand", reviewer, request }
        );
        const parsed = parseJsonObject(extractTextFromGemini(payload) || payload);
        const addition = filterExpansion(reviewer, extractExpansion(parsed));
        if (!addition.flashcards.length && !addition.multipleChoice.length) continue;
        return res.json({
          success: true,
          addition,
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        if (error && error.name === "AbortError") timedOut = true;
      }
    }

    return res.status(timedOut ? 504 : 502).json({
      success: false,
      error: timedOut ? "The expansion took too long." : "Unable to expand your reviewer."
    });
  } catch (_error) {
    return sendFailure(req, res);
  }
}

module.exports = {
  generateStudyDeck,
  expandStudyDeck
};
