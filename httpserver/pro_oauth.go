package main

// Sign-in for the cloud-drive data sources (Google Drive, OneDrive, Dropbox,
// ...) through OAuth apps you register yourself. The server holds each app's
// client secret: it sends the browser to the provider, shows the returned
// code on its callback page for the user to paste into the app, and exchanges
// and refreshes tokens for the app.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type proOAuthProvider struct {
	// Name used in the env variables, e.g. GOOGLE for PRO_OAUTH_GOOGLE_CLIENT_ID
	EnvName      string
	AuthorizeURL string
	TokenURL     string
	// Extra query parameters for the authorize URL (scope etc.)
	AuthParams url.Values
	// How the token endpoint wants its input
	TokenStyle string // "form" (POST form), "query" (GET), "json" (POST JSON)
	// Tokens nested under a "data" field (115)
	NestedData bool
	// A separate endpoint for refreshing (115)
	RefreshURL string
	// Tokens never expire and there is no refresh token (pCloud)
	NoRefresh bool
}

// Scopes and parameters match what the app's drive clients expect
var proOAuthProviders = map[string]proOAuthProvider{
	"google": {
		EnvName:      "GOOGLE",
		AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth",
		TokenURL:     "https://oauth2.googleapis.com/token",
		AuthParams: url.Values{
			"scope":       {"https://www.googleapis.com/auth/drive.file"},
			"access_type": {"offline"},
			"prompt":      {"consent"},
		},
		TokenStyle: "form",
	},
	"microsoft": {
		EnvName:      "MICROSOFT",
		AuthorizeURL: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
		TokenURL:     "https://login.microsoftonline.com/common/oauth2/v2.0/token",
		AuthParams:   url.Values{"scope": {"files.readwrite.appfolder offline_access"}},
		TokenStyle:   "form",
	},
	// OneDrive with access to the whole drive instead of the app folder
	"microsoft_exp": {
		EnvName:      "MICROSOFT",
		AuthorizeURL: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
		TokenURL:     "https://login.microsoftonline.com/common/oauth2/v2.0/token",
		AuthParams:   url.Values{"scope": {"files.readwrite.all offline_access"}},
		TokenStyle:   "form",
	},
	"dropbox": {
		EnvName:      "DROPBOX",
		AuthorizeURL: "https://www.dropbox.com/oauth2/authorize",
		TokenURL:     "https://api.dropboxapi.com/oauth2/token",
		AuthParams:   url.Values{"token_access_type": {"offline"}},
		TokenStyle:   "form",
	},
	"boxnet": {
		EnvName:      "BOX",
		AuthorizeURL: "https://account.box.com/api/oauth2/authorize",
		TokenURL:     "https://api.box.com/oauth2/token",
		AuthParams:   url.Values{"scope": {"root_readwrite"}},
		TokenStyle:   "form",
	},
	"pcloud": {
		EnvName:      "PCLOUD",
		AuthorizeURL: "https://my.pcloud.com/oauth2/authorize",
		// The host depends on the account's region, see proOAuthTokenURL
		TokenURL:   "https://api.pcloud.com/oauth2_token",
		TokenStyle: "query",
		NoRefresh:  true,
	},
	"yandex": {
		EnvName:      "YANDEX",
		AuthorizeURL: "https://oauth.yandex.com/authorize",
		TokenURL:     "https://oauth.yandex.com/token",
		AuthParams:   url.Values{"force_confirm": {"true"}},
		TokenStyle:   "form",
	},
	"dubox": {
		EnvName:      "BAIDU",
		AuthorizeURL: "https://openapi.baidu.com/oauth/2.0/authorize",
		TokenURL:     "https://openapi.baidu.com/oauth/2.0/token",
		AuthParams: url.Values{
			"scope":   {"basic,netdisk"},
			"display": {"page"},
			"qrcode":  {"1"},
		},
		TokenStyle: "query",
	},
	"adrive": {
		EnvName:      "ALIYUN",
		AuthorizeURL: "https://openapi.alipan.com/oauth/authorize",
		TokenURL:     "https://openapi.alipan.com/oauth/access_token",
		AuthParams:   url.Values{"scope": {"user:base,file:all:write,file:all:read"}},
		TokenStyle:   "json",
	},
	"yiyiwu": {
		EnvName:      "115",
		AuthorizeURL: "https://passportapi.115.com/open/authorize",
		TokenURL:     "https://passportapi.115.com/open/authCodeToToken",
		RefreshURL:   "https://passportapi.115.com/open/refreshToken",
		TokenStyle:   "form",
		NestedData:   true,
	},
}

type proOAuthApp struct {
	ClientID     string
	ClientSecret string
}

var (
	proPublicURL      string
	proOAuthApps      = map[string]proOAuthApp{}
	proGooglePickerID string // Google Cloud project number
	proGoogleAPIKey   string
)

