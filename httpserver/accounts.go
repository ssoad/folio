package main

// User accounts for the Folio services. People create an account in the app
// (email + password or Google), and their plan decides which features they
// get and how much of them per month. The admin manages everything in /admin.
//
// The PRO_ACCESS_TOKEN, when set, still works as an owner token with every
// feature and no limits.

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── Who is calling ───────────────────────────────────────────────────────────

type principal struct {
	Owner   bool
	User    *User
	TokenID int64
	Sub     *Subscription
	Package *Package
}

type principalKey struct{}

func principalFrom(r *http.Request) *principal {
	p, _ := r.Context().Value(principalKey{}).(*principal)
	return p
}

// The owner token, or an app token from an account
func resolvePrincipal(r *http.Request) *principal {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return nil
	}
	token = strings.TrimSpace(token)
	if proAccessToken != "" && subtle.ConstantTimeCompare([]byte(token), []byte(proAccessToken)) == 1 {
		return &principal{Owner: true}
	}
	if accountsDB == nil || token == "" {
		return nil
	}
	user, tokenID, err := userForToken(token, "app")
	if err != nil {
		return nil
	}
	sub, pkg := currentPlan(user.ID)
	return &principal{User: user, TokenID: tokenID, Sub: sub, Package: pkg}
}

// Features the server itself can provide
func serverFeatures() map[string]bool {
	return map[string]bool{
		"ai":       proAI.configured(),
		"ocr":      proAI.configured() && proOCRModel != "",
		"tts":      proTTS.configured(),
		"metadata": true,
		"vault":    true,
		"assets":   true,
		"drives":   len(proOAuthDrives()) > 0,
	}
}

func (p *principal) has(feature string) bool {
	if p.Owner {
		return true
	}
	if p.Package == nil {
		return false
	}
	for _, f := range p.Package.Features {
		if f == feature {
			return true
		}
	}
	return false
}

// Features available to this caller: the server's, narrowed by the plan
func (p *principal) features() map[string]bool {
	out := map[string]bool{}
	for f, available := range serverFeatures() {
		out[f] = available && p.has(f)
	}
	return out
}

// Whether `amount` more of a metric fits this month's limit
func (p *principal) withinLimit(metric string, amount int64) (bool, int64) {
	if p.Owner || p.Package == nil {
		return true, -1
	}
	limit, limited := p.Package.Limits[metric]
	if !limited {
		return true, -1
	}
	used := getUsage(p.User.ID, usagePeriod())[metric]
	return used+amount <= limit, limit
}

// ── Plan checks on the services ──────────────────────────────────────────────

// The feature a service needs and the usage metric it counts
func routeRequirements(method, path string) (feature, metric string) {
	switch {
	case path == "/pro/v1/openai/chat/completions":
		return "ai", "ai_requests"
	case path == "/pro/v1/openai/models":
		return "ai", ""
	case path == "/pro/v1/translate/batch", path == "/pro/v1/title/analyze", path == "/pro/v1/speech/split":
		return "ai", "ai_requests"
	case path == "/pro/v1/tts":
		return "tts", "tts_chars"
	case path == "/pro/v1/ocr":
		return "ocr", "ocr_pages"
	case path == "/pro/v1/metadata/search":
		return "metadata", ""
	case strings.HasPrefix(path, "/pro/v1/token/"):
		return "vault", ""
	case path == "/pro/v1/oauth/token", path == "/pro/v1/oauth/refresh":
		return "drives", ""
	case strings.HasPrefix(path, "/pro/v1/assets/"):
		return "assets", ""
	}
	return "", ""
}

// How much a request counts for; TTS counts characters, so it peeks the body
func meterAmount(r *http.Request, metric string) int64 {
	if metric != "tts_chars" {
		return 1
	}
	body, err := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewReader(body))
	if err != nil {
		return 0
	}
	var in struct {
		Text string `json:"text"`
	}
	json.Unmarshal(body, &in)
	return int64(len([]rune(in.Text)))
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

var limitNames = map[string]string{
	"ai_requests": "AI requests",
	"tts_chars":   "voice characters",
	"ocr_pages":   "OCR pages",
}

