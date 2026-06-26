# AI Description Generation — Setup & Reference

## How It Works

Descriptions are generated from the video's `.vtt` subtitle file.
The subtitle transcript is extracted, sent to an AI model, and the result is saved to the `videos` table in the database.

**Flow:**
```
VTT file on disk → extract transcript text → send to AI → save description to DB
```

Subtitles are **not** stored in the database — only the file path is. The `.vtt` file must exist on disk for generation to work.

---

## Supported Providers

| Provider | Key in `.env` | Default Model |
|----------|--------------|---------------|
| Gemini (primary) | `GEMINI_API_KEY` | `gemini-2.5-flash-lite` |
| OpenAI (fallback) | `OPENAI_API_KEY` | `gpt-4o-mini` |

Gemini is used first. If Gemini fails, OpenAI is used automatically (if configured).

---

## backend/.env Settings

```env
# Gemini (primary)
GEMINI_API_KEY=your-gemini-key-here
GEMINI_MODEL=gemini-2.5-flash-lite

# OpenAI (fallback — optional but recommended)
OPENAI_API_KEY=sk-your-openai-key-here
OPENAI_MODEL=gpt-4o-mini
```

Get a Gemini key: https://aistudio.google.com/apikey  
Get an OpenAI key: https://platform.openai.com/api-keys

---

## Gemini Model Fallback Chain

When the primary model is overloaded or hits quota, the system automatically tries the next model:

```
gemini-2.5-flash-lite  →  gemini-2.5-flash  →  gemini-2.0-flash
```

Each model gets **3 attempts** with delays of **5s** and **15s** between retries.

---

## Common Errors & Fixes

### `Gemini quota exceeded`
- **Cause:** Free tier limit reached (20 requests/minute or daily cap)
- **Fix 1:** Wait — per-minute quota resets every 60 seconds
- **Fix 2:** Use a different Google account at https://aistudio.google.com/apikey
- **Fix 3:** Enable billing in Google AI Studio (removes free tier limit)
- **Fix 4:** Add `OPENAI_API_KEY` to `.env` as a fallback

### `Gemini is temporarily overloaded`
- **Cause:** Google's servers are under high demand
- **Fix:** The system retries automatically. If it persists, wait a few minutes.

### `Invalid GEMINI_API_KEY`
- **Cause:** Wrong or revoked API key
- **Fix:** Generate a new key at https://aistudio.google.com/apikey and update `backend/.env`, then restart the backend.

### `Subtitles not found for [videoId]`
- **Cause:** No `.vtt` file exists on disk for that video
- **Fix:** Upload a subtitle file manually or wait for automatic subtitle generation to complete.

### `Subtitle transcript is too short`
- **Cause:** The `.vtt` file exists but contains very little text
- **Fix:** Check the subtitle file quality. Re-generate or upload a better `.vtt`.

---

## Subtitle File Locations (checked in order)

1. Co-located beside the video: `video-storage/videos/VIDEO_ID.vtt`
2. Captions folder: `video-storage/captions/VIDEO_ID_en.vtt`
3. Legacy: `subtitles/VIDEO_ID.vtt` or `backend/subtitles/VIDEO_ID.vtt`

---

## AI Prompt Behavior

- Temperature: **0.8** (both Gemini and OpenAI) — higher = more natural, less robotic
- Transcript limit: **12,000 characters**
- OpenAI uses `system` + `user` message split for stronger persona
- Output: single paragraph, 3–6 sentences, no bullet points, no title

The prompt instructs the AI to write like a teacher or content reviewer —
grounded in the actual transcript content, no marketing language, no AI filler phrases.

---

## Files Involved

| File | Purpose |
|------|---------|
| `backend/utils/generateAiDescription.js` | Main entry point — reads VTT, calls AI, saves to DB |
| `backend/utils/geminiClient.js` | Gemini API calls, retry logic, model fallbacks |
| `backend/utils/openaiClient.js` | OpenAI client setup and error formatting |
| `backend/config/loadEnv.js` | Reads `.env`, exposes provider/model config functions |
| `backend/controllers/videoDescriptionController.js` | API endpoints for single and bulk generation |
