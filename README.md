# Salt

Salt is a local-first AI chat and coding workspace. This repository contains the app shell; hosted model calls use the server-side Vercel AI Gateway, and the optional small local model runs in the browser after its first download.

## Run locally

Requirements: Node.js 20.12 or newer.

```powershell
npm install
npm run build
npm start
```

Open <http://localhost:4173>. To enable hosted providers, add `AI_GATEWAY_API_KEY` to a local `.env` or `.env.txt` file. If both exist, `.env.txt` takes precedence. For Drive backup sync, create a Google OAuth **Web application** client ID, enable the Google Drive API, add `http://localhost:4173`, `http://localhost:4174`, and the HTTPS deployment origin to its authorized JavaScript origins, then add `GOOGLE_CLIENT_ID` to an env file. Never commit either env file; `.gitignore` excludes them. The Gateway key remains server-side. Local development workspace execution also requires Docker Desktop with its engine running. Code containers are restricted and run without network access by default; dependency installs require an explicit user action.

## Voice mode

The first time you open voice mode on a browser profile, choose **Enroll voice** and say the displayed phrase twice. Salt keeps a compact MFCC audio-feature profile in that browser’s local storage; the enrollment recordings are analyzed in memory and discarded. Future entries prompt for the phrase and compare it locally. To use another device or browser profile, enroll there too. Use **Forget this voiceprint** to remove the saved profile.

This is an experimental convenience match, not secure authentication. Similar voices or a recording may pass, and microphone changes may reject the enrolled speaker. Do not use it to protect sensitive information. Speech transcription is separate and only starts in browsers that support local speech recognition; supported browsers may need a one-time language-pack download.

## Avatar library

The local `avatar-data/` folder has `portraits/`, `outfits/`, `hairstyles/`, `gestures/`, `speech/`, and `references/` subfolders. Drop supported media into a folder or add it in **Voice mode → Avatar studio**. Salt scans the library every 20 seconds while voice mode is open, switches to a newly added look, and caches served assets for offline use. Supported uploads are PNG/JPEG/WebP/GIF images, MP4/WebM gesture clips, and MP3/WAV/OGG/M4A speech clips, up to 8 MB each. Broken or missing media falls back to the animated 3D avatar. Files stay in `avatar-data/`, which is ignored by Git so personal images are not included in a public repository.

### Daily outfit studio

Open **Voice → Avatar studio → Outfit of the day**. Select a theme, clothing style, hair, accessory, background, and a saved identity reference. The supplied weekly showcase is a collage; use **Prepare a single-person identity reference** to crop its central Salt portrait before image editing. The reference is sent to Vercel AI Gateway only after a parent unlocks controls and approves the request. The current server-side default is `openai/gpt-image-2`; requests use AI Gateway’s image-edit endpoint. Model edits can still change facial details, so review each result. Parent controls use a PIN/passphrase of at least eight characters; a salted scrypt hash is stored locally in ignored `avatar-data/parent-controls.json`, and an unlock expires after 15 minutes. A parent can set a daily image limit from 1–10; the default is one per UTC day. Successful images are content-hash cached, deduplicated, validated, limited to 8 MB, and saved in the local outfits folder. Failed attempts and successes are counted for the current UTC day. Approved favorites/history are device-local; upload/media saves can trigger an encrypted Drive snapshot when a session key and Drive token are active.

Image generation sends the selected reference image and outfit prompt to Vercel AI Gateway and its routed provider. It is not offline. Keep the Gateway key server-side and review the provider’s image/privacy terms before using a child’s photo. This local loopback PIN is a parental speed bump, not a substitute for operating-system sign-in or a hardened hosted authentication service.

## Data and deployment

Drive sync is user initiated from **Settings → Google Drive workspace sync**. Salt encrypts chats, preferences, avatar media, and supported text files from coding projects in the browser with a passphrase before uploading a replaceable backup file to a visible `Salt Workspace` Drive folder. The OAuth access token is memory-only and requests the `drive.file` scope. Restore downloads the encrypted file and asks for the passphrase; chat history is replaced, while project and avatar files are merged and same-named files overwritten. Archives are capped at 40 MB plaintext, 12 MB avatar media, and 10 MB project text; hidden files, generated folders, and binary project files are omitted. Voice profiles, provider keys, offline model weights, dependencies, and Salt app source are excluded. Keep Salt's source in Git and deploy the built PWA to an HTTPS host; Drive is storage and sync, not an application server or installer. The local offline model and dependencies must be downloaded on each device. When a hosted model is selected, prompts pass through the configured AI Gateway and then to the selected model provider. Review those providers’ policies before sending sensitive content. The public repository contains no app secrets; provide your own server-side key for hosted model access.

## Media and web search

Open **Media & web search** in the sidebar. Web and movie searches open Google in a new tab. Enter a movie title before using the movie shortcut; it searches for official streaming, rental, and purchase options. **Public-domain films & videos** searches for downloadable works labeled as public domain or Creative Commons. Search results are external and Salt does not verify licenses or source safety.

To locate a scene in your own collection, choose a screenshot and up to 30 local video files. Salt samples frames in the browser, computes a rough visual similarity score, and returns likely timestamps. The selected files stay in the browser; this is an approximate visual match, not face recognition or a guaranteed result. It skips files over 2 GB.

For a video you have permission to download, the app can transcode a local file to a 720p or 480p WebM copy using the browser's MediaRecorder. This is local processing; it may take the length of the video, can fail on unsupported browsers/codecs, and may not retain subtitles or every audio track. A direct URL download is only a browser handoff: the app does not crawl arbitrary sites, bypass DRM/paywalls, or fetch copyrighted movies from unauthorized sources. Use licensed public-domain/Creative Commons files, a creator's download, or official watch/rent/buy services.

## Email, LinkedIn, and scheduled drafts

Open **Create & publish** or choose **Use in a post** below an assistant response. Drafts, recipient addresses, and schedule times are stored in this browser and included in encrypted Salt workspace backups. Email opens the device's `mailto:` handler for a final review. LinkedIn copies the draft and opens LinkedIn; paste it into LinkedIn and publish there. No post or email is sent by saving a draft.

Schedules are local reminders, not background publishing: Salt marks a scheduled draft **ready for review** while the app is open. It cannot send at a future time when the browser or machine is closed. For direct publishing, connect a trusted publishing MCP server and explicitly call its publishing tool. Review its access scopes and tool behavior; remote platforms still enforce their own API, account, and rate limits, so Salt cannot promise unlimited posting or emailing.

## Windows: Vercel AI Gateway key

`npx vercel ai-gateway setup` configures supported coding agents on the machine; it does not fill Salt's project `.env` file. On Windows PowerShell, from the Salt repository root:

```powershell
Copy-Item .env.example .env
notepad .env
```

In Notepad, set `AI_GATEWAY_API_KEY=...` in `.env` or `.env.txt` with a newly created key from the Vercel AI Gateway dashboard, save the file, and restart Salt with `npm start`. `.env.txt` wins if both files exist. Keep both files local; `.gitignore` excludes them. If a key was pasted into a shell transcript, chat, or public repo, revoke it and create a replacement before use.

## MCP app connections

Open **Settings & connections → MCP connections**. Remote servers must use HTTPS and have a public network address; paste any bearer token only into the connection form. Local stdio servers require you to check the trust confirmation because they run a program as your Windows user. Connections and tokens live in server memory and are cleared when Salt stops. Salt lists the server's tools, resources, and prompts; choose and confirm each action manually. A tool may change data or publish externally, so inspect its description and arguments before running it. The MCP feature does not make every app compatible; each service needs its own MCP server or supported connector.
