package main

// The admin panel at /admin: a single page (admin/ embedded in the binary)
// and its JSON API at /admin/api. Admins sign in with their account; the
// session is an HttpOnly, SameSite=Strict cookie, and every change must carry
// the X-Folio-Admin header, which cross-site forms and scripts can't send.

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
	"time"
)

//go:embed admin
var adminFiles embed.FS

const (
	adminCookie     = "folio_admin"
	adminSessionTTL = 12 * time.Hour
)

func adminHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if rest, ok := strings.CutPrefix(r.URL.Path, "/admin/api/"); ok {
		adminAPI(w, r, strings.Trim(rest, "/"))
		return
	}
	static, _ := fs.Sub(adminFiles, "admin")
	if file, ok := strings.CutPrefix(r.URL.Path, "/admin/static/"); ok && file != "" && !strings.Contains(file, "..") {
		serveAdminFile(w, r, static, file)
		return
	}
	// Everything else is the single page
	w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'")
	serveAdminFile(w, r, static, "index.html")
}

// Embedded files have no modification time, so a content hash tells the
// browser when a new server version changed them
func serveAdminFile(w http.ResponseWriter, r *http.Request, static fs.FS, name string) {
	data, err := fs.ReadFile(static, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	sum := sha256.Sum256(data)
	w.Header().Set("ETag", `"`+hex.EncodeToString(sum[:8])+`"`)
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

func adminFail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

func adminOK(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, data)
}

func adminUser(r *http.Request) *User {
	cookie, err := r.Cookie(adminCookie)
	if err != nil || cookie.Value == "" {
		return nil
	}
	user, _, err := userForToken(cookie.Value, "admin")
	if err != nil || user.Role != "admin" {
		return nil
	}
	return user
}

func setAdminCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminCookie,
		Value:    token,
		Path:     "/admin",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
		SameSite: http.SameSiteStrictMode,
	})
}

func startAdminSession(w http.ResponseWriter, r *http.Request, user *User) {
	token, err := issueToken(user.ID, "admin", clip(r.UserAgent(), 80), adminSessionTTL)
	if err != nil {
		adminFail(w, http.StatusInternalServerError, "Cannot sign in")
		return
	}
	setAdminCookie(w, r, token, int(adminSessionTTL.Seconds()))
	adminOK(w, map[string]any{"user": user})
}

// Splits "users/12/subscriptions/3" into its parts
func segments(path string) []string {
	if path == "" {
		return nil
	}
	return strings.Split(path, "/")
}

func idAt(parts []string, i int) int64 {
	if i >= len(parts) {
		return 0
	}
	id, _ := strconv.ParseInt(parts[i], 10, 64)
	return id
}

func adminAPI(w http.ResponseWriter, r *http.Request, path string) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if r.Method != http.MethodGet && r.Header.Get("X-Folio-Admin") != "1" {
		adminFail(w, http.StatusForbidden, "Missing X-Folio-Admin header")
		return
	}
	// Before signing in
	switch {
	case r.Method == http.MethodGet && path == "session":
		adminOK(w, map[string]any{"setup_required": countAdmins() == 0, "user": adminUser(r)})
		return
	case r.Method == http.MethodPost && path == "setup":
		adminSetup(w, r)
		return
	case r.Method == http.MethodPost && path == "login":
		adminLogin(w, r)
		return
	case r.Method == http.MethodPost && path == "logout":
		if cookie, err := r.Cookie(adminCookie); err == nil {
			accountsDB.Exec(`UPDATE tokens SET revoked = 1 WHERE token_hash = ?`, hashToken(cookie.Value))
		}
		setAdminCookie(w, r, "", -1)
		adminOK(w, map[string]any{})
		return
	}
	admin := adminUser(r)
	if admin == nil {
		adminFail(w, http.StatusUnauthorized, "Sign in again")
		return
	}
	parts := segments(path)
	if len(parts) == 0 {
		adminFail(w, http.StatusNotFound, "Not Found")
		return
	}
	switch parts[0] {
	case "stats":
		adminStats(w)
	case "server":
		adminServer(w)
	case "users":
		adminUsers(w, r, admin, parts)
	case "packages":
		adminPackages(w, r, parts)
	case "promos":
		adminPromos(w, r, parts)
	case "requests":
		adminRequests(w, r, parts)
	case "settings":
		adminSettings(w, r, parts)
	default:
		adminFail(w, http.StatusNotFound, "Not Found")
	}
}

