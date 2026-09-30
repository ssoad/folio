package main

// Accounts store: users, their device tokens, packages (plans), subscriptions,
// promo codes, access requests, monthly usage and admin-editable settings.
// One SQLite file (PRO_DB_PATH, default ./data/folio.db).

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var accountsDB *sql.DB

// Features a package can include; the server must also provide them
var allFeatures = []string{"ai", "tts", "ocr", "metadata", "vault", "assets", "drives"}

// Monthly usage limits a package can set; missing means unlimited
var allLimits = []string{"ai_requests", "tts_chars", "ocr_pages"}

const accountsSchema = `
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	email TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL DEFAULT '',
	password_hash TEXT NOT NULL DEFAULT '',
	google_sub TEXT UNIQUE,
	role TEXT NOT NULL DEFAULT 'user',
	status TEXT NOT NULL DEFAULT 'active',
	email_verified INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tokens (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,
	token_hash TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	last_used_at INTEGER NOT NULL DEFAULT 0,
	expires_at INTEGER NOT NULL DEFAULT 0,
	revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
CREATE TABLE IF NOT EXISTS packages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	price_label TEXT NOT NULL DEFAULT '',
	duration_days INTEGER NOT NULL DEFAULT 30,
	features TEXT NOT NULL DEFAULT '[]',
	limits TEXT NOT NULL DEFAULT '{}',
	is_public INTEGER NOT NULL DEFAULT 1,
	is_active INTEGER NOT NULL DEFAULT 1,
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	package_id INTEGER NOT NULL REFERENCES packages(id),
	source TEXT NOT NULL,
	starts_at INTEGER NOT NULL,
	ends_at INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'active',
	note TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions(user_id);
CREATE TABLE IF NOT EXISTS promo_codes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	code TEXT NOT NULL UNIQUE,
	package_id INTEGER NOT NULL REFERENCES packages(id),
	duration_days INTEGER NOT NULL DEFAULT 0,
	max_uses INTEGER NOT NULL DEFAULT 1,
	used_count INTEGER NOT NULL DEFAULT 0,
	expires_at INTEGER NOT NULL DEFAULT 0,
	is_active INTEGER NOT NULL DEFAULT 1,
	note TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS promo_redemptions (
	promo_id INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	redeemed_at INTEGER NOT NULL,
	PRIMARY KEY (promo_id, user_id)
);
CREATE TABLE IF NOT EXISTS access_requests (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,
	package_id INTEGER,
	message TEXT NOT NULL DEFAULT '',
	payment_reference TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'pending',
	admin_note TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	decided_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS usage (
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	period TEXT NOT NULL,
	metric TEXT NOT NULL,
	amount INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (user_id, period, metric)
);
CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_tokens (
	token_hash TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,
	expires_at INTEGER NOT NULL
);
`

func openAccountsDB(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	// SQLite writes one at a time
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(accountsSchema); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func unixNow() int64 { return time.Now().Unix() }

// Shortens text for storage without splitting a character
func clip(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n])
}

// ── Secrets ──────────────────────────────────────────────────────────────────

