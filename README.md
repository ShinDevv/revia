# revia

## Configuration

Set `AI_API_URLS` to a comma-separated list of POST endpoints. Revia tries them in order and uses the first one that returns a valid reviewer deck.

```env
AI_API_URLS=https://smfahim.xyz/ai/gemini/v3,https://ceddsrestapi.vercel.app/ai/chatgpt
GEMINI_TIMEOUT_MS=90000
```

Each endpoint receives JSON in the form `{ "prompt": "..." }` and may return the reviewer JSON directly or wrapped in a text/response field.