// The first admin, with the code printed in the server log
func adminSetup(w http.ResponseWriter, r *http.Request) {
	var in struct{ Code, Email, Password, Name string }
	decodeJSON(r, &in)
	if countAdmins() > 0 || adminSetupToken == "" {
		adminFail(w, http.StatusForbidden, "An admin already exists")
		return
	}
	if strings.TrimSpace(in.Code) != adminSetupToken {
		adminFail(w, http.StatusForbidden, "Wrong setup code; it's in the server log")
		return
	}
	if !validEmail(normalizeEmail(in.Email)) || len(in.Password) < 10 {
		adminFail(w, http.StatusBadRequest, "Enter an email and a password of at least 10 characters")
		return
	}
	user, err := getUserByEmail(in.Email)
	if err == nil {
		setUserPassword(user.ID, in.Password)
		accountsDB.Exec(`UPDATE users SET role = 'admin', status = 'active', email_verified = 1 WHERE id = ?`, user.ID)
		user, _ = getUser(user.ID)
	} else if user, err = createUser(in.Email, in.Name, in.Password, "admin", true); err != nil {
		adminFail(w, http.StatusBadRequest, err.Error())
		return
	}
	adminSetupToken = ""
	startAdminSession(w, r, user)
}

func adminLogin(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password string }
	decodeJSON(r, &in)
	email := normalizeEmail(in.Email)
	keys := []string{"admin:" + email, "adminip:" + clientIP(r)}
	if loginLimiter.blocked(keys...) {
		adminFail(w, http.StatusTooManyRequests, "Too many attempts, try again in a few minutes")
		return
	}
	user, err := getUserByEmail(email)
	if err != nil || user.Role != "admin" || user.Status != "active" || !user.HasPassword || !checkPassword(user.passwordHash, in.Password) {
		loginLimiter.fail(keys...)
		adminFail(w, http.StatusUnauthorized, "Wrong email or password")
		return
	}
	loginLimiter.clear("admin:" + email)
	startAdminSession(w, r, user)
}

// ── Overview ─────────────────────────────────────────────────────────────────

func count(query string, args ...any) int64 {
	var n int64
	accountsDB.QueryRow(query, args...).Scan(&n)
	return n
}

func adminStats(w http.ResponseWriter) {
	t := unixNow()
	usage := map[string]int64{}
	rows, err := accountsDB.Query(`SELECT metric, SUM(amount) FROM usage WHERE period = ? GROUP BY metric`, usagePeriod())
	if err == nil {
		for rows.Next() {
			var metric string
			var amount int64
			rows.Scan(&metric, &amount)
			usage[metric] = amount
		}
		rows.Close()
	}
	byPackage := []map[string]any{}
	rows, err = accountsDB.Query(`SELECT p.name, COUNT(*) FROM subscriptions s JOIN packages p ON p.id = s.package_id
		WHERE s.status = 'active' AND s.starts_at <= ? AND (s.ends_at = 0 OR s.ends_at > ?) GROUP BY p.id ORDER BY COUNT(*) DESC`, t, t)
	if err == nil {
		for rows.Next() {
			var name string
			var n int64
			rows.Scan(&name, &n)
			byPackage = append(byPackage, map[string]any{"name": name, "count": n})
		}
		rows.Close()
	}
	adminOK(w, map[string]any{
		"users":                    count(`SELECT COUNT(*) FROM users`),
		"new_users_30d":            count(`SELECT COUNT(*) FROM users WHERE created_at > ?`, t-30*86400),
		"active_users_7d":          count(`SELECT COUNT(*) FROM users WHERE last_seen_at > ?`, t-7*86400),
		"pending_requests":         count(`SELECT COUNT(*) FROM access_requests WHERE status = 'pending'`),
		"active_subscriptions":     count(`SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND starts_at <= ? AND (ends_at = 0 OR ends_at > ?)`, t, t),
		"expiring_7d":              count(`SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND ends_at > ? AND ends_at < ?`, t, t+7*86400),
		"subscriptions_by_package": byPackage,
		"usage":                    usage,
		"period":                   usagePeriod(),
	})
}