func randomToken(bytes int) string {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

const passwordIterations = 600_000

// Stored as pbkdf2-sha256$iterations$salt$key
func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, passwordIterations, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", passwordIterations,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

func checkPassword(stored, password string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iterations, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// ── Users ────────────────────────────────────────────────────────────────────

type User struct {
	ID            int64  `json:"id"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	Role          string `json:"role"`
	Status        string `json:"status"`
	EmailVerified bool   `json:"email_verified"`
	HasPassword   bool   `json:"has_password"`
	HasGoogle     bool   `json:"has_google"`
	CreatedAt     int64  `json:"created_at"`
	LastSeenAt    int64  `json:"last_seen_at"`
	passwordHash  string
}

const userColumns = `id, email, name, password_hash, COALESCE(google_sub, ''), role, status, email_verified, created_at, last_seen_at`

func scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var u User
	var googleSub string
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.passwordHash, &googleSub, &u.Role, &u.Status,
		&u.EmailVerified, &u.CreatedAt, &u.LastSeenAt); err != nil {
		return nil, err
	}
	u.HasPassword = u.passwordHash != ""
	u.HasGoogle = googleSub != ""
	return &u, nil
}

func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

func validEmail(email string) bool {
	at := strings.LastIndex(email, "@")
	return at > 0 && at < len(email)-3 && strings.Contains(email[at:], ".") && !strings.ContainsAny(email, " \t\r\n")
}

func getUser(id int64) (*User, error) {
	return scanUser(accountsDB.QueryRow(`SELECT `+userColumns+` FROM users WHERE id = ?`, id))
}

func getUserByEmail(email string) (*User, error) {
	return scanUser(accountsDB.QueryRow(`SELECT `+userColumns+` FROM users WHERE email = ?`, normalizeEmail(email)))
}

func getUserByGoogle(sub string) (*User, error) {
	return scanUser(accountsDB.QueryRow(`SELECT `+userColumns+` FROM users WHERE google_sub = ?`, sub))
}

var errEmailTaken = errors.New("An account with this email already exists")

func createUser(email, name, password, role string, verified bool) (*User, error) {
	email = normalizeEmail(email)
	hash := ""
	if password != "" {
		var err error
		if hash, err = hashPassword(password); err != nil {
			return nil, err
		}
	}
	res, err := accountsDB.Exec(`INSERT INTO users (email, name, password_hash, role, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		email, strings.TrimSpace(name), hash, role, verified, unixNow())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return nil, errEmailTaken
		}
		return nil, err
	}
	id, _ := res.LastInsertId()
	return getUser(id)
}

func setUserPassword(id int64, password string) error {
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	_, err = accountsDB.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, hash, id)
	return err
}

func countAdmins() int {
	var n int
	accountsDB.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'`).Scan(&n)
	return n
}

// ── Tokens ───────────────────────────────────────────────────────────────────

type Device struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	CreatedAt  int64  `json:"created_at"`
	LastUsedAt int64  `json:"last_used_at"`
}