// Runs a service after checking the caller's plan, and counts its usage
func withPlan(w http.ResponseWriter, r *http.Request, p *principal, method, path string, serve func(http.ResponseWriter, *http.Request)) {
	feature, metric := routeRequirements(method, path)
	if feature != "" && !p.has(feature) {
		proFail(w, http.StatusForbidden, 403, "Your plan doesn't include this feature")
		return
	}
	var amount int64
	if metric != "" {
		amount = meterAmount(r, metric)
		if ok, limit := p.withinLimit(metric, amount); !ok {
			proFail(w, http.StatusTooManyRequests, 429,
				fmt.Sprintf("You've reached this month's limit of %d %s", limit, limitNames[metric]))
			return
		}
	}
	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	serve(rec, r)
	if metric != "" && p.User != nil && rec.status < 400 && amount > 0 {
		addUsage(p.User.ID, metric, amount)
	}
}

// ── Setup ────────────────────────────────────────────────────────────────────

var adminSetupToken string

func initAccounts() {
	path := getEnv("PRO_DB_PATH", "./data/folio.db")
	db, err := openAccountsDB(path)
	if err != nil {
		log.Fatalf("[accounts] Cannot open database %s: %v", path, err)
	}
	accountsDB = db
	log.Printf("[accounts] Database: %s", path)

	// ADMIN_EMAIL / ADMIN_PASSWORD create (or reset) an admin at startup
	email, password := normalizeEmail(os.Getenv("ADMIN_EMAIL")), os.Getenv("ADMIN_PASSWORD")
	if email != "" && password != "" {
		if user, err := getUserByEmail(email); err == nil {
			setUserPassword(user.ID, password)
			accountsDB.Exec(`UPDATE users SET role = 'admin', status = 'active', email_verified = 1 WHERE id = ?`, user.ID)
		} else if _, err := createUser(email, "Admin", password, "admin", true); err != nil {
			log.Printf("[accounts] Cannot create admin %s: %v", email, err)
		}
	}
	if countAdmins() == 0 {
		adminSetupToken = randomToken(18)
		log.Printf("[accounts] No admin yet. Create one at /admin with setup code: %s", adminSetupToken)
	}
}

func publicURL() string {
	if u := strings.TrimRight(getSetting("public_url"), "/"); u != "" {
		return u
	}
	return proPublicURL
}

// ── Public endpoints (no token) ──────────────────────────────────────────────

// Handles /pro/v1/info, /pro/v1/packages and /pro/v1/auth/*; false if the
// path is none of them
func handlePublicAccounts(w http.ResponseWriter, r *http.Request, path string) bool {
	switch {
	case r.Method == http.MethodGet && path == "/pro/v1/info":
		proOK(w, map[string]any{
			"name":               "Folio",
			"accounts":           true,
			"registration_open":  settingBool("registration_open"),
			"google_enabled":     googleSignInConfigured(),
			"email_verification": verificationRequired(),
			"password_reset":     mailConfigured(),
			"owner_token":        proAccessToken != "",
		})
	case r.Method == http.MethodGet && path == "/pro/v1/packages":
		proOK(w, map[string]any{
			"packages":             listPackages(true),
			"payment_instructions": getSetting("payment_instructions"),
		})
	case r.Method == http.MethodPost && path == "/pro/v1/auth/register":
		handleRegister(w, r)
	case r.Method == http.MethodPost && path == "/pro/v1/auth/login":
		handleLogin(w, r)
	case r.Method == http.MethodPost && path == "/pro/v1/auth/forgot":
		handleForgotPassword(w, r)
	case r.Method == http.MethodPost && path == "/pro/v1/auth/resend":
		handleResendVerification(w, r)
	case r.Method == http.MethodGet && path == "/pro/v1/auth/verify":
		handleVerifyEmail(w, r)
	case path == "/pro/v1/auth/reset":
		handleResetPage(w, r)
	case r.Method == http.MethodGet && path == "/pro/v1/auth/google/authorize":
		handleGoogleAuthorize(w, r)
	case r.Method == http.MethodGet && path == "/pro/v1/auth/google/callback":
		handleGoogleCallback(w, r)
	case r.Method == http.MethodPost && path == "/pro/v1/auth/google/exchange":
		handleGoogleExchange(w, r)
	default:
		return false
	}
	return true
}

// Slows password guessing: attempts per email and per client address
type attemptLimiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
}