func adminServer(w http.ResponseWriter) {
	adminOK(w, map[string]any{
		"features":     serverFeatures(),
		"ai_model":     proAI.Model,
		"tts_model":    proTTS.Model,
		"drives":       proOAuthDrives(),
		"assets_dir":   proAssetsDir,
		"public_url":   publicURL(),
		"owner_token":  proAccessToken != "",
		"mail":         mailConfigured(),
		"google_login": googleSignInConfigured(),
		"all_features": allFeatures,
		"all_limits":   allLimits,
	})
}

// ── Users ────────────────────────────────────────────────────────────────────

type userRow struct {
	User
	PackageName string `json:"package_name"`
	EndsAt      int64  `json:"ends_at"`
}

func adminUsers(w http.ResponseWriter, r *http.Request, admin *User, parts []string) {
	id := idAt(parts, 1)
	switch {
	case len(parts) == 1 && r.Method == http.MethodGet:
		query := "%" + strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q"))) + "%"
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		rows, err := accountsDB.Query(`SELECT `+userColumns+` FROM users WHERE email LIKE ? OR LOWER(name) LIKE ? ORDER BY created_at DESC LIMIT 50 OFFSET ?`, query, query, offset)
		if err != nil {
			adminFail(w, http.StatusInternalServerError, err.Error())
			return
		}
		users := []userRow{}
		for rows.Next() {
			if u, err := scanUser(rows); err == nil {
				users = append(users, userRow{User: *u})
			}
		}
		rows.Close()
		for i := range users {
			if sub, pkg := currentPlan(users[i].ID); pkg != nil {
				users[i].PackageName = pkg.Name
				if sub != nil {
					users[i].EndsAt = sub.EndsAt
				}
			}
		}
		adminOK(w, map[string]any{"users": users, "total": count(`SELECT COUNT(*) FROM users WHERE email LIKE ? OR LOWER(name) LIKE ?`, query, query)})
	case len(parts) == 1 && r.Method == http.MethodPost:
		var in struct {
			Email, Name, Password, Role string
			PackageID                   int64 `json:"package_id"`
		}
		decodeJSON(r, &in)
		if !validEmail(normalizeEmail(in.Email)) || len(in.Password) < 8 {
			adminFail(w, http.StatusBadRequest, "Enter an email and a password of at least 8 characters")
			return
		}
		role := "user"
		if in.Role == "admin" {
			role = "admin"
		}
		user, err := createUser(in.Email, in.Name, in.Password, role, true)
		if err != nil {
			adminFail(w, http.StatusBadRequest, err.Error())
			return
		}
		if in.PackageID > 0 {
			grantSubscription(user.ID, in.PackageID, 0, "admin", "Added by "+admin.Email)
		}
		adminOK(w, user)
	case len(parts) == 2 && r.Method == http.MethodGet:
		user, err := getUser(id)
		if err != nil {
			adminFail(w, http.StatusNotFound, "User not found")
			return
		}
		sub, pkg := currentPlan(id)
		limits := map[string]int64{}
		if pkg != nil {
			limits = pkg.Limits
		}
		adminOK(w, map[string]any{
			"user":          user,
			"subscription":  sub,
			"package":       pkg,
			"subscriptions": listSubscriptions(id),
			"devices":       listDevices(id),
			"usage":         getUsage(id, usagePeriod()),
			"limits":        limits,
			"requests":      listAccessRequests(id, ""),
		})
	case len(parts) == 2 && r.Method == http.MethodPatch:
		adminUpdateUser(w, r, admin, id)
	case len(parts) == 2 && r.Method == http.MethodDelete:
		if id == admin.ID {
			adminFail(w, http.StatusBadRequest, "You can't delete your own account")
			return
		}
		accountsDB.Exec(`DELETE FROM promo_redemptions WHERE user_id = ?`, id)
		accountsDB.Exec(`DELETE FROM users WHERE id = ?`, id)
		removeSyncStore(id)
		adminOK(w, map[string]any{})
	case len(parts) == 3 && parts[2] == "subscriptions" && r.Method == http.MethodPost:
		var in struct {
			PackageID int64  `json:"package_id"`
			Days      int64  `json:"days"`
			Note      string `json:"note"`
		}
		decodeJSON(r, &in)
		sub, err := grantSubscription(id, in.PackageID, in.Days, "admin", clip(in.Note, 500))
		if err != nil {
			adminFail(w, http.StatusBadRequest, err.Error())
			return
		}
		adminOK(w, sub)
	case len(parts) == 4 && parts[2] == "subscriptions" && r.Method == http.MethodDelete:
		cancelSubscription(id, idAt(parts, 3))
		adminOK(w, map[string]any{})
	case len(parts) == 4 && parts[2] == "devices" && r.Method == http.MethodDelete:
		accountsDB.Exec(`UPDATE tokens SET revoked = 1 WHERE id = ? AND user_id = ?`, idAt(parts, 3), id)
		adminOK(w, map[string]any{})
	case len(parts) == 3 && parts[2] == "signout" && r.Method == http.MethodPost:
		accountsDB.Exec(`UPDATE tokens SET revoked = 1 WHERE user_id = ? AND kind = 'app'`, id)
		adminOK(w, map[string]any{})
	case len(parts) == 3 && parts[2] == "usage" && r.Method == http.MethodDelete:
		accountsDB.Exec(`DELETE FROM usage WHERE user_id = ? AND period = ?`, id, usagePeriod())
		adminOK(w, map[string]any{})
	default:
		adminFail(w, http.StatusNotFound, "Not Found")
	}
}

