#!/bin/sh
# Creates the upload key Google Play knows Folio by, and the
# android/keystore.properties the release build signs with.
#
# Run it once, yourself (it asks for the passwords; nothing is printed):
#   sh store/scripts/create-upload-key.sh
#
# Then back up android/folio-upload.jks and its password somewhere safe
# (a password manager). With Play App Signing, Google keeps the real app
# signing key; if this upload key is ever lost, Play support can reset it.
set -e
cd "$(dirname "$0")/../../android"

KEYSTORE=folio-upload.jks
ALIAS=folio-upload

if [ -f "$KEYSTORE" ] || [ -f keystore.properties ]; then
  echo "android/$KEYSTORE or android/keystore.properties already exists; not overwriting."
  exit 1
fi
if ! command -v keytool >/dev/null 2>&1; then
  echo "keytool not found: install a JDK (Android Studio includes one)."
  exit 1
fi

printf "Choose a keystore password (6+ characters, hidden): "
stty -echo; read -r STOREPASS; stty echo; echo
printf "Repeat it (hidden): "
stty -echo; read -r STOREPASS2; stty echo; echo
if [ "$STOREPASS" != "$STOREPASS2" ] || [ ${#STOREPASS} -lt 6 ]; then
  echo "The passwords don't match or are too short."
  exit 1
fi
printf "Your name or organisation (for the certificate): "
read -r OWNER
printf "Two-letter country code (e.g. BD): "
read -r COUNTRY

keytool -genkeypair -v \
  -keystore "$KEYSTORE" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$STOREPASS" -keypass "$STOREPASS" \
  -dname "CN=${OWNER:-Folio}, O=${OWNER:-Folio}, C=${COUNTRY:-US}" >/dev/null

umask 077
cat > keystore.properties <<EOF
storeFile=$KEYSTORE
storePassword=$STOREPASS
keyAlias=$ALIAS
keyPassword=$STOREPASS
EOF
chmod 600 "$KEYSTORE" keystore.properties

echo "Created android/$KEYSTORE and android/keystore.properties (both kept out of git)."
echo "Back them up now. Build the bundle for Google Play with: yarn android:bundle"
