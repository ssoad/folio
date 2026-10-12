#!/bin/sh
# Builds every Google Play graphic in store/google-play/ from the real app:
#   1. covers for a sample library of public-domain classics, then EPUBs
#   2. the app (yarn start, http://localhost:3000) driven in a headless
#      Chrome with a fresh profile: onboarding, import, reading, settings
#   3. the frames, feature graphic and icon, rendered at Play's sizes
#
# Needs Google Chrome, Node 22+, Python 3 with Pillow, and the dev server:
#   yarn start            (in another terminal)
#   sh store/build.sh
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
cleanup() { kill "$CAPTURE_PID" "$RENDER_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

if ! curl -s -o /dev/null http://localhost:3000/; then
  echo "Start the app first: yarn start"
  exit 1
fi

"$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --remote-debugging-port=9555 --user-data-dir="$TMP/render" --no-first-run about:blank >/dev/null 2>&1 &
RENDER_PID=$!
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --remote-debugging-port=9444 --user-data-dir="$TMP/capture" --no-first-run about:blank >/dev/null 2>&1 &
CAPTURE_PID=$!
sleep 3

echo "── Sample library"
node store/src/render.mjs covers
python3 store/src/books/make_epubs.py >/dev/null

echo "── Capturing the app"
rm -f store/build/raw/*.png
node store/src/capture/capture.mjs reset onboarding import progress library libraryDark reader highlight readerDark tablet
python3 store/src/frames/colors.py

echo "── Rendering the store graphics"
node store/src/render.mjs icon feature phone/ tablet-

echo "Done: store/google-play/"
