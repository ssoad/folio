package main

// Encrypts data-source credentials (WebDAV, S3, FTP, ... logins) for the app,
// replacing the official token service. The app keeps only the encrypted
// token and asks the server to decrypt it when it syncs.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
)

// Marks tokens this server encrypted; tokens from the official service don't
// have it, so the app knows which one to ask
const proVaultPrefix = "fv1:"

var proVaultKey []byte

// The key comes from PRO_TOKEN_KEY, or from the access token when that isn't
// set. Changing whichever one is used makes saved credentials unreadable, and
// the data sources have to be added again.
func initProVault() {
	secret := getDockerSecret(getEnv("PRO_TOKEN_KEY_FILE", "pro_token_key"))
	if secret == "" {
		secret = strings.TrimSpace(getEnv("PRO_TOKEN_KEY", ""))
	}
	if secret == "" {
		secret = proAccessToken
	}
	sum := sha256.Sum256([]byte("folio-token-vault:" + secret))
	proVaultKey = sum[:]
}

func proVaultCipher() (cipher.AEAD, error) {
	block, err := aes.NewCipher(proVaultKey)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func proEncryptToken(plain string) (string, error) {
	gcm, err := proVaultCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return proVaultPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

func proDecryptToken(encrypted string) (string, error) {
	raw, ok := strings.CutPrefix(encrypted, proVaultPrefix)
	if !ok {
		return "", errors.New("Token was not encrypted by this server")
	}
	sealed, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return "", errors.New("Malformed token")
	}
	gcm, err := proVaultCipher()
	if err != nil {
		return "", err
	}
	if len(sealed) < gcm.NonceSize() {
		return "", errors.New("Malformed token")
	}
	plain, err := gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("Token can't be decrypted with this server's key")
	}
	return string(plain), nil
}

// Same request and response fields as the official service
func proHandleEncryptToken(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(r, &in); err != nil || in.Token == "" {
		proFail(w, http.StatusBadRequest, 400, "Expected {token}")
		return
	}
	encrypted, err := proEncryptToken(in.Token)
	if err != nil {
		proFail(w, http.StatusInternalServerError, 500, "Encryption failed")
		return
	}
	proOK(w, map[string]string{"encrypted_token": encrypted})
}

func proHandleDecryptToken(w http.ResponseWriter, r *http.Request) {
	var in struct {
		EncryptedToken string `json:"encrypted_token"`
	}
	if err := decodeJSON(r, &in); err != nil || in.EncryptedToken == "" {
		proFail(w, http.StatusBadRequest, 400, "Expected {encrypted_token}")
		return
	}
	plain, err := proDecryptToken(in.EncryptedToken)
	if err != nil {
		proFail(w, http.StatusBadRequest, 400, err.Error())
		return
	}
	proOK(w, map[string]string{"token": plain})
}