// App tokens last until revoked; admin panel sessions expire
func issueToken(userID int64, kind, name string, ttl time.Duration) (string, error) {
	token := randomToken(32)
	expires := int64(0)
	if ttl > 0 {
		expires = time.Now().Add(ttl).Unix()
	}
	_, err := accountsDB.Exec(`INSERT INTO tokens (user_id, kind, token_hash, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		userID, kind, hashToken(token), clip(strings.TrimSpace(name), 80), unixNow(), expires)
	return token, err
}

// The active user behind a token of this kind
func userForToken(token, kind string) (*User, int64, error) {
	var tokenID, userID, expires int64
	err := accountsDB.QueryRow(`SELECT id, user_id, expires_at FROM tokens WHERE token_hash = ? AND kind = ? AND revoked = 0`,
		hashToken(token), kind).Scan(&tokenID, &userID, &expires)
	if err != nil || (expires > 0 && expires < unixNow()) {
		return nil, 0, errors.New("invalid token")
	}
	user, err := getUser(userID)
	if err != nil || user.Status != "active" {
		return nil, 0, errors.New("invalid token")
	}
	t := unixNow()
	// Once a minute is enough for "last seen"
	accountsDB.Exec(`UPDATE tokens SET last_used_at = ? WHERE id = ? AND last_used_at < ?`, t, tokenID, t-60)
	accountsDB.Exec(`UPDATE users SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?`, t, userID, t-60)
	return user, tokenID, nil
}

func revokeToken(id int64) error {
	_, err := accountsDB.Exec(`UPDATE tokens SET revoked = 1 WHERE id = ?`, id)
	return err
}

func listDevices(userID int64) []Device {
	rows, err := accountsDB.Query(`SELECT id, name, created_at, last_used_at FROM tokens WHERE user_id = ? AND kind = 'app' AND revoked = 0 ORDER BY last_used_at DESC`, userID)
	devices := []Device{}
	if err != nil {
		return devices
	}
	defer rows.Close()
	for rows.Next() {
		var d Device
		rows.Scan(&d.ID, &d.Name, &d.CreatedAt, &d.LastUsedAt)
		devices = append(devices, d)
	}
	return devices
}

// One-time email links (verification, password reset)
func issueEmailToken(userID int64, kind string, ttl time.Duration) (string, error) {
	token := randomToken(24)
	accountsDB.Exec(`DELETE FROM email_tokens WHERE user_id = ? AND kind = ?`, userID, kind)
	_, err := accountsDB.Exec(`INSERT INTO email_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)`,
		hashToken(token), userID, kind, time.Now().Add(ttl).Unix())
	return token, err
}

func consumeEmailToken(token, kind string) (int64, error) {
	var userID, expires int64
	err := accountsDB.QueryRow(`SELECT user_id, expires_at FROM email_tokens WHERE token_hash = ? AND kind = ?`, hashToken(token), kind).Scan(&userID, &expires)
	if err != nil || expires < unixNow() {
		return 0, errors.New("This link is invalid or has expired")
	}
	accountsDB.Exec(`DELETE FROM email_tokens WHERE token_hash = ?`, hashToken(token))
	return userID, nil
}

// ── Packages ─────────────────────────────────────────────────────────────────

type Package struct {
	ID           int64            `json:"id"`
	Name         string           `json:"name"`
	Description  string           `json:"description"`
	PriceLabel   string           `json:"price_label"`
	DurationDays int64            `json:"duration_days"`
	Features     []string         `json:"features"`
	Limits       map[string]int64 `json:"limits"`
	IsPublic     bool             `json:"is_public"`
	IsActive     bool             `json:"is_active"`
	SortOrder    int64            `json:"sort_order"`
	CreatedAt    int64            `json:"created_at"`
}

const packageColumns = `id, name, description, price_label, duration_days, features, limits, is_public, is_active, sort_order, created_at`

func scanPackage(row interface{ Scan(...any) error }) (*Package, error) {
	var p Package
	var features, limits string
	if err := row.Scan(&p.ID, &p.Name, &p.Description, &p.PriceLabel, &p.DurationDays, &features, &limits,
		&p.IsPublic, &p.IsActive, &p.SortOrder, &p.CreatedAt); err != nil {
		return nil, err
	}
	json.Unmarshal([]byte(features), &p.Features)
	json.Unmarshal([]byte(limits), &p.Limits)
	if p.Features == nil {
		p.Features = []string{}
	}
	if p.Limits == nil {
		p.Limits = map[string]int64{}
	}
	return &p, nil
}

func getPackage(id int64) (*Package, error) {
	return scanPackage(accountsDB.QueryRow(`SELECT `+packageColumns+` FROM packages WHERE id = ?`, id))
}

func listPackages(onlyPublic bool) []Package {
	query := `SELECT ` + packageColumns + ` FROM packages`
	if onlyPublic {
		query += ` WHERE is_public = 1 AND is_active = 1`
	}
	rows, err := accountsDB.Query(query + ` ORDER BY sort_order, id`)
	packages := []Package{}
	if err != nil {
		return packages
	}
	defer rows.Close()
	for rows.Next() {
		if p, err := scanPackage(rows); err == nil {
			packages = append(packages, *p)
		}
	}
	return packages
}

// Keeps only known features and limits
func cleanPackage(p *Package) error {
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return errors.New("A package needs a name")
	}
	if p.DurationDays < 0 {
		return errors.New("Duration can't be negative")
	}
	features := []string{}
	for _, f := range p.Features {
		for _, known := range allFeatures {
			if f == known {
				features = append(features, f)
				break
			}
		}
	}
	p.Features = features
	limits := map[string]int64{}
	for k, v := range p.Limits {
		for _, known := range allLimits {
			if k == known && v >= 0 {
				limits[k] = v
			}
		}
	}
	p.Limits = limits
	return nil
}

func savePackage(p *Package) error {
	if err := cleanPackage(p); err != nil {
		return err
	}
	features, _ := json.Marshal(p.Features)
	limits, _ := json.Marshal(p.Limits)
	if p.ID == 0 {
		res, err := accountsDB.Exec(`INSERT INTO packages (name, description, price_label, duration_days, features, limits, is_public, is_active, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			p.Name, p.Description, p.PriceLabel, p.DurationDays, string(features), string(limits), p.IsPublic, p.IsActive, p.SortOrder, unixNow())
		if err != nil {
			return err
		}
		p.ID, _ = res.LastInsertId()
		return nil
	}
	_, err := accountsDB.Exec(`UPDATE packages SET name = ?, description = ?, price_label = ?, duration_days = ?, features = ?, limits = ?, is_public = ?, is_active = ?, sort_order = ? WHERE id = ?`,
		p.Name, p.Description, p.PriceLabel, p.DurationDays, string(features), string(limits), p.IsPublic, p.IsActive, p.SortOrder, p.ID)
	return err
}

