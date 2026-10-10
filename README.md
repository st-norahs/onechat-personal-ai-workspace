# OneChat

OneChat is a personal, local-first workspace for conversations across AI providers. It has a progressive web app shell, local history, offline draft mode, export, and an optional server-side Vercel AI Gateway connection for live models.

## Run locally

1. Install Node.js 20.12 or later.
2. (Optional, for live AI) Run `Copy-Item .env.example .env` in PowerShell, then put your own `AI_GATEWAY_API_KEY` from the Vercel AI Gateway dashboard in `.env`.
3. Run `npm run start` and open `http://localhost:4173`.

Without a Gateway key, OneChat still works for local chat drafts and history, but it does not invent demo model answers. The server reads the key from `.env`; the browser never receives it. The key grants billable model access, so keep `.env` private. The server binds to `127.0.0.1` for local use.

The service worker and offline cache work on localhost and HTTPS. Browser storage is device-specific and can be cleared by the browser. An export is JSON, not encrypted; do not put it in Drive or another shared location until encrypted backup is implemented. Local browser storage is not encrypted against someone who can access your unlocked device or browser profile.

Auto routing is a transparent keyword-based task heuristic: research and current-information prompts prefer Perplexity, code prompts prefer Claude, image/audio prompts prefer Gemini, reasoning prompts prefer OpenAI, and writing prompts prefer Claude. It then ranks the currently available models by catalog names. Review the selected provider and model above the conversation; choosing a provider pill overrides Auto. This is a practical default, not an independent benchmark of model quality.

## Current features

- Chat workspace with six provider choices: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, and Perplexity.
- Live model catalog and streamed chat via Vercel AI Gateway when configured.
- Dark interface and Auto routing by task; manual provider/model selection remains available.
- Conversation list, new chat, search, copy, local draft export, mobile layout, and offline status.
- PWA shell caching and local browser storage.
- Review-before-sharing draft flow. No account sign-up, publishing, or external action happens in this prototype.

## Security and hosting boundaries

Google Drive is suitable for storing a backup file, but it does not run this app's server and is not a secure secret manager. A static app hosted in Drive cannot safely hold provider API keys. The optional Gateway connection sends prompts through Vercel AI Gateway and then to the selected model provider; their service terms and data handling apply. For a hosted deployment, keep keys in the host's secret store, add user authentication, enforce per-user provider allowlists and rate limits, and avoid logging prompts or keys. Only request the permissions needed for each integration.

No app can honestly promise that it cannot be hacked. A responsible release needs dependency updates, security review, backups, abuse controls, and a recovery plan. Offline mode can display saved conversations and accept drafts; online model inference and external app actions require network access. Cross-device sync requires an authenticated sync service or an encrypted file you move between devices.

## Suggested next milestones

1. Add authenticated user sessions and redacted logs before making the backend public.
2. Add browser-side encryption and encrypted export/import before enabling Drive backup.
3. Add shared prompts, side-by-side answers, research folders, citations, file ingestion, and model-specific tools.
4. Add OAuth integrations individually, with scopes shown to the user and confirmation before publishing or changing accounts.
5. Deploy the static PWA over HTTPS and the API separately. Drive can be an optional backup destination through the Google Drive API.

## Model catalog

The model selector loads current models from the Gateway catalog instead of relying on hard-coded model names. Availability depends on Gateway access, provider routing, and model availability. See [Gateway API docs](https://vercel.com/docs/ai-gateway/openai-compat/rest-api) and [Gateway authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok).
