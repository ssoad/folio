package main

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// A Pro server with a fresh accounts database
func setupAccounts(t *testing.T) *httptest.Server {
	t.Helper()
	srv := setupPro(t)
	db, err := openAccountsDB(filepath.Join(t.TempDir(), "folio.db"))
	if err != nil {
		t.Fatal(err)
	}
	accountsDB = db
	t.Cleanup(func() { db.Close(); accountsDB = nil })
	initProVault()
	loginLimiter = &attemptLimiter{attempts: map[string][]time.Time{}}
	return srv
}

func decodeData(t *testing.T, env envelope, into any) {
	t.Helper()
	if err := json.Unmarshal(env.Data, into); err != nil {
		t.Fatalf("decoding %s: %v", env.Data, err)
	}
}

func register(t *testing.T, srv *httptest.Server, email string) string {
	t.Helper()
	_, env, raw := call(t, srv, http.MethodPost, "/pro/v1/auth/register", `{"email":"`+email+`","password":"correct horse","name":"Reader"}`, "")
	var out authResult
	if env.Code != 200 {
		t.Fatalf("register: %s", raw)
	}
	decodeData(t, env, &out)
	return out.Token
}

func makePackage(t *testing.T, name string, features []string, limits map[string]int64) *Package {
	t.Helper()
	p := &Package{Name: name, DurationDays: 30, Features: features, Limits: limits, IsPublic: true, IsActive: true}
	if err := savePackage(p); err != nil {
		t.Fatal(err)
	}
	return p
}

func features(t *testing.T, srv *httptest.Server, token string) map[string]bool {
	t.Helper()
	_, env, raw := call(t, srv, http.MethodGet, "/pro/v1/status", "", token)
	var status struct {
		Features map[string]bool `json:"features"`
	}
	if env.Code != 200 {
		t.Fatalf("status: %s", raw)
	}
	decodeData(t, env, &status)
	return status.Features
}

func TestPasswordHashing(t *testing.T) {
	hash, err := hashPassword("s3cret-pass")
	if err != nil || !strings.HasPrefix(hash, "pbkdf2-sha256$") {
		t.Fatalf("hash %q %v", hash, err)
	}
	if !checkPassword(hash, "s3cret-pass") || checkPassword(hash, "s3cret-pasS") || checkPassword("junk", "x") {
		t.Fatal("password check is wrong")
	}
}

func TestRegisterLoginAndPlanFeatures(t *testing.T) {
	srv := setupAccounts(t)
	token := register(t, srv, "Reader@Example.com")

	// No package: signed in, but no features
	for f, on := range features(t, srv, token) {
		if on {
			t.Fatalf("feature %s on without a package", f)
		}
	}
	status, env, _ := call(t, srv, http.MethodPost, "/pro/v1/translate/batch", `{"texts":["hi"],"to":"French"}`, token)
	if status != http.StatusForbidden || env.Code != 403 {
		t.Fatalf("AI without plan: HTTP %d code %d", status, env.Code)
	}

	pro := makePackage(t, "Pro", []string{"ai", "metadata", "vault"}, nil)
	user, _ := getUserByEmail("reader@example.com")
	if _, err := grantSubscription(user.ID, pro.ID, 0, "admin", ""); err != nil {
		t.Fatal(err)
	}
	got := features(t, srv, token)
	if !got["ai"] || !got["vault"] || got["tts"] {
		t.Fatalf("features with Pro: %v", got)
	}

	// Duplicate email, wrong password, right password
	status, _, _ = call(t, srv, http.MethodPost, "/pro/v1/auth/register", `{"email":"reader@example.com","password":"another one"}`, "")
	if status != http.StatusConflict {
		t.Fatalf("duplicate email: HTTP %d", status)
	}
	status, _, _ = call(t, srv, http.MethodPost, "/pro/v1/auth/login", `{"email":"reader@example.com","password":"wrong password"}`, "")
	if status != http.StatusUnauthorized {
		t.Fatalf("wrong password: HTTP %d", status)
	}
	_, env, raw := call(t, srv, http.MethodPost, "/pro/v1/auth/login", `{"email":"READER@example.com","password":"correct horse"}`, "")
	if env.Code != 200 {
		t.Fatalf("login: %s", raw)
	}

	// Signing out revokes the token
	call(t, srv, http.MethodPost, "/pro/v1/account/logout", "", token)
	if status, _, _ := call(t, srv, http.MethodGet, "/pro/v1/status", "", token); status != http.StatusUnauthorized {
		t.Fatalf("revoked token still works: HTTP %d", status)
	}
}