func adminUpdateUser(w http.ResponseWriter, r *http.Request, admin *User, id int64) {
	var in struct {
		Name          *string `json:"name"`
		Role          *string `json:"role"`
		Status        *string `json:"status"`
		EmailVerified *bool   `json:"email_verified"`
		Password      *string `json:"password"`
	}
	decodeJSON(r, &in)
	user, err := getUser(id)
	if err != nil {
		adminFail(w, http.StatusNotFound, "User not found")
		return
	}
	// Keeps at least one admin who can sign in
	if id == admin.ID && ((in.Role != nil && *in.Role != "admin") || (in.Status != nil && *in.Status != "active")) {
		adminFail(w, http.StatusBadRequest, "You can't remove your own admin access")
		return
	}
	if in.Name != nil {
		accountsDB.Exec(`UPDATE users SET name = ? WHERE id = ?`, clip(strings.TrimSpace(*in.Name), 120), id)
	}
	if in.Role != nil && (*in.Role == "admin" || *in.Role == "user") {
		accountsDB.Exec(`UPDATE users SET role = ? WHERE id = ?`, *in.Role, id)
		if *in.Role == "user" {
			accountsDB.Exec(`UPDATE tokens SET revoked = 1 WHERE user_id = ? AND kind = 'admin'`, id)
		}
	}
	if in.Status != nil && (*in.Status == "active" || *in.Status == "disabled") {
		accountsDB.Exec(`UPDATE users SET status = ? WHERE id = ?`, *in.Status, id)
	}
	if in.EmailVerified != nil {
		accountsDB.Exec(`UPDATE users SET email_verified = ? WHERE id = ?`, *in.EmailVerified, id)
	}
	if in.Password != nil {
		if len(*in.Password) < 8 {
			adminFail(w, http.StatusBadRequest, "Use a password of at least 8 characters")
			return
		}
		setUserPassword(user.ID, *in.Password)
	}
	user, _ = getUser(id)
	adminOK(w, user)
}

// ── Packages ─────────────────────────────────────────────────────────────────

