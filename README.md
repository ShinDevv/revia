# Revia

Revia turns study notes into an AI-powered reviewer with flashcards and multiple-choice quizzes. Reviewers are saved locally in the browser, so no account is required.

## Features

- Generate a reviewer from pasted notes
- Study with interactive flashcards
- Test knowledge with multiple-choice quizzes
- Search, rename, and delete saved reviewers
- Light and dark themes for desktop and mobile
- Automatic AI endpoint failover
- Installable progressive web app

## Requirements

- Node.js 18 or newer
- An AI endpoint that accepts the request described below

## Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file in the project root. Configure one or more endpoints in priority order:

```env
AI_API_URLS=https://ceddsrestapi.vercel.app/ai/chatgpt
PORT=3000
```

`AI_API_URLS` is a comma-separated list. Revia tries each endpoint until one returns a valid reviewer. The configured default is `https://ceddsrestapi.vercel.app/ai/chatgpt`.

## Run

Start the server:

```bash
npm start
```

For development with automatic server restarts:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## AI endpoint contract

Each configured endpoint receives a `POST` request with JSON:

```json
{
	"prompt": "..."
}
```

The response may be reviewer JSON directly or JSON/text wrapped in a `response`, `text`, `output`, `result`, `message`, `content`, `data`, `answer`, `generated_text`, or `output_text` field.

The reviewer must contain a title, summary, at least three flashcards, and at least three multiple-choice questions. Each flashcard needs `front` and `back`. Each question needs `question`, four `options`, `answerIndex`, and `explanation`.

## Routes

| URL | Purpose |
| --- | --- |
| `/` | Dashboard |
| `/create` | Generate a reviewer |
| `/library` | Browse saved reviewers |
| `/reviewer?id=...` | Study a reviewer |
| `POST /api/study-deck` | Generate reviewer data |
## Progress

Flashcard ratings, mastery, streaks, quiz results, study sessions, and last-studied dates are saved inside each reviewer in local storage. Existing reviewers are upgraded with default progress values automatically.

## Data and privacy

Generated reviewers are stored in the browser's local storage on the current device. The server forwards submitted study material to the configured AI endpoints to generate the reviewer.
