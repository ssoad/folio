# Folio server

One Go binary with three optional services:

| Service | Enable with | Port |
|---|---|---|
| File server (the "Docker" sync data source), OPDS catalog | `ENABLE_HTTP_SERVER=true`, `ENABLE_OPDS=true` | `PORT` (8080) |
| KOReader progress sync | `ENABLE_KOREADER_SERVER=true` | 7200 |
| Folio services (everything beyond reading) | `ENABLE_PRO_SERVER=true` | `PORT` (8080) |

## Folio services

Folio has no central cloud: everything beyond reading local books comes from
the server you run. In the app, open **Settings → Server** and enter the
server address and access token.

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
| `PRO_ACCESS_TOKEN` | Token the app sends as `Authorization: Bearer ...`, at least 16 characters. A Docker secret named by `PRO_ACCESS_TOKEN_FILE` (default `pro_access_token`) takes precedence. |
| `PRO_AI_BASE_URL` | OpenAI-compatible API base, e.g. `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, `http://ollama:11434/v1` |
| `PRO_AI_API_KEY` | Key for that API (leave empty for local servers) |
| `PRO_AI_MODEL` | Model used for every AI feature |
| `PRO_OCR_MODEL` | Optional vision model for OCR, defaults to `PRO_AI_MODEL` |
| `PRO_TTS_BASE_URL` | OpenAI-compatible speech API base, e.g. [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) at `http://kokoro:8880/v1` |
| `PRO_TTS_API_KEY` | Key for the speech API, if it needs one |
| `PRO_TTS_MODEL` | Speech model, default `kokoro` |
| `PRO_TTS_VOICE` | Voice used when the app asks for one the TTS server doesn't have, default `af_heart` |
| `PRO_TOKEN_KEY` | Secret the data-source credentials are encrypted with. Defaults to `PRO_ACCESS_TOKEN`; set it so you can change the access token without adding the data sources again. A Docker secret named by `PRO_TOKEN_KEY_FILE` (default `pro_token_key`) takes precedence. Changing it makes saved credentials unreadable. |
| `PRO_PUBLIC_URL` | Address the server is reached at from the internet, e.g. `https://folio.example.com`. Cloud-drive providers send the browser back to it after sign-in. |
| `PRO_OAUTH_<PROVIDER>_CLIENT_ID`, `PRO_OAUTH_<PROVIDER>_CLIENT_SECRET` | OAuth app for a cloud drive, see below |
| `PRO_OAUTH_GOOGLE_APP_ID`, `PRO_OAUTH_GOOGLE_API_KEY` | Google Cloud project number and browser API key for the Google Drive file picker used when importing books |
| `PRO_ASSETS_DIR` | Folder with downloadable fonts, dictionaries and backgrounds, default `./assets` |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the server from a browser (shared with the file server) |

Generate a token with `openssl rand -hex 32`. Put the server behind HTTPS
(Caddy, Nginx, Traefik) when it is reachable from the internet, the token
travels in every request.

Example:

```bash
docker run -d -p 8080:8080 \
  -e ENABLE_PRO_SERVER=true \
  -e PRO_ACCESS_TOKEN=$(openssl rand -hex 32) \
  -e PRO_TOKEN_KEY=$(openssl rand -hex 32) \
  -e PRO_AI_BASE_URL=https://openrouter.ai/api/v1 \
  -e PRO_AI_API_KEY=sk-or-... \
  -e PRO_AI_MODEL=anthropic/claude-opus-5 \
  -e PRO_TTS_BASE_URL=http://kokoro:8880/v1 \
  -v /opt/folio-assets:/app/assets \
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
envelope and need the bearer token, except the three pages the browser opens
during cloud-drive sign-in.

| Endpoint | Purpose |
|---|---|
| `GET /pro/v1/status` | Which features are configured, the cloud drives that can sign in, Google picker settings |
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
