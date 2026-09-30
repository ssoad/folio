# Folio server

One Go binary with three optional services:

| Service | Enable with | Port |
|---|---|---|
| File server (the "Docker" sync data source), OPDS catalog | `ENABLE_HTTP_SERVER=true`, `ENABLE_OPDS=true` | `PORT` (8080) |
| KOReader progress sync | `ENABLE_KOREADER_SERVER=true` | 7200 |
| Folio services (everything beyond reading) | `ENABLE_PRO_SERVER=true` | `PORT` (8080) |

## Folio services

Folio has no central cloud: everything beyond reading local books comes from
the server you run. People create an account on it from the app
(**Settings → Server**), with email and password or Google, and their
package decides which features they get and how much of them per month.
You manage everything in the admin panel at `/admin`.

### Accounts and the admin panel

1. Start the server and open `https://your-server/admin`. Create the first
   admin with the setup code printed in the server log, or set
   `ADMIN_EMAIL` and `ADMIN_PASSWORD`, which create (or reset) that admin at
   startup.
2. **Packages**: create plans such as Free, Pro and Family. Each has
   features (AI, voices, OCR, metadata, sync, downloads, cloud drives),
   optional monthly limits (AI requests, voice characters, OCR pages), a
   duration and a price label shown in the app.
3. **Settings**: choose the default package (everyone without an active
   subscription gets it, and ended plans fall back to it), write the payment
   instructions shown in the app, and set up email (verification, password
   reset) and Google sign-in.
4. People get a package in three ways:
   - **Promo codes** (Promo codes page): single or bulk, with uses, days of
     access and an expiry date. Users redeem them in the app.
   - **Buying a plan**: they pick a plan in the app, pay you outside the app
     following your instructions, and send their payment reference. You
     approve the request (Access requests page), choosing the days.
   - **Special access**: a free-text request you approve with any package.
   You can also give or cancel a package on a user's page.
5. On a user's page you also see their usage, subscription history and
   signed-in devices, and can sign them out, disable, promote or delete them.

A feature works when the server provides it (see below) and the user's
package includes it. The accounts database is SQLite at `PRO_DB_PATH`
(Docker: the `/app/data` volume); back it up.

`PRO_ACCESS_TOKEN` is optional: it's an owner token with every feature and no
limits, for your own devices.