func initProOAuth() {
	proPublicURL = strings.TrimRight(os.Getenv("PRO_PUBLIC_URL"), "/")
	proOAuthApps = map[string]proOAuthApp{}
	for key, provider := range proOAuthProviders {
		prefix := "PRO_OAUTH_" + provider.EnvName + "_"
		app := proOAuthApp{
			ClientID:     strings.TrimSpace(os.Getenv(prefix + "CLIENT_ID")),
			ClientSecret: strings.TrimSpace(os.Getenv(prefix + "CLIENT_SECRET")),
		}
		if app.ClientID != "" && app.ClientSecret != "" {
			proOAuthApps[key] = app
		}
	}
	proGooglePickerID = strings.TrimSpace(os.Getenv("PRO_OAUTH_GOOGLE_APP_ID"))
	proGoogleAPIKey = strings.TrimSpace(os.Getenv("PRO_OAUTH_GOOGLE_API_KEY"))
}

// Drives that can sign in: an app is configured and the server knows its
// public address for the provider to redirect back to
func proOAuthDrives() []string {
	drives := []string{}
	if proPublicURL == "" {
		return drives
	}
	for key := range proOAuthProviders {
		if _, ok := proOAuthApps[key]; ok {
			drives = append(drives, key)
		}
	}
	return drives
}

func proOAuthRedirectURI() string {
	return proPublicURL + "/pro/v1/oauth/callback"
}

// GET /pro/v1/oauth/{provider}/authorize: opened in the browser, so it has no
// bearer token; it only reveals the public client ID
func proHandleOAuthAuthorize(w http.ResponseWriter, r *http.Request, key string) {
	provider, ok := proOAuthProviders[key]
	app, configured := proOAuthApps[key]
	if !ok || !configured || proPublicURL == "" {
		writePlain(w, http.StatusNotFound, "This data source is not configured on the server")
		return
	}
	params := url.Values{
		"response_type": {"code"},
		"client_id":     {app.ClientID},
		"redirect_uri":  {proOAuthRedirectURI()},
		// The callback page shows which data source the code is for
		"state": {key},
	}
	for name, values := range provider.AuthParams {
		params[name] = values
	}
	http.Redirect(w, r, provider.AuthorizeURL+"?"+params.Encode(), http.StatusFound)
}