func adminPackages(w http.ResponseWriter, r *http.Request, parts []string) {
	switch {
	case len(parts) == 1 && r.Method == http.MethodGet:
		adminOK(w, listPackages(false))
	case len(parts) == 1 && r.Method == http.MethodPost, len(parts) == 2 && r.Method == http.MethodPatch:
		var p Package
		if err := decodeJSON(r, &p); err != nil {
			adminFail(w, http.StatusBadRequest, "Invalid package")
			return
		}
		p.ID = idAt(parts, 1)
		if p.ID > 0 {
			if _, err := getPackage(p.ID); err != nil {
				adminFail(w, http.StatusNotFound, "Package not found")
				return
			}
		}
		if err := savePackage(&p); err != nil {
			adminFail(w, http.StatusBadRequest, err.Error())
			return
		}
		saved, _ := getPackage(p.ID)
		adminOK(w, saved)
	case len(parts) == 2 && r.Method == http.MethodDelete:
		id := idAt(parts, 1)
		// Packages people had stay for their history; they're hidden instead
		if count(`SELECT COUNT(*) FROM subscriptions WHERE package_id = ?`, id)+count(`SELECT COUNT(*) FROM promo_codes WHERE package_id = ?`, id) > 0 {
			accountsDB.Exec(`UPDATE packages SET is_active = 0, is_public = 0 WHERE id = ?`, id)
			adminOK(w, map[string]any{"archived": true})
			return
		}
		accountsDB.Exec(`DELETE FROM packages WHERE id = ?`, id)
		adminOK(w, map[string]any{"archived": false})
	default:
		adminFail(w, http.StatusNotFound, "Not Found")
	}
}

// ── Promo codes ──────────────────────────────────────────────────────────────

