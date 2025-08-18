## Voice Tasker

Telegram bot that converts voice notes into Google Tasks using OpenAI Whisper + GPT-5 Mini, deployed on Vercel. Uses Upstash QStash for background processing.

### Quick Start

1. Copy `.env.example` to `.env` and fill values.
2. Install deps: `npm install`
3. Optional: verify Google OAuth refresh flow: `npm run get-google-token`
4. Run locally: `vercel dev`
5. Deploy: push to GitHub; Vercel auto-deploys.

### Endpoints

- `POST /api/telegram`: Telegram webhook; fast ACK and enqueue to QStash.
- `POST /api/worker`: Background processor (QStash). Protected with `Authorization: Bearer WORKER_SHARED_SECRET`.
- `GET /api/list-tasklists`: Helper to list Google Task lists.

### Environment

Create a `.env` file with:

```
# Telegram
TELEGRAM_BOT_TOKEN=

# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-mini

# Google APIs
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=

# Upstash QStash
QSTASH_TOKEN=

# App
PUBLIC_BASE_URL=
WORKER_SHARED_SECRET=

# Categories
CATEGORY_LIST_JSON=["Personal","Charities Unit","Onboarding","Learning & Development (L&D)","Finance","HR","Staffing","Knowledge Management (KM)","General Operations"]

# Optional mappings
CATEGORY_TO_LIST_JSON={}
DEFAULT_TASKLIST_ID=
```

### Webhook Setup

```
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-app.vercel.app/api/telegram"}'
```