var proCallbackPage = template.Must(template.New("callback").Parse(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Folio</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f7f6f3;color:#1c1b19;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#fff;border:1px solid #e4e2dc;border-radius:14px;padding:28px;max-width:440px;width:100%;box-sizing:border-box}
h1{font-size:20px;margin:0 0 8px}p{color:#6b6a65;line-height:1.5;margin:0 0 16px}
code{display:block;word-break:break-all;background:#f1f0ec;border-radius:8px;padding:12px;font-size:13px;margin-bottom:16px}
button{background:#4458c7;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#141413;color:#edece8}main{background:#1c1c1b;border-color:#2b2b29}p{color:#a3a29d}code{background:#232322}button{background:#8c9bff;color:#141413}}
</style></head><body><main>
{{if .Code}}<h1>Authorisation successful</h1>
<p>Copy this code and paste it into Folio to finish adding the data source.</p>
<code id="code">{{.Code}}</code>
<button onclick="navigator.clipboard.writeText(document.getElementById('code').textContent);this.textContent='Copied'">Copy code</button>
{{else}}<h1>Authorisation failed</h1><p>{{.Error}}</p>{{end}}
</main></body></html>`))

// GET /pro/v1/oauth/callback: where the provider sends the browser back
func proHandleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	data := struct{ Code, Error string }{Code: query.Get("code")}
	if data.Code == "" {
		data.Error = query.Get("error_description")
		if data.Error == "" {
			data.Error = query.Get("error")
		}
		if data.Error == "" {
			data.Error = "The provider didn't return a code."
		}
	} else if location := query.Get("locationid"); location != "" {
		// pCloud: the token endpoint depends on the account's region
		data.Code += "$" + location
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = proCallbackPage.Execute(w, data)
}

type proOAuthTokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

// pCloud accounts in the EU region use a different API host
func proOAuthTokenURL(key string, provider proOAuthProvider, code string) (string, string) {
	if key == "pcloud" {
		if base, location, ok := strings.Cut(code, "$"); ok {
			if location == "2" {
				return "https://eapi.pcloud.com/oauth2_token", base
			}
			return provider.TokenURL, base
		}
	}
	return provider.TokenURL, code
}

func proOAuthRequest(ctx context.Context, provider proOAuthProvider, endpoint string, fields url.Values) (proOAuthTokens, error) {
	var req *http.Request
	var err error
	switch provider.TokenStyle {
	case "query":
		req, err = http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+fields.Encode(), nil)
	case "json":
		body := map[string]string{}
		for name := range fields {
			body[name] = fields.Get(name)
		}
		payload, _ := json.Marshal(body)
		req, err = http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
		}
	default:
		req, err = http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(fields.Encode()))
		if err == nil {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
	}
	if err != nil {
		return proOAuthTokens{}, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := proHTTP.Do(req)
	if err != nil {
		return proOAuthTokens{}, errors.New("The provider can't be reached")
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return proOAuthTokens{}, fmt.Errorf("The provider returned HTTP %d: %s", resp.StatusCode, truncate(string(raw), 200))
	}
	var tokens proOAuthTokens
	if provider.NestedData {
		var wrapped struct {
			Data    proOAuthTokens `json:"data"`
			Message string         `json:"message"`
		}
		if err := json.Unmarshal(raw, &wrapped); err != nil {
			return proOAuthTokens{}, errors.New("Unexpected response from the provider")
		}
		tokens = wrapped.Data
		if tokens.AccessToken == "" && wrapped.Message != "" {
			return proOAuthTokens{}, errors.New(wrapped.Message)
		}
	} else if err := json.Unmarshal(raw, &tokens); err != nil {
		return proOAuthTokens{}, errors.New("Unexpected response from the provider")
	}
	if tokens.AccessToken == "" {
		return proOAuthTokens{}, fmt.Errorf("The provider didn't return a token: %s", truncate(string(raw), 200))
	}
	return tokens, nil
}

func proOAuthLookup(w http.ResponseWriter, key string) (proOAuthProvider, proOAuthApp, bool) {
	provider, ok := proOAuthProviders[key]
	app, configured := proOAuthApps[key]
	if !ok || !configured {
		proFail(w, http.StatusBadRequest, 400, "This data source is not configured on the server")
		return provider, app, false
	}
	return provider, app, true
}

// POST /pro/v1/oauth/token {provider, code} → {access_token, refresh_token, expires_in}
func proHandleOAuthToken(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Provider string `json:"provider"`
		Code     string `json:"code"`
	}
	if err := decodeJSON(r, &in); err != nil || in.Code == "" {
		proFail(w, http.StatusBadRequest, 400, "Expected {provider, code}")
		return
	}
	provider, app, ok := proOAuthLookup(w, in.Provider)
	if !ok {
		return
	}
	endpoint, code := proOAuthTokenURL(in.Provider, provider, strings.TrimSpace(in.Code))
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	tokens, err := proOAuthRequest(ctx, provider, endpoint, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {app.ClientID},
		"client_secret": {app.ClientSecret},
		"redirect_uri":  {proOAuthRedirectURI()},
	})
	if err != nil {
		proFail(w, http.StatusBadGateway, 502, err.Error())
		return
	}
	if provider.NoRefresh {
		// The app keeps a non-expiring access token as its refresh token
		tokens.RefreshToken = tokens.AccessToken
	}
	proOK(w, tokens)
}

// POST /pro/v1/oauth/refresh {provider, refresh_token} → {access_token, refresh_token, expires_in}
func proHandleOAuthRefresh(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Provider     string `json:"provider"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := decodeJSON(r, &in); err != nil || in.RefreshToken == "" {
		proFail(w, http.StatusBadRequest, 400, "Expected {provider, refresh_token}")
		return
	}
	provider, app, ok := proOAuthLookup(w, in.Provider)
	if !ok {
		return
	}
	if provider.NoRefresh {
		proOK(w, proOAuthTokens{AccessToken: in.RefreshToken, RefreshToken: in.RefreshToken})
		return
	}
	endpoint := provider.TokenURL
	fields := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {in.RefreshToken},
		"client_id":     {app.ClientID},
		"client_secret": {app.ClientSecret},
	}
	if provider.RefreshURL != "" {
		endpoint = provider.RefreshURL
		fields = url.Values{"refresh_token": {in.RefreshToken}}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	tokens, err := proOAuthRequest(ctx, provider, endpoint, fields)
	if err != nil {
		proFail(w, http.StatusBadGateway, 502, err.Error())
		return
	}
	proOK(w, tokens)
}

var proPickerPage = template.Must(template.New("picker").Parse(`<!doctype html>
<html><head><meta charset="utf-8"><title>Folio</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;color:#6b6a65}</style>
</head><body><p id="status">Opening Google Drive…</p>
<script>
// The access token travels in the URL fragment, which the browser never sends to the server
var token = new URLSearchParams(location.hash.slice(1)).get("access_token");
function done(data) {
  var docs = (data.docs || []).map(function (d) { return { id: d.id, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes }; });
  location.href = "folio://picker?pickerData=" + encodeURIComponent(JSON.stringify({ action: data.action, docs: docs }));
  document.getElementById("status").textContent = "You can close this window and return to Folio.";
}
function open() {
  var view = new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true);
  new google.picker.PickerBuilder()
    .setAppId({{.AppID}})
    .setDeveloperKey({{.APIKey}})
    .setOAuthToken(token)
    .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
    .addView(view)
    .setCallback(function (data) {
      if (data.action === google.picker.Action.PICKED || data.action === google.picker.Action.CANCEL) done(data);
    })
    .build()
    .setVisible(true);
}
</script>
<script src="https://apis.google.com/js/api.js" onload="gapi.load('picker', open)"></script>
</body></html>`))

// GET /pro/v1/oauth/google/picker: Google Drive file picker for the desktop
// app, which then imports the chosen books
func proHandleGooglePicker(w http.ResponseWriter, _ *http.Request) {
	if proGooglePickerID == "" || proGoogleAPIKey == "" {
		writePlain(w, http.StatusNotFound, "The Google Drive picker is not configured on the server")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = proPickerPage.Execute(w, struct{ AppID, APIKey string }{proGooglePickerID, proGoogleAPIKey})
}