var loginLimiter = &attemptLimiter{attempts: map[string][]time.Time{}}

const (
	loginWindow      = 15 * time.Minute
	loginMaxAttempts = 10
)

func (l *attemptLimiter) blocked(keys ...string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := time.Now().Add(-loginWindow)
	for _, key := range keys {
		recent := l.attempts[key][:0]
		for _, t := range l.attempts[key] {
			if t.After(cutoff) {
				recent = append(recent, t)
			}
		}
		l.attempts[key] = recent
		if len(recent) >= loginMaxAttempts {
			return true
		}
	}
	return false
}

func (l *attemptLimiter) fail(keys ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, key := range keys {
		l.attempts[key] = append(l.attempts[key], time.Now())
	}
}

func (l *attemptLimiter) clear(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, key)
}

// The client's address. Behind the image's Caddy every request comes from
// loopback, so the X-Real-IP it sets is used then (and only then: anyone else
// could send the header)
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if real := strings.TrimSpace(r.Header.Get("X-Real-IP")); net.ParseIP(real) != nil {
			return real
		}
	}
	return host
}

func verificationRequired() bool {
	return settingBool("require_email_verification") && mailConfigured()
}

type authResult struct {
	Token string `json:"token"`
	User  *User  `json:"user"`
}

func deviceName(r *http.Request, given string) string {
	if strings.TrimSpace(given) != "" {
		return given
	}
	return clip(r.UserAgent(), 80)
}

func handleRegister(w http.ResponseWriter, r *http.Request) {
	if !settingBool("registration_open") {
		proFail(w, http.StatusForbidden, 403, "Sign-ups are closed on this server")
		return
	}
	var in struct {
		Email, Password, Name, Device string
	}
	if err := decodeJSON(r, &in); err != nil {
		proFail(w, http.StatusBadRequest, 400, "Expected {email, password, name}")
		return
	}
	email := normalizeEmail(in.Email)
	if !validEmail(email) {
		proFail(w, http.StatusBadRequest, 400, "Enter a valid email address")
		return
	}
	if len(in.Password) < 8 {
		proFail(w, http.StatusBadRequest, 400, "Use a password of at least 8 characters")
		return
	}
	needsVerification := verificationRequired()
	user, err := createUser(email, in.Name, in.Password, "user", !needsVerification)
	if err != nil {
		proFail(w, http.StatusConflict, 409, err.Error())
		return
	}
	if needsVerification {
		sendVerificationEmail(user)
		proOK(w, map[string]any{"verification_required": true, "email": user.Email})
		return
	}
	token, err := issueToken(user.ID, "app", deviceName(r, in.Device), 0)
	if err != nil {
		proFail(w, http.StatusInternalServerError, 500, "Cannot sign in")
		return
	}
	proOK(w, authResult{Token: token, User: user})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email, Password, Device string
	}
	if err := decodeJSON(r, &in); err != nil {
		proFail(w, http.StatusBadRequest, 400, "Expected {email, password}")
		return
	}
	email := normalizeEmail(in.Email)
	keys := []string{"email:" + email, "ip:" + clientIP(r)}
	if loginLimiter.blocked(keys...) {
		proFail(w, http.StatusTooManyRequests, 429, "Too many attempts, try again in a few minutes")
		return
	}
	user, err := getUserByEmail(email)
	if err != nil || !user.HasPassword || !checkPassword(user.passwordHash, in.Password) {
		loginLimiter.fail(keys...)
		proFail(w, http.StatusUnauthorized, 401, "Wrong email or password")
		return
	}
	loginLimiter.clear("email:" + email)
	if user.Status != "active" {
		proFail(w, http.StatusForbidden, 403, "This account is disabled")
		return
	}
	if !user.EmailVerified && verificationRequired() {
		proFail(w, http.StatusForbidden, 40301, "Please verify your email first; check your inbox")
		return
	}
	token, err := issueToken(user.ID, "app", deviceName(r, in.Device), 0)
	if err != nil {
		proFail(w, http.StatusInternalServerError, 500, "Cannot sign in")
		return
	}
	proOK(w, authResult{Token: token, User: user})
}

