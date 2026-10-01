# syntax=docker/dockerfile:1.7
# Folio: web app + server in one image. Builds from a plain checkout:
#   docker compose up -d --build
# The web app and the Go server are built on the build machine's own
# architecture and cross-compiled, so multi-arch builds need no emulation.

# ── Web app ───────────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /src
COPY package.json yarn.lock .yarnrc ./
# Skips install scripts: Electron and native modules aren't needed for the web build
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --ignore-scripts --network-timeout 1000000
COPY .env tsconfig.json ./
COPY types ./types
COPY scripts ./scripts
COPY public ./public
COPY src ./src
# Linting is the dev build's job; here it would also scan the minified engine
ENV GENERATE_SOURCEMAP=false \
    DISABLE_ESLINT_PLUGIN=true \
    CI=false \
    NODE_OPTIONS=--max-old-space-size=4096
RUN yarn build

# ── Server ────────────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS server
WORKDIR /src
COPY httpserver/go.mod httpserver/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY httpserver/ ./
ARG TARGETOS TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/httpserver .

# ── Image ─────────────────────────────────────────────────────────────────────
FROM caddy:2-alpine
COPY --from=web /src/build /usr/share/caddy
COPY --from=server /out/httpserver /app/httpserver
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /entrypoint.sh
WORKDIR /app
RUN mkdir -p /app/uploads /app/data /app/assets

# Defaults; set your own in folio.env (see folio.env.example)
ENV ENABLE_PRO_SERVER=true \
    PRO_DB_PATH=/app/data/folio.db \
    PRO_ASSETS_DIR=/app/assets \
    ENABLE_HTTP_SERVER=false \
    SERVER_USERNAME=admin \
    SERVER_PASSWORD_FILE=my_secret \
    ENABLE_KOREADER_SERVER=false \
    ENABLE_KOREADER_REGISTRATION=true \
    ENABLE_OPDS=false

# 80: web app, /pro, /admin, /opds · 8080: server directly · 7200: KOReader sync
EXPOSE 80 8080 7200
# Uploaded books (file server), the accounts database, downloadable assets
VOLUME ["/app/uploads", "/app/data", "/app/assets"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
ENTRYPOINT ["/entrypoint.sh"]
