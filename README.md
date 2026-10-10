# OneChat

OneChat is a personal, local-first workspace prototype for conversations across AI providers. This first build is a progressive web app shell with a working chat UI, local history, offline draft mode, and export. Model replies are demo content; provider connection buttons are placeholders.

## Run locally

1. Install Node.js 20 or later.
2. Run `npm run start` and open `http://localhost:4173`.

The service worker and offline cache work on localhost and HTTPS. Browser storage is device-specific and can be cleared by the browser. An export is JSON, not encrypted; do not put it in Drive or another shared location until encrypted backup is implemented. Local browser storage is not encrypted against someone who can access your unlocked device or browser profile.

## Current features

- Chat workspace with six provider choices: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, and Perplexity.
- Conversation list, new chat, search, copy, local draft export, mobile layout, and offline status.
- PWA shell caching and local browser storage.
- Review-before-sharing draft flow. No account sign-up, publishing, or external action happens in this prototype.

## Security and hosting boundaries

Google Drive is suitable for storing a backup file, but it does not run this app's server and is not a secure secret manager. A static app hosted in Drive cannot safely hold provider API keys. For real model access, deploy a small backend/API gateway on a proper application host; keep keys in that host's secret store; authenticate users; enforce per-user provider allowlists and rate limits; and avoid logging prompts or keys. Only request the permissions needed for each integration.

No app can honestly promise that it cannot be hacked. A responsible release needs dependency updates, security review, backups, abuse controls, and a recovery plan. Offline mode can display saved conversations and accept drafts; online model inference and external app actions require network access. Cross-device sync requires an authenticated sync service or an encrypted file you move between devices.

## Suggested next milestones

1. Add a backend with authenticated user sessions, per-provider adapters, rate limiting, and redacted logs.
2. Connect one provider at a time; load its available models from its official model-list endpoint instead of relying on hard-coded names.
3. Add browser-side encryption for local history and encrypted export/import before enabling Drive backup.
4. Add side-by-side responses, citations, streaming, file ingestion, and model-specific tool support.
5. Add OAuth integrations individually, with scopes shown to the user and an explicit confirmation before every publish or account change.
6. Deploy the static PWA over HTTPS and the API separately. Drive can be an optional backup destination through the Google Drive API.

## Model catalog note

The labels in the UI are discovery defaults as of October 10, 2026 and can change or be unavailable to a particular account. Official provider documentation should be checked when implementing each live adapter: [OpenAI models](https://platform.openai.com/docs/models), [Anthropic model lifecycle](https://docs.anthropic.com/en/docs/about-claude/model-deprecations), [Google Gemini models](https://ai.google.dev/gemini-api/docs/models), [xAI models](https://docs.x.ai/developers/rest-api-reference/inference/models), [DeepSeek models](https://api-docs.deepseek.com/api/list-models/), [Perplexity API docs](https://docs.perplexity.ai/).