// Always answers OK, so it can't be used to find out who has an account
func handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email string }
	decodeJSON(r, &in)
	if user, err := getUserByEmail(in.Email); err == nil && user.Status == "active" && mailConfigured() {
		if !loginLimiter.blocked("reset:" + user.Email) {
			loginLimiter.fail("reset:" + user.Email)
			token, err := issueEmailToken(user.ID, "reset", time.Hour)
			if err == nil {
				link := publicURL() + "/pro/v1/auth/reset?token=" + url.QueryEscape(token)
				go sendMail(user.Email, "Reset your Folio password",
					"Open this link to choose a new password (valid for an hour):\n\n"+link+
						"\n\nIf you didn't ask for this, ignore this email.")
			}
		}
	}
	proOK(w, map[string]any{})
}

func handleResendVerification(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email string }
	decodeJSON(r, &in)
	if user, err := getUserByEmail(in.Email); err == nil && !user.EmailVerified && !loginLimiter.blocked("verify:"+user.Email) {
		loginLimiter.fail("verify:" + user.Email)
		sendVerificationEmail(user)
	}
	proOK(w, map[string]any{})
}

func sendVerificationEmail(user *User) {
	token, err := issueEmailToken(user.ID, "verify", 48*time.Hour)
	if err != nil {
		return
	}
	link := publicURL() + "/pro/v1/auth/verify?token=" + url.QueryEscape(token)
	go sendMail(user.Email, "Confirm your Folio account",
		"Welcome to Folio. Confirm your email address to start using your account:\n\n"+link)
}