func adminPromos(w http.ResponseWriter, r *http.Request, parts []string) {
	switch {
	case len(parts) == 1 && r.Method == http.MethodGet:
		adminOK(w, listPromoCodes())
	case len(parts) == 1 && r.Method == http.MethodPost:
		var in struct {
			Code         string `json:"code"`
			Count        int    `json:"count"`
			PackageID    int64  `json:"package_id"`
			DurationDays int64  `json:"duration_days"`
			MaxUses      int64  `json:"max_uses"`
			ExpiresAt    int64  `json:"expires_at"`
			Note         string `json:"note"`
		}
		decodeJSON(r, &in)
		if _, err := getPackage(in.PackageID); err != nil {
			adminFail(w, http.StatusBadRequest, "Choose a package")
			return
		}
		if in.Count < 1 {
			in.Count = 1
		}
		if in.Count > 500 {
			adminFail(w, http.StatusBadRequest, "At most 500 codes at a time")
			return
		}
		if in.MaxUses < 0 || in.DurationDays < -1 {
			adminFail(w, http.StatusBadRequest, "Invalid uses or duration")
			return
		}
		created := []string{}
		for i := 0; i < in.Count; i++ {
			code := generateCode()
			if in.Count == 1 && strings.TrimSpace(in.Code) != "" {
				code = normalizeCode(in.Code)
			}
			_, err := accountsDB.Exec(`INSERT INTO promo_codes (code, package_id, duration_days, max_uses, expires_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				code, in.PackageID, in.DurationDays, in.MaxUses, in.ExpiresAt, clip(in.Note, 200), unixNow())
			if err != nil {
				adminFail(w, http.StatusBadRequest, "The code "+code+" already exists")
				return
			}
			created = append(created, code)
		}
		adminOK(w, map[string]any{"codes": created})
	case len(parts) == 2 && r.Method == http.MethodPatch:
		var in struct {
			IsActive  *bool   `json:"is_active"`
			MaxUses   *int64  `json:"max_uses"`
			ExpiresAt *int64  `json:"expires_at"`
			Note      *string `json:"note"`
		}
		decodeJSON(r, &in)
		id := idAt(parts, 1)
		if in.IsActive != nil {
			accountsDB.Exec(`UPDATE promo_codes SET is_active = ? WHERE id = ?`, *in.IsActive, id)
		}
		if in.MaxUses != nil && *in.MaxUses >= 0 {
			accountsDB.Exec(`UPDATE promo_codes SET max_uses = ? WHERE id = ?`, *in.MaxUses, id)
		}
		if in.ExpiresAt != nil {
			accountsDB.Exec(`UPDATE promo_codes SET expires_at = ? WHERE id = ?`, *in.ExpiresAt, id)
		}
		if in.Note != nil {
			accountsDB.Exec(`UPDATE promo_codes SET note = ? WHERE id = ?`, clip(*in.Note, 200), id)
		}
		adminOK(w, map[string]any{})
	case len(parts) == 2 && r.Method == http.MethodDelete:
		accountsDB.Exec(`DELETE FROM promo_codes WHERE id = ?`, idAt(parts, 1))
		adminOK(w, map[string]any{})
	default:
		adminFail(w, http.StatusNotFound, "Not Found")
	}
}

// ── Access requests ──────────────────────────────────────────────────────────

func adminRequests(w http.ResponseWriter, r *http.Request, parts []string) {
	switch {
	case len(parts) == 1 && r.Method == http.MethodGet:
		adminOK(w, listAccessRequests(0, r.URL.Query().Get("status")))
	case len(parts) == 3 && r.Method == http.MethodPost && (parts[2] == "approve" || parts[2] == "reject"):
		var in struct {
			PackageID int64  `json:"package_id"`
			Days      int64  `json:"days"`
			Note      string `json:"note"`
		}
		decodeJSON(r, &in)
		id := idAt(parts, 1)
		var userID int64
		var status string
		if err := accountsDB.QueryRow(`SELECT user_id, status FROM access_requests WHERE id = ?`, id).Scan(&userID, &status); err != nil {
			adminFail(w, http.StatusNotFound, "Request not found")
			return
		}
		if status != "pending" {
			adminFail(w, http.StatusBadRequest, "This request was already decided")
			return
		}
		decision := "rejected"
		if parts[2] == "approve" {
			if _, err := grantSubscription(userID, in.PackageID, in.Days, "request", clip(in.Note, 500)); err != nil {
				adminFail(w, http.StatusBadRequest, err.Error())
				return
			}
			decision = "approved"
		}
		accountsDB.Exec(`UPDATE access_requests SET status = ?, admin_note = ?, decided_at = ? WHERE id = ?`, decision, clip(in.Note, 500), unixNow(), id)
		adminOK(w, map[string]any{"status": decision})
	default:
		adminFail(w, http.StatusNotFound, "Not Found")
	}
}

// ── Settings ─────────────────────────────────────────────────────────────────

func adminSettings(w http.ResponseWriter, r *http.Request, parts []string) {
	switch {
	case len(parts) == 1 && r.Method == http.MethodGet:
		out := map[string]any{}
		for key := range settingDefaults {
			value := getSetting(key)
			if secretSettings[key] {
				// Only whether it's set
				out[key] = ""
				out[key+"_set"] = value != ""
				continue
			}
			out[key] = value
		}
		adminOK(w, out)
	case len(parts) == 1 && r.Method == http.MethodPut:
		var in map[string]string
		if err := decodeJSON(r, &in); err != nil {
			adminFail(w, http.StatusBadRequest, "Invalid settings")
			return
		}
		for key, value := range in {
			// An empty secret field means "unchanged"
			if secretSettings[key] && value == "" {
				continue
			}
			if err := setSetting(key, strings.TrimSpace(value)); err != nil {
				adminFail(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		adminOK(w, map[string]any{})
	case len(parts) == 2 && parts[1] == "test-email" && r.Method == http.MethodPost:
		var in struct{ To string }
		decodeJSON(r, &in)
		if err := sendMail(normalizeEmail(in.To), "Folio test email", "Email from your Folio server works."); err != nil {
			adminFail(w, http.StatusBadGateway, err.Error())
			return
		}
		adminOK(w, map[string]any{})
	default:
		adminFail(w, http.StatusNotFound, "Not Found")
	}
}