| Feature | Needs |
|---|---|
| AI assistant, translation, dictionary, book assistant, full-book translation, AI title recognition, AI multi-role speech | `PRO_AI_*` |
| AI voices | `PRO_TTS_*` |
| AI OCR for scanned PDFs | `PRO_AI_*` with a vision-capable model (or `PRO_OCR_MODEL`) |
| Book metadata search | nothing, uses Open Library |
| Sync to WebDAV, S3, FTP, SFTP, SMB, MEGA, a local folder or this server's file server | nothing; the server encrypts the data-source credentials |
| Sync to Google Drive, OneDrive, Dropbox, Box, pCloud, Yandex Disk, Baidu, Aliyun Drive, 115 | `PRO_PUBLIC_URL` and an OAuth app per provider, see [Cloud drives](#cloud-drives) |
| Downloadable fonts, dictionaries and backgrounds | files in `PRO_ASSETS_DIR`, see [Downloads](#downloads) |

### Configuration

| Variable | Description |
|---|---|
| `ENABLE_PRO_SERVER` | `true` to enable |
| `PRO_ACCESS_TOKEN` | Optional owner token (every feature, no limits), at least 16 characters. A Docker secret named by `PRO_ACCESS_TOKEN_FILE` (default `pro_access_token`) takes precedence. |
| `PRO_DB_PATH` | Accounts database, default `./data/folio.db` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Create or reset this admin at startup (otherwise use the setup code from the log) |
| `PRO_AI_BASE_URL` | OpenAI-compatible API base, e.g. `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, `http://ollama:11434/v1` |
| `PRO_AI_API_KEY` | Key for that API (leave empty for local servers) |
| `PRO_AI_MODEL` | Model used for every AI feature |
| `PRO_OCR_MODEL` | Optional vision model for OCR, defaults to `PRO_AI_MODEL` |
| `PRO_TTS_BASE_URL` | OpenAI-compatible speech API base, e.g. [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) at `http://kokoro:8880/v1` |
| `PRO_TTS_API_KEY` | Key for the speech API, if it needs one |
| `PRO_TTS_MODEL` | Speech model, default `kokoro` |
| `PRO_TTS_VOICE` | Voice used when the app asks for one the TTS server doesn't have, default `af_heart` |
| `PRO_TOKEN_KEY` | Secret the data-source credentials are encrypted with. Defaults to `PRO_ACCESS_TOKEN`, or a random key kept in the database when neither is set; set it so you can change the access token without adding the data sources again. A Docker secret named by `PRO_TOKEN_KEY_FILE` (default `pro_token_key`) takes precedence. Changing it makes saved credentials unreadable. |
| `PRO_PUBLIC_URL` | Address the server is reached at from the internet, e.g. `https://folio.example.com`. Used for cloud-drive and Google sign-in and in emails; can also be set in the admin panel. |
| `PRO_OAUTH_<PROVIDER>_CLIENT_ID`, `PRO_OAUTH_<PROVIDER>_CLIENT_SECRET` | OAuth app for a cloud drive, see below |
| `PRO_OAUTH_GOOGLE_APP_ID`, `PRO_OAUTH_GOOGLE_API_KEY` | Google Cloud project number and browser API key for the Google Drive file picker used when importing books |
| `PRO_ASSETS_DIR` | Folder with downloadable fonts, dictionaries and backgrounds, default `./assets` |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the server from a browser (shared with the file server) |

Email (SMTP), Google sign-in, sign-up rules and payment instructions are set
in the admin panel, not the environment.

Generate secrets with `openssl rand -hex 32`. Put the server behind HTTPS
(Caddy, Nginx, Traefik) when it is reachable from the internet: sign-in
passwords and tokens travel in requests.

Example:

```bash
docker run -d -p 8080:8080 \
  -e ENABLE_PRO_SERVER=true \
  -e PRO_PUBLIC_URL=https://folio.example.com \
  -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='a long password' \
  -e PRO_TOKEN_KEY=$(openssl rand -hex 32) \
  -e PRO_AI_BASE_URL=https://openrouter.ai/api/v1 \
  -e PRO_AI_API_KEY=sk-or-... \
  -e PRO_AI_MODEL=anthropic/claude-opus-5 \
  -e PRO_TTS_BASE_URL=http://kokoro:8880/v1 \
  -v /opt/folio-assets:/app/assets \
  -v /opt/folio-data:/app/data \
  ghcr.io/ssoad/folio
```

### Cloud drives

Each cloud drive signs in through an OAuth app you register with the
provider. Set its redirect URI to `<PRO_PUBLIC_URL>/pro/v1/oauth/callback`,
then give the server its client ID and secret. Adding the data source in the
app opens the provider's sign-in page; afterwards the server shows a code to
paste back into the app.

| Data source | `<PROVIDER>` | Register at | Scopes the app uses |
|---|---|---|---|
| Google Drive | `GOOGLE` | Google Cloud Console → Credentials → OAuth client (web) | `drive.file` |
| OneDrive | `MICROSOFT` | Microsoft Entra → App registrations | `Files.ReadWrite.AppFolder` (and `Files.ReadWrite.All` for full-drive access), `offline_access` |
| Dropbox | `DROPBOX` | Dropbox App Console | app folder or full Dropbox |
| Box | `BOX` | Box Developer Console | `root_readwrite` |
| pCloud | `PCLOUD` | pCloud App Console | |
| Yandex Disk | `YANDEX` | Yandex OAuth | Disk read and write |
| Baidu Netdisk | `BAIDU` | Baidu Open Platform | `basic,netdisk` |
| Aliyun Drive | `ALIYUN` | Alipan Open Platform | `user:base,file:all:read,file:all:write` |
| 115 | `115` | 115 Open Platform | |

Only drives with both a client ID and a secret appear as available in the
app.

### Downloads

The app's font, dictionary and background download lists show what this
folder contains:

```
assets/
  fonts/<family>/<file>          paths as in the app's font list, e.g. fonts/EB_Garamond/EBGaramond-VF.ttf
  dicts/<id>.mdx                 any MDict dictionary
  backgrounds/desktop/<name>.png full-size background
  backgrounds/desktop-thumbnail/<name>.png  optional preview of the same name
```

### API

Endpoints answer with a `{"code": 200, "msg": "success", "data": ...}`
envelope. Services need a bearer token: an account's device token (from
sign-in) or the owner token. Sign-in, sign-up and the plan list don't, nor
do the pages the browser opens during sign-in.

| Endpoint | Purpose |
|---|---|
| `GET /pro/v1/info` | Public. Sign-up open, Google sign-in, email verification |
| `GET /pro/v1/packages` | Public. Plans shown in the app and payment instructions |
| `POST /pro/v1/auth/register`, `POST /pro/v1/auth/login` | `{email, password, name?, device}` → `{token, user}` |
| `GET /pro/v1/auth/google/authorize`, `/callback`; `POST /pro/v1/auth/google/exchange` | Google sign-in; the callback page shows a code the app exchanges for a token |
| `POST /pro/v1/auth/forgot`, `/resend`; `GET /pro/v1/auth/verify`, `/reset` | Password reset and email verification (links in emails) |
| `GET /pro/v1/account` | Plan, features, usage, limits, devices |
| `POST /pro/v1/account/redeem` | `{code}`: promo code |
| `GET`, `POST /pro/v1/account/requests` | Plan purchase (`{kind: "subscription", package_id, payment_reference}`) or special access (`{kind: "special", message}`) |
| `POST /pro/v1/account/logout`, `/devices/revoke`, `/password` | Sessions and password |
| `/admin/api/*` | The admin panel's API (cookie session, `X-Folio-Admin: 1` header) |

A request over a package's monthly limit gets HTTP 429; a feature the
package doesn't include gets 403.

The services:

| Endpoint | Purpose |
|---|---|
| `GET /pro/v1/status` | Features this caller can use (the server's, narrowed by their package), cloud drives, Google picker settings |
| `POST /pro/v1/openai/chat/completions`, `GET /pro/v1/openai/models` | OpenAI-compatible proxy to `PRO_AI_*`; the app registers it as an AI model |
| `POST /pro/v1/translate/batch` | `{texts, from, to}` → `{texts}` |
| `POST /pro/v1/title/analyze` | `{title}` → `{name, author}` |
| `POST /pro/v1/speech/split` | `{texts: [{text, index}]}` → `{sentences: [{text, role, index}]}` |
| `GET /pro/v1/metadata/search?name=&author=` | Open Library results |
| `POST /pro/v1/tts` | `{text, voice, speed}` → `{audio_base64}` (data URI) |
| `POST /pro/v1/ocr` | `{image_base64}` → `{text}` |
| `POST /pro/v1/token/encrypt` | `{token}` → `{encrypted_token}` (AES-256-GCM) |
| `POST /pro/v1/token/decrypt` | `{encrypted_token}` → `{token}` |
| `GET /pro/v1/oauth/{provider}/authorize` | Public. Redirects to the provider's sign-in |
| `GET /pro/v1/oauth/callback` | Public. Shows the code to paste into the app |
| `GET /pro/v1/oauth/google/picker` | Public. Google Drive picker for the desktop app |
| `POST /pro/v1/oauth/token` | `{provider, code}` → `{access_token, refresh_token, expires_in}` |
| `POST /pro/v1/oauth/refresh` | `{provider, refresh_token}` → `{access_token, refresh_token, expires_in}` |
| `GET /pro/v1/assets/catalog` | `{fonts, dicts, backgrounds}`: paths of the files on offer |
| `GET /pro/v1/assets/{fonts,dicts,backgrounds}/{path}` | The file |

Tests: `go test ./...`