var messagePage = template.Must(template.New("message").Parse(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Folio</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f7f6f3;color:#1c1b19;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#fff;border:1px solid #e4e2dc;border-radius:14px;padding:28px;max-width:420px;width:100%;box-sizing:border-box}
h1{font-size:20px;margin:0 0 8px}p{color:#6b6a65;line-height:1.5;margin:0 0 16px}
code{display:block;word-break:break-all;background:#f1f0ec;border-radius:8px;padding:12px;font-size:18px;letter-spacing:.08em;text-align:center;margin-bottom:16px}
input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d8d6cf;border-radius:8px;font-size:15px;margin-bottom:12px;background:transparent;color:inherit}
button{background:#4458c7;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer}
.brand{font-family:Georgia,serif;font-weight:600;font-size:22px;letter-spacing:-.04em;margin-bottom:18px}.brand span{color:#4458c7}
@media (prefers-color-scheme:dark){body{background:#141413;color:#edece8}main{background:#1c1c1b;border-color:#2b2b29}p{color:#a3a29d}code{background:#232322}input{border-color:#3a3a37}button{background:#8c9bff;color:#141413}.brand span{color:#8c9bff}}
</style></head><body><main>
<div class="brand">Folio<span>.</span></div>
<h1>{{.Title}}</h1>{{if .Text}}<p>{{.Text}}</p>{{end}}
{{if .Code}}<code id="code">{{.Code}}</code>
<button onclick="navigator.clipboard.writeText(document.getElementById('code').textContent);this.textContent='Copied'">Copy code</button>{{end}}
{{if .ResetToken}}<form method="post"><input type="hidden" name="token" value="{{.ResetToken}}">
<input type="password" name="password" placeholder="New password (8+ characters)" minlength="8" required autofocus>
<button type="submit">Save password</button></form>{{end}}
</main>{{if .Script}}<script>{{.Script}}</script>{{end}}</body></html>`))

type messageData struct {
	Title, Text, Code, ResetToken string
	Script                        template.JS
}

func renderMessage(w http.ResponseWriter, status int, data messageData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.WriteHeader(status)
	messagePage.Execute(w, data)
}

func handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	userID, err := consumeEmailToken(r.URL.Query().Get("token"), "verify")
	if err != nil {
		renderMessage(w, http.StatusBadRequest, messageData{Title: "Link expired", Text: err.Error()})
		return
	}
	accountsDB.Exec(`UPDATE users SET email_verified = 1 WHERE id = ?`, userID)
	renderMessage(w, http.StatusOK, messageData{Title: "Email confirmed", Text: "You can sign in to Folio now."})
}

func handleResetPage(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		r.ParseForm()
		password := r.PostForm.Get("password")
		if len(password) < 8 {
			renderMessage(w, http.StatusBadRequest, messageData{Title: "Choose a new password",
				Text: "Use at least 8 characters.", ResetToken: r.PostForm.Get("token")})
			return
		}
		userID, err := consumeEmailToken(r.PostForm.Get("token"), "reset")
		if err != nil {
			renderMessage(w, http.StatusBadRequest, messageData{Title: "Link expired", Text: err.Error()})
			return
		}
		setUserPassword(userID, password)
		// Signs out every device
		accountsDB.Exec(`UPDATE tokens SET revoked = 1 WHERE user_id = ?`, userID)
		renderMessage(w, http.StatusOK, messageData{Title: "Password changed", Text: "Sign in to Folio with your new password."})
		return
	}
	renderMessage(w, http.StatusOK, messageData{Title: "Choose a new password", ResetToken: r.URL.Query().Get("token")})
}

// ── Google sign-in ───────────────────────────────────────────────────────────

func googleSignInApp() (string, string) {
	id, secret := getSetting("google_client_id"), getSetting("google_client_secret")
	if id != "" && secret != "" {
		return id, secret
	}
	// The Google Drive OAuth app can sign people in too
	if app, ok := proOAuthApps["google"]; ok {
		return app.ClientID, app.ClientSecret
	}
	return "", ""
}

func googleSignInConfigured() bool {
	id, _ := googleSignInApp()
	return id != "" && publicURL() != ""
}

type pendingCode struct {
	userID  int64
	expires time.Time
}

// Google sign-in hands the app a short one-time code through the browser
var (
	googleMu     sync.Mutex
	googleStates = map[string]time.Time{}
	loginCodes   = map[string]pendingCode{}
)

func handleGoogleAuthorize(w http.ResponseWriter, r *http.Request) {
	clientID, _ := googleSignInApp()
	if !googleSignInConfigured() {
		renderMessage(w, http.StatusNotFound, messageData{Title: "Google sign-in is off", Text: "The server has no Google app configured."})
		return
	}
	state := randomToken(18)
	googleMu.Lock()
	for s, t := range googleStates {
		if time.Now().After(t) {
			delete(googleStates, s)
		}
	}
	googleStates[state] = time.Now().Add(10 * time.Minute)
	googleMu.Unlock()
	params := url.Values{
		"response_type": {"code"},
		"client_id":     {clientID},
		"redirect_uri":  {publicURL() + "/pro/v1/auth/google/callback"},
		"scope":         {"openid email profile"},
		"state":         {state},
		"prompt":        {"select_account"},
	}
	http.Redirect(w, r, "https://accounts.google.com/o/oauth2/v2/auth?"+params.Encode(), http.StatusFound)
}

func handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	googleMu.Lock()
	expires, known := googleStates[query.Get("state")]
	delete(googleStates, query.Get("state"))
	googleMu.Unlock()
	if !known || time.Now().After(expires) {
		renderMessage(w, http.StatusBadRequest, messageData{Title: "Sign-in expired", Text: "Start again from Folio."})
		return
	}
	if query.Get("code") == "" {
		renderMessage(w, http.StatusBadRequest, messageData{Title: "Sign-in cancelled", Text: query.Get("error")})
		return
	}
	user, err := googleUser(r.Context(), query.Get("code"))
	if err != nil {
		renderMessage(w, http.StatusBadRequest, messageData{Title: "Sign-in failed", Text: err.Error()})
		return
	}
	code := generateCode()
	googleMu.Lock()
	for c, p := range loginCodes {
		if time.Now().After(p.expires) {
			delete(loginCodes, c)
		}
	}
	loginCodes[code] = pendingCode{userID: user.ID, expires: time.Now().Add(10 * time.Minute)}
	googleMu.Unlock()
	data := messageData{Title: "Signed in as " + user.Email, Text: "Copy this code and paste it into Folio to finish signing in.", Code: code}
	// Hands the code straight to the app window that opened this page, when
	// that window's origin is one the server trusts
	if len(allowedOrigins) > 0 {
		origins, _ := json.Marshal(allowedOrigins)
		codeJSON, _ := json.Marshal(code)
		data.Script = template.JS(fmt.Sprintf(`(function(){var o=window.opener;if(!o)return;%s.forEach(function(origin){try{o.postMessage({type:"folio-login",code:%s},origin)}catch(e){}});})();`, origins, codeJSON))
	}
	renderMessage(w, http.StatusOK, data)
}

// Exchanges the authorization code and finds or creates the account
func googleUser(ctx context.Context, code string) (*User, error) {
	clientID, secret := googleSignInApp()
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {clientID},
		"client_secret": {secret},
		"redirect_uri":  {publicURL() + "/pro/v1/auth/google/callback"},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, googleTokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := proHTTP.Do(req)
	if err != nil {
		return nil, errors.New("Google can't be reached")
	}
	defer resp.Body.Close()
	var tokens struct {
		IDToken string `json:"id_token"`
		Error   string `json:"error_description"`
	}
	json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&tokens)
	if tokens.IDToken == "" {
		return nil, fmt.Errorf("Google refused the sign-in: %s", tokens.Error)
	}
	// The ID token came straight from Google over TLS, so its claims can be
	// read without checking the signature (OpenID Connect Core 3.1.3.7)
	parts := strings.Split(tokens.IDToken, ".")
	if len(parts) != 3 {
		return nil, errors.New("Unexpected answer from Google")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("Unexpected answer from Google")
	}
	var claims struct {
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		Aud           string `json:"aud"`
	}
	json.Unmarshal(payload, &claims)
	if claims.Aud != clientID || claims.Sub == "" || claims.Email == "" || !claims.EmailVerified {
		return nil, errors.New("Google didn't confirm this email address")
	}
	if user, err := getUserByGoogle(claims.Sub); err == nil {
		if user.Status != "active" {
			return nil, errors.New("This account is disabled")
		}
		return user, nil
	}
	// An existing account with the same, Google-verified email is linked
	if user, err := getUserByEmail(claims.Email); err == nil {
		if user.Status != "active" {
			return nil, errors.New("This account is disabled")
		}
		accountsDB.Exec(`UPDATE users SET google_sub = ?, email_verified = 1 WHERE id = ?`, claims.Sub, user.ID)
		return getUser(user.ID)
	}
	if !settingBool("registration_open") {
		return nil, errors.New("Sign-ups are closed on this server")
	}
	user, err := createUser(claims.Email, claims.Name, "", "user", true)
	if err != nil {
		return nil, err
	}
	accountsDB.Exec(`UPDATE users SET google_sub = ? WHERE id = ?`, claims.Sub, user.ID)
	return getUser(user.ID)
}

var googleTokenURL = "https://oauth2.googleapis.com/token"

func handleGoogleExchange(w http.ResponseWriter, r *http.Request) {
	var in struct{ Code, Device string }
	if err := decodeJSON(r, &in); err != nil {
		proFail(w, http.StatusBadRequest, 400, "Expected {code}")
		return
	}
	code := normalizeCode(in.Code)
	if loginLimiter.blocked("ip:" + clientIP(r)) {
		proFail(w, http.StatusTooManyRequests, 429, "Too many attempts, try again in a few minutes")
		return
	}
	googleMu.Lock()
	pending, ok := loginCodes[code]
	delete(loginCodes, code)
	googleMu.Unlock()
	if !ok || time.Now().After(pending.expires) {
		loginLimiter.fail("ip:" + clientIP(r))
		proFail(w, http.StatusUnauthorized, 401, "This code is invalid or has expired")
		return
	}
	user, err := getUser(pending.userID)
	if err != nil || user.Status != "active" {
		proFail(w, http.StatusForbidden, 403, "This account is disabled")
		return
	}
	token, err := issueToken(user.ID, "app", deviceName(r, in.Device), 0)
	if err != nil {
		proFail(w, http.StatusInternalServerError, 500, "Cannot sign in")
		return
	}
	proOK(w, authResult{Token: token, User: user})
}

// ── The signed-in user's account ─────────────────────────────────────────────

// Handles /pro/v1/account*; false if the path is none of them
func handleAccount(w http.ResponseWriter, r *http.Request, p *principal, path string) bool {
	if !strings.HasPrefix(path, "/pro/v1/account") {
		return false
	}
	if p.User == nil {
		proFail(w, http.StatusBadRequest, 400, "The owner token has no account")
		return true
	}
	switch {
	case r.Method == http.MethodGet && path == "/pro/v1/account":
		proOK(w, accountSummary(p))
	case r.Method == http.MethodPost && path == "/pro/v1/account/redeem":
		var in struct{ Code string }
		decodeJSON(r, &in)
		if loginLimiter.blocked("redeem:" + strconv.FormatInt(p.User.ID, 10)) {
			proFail(w, http.StatusTooManyRequests, 429, "Too many attempts, try again in a few minutes")
			return true
		}
		sub, err := redeemPromoCode(p.User.ID, in.Code)
		if err != nil {
			loginLimiter.fail("redeem:" + strconv.FormatInt(p.User.ID, 10))
			proFail(w, http.StatusBadRequest, 400, err.Error())
			return true
		}
		proOK(w, sub)
	case r.Method == http.MethodGet && path == "/pro/v1/account/requests":
		proOK(w, listAccessRequests(p.User.ID, ""))
	case r.Method == http.MethodPost && path == "/pro/v1/account/requests":
		handleCreateRequest(w, r, p)
	case r.Method == http.MethodPost && path == "/pro/v1/account/logout":
		revokeToken(p.TokenID)
		proOK(w, map[string]any{})
	case r.Method == http.MethodPost && path == "/pro/v1/account/devices/revoke":
		var in struct{ ID int64 }
		decodeJSON(r, &in)
		accountsDB.Exec(`UPDATE tokens SET revoked = 1 WHERE id = ? AND user_id = ?`, in.ID, p.User.ID)
		proOK(w, listDevices(p.User.ID))
	case r.Method == http.MethodPost && path == "/pro/v1/account/password":
		var in struct{ Current, New string }
		decodeJSON(r, &in)
		if p.User.HasPassword && !checkPassword(p.User.passwordHash, in.Current) {
			proFail(w, http.StatusBadRequest, 400, "Your current password is wrong")
			return true
		}
		if len(in.New) < 8 {
			proFail(w, http.StatusBadRequest, 400, "Use a password of at least 8 characters")
			return true
		}
		setUserPassword(p.User.ID, in.New)
		proOK(w, map[string]any{})
	default:
		proFail(w, http.StatusNotFound, 404, "Not Found")
	}
	return true
}

func accountSummary(p *principal) map[string]any {
	limits := map[string]int64{}
	if p.Package != nil {
		limits = p.Package.Limits
	}
	return map[string]any{
		"user":           p.User,
		"subscription":   p.Sub,
		"package":        p.Package,
		"features":       p.features(),
		"usage":          getUsage(p.User.ID, usagePeriod()),
		"limits":         limits,
		"period":         usagePeriod(),
		"devices":        listDevices(p.User.ID),
		"current_device": p.TokenID,
	}
}

func handleCreateRequest(w http.ResponseWriter, r *http.Request, p *principal) {
	var in struct {
		Kind             string `json:"kind"`
		PackageID        int64  `json:"package_id"`
		Message          string `json:"message"`
		PaymentReference string `json:"payment_reference"`
	}
	if err := decodeJSON(r, &in); err != nil || (in.Kind != "subscription" && in.Kind != "special") {
		proFail(w, http.StatusBadRequest, 400, "Expected {kind: subscription|special, package_id, message, payment_reference}")
		return
	}
	if in.Kind == "subscription" {
		pkg, err := getPackage(in.PackageID)
		if err != nil || !pkg.IsPublic || !pkg.IsActive {
			proFail(w, http.StatusBadRequest, 400, "Choose a plan")
			return
		}
	} else if strings.TrimSpace(in.Message) == "" {
		proFail(w, http.StatusBadRequest, 400, "Tell the admin what you need")
		return
	}
	var pending int
	accountsDB.QueryRow(`SELECT COUNT(*) FROM access_requests WHERE user_id = ? AND status = 'pending'`, p.User.ID).Scan(&pending)
	if pending >= 3 {
		proFail(w, http.StatusTooManyRequests, 429, "You already have requests waiting for review")
		return
	}
	var packageID any
	if in.PackageID > 0 {
		packageID = in.PackageID
	}
	accountsDB.Exec(`INSERT INTO access_requests (user_id, kind, package_id, message, payment_reference, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		p.User.ID, in.Kind, packageID, clip(strings.TrimSpace(in.Message), 2000), clip(strings.TrimSpace(in.PaymentReference), 200), unixNow())
	proOK(w, listAccessRequests(p.User.ID, ""))
}