// ── Subscriptions ────────────────────────────────────────────────────────────

type Subscription struct {
	ID          int64  `json:"id"`
	PackageID   int64  `json:"package_id"`
	PackageName string `json:"package_name"`
	Source      string `json:"source"`
	StartsAt    int64  `json:"starts_at"`
	EndsAt      int64  `json:"ends_at"`
	Status      string `json:"status"`
	Note        string `json:"note"`
	CreatedAt   int64  `json:"created_at"`
	Active      bool   `json:"active"`
}

func listSubscriptions(userID int64) []Subscription {
	rows, err := accountsDB.Query(`SELECT s.id, s.package_id, COALESCE(p.name, ''), s.source, s.starts_at, s.ends_at, s.status, s.note, s.created_at
		FROM subscriptions s LEFT JOIN packages p ON p.id = s.package_id WHERE s.user_id = ? ORDER BY s.created_at DESC`, userID)
	subs := []Subscription{}
	if err != nil {
		return subs
	}
	defer rows.Close()
	t := unixNow()
	for rows.Next() {
		var s Subscription
		rows.Scan(&s.ID, &s.PackageID, &s.PackageName, &s.Source, &s.StartsAt, &s.EndsAt, &s.Status, &s.Note, &s.CreatedAt)
		s.Active = s.Status == "active" && s.StartsAt <= t && (s.EndsAt == 0 || s.EndsAt > t)
		subs = append(subs, s)
	}
	return subs
}

// The user's current subscription and its package, if any
func activeSubscription(userID int64) (*Subscription, *Package) {
	for _, s := range listSubscriptions(userID) {
		if s.Active {
			if p, err := getPackage(s.PackageID); err == nil && p.IsActive {
				sub := s
				return &sub, p
			}
		}
	}
	return nil, nil
}