func TestRegistrationCanBeClosed(t *testing.T) {
	srv := setupAccounts(t)
	setSetting("registration_open", "false")
	status, _, _ := call(t, srv, http.MethodPost, "/pro/v1/auth/register", `{"email":"a@example.com","password":"correct horse"}`, "")
	if status != http.StatusForbidden {
		t.Fatalf("closed sign-up: HTTP %d", status)
	}
}

func TestDefaultPackageForNewAccounts(t *testing.T) {
	srv := setupAccounts(t)
	free := makePackage(t, "Free", []string{"metadata"}, nil)
	setSetting("default_package_id", itoa(free.ID))
	token := register(t, srv, "new@example.com")
	got := features(t, srv, token)
	if !got["metadata"] || got["ai"] {
		t.Fatalf("default package features: %v", got)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func TestPromoCodes(t *testing.T) {
	srv := setupAccounts(t)
	pro := makePackage(t, "Pro", []string{"ai"}, nil)
	accountsDB.Exec(`INSERT INTO promo_codes (code, package_id, duration_days, max_uses, created_at) VALUES ('LAUNCH-2026', ?, 7, 1, 1)`, pro.ID)
	first := register(t, srv, "first@example.com")
	second := register(t, srv, "second@example.com")

	_, env, raw := call(t, srv, http.MethodPost, "/pro/v1/account/redeem", `{"code":" launch-2026 "}`, first)
	if env.Code != 200 {
		t.Fatalf("redeem: %s", raw)
	}
	if !features(t, srv, first)["ai"] {
		t.Fatal("promo didn't grant the package")
	}
	var sub Subscription
	decodeData(t, env, &sub)
	if sub.EndsAt-sub.StartsAt != 7*86400 {
		t.Fatalf("promo duration: %d", sub.EndsAt-sub.StartsAt)
	}
	// Used by the first account, so it's gone for the second
	if status, _, _ := call(t, srv, http.MethodPost, "/pro/v1/account/redeem", `{"code":"LAUNCH-2026"}`, second); status != http.StatusBadRequest {
		t.Fatalf("used-up code: HTTP %d", status)
	}
	if status, _, _ := call(t, srv, http.MethodPost, "/pro/v1/account/redeem", `{"code":"NOPE"}`, second); status != http.StatusBadRequest {
		t.Fatalf("unknown code: HTTP %d", status)
	}
}

func TestMonthlyLimits(t *testing.T) {
	srv := setupAccounts(t)
	limited := makePackage(t, "Trial", []string{"ai", "tts"}, map[string]int64{"ai_requests": 1, "tts_chars": 10})
	token := register(t, srv, "trial@example.com")
	user, _ := getUserByEmail("trial@example.com")
	grantSubscription(user.ID, limited.ID, 0, "admin", "")

	body := `{"title":"Dune by Frank Herbert"}`
	if _, env, raw := call(t, srv, http.MethodPost, "/pro/v1/title/analyze", body, token); env.Code != 200 {
		t.Fatalf("first AI request: %s", raw)
	}
	status, env, _ := call(t, srv, http.MethodPost, "/pro/v1/title/analyze", body, token)
	if status != http.StatusTooManyRequests || env.Code != 429 {
		t.Fatalf("over the AI limit: HTTP %d", status)
	}
	// TTS counts characters: 5 fit, then 6 more don't
	if _, env, raw := call(t, srv, http.MethodPost, "/pro/v1/tts", `{"text":"héllo"}`, token); env.Code != 200 {
		t.Fatalf("TTS: %s", raw)
	}
	if status, _, _ := call(t, srv, http.MethodPost, "/pro/v1/tts", `{"text":"123456"}`, token); status != http.StatusTooManyRequests {
		t.Fatalf("over the TTS limit: HTTP %d", status)
	}
	usage := getUsage(user.ID, usagePeriod())
	if usage["ai_requests"] != 1 || usage["tts_chars"] != 5 {
		t.Fatalf("usage: %v", usage)
	}
	// The owner token has no limits
	if _, env, _ := call(t, srv, http.MethodPost, "/pro/v1/title/analyze", body, testProToken); env.Code != 200 {
		t.Fatal("owner token was limited")
	}
}

func TestVaultIsPerAccount(t *testing.T) {
	srv := setupAccounts(t)
	sync := makePackage(t, "Sync", []string{"vault"}, nil)
	alice := register(t, srv, "alice@example.com")
	bob := register(t, srv, "bob@example.com")
	for _, email := range []string{"alice@example.com", "bob@example.com"} {
		u, _ := getUserByEmail(email)
		grantSubscription(u.ID, sync.ID, 0, "admin", "")
	}
	_, env, _ := call(t, srv, http.MethodPost, "/pro/v1/token/encrypt", `{"token":"alice-webdav-password"}`, alice)
	var enc struct {
		EncryptedToken string `json:"encrypted_token"`
	}
	decodeData(t, env, &enc)
	body := `{"encrypted_token":"` + enc.EncryptedToken + `"}`
	if _, env, raw := call(t, srv, http.MethodPost, "/pro/v1/token/decrypt", body, alice); env.Code != 200 {
		t.Fatalf("alice decrypting her own: %s", raw)
	}
	if status, _, _ := call(t, srv, http.MethodPost, "/pro/v1/token/decrypt", body, bob); status != http.StatusBadRequest {
		t.Fatalf("bob decrypted alice's credentials: HTTP %d", status)
	}
}

func TestAccessRequestApproval(t *testing.T) {
	srv := setupAccounts(t)
	pro := makePackage(t, "Pro", []string{"ai"}, nil)
	token := register(t, srv, "buyer@example.com")
	_, env, raw := call(t, srv, http.MethodPost, "/pro/v1/account/requests",
		`{"kind":"subscription","package_id":`+itoa(pro.ID)+`,"payment_reference":"TX-991"}`, token)
	if env.Code != 200 {
		t.Fatalf("request: %s", raw)
	}
	requests := listAccessRequests(0, "pending")
	if len(requests) != 1 || requests[0].PaymentReference != "TX-991" {
		t.Fatalf("pending requests: %+v", requests)
	}

	client, adminURL := adminClient(t, srv)
	res := adminDo(t, client, http.MethodPost, adminURL+"requests/"+itoa(requests[0].ID)+"/approve", `{"package_id":`+itoa(pro.ID)+`}`)
	if res.StatusCode != 200 {
		t.Fatalf("approve: HTTP %d", res.StatusCode)
	}
	if !features(t, srv, token)["ai"] {
		t.Fatal("approval didn't grant the package")
	}
	res = adminDo(t, client, http.MethodPost, adminURL+"requests/"+itoa(requests[0].ID)+"/approve", `{"package_id":`+itoa(pro.ID)+`}`)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("approving twice: HTTP %d", res.StatusCode)
	}
}

// Signs in the first admin through the setup code; returns a client with the
// session cookie and the API base URL
func adminClient(t *testing.T, srv *httptest.Server) (*http.Client, string) {
	t.Helper()
	adminSetupToken = "setup-code"
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	base := srv.URL + "/admin/api/"
	res := adminDo(t, client, http.MethodPost, base+"setup", `{"code":"setup-code","email":"admin@example.com","password":"a long admin password"}`)
	if res.StatusCode != 200 {
		t.Fatalf("admin setup: HTTP %d", res.StatusCode)
	}
	return client, base
}

func adminDo(t *testing.T, client *http.Client, method, url, body string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Folio-Admin", "1")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res
}

func TestAdminPanelAccess(t *testing.T) {
	srv := setupAccounts(t)
	proEnabled = true
	base := srv.URL + "/admin/api/"

	// Setup needs the code from the log
	adminSetupToken = "setup-code"
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	if res := adminDo(t, client, http.MethodPost, base+"setup", `{"code":"guess","email":"x@example.com","password":"a long admin password"}`); res.StatusCode != http.StatusForbidden {
		t.Fatalf("setup with a wrong code: HTTP %d", res.StatusCode)
	}
	client, base = adminClient(t, srv)
	if res := adminDo(t, client, http.MethodGet, base+"stats", ""); res.StatusCode != 200 {
		t.Fatalf("stats as admin: HTTP %d", res.StatusCode)
	}
	// A second setup is refused once an admin exists
	adminSetupToken = "setup-code"
	if res := adminDo(t, client, http.MethodPost, base+"setup", `{"code":"setup-code","email":"y@example.com","password":"a long admin password"}`); res.StatusCode != http.StatusForbidden {
		t.Fatalf("second setup: HTTP %d", res.StatusCode)
	}

	// Changes without the header are refused (cross-site requests can't set it)
	req, _ := http.NewRequest(http.MethodPost, base+"packages", strings.NewReader(`{"name":"X"}`))
	res, _ := client.Do(req)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("change without header: HTTP %d", res.StatusCode)
	}

	// Without a session, or as a regular user
	if res := adminDo(t, http.DefaultClient, http.MethodGet, base+"users", ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("users without session: HTTP %d", res.StatusCode)
	}
	register(t, srv, "user@example.com")
	userJar, _ := cookiejar.New(nil)
	userClient := &http.Client{Jar: userJar}
	if res := adminDo(t, userClient, http.MethodPost, base+"login", `{"email":"user@example.com","password":"correct horse"}`); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("regular user signing in to admin: HTTP %d", res.StatusCode)
	}

	// The admin can't lock themselves out
	admin, _ := getUserByEmail("admin@example.com")
	if res := adminDo(t, client, http.MethodPatch, base+"users/"+itoa(admin.ID), `{"role":"user"}`); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("self-demotion: HTTP %d", res.StatusCode)
	}

	// The page itself
	page, _ := http.Get(srv.URL + "/admin")
	if page.StatusCode != 200 || !strings.Contains(page.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatalf("admin page: HTTP %d", page.StatusCode)
	}
	u, _ := url.Parse(srv.URL + "/admin/static/app.js")
	script, _ := http.Get(u.String())
	if script.StatusCode != 200 {
		t.Fatalf("admin script: HTTP %d", script.StatusCode)
	}
}

