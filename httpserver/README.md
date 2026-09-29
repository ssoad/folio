# Koodo Reader server

One Go binary with three optional services:

| Service | Enable with | Port |
|---|---|---|
| File server (the "Docker" sync data source), OPDS catalog | `ENABLE_HTTP_SERVER=true`, `ENABLE_OPDS=true` | `PORT` (8080) |
| KOReader progress sync | `ENABLE_KOREADER_SERVER=true` | 7200 |
| Self-hosted Pro services | `ENABLE_PRO_SERVER=true` | `PORT` (8080) |

## Self-hosted Pro services

Runs the Pro features on infrastructure you control instead of the official
Koodo servers. In the app, open **Settings → Account → Self-hosted server**
and enter the server address and access token. Features the server provides
unlock without a Koodo account:

| Feature | Needs |
|---|---|
| AI assistant, translation, dictionary, book assistant, full-book translation, AI title recognition, AI multi-role speech | `PRO_AI_*` |
| AI voices | `PRO_TTS_*` |
| AI OCR for scanned PDFs | `PRO_AI_*` with a vision-capable model (or `PRO_OCR_MODEL`) |
| Book metadata search | nothing, uses Open Library |
| Sync to WebDAV, S3, FTP, SFTP, SMB, MEGA, a local folder or this server's file server | nothing |

Google Drive, OneDrive, Dropbox and the other OAuth data sources, Koodo Sync
and word definitions still need a Koodo Pro account: they depend on the
official token and analysis services.

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
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the server from a browser (shared with the file server) |

Generate a token with `openssl rand -hex 32`. Put the server behind HTTPS
(Caddy, Nginx, Traefik) when it is reachable from the internet, the token
travels in every request.

Example:

```bash
docker run -d -p 8080:8080 \
  -e ENABLE_PRO_SERVER=true \
  -e PRO_ACCESS_TOKEN=$(openssl rand -hex 32) \
  -e PRO_AI_BASE_URL=https://openrouter.ai/api/v1 \
  -e PRO_AI_API_KEY=sk-or-... \
  -e PRO_AI_MODEL=anthropic/claude-opus-5 \
  -e PRO_TTS_BASE_URL=http://kokoro:8880/v1 \
  ghcr.io/<you>/koodo-reader
```

### API

All endpoints need the bearer token and answer with the official API's
envelope, `{"code": 200, "msg": "success", "data": ...}`.

| Endpoint | Purpose |
|---|---|
| `GET /pro/v1/status` | Which features are configured |
| `POST /pro/v1/openai/chat/completions`, `GET /pro/v1/openai/models` | OpenAI-compatible proxy to `PRO_AI_*`; the app registers it as an AI model |
| `POST /pro/v1/translate/batch` | `{texts, from, to}` → `{texts}` |
| `POST /pro/v1/title/analyze` | `{title}` → `{name, author}` |
| `POST /pro/v1/speech/split` | `{texts: [{text, index}]}` → `{sentences: [{text, role, index}]}` |
| `GET /pro/v1/metadata/search?name=&author=` | Open Library results |
| `POST /pro/v1/tts` | `{text, voice, speed}` → `{audio_base64}` (data URI) |
| `POST /pro/v1/ocr` | `{image_base64}` → `{text}` |

Tests: `go test ./...`