// Gives a user a package. Days: 0 uses the package's duration, -1 means no
// end. The same package extends the current subscription; another replaces it.
func grantSubscription(userID, packageID int64, days int64, source, note string) (*Subscription, error) {
	pkg, err := getPackage(packageID)
	if err != nil {
		return nil, errors.New("Package not found")
	}
	if days == 0 {
		days = pkg.DurationDays
	}
	t := unixNow()
	current, currentPkg := activeSubscription(userID)
	if current != nil && currentPkg.ID == packageID {
		if current.EndsAt == 0 {
			return current, nil
		}
		ends := int64(0)
		if days > 0 {
			ends = current.EndsAt + days*86400
		}
		accountsDB.Exec(`UPDATE subscriptions SET ends_at = ?, note = TRIM(note || ' ' || ?) WHERE id = ?`, ends, note, current.ID)
		for _, s := range listSubscriptions(userID) {
			if s.ID == current.ID {
				return &s, nil
			}
		}
	}
	if current != nil {
		accountsDB.Exec(`UPDATE subscriptions SET status = 'replaced' WHERE user_id = ? AND status = 'active'`, userID)
	}
	ends := int64(0)
	if days > 0 {
		ends = t + days*86400
	}
	res, err := accountsDB.Exec(`INSERT INTO subscriptions (user_id, package_id, source, starts_at, ends_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		userID, packageID, source, t, ends, note, t)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	for _, s := range listSubscriptions(userID) {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, errors.New("Subscription not saved")
}

func cancelSubscription(userID, subscriptionID int64) error {
	_, err := accountsDB.Exec(`UPDATE subscriptions SET status = 'cancelled' WHERE id = ? AND user_id = ?`, subscriptionID, userID)
	return err
}

// The package in settings that everyone without an active subscription
// gets, e.g. Free; so an ended plan falls back to it
func defaultPackage() *Package {
	id, _ := strconv.ParseInt(getSetting("default_package_id"), 10, 64)
	if id <= 0 {
		return nil
	}
	if pkg, err := getPackage(id); err == nil && pkg.IsActive {
		return pkg
	}
	return nil
}

// The subscription and package that apply now: the active subscription, or
// the default package (with no subscription)
func currentPlan(userID int64) (*Subscription, *Package) {
	if sub, pkg := activeSubscription(userID); sub != nil {
		return sub, pkg
	}
	return nil, defaultPackage()
}

// ── Promo codes ──────────────────────────────────────────────────────────────

type PromoCode struct {
	ID           int64  `json:"id"`
	Code         string `json:"code"`
	PackageID    int64  `json:"package_id"`
	PackageName  string `json:"package_name"`
	DurationDays int64  `json:"duration_days"`
	MaxUses      int64  `json:"max_uses"`
	UsedCount    int64  `json:"used_count"`
	ExpiresAt    int64  `json:"expires_at"`
	IsActive     bool   `json:"is_active"`
	Note         string `json:"note"`
	CreatedAt    int64  `json:"created_at"`
}

func normalizeCode(code string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), " ", ""))
}

// Readable codes without look-alike characters
func generateCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 10)
	rand.Read(b)
	out := make([]byte, 0, 11)
	for i, v := range b {
		if i == 5 {
			out = append(out, '-')
		}
		out = append(out, alphabet[int(v)%len(alphabet)])
	}
	return string(out)
}

func listPromoCodes() []PromoCode {
	rows, err := accountsDB.Query(`SELECT c.id, c.code, c.package_id, COALESCE(p.name, ''), c.duration_days, c.max_uses, c.used_count, c.expires_at, c.is_active, c.note, c.created_at
		FROM promo_codes c LEFT JOIN packages p ON p.id = c.package_id ORDER BY c.created_at DESC`)
	codes := []PromoCode{}
	if err != nil {
		return codes
	}
	defer rows.Close()
	for rows.Next() {
		var c PromoCode
		rows.Scan(&c.ID, &c.Code, &c.PackageID, &c.PackageName, &c.DurationDays, &c.MaxUses, &c.UsedCount, &c.ExpiresAt, &c.IsActive, &c.Note, &c.CreatedAt)
		codes = append(codes, c)
	}
	return codes
}

func redeemPromoCode(userID int64, code string) (*Subscription, error) {
	invalid := errors.New("This code is invalid or has expired")
	var c PromoCode
	err := accountsDB.QueryRow(`SELECT id, package_id, duration_days, max_uses, used_count, expires_at, is_active FROM promo_codes WHERE code = ?`,
		normalizeCode(code)).Scan(&c.ID, &c.PackageID, &c.DurationDays, &c.MaxUses, &c.UsedCount, &c.ExpiresAt, &c.IsActive)
	if err != nil || !c.IsActive || (c.ExpiresAt > 0 && c.ExpiresAt < unixNow()) || (c.MaxUses > 0 && c.UsedCount >= c.MaxUses) {
		return nil, invalid
	}
	res, err := accountsDB.Exec(`INSERT OR IGNORE INTO promo_redemptions (promo_id, user_id, redeemed_at) VALUES (?, ?, ?)`, c.ID, userID, unixNow())
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, errors.New("You have already used this code")
	}
	// Guards against two redemptions racing for the last use
	res, _ = accountsDB.Exec(`UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ? AND (max_uses = 0 OR used_count < max_uses)`, c.ID)
	if n, _ := res.RowsAffected(); n == 0 {
		accountsDB.Exec(`DELETE FROM promo_redemptions WHERE promo_id = ? AND user_id = ?`, c.ID, userID)
		return nil, invalid
	}
	return grantSubscription(userID, c.PackageID, c.DurationDays, "promo", "Code "+normalizeCode(code))
}

// ── Access requests ──────────────────────────────────────────────────────────

type AccessRequest struct {
	ID               int64  `json:"id"`
	UserID           int64  `json:"user_id"`
	UserEmail        string `json:"user_email"`
	Kind             string `json:"kind"`
	PackageID        int64  `json:"package_id"`
	PackageName      string `json:"package_name"`
	Message          string `json:"message"`
	PaymentReference string `json:"payment_reference"`
	Status           string `json:"status"`
	AdminNote        string `json:"admin_note"`
	CreatedAt        int64  `json:"created_at"`
	DecidedAt        int64  `json:"decided_at"`
}

// userID 0 lists everyone's; status "" lists all
func listAccessRequests(userID int64, status string) []AccessRequest {
	query := `SELECT r.id, r.user_id, u.email, r.kind, COALESCE(r.package_id, 0), COALESCE(p.name, ''), r.message, r.payment_reference, r.status, r.admin_note, r.created_at, r.decided_at
		FROM access_requests r JOIN users u ON u.id = r.user_id LEFT JOIN packages p ON p.id = r.package_id WHERE 1 = 1`
	args := []any{}
	if userID > 0 {
		query += ` AND r.user_id = ?`
		args = append(args, userID)
	}
	if status != "" {
		query += ` AND r.status = ?`
		args = append(args, status)
	}
	rows, err := accountsDB.Query(query+` ORDER BY r.created_at DESC LIMIT 500`, args...)
	requests := []AccessRequest{}
	if err != nil {
		return requests
	}
	defer rows.Close()
	for rows.Next() {
		var a AccessRequest
		rows.Scan(&a.ID, &a.UserID, &a.UserEmail, &a.Kind, &a.PackageID, &a.PackageName, &a.Message, &a.PaymentReference, &a.Status, &a.AdminNote, &a.CreatedAt, &a.DecidedAt)
		requests = append(requests, a)
	}
	return requests
}

// ── Usage ────────────────────────────────────────────────────────────────────

func usagePeriod() string { return time.Now().UTC().Format("2006-01") }

func getUsage(userID int64, period string) map[string]int64 {
	usage := map[string]int64{}
	for _, m := range allLimits {
		usage[m] = 0
	}
	rows, err := accountsDB.Query(`SELECT metric, amount FROM usage WHERE user_id = ? AND period = ?`, userID, period)
	if err != nil {
		return usage
	}
	defer rows.Close()
	for rows.Next() {
		var metric string
		var amount int64
		rows.Scan(&metric, &amount)
		usage[metric] = amount
	}
	return usage
}

func addUsage(userID int64, metric string, amount int64) {
	accountsDB.Exec(`INSERT INTO usage (user_id, period, metric, amount) VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, period, metric) DO UPDATE SET amount = amount + excluded.amount`, userID, usagePeriod(), metric, amount)
}

// ── Settings ─────────────────────────────────────────────────────────────────

// Admin-editable; the value here is used until one is saved
var settingDefaults = map[string]string{
	"registration_open":          "true",
	"require_email_verification": "false",
	"default_package_id":         "0",
	"payment_instructions":       "",
	"public_url":                 "",
	"smtp_host":                  "",
	"smtp_port":                  "587",
	"smtp_username":              "",
	"smtp_password":              "",
	"smtp_from":                  "",
	"google_client_id":           "",
	"google_client_secret":       "",
}

// Never sent back to the admin panel in full
var secretSettings = map[string]bool{"smtp_password": true, "google_client_secret": true}

func getSetting(key string) string {
	var value string
	if err := accountsDB.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value); err == nil {
		return value
	}
	return settingDefaults[key]
}

func setSetting(key, value string) error {
	if _, known := settingDefaults[key]; !known {
		return fmt.Errorf("Unknown setting %q", key)
	}
	_, err := accountsDB.Exec(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func settingBool(key string) bool { return getSetting(key) == "true" }