func TestAdminSecretsAreNotReturned(t *testing.T) {
	srv := setupAccounts(t)
	setSetting("smtp_password", "hunter2hunter2")
	client, base := adminClient(t, srv)
	req, _ := http.NewRequest(http.MethodGet, base+"settings", nil)
	res, _ := client.Do(req)
	var settings map[string]any
	json.NewDecoder(res.Body).Decode(&settings)
	res.Body.Close()
	if settings["smtp_password"] != "" || settings["smtp_password_set"] != true {
		t.Fatalf("settings exposed the SMTP password: %v", settings["smtp_password"])
	}
	// Saving with the secret left blank keeps it
	adminDo(t, client, http.MethodPut, base+"settings", `{"smtp_password":"","smtp_host":"smtp.example.com"}`)
	if getSetting("smtp_password") != "hunter2hunter2" {
		t.Fatal("blank secret overwrote the saved one")
	}
}

func TestEndedPlanFallsBackToDefault(t *testing.T) {
	srv := setupAccounts(t)
	free := makePackage(t, "Free", []string{"metadata"}, nil)
	pro := makePackage(t, "Pro", []string{"ai", "metadata"}, nil)
	setSetting("default_package_id", itoa(free.ID))
	token := register(t, srv, "lapsed@example.com")
	user, _ := getUserByEmail("lapsed@example.com")
	sub, _ := grantSubscription(user.ID, pro.ID, 0, "admin", "")
	if !features(t, srv, token)["ai"] {
		t.Fatal("Pro not applied")
	}
	accountsDB.Exec(`UPDATE subscriptions SET ends_at = ? WHERE id = ?`, unixNow()-60, sub.ID)
	got := features(t, srv, token)
	if got["ai"] || !got["metadata"] {
		t.Fatalf("after Pro ended: %v", got)
	}
}
