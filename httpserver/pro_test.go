package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testProToken = "test-token-0123456789"

// fakeUpstream answers like an OpenAI-compatible provider. Replies depend on
// the system prompt so each Pro endpoint gets the shape it asks for.
func fakeUpstream(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer upstream-key" {
			http.Error(w, "bad upstream key", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/audio/speech":
			var in map[string]any
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in["voice"] == "unknown-voice" {
				http.Error(w, "voice not found", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("ID3fake-mp3-" + in["voice"].(string)))
		case "/chat/completions":
			var in struct {
				Model    string           `json:"model"`
				Stream   bool             `json:"stream"`
				Messages []map[string]any `json:"messages"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in.Stream {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"model="+in.Model+"\"}}]}\n\ndata: [DONE]\n\n")
				return
			}
			system, _ := in.Messages[0]["content"].(string)
			user, _ := in.Messages[len(in.Messages)-1]["content"].(string)
			var reply string
			switch {
			case strings.Contains(system, "translate book text"):
				if strings.Contains(user, "BREAK_SHAPE") {
					reply = `["only one"]`
					break
				}
				var texts []string
				_ = json.Unmarshal([]byte(user), &texts)
				for i := range texts {
					texts[i] = "T:" + texts[i]
				}
				b, _ := json.Marshal(texts)
				reply = "Here you go:\n```json\n" + string(b) + "\n```"
			case strings.HasPrefix(system, "Translate the user's text"):
				reply = "single:" + user
			case strings.Contains(system, "clean up e-book file names"):
				reply = `<think>hmm</think>{"name": "Dune", "author": "Frank Herbert"}`
			case strings.Contains(system, "multi-voice audiobook"):
				reply = `[{"text":"He said hi.","role":"male","index":0},{"text":"It rained.","role":"robot","index":0}]`
			default:
				// OCR sends content parts instead of a system prompt
				reply = "page text"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{{"message": map[string]any{"content": reply}}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
}

func setupPro(t *testing.T) *httptest.Server {
	t.Helper()
	upstream := fakeUpstream(t)
	t.Cleanup(upstream.Close)
	proEnabled = true
	serverEnabled = false
	proAccessToken = testProToken
	proAI = proUpstream{BaseURL: upstream.URL, APIKey: "upstream-key", Model: "real-model"}
	proOCRModel = "vision-model"
	proTTS = proUpstream{BaseURL: upstream.URL, APIKey: "upstream-key", Model: "kokoro"}
	proTTSVoice = "af_heart"
	initProVault()
	srv := httptest.NewServer(http.HandlerFunc(handler))
	t.Cleanup(srv.Close)
	return srv
}

type envelope struct {
	Code int             `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

func call(t *testing.T, srv *httptest.Server, method, path, body, token string) (int, envelope, string) {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var env envelope
	_ = json.Unmarshal(raw, &env)
	return resp.StatusCode, env, string(raw)
}

func TestProRejectsMissingOrWrongToken(t *testing.T) {
	srv := setupPro(t)
	for _, token := range []string{"", "wrong-token-0123456789"} {
		status, env, _ := call(t, srv, http.MethodGet, "/pro/v1/status", "", token)
		if status != http.StatusUnauthorized || env.Code != 401 {
			t.Fatalf("token %q: got HTTP %d code %d", token, status, env.Code)
		}
	}
}

func TestProFileServerStaysOffWhenDisabled(t *testing.T) {
	srv := setupPro(t)
	status, _, _ := call(t, srv, http.MethodGet, "/list", "", testProToken)
	if status != http.StatusNotFound {
		t.Fatalf("file server route should be off, got HTTP %d", status)
	}
}

func TestProStatus(t *testing.T) {
	srv := setupPro(t)
	status, env, _ := call(t, srv, http.MethodGet, "/pro/v1/status", "", testProToken)
	if status != 200 || env.Code != 200 {
		t.Fatalf("got HTTP %d code %d", status, env.Code)
	}
	var data struct {
		Features map[string]bool `json:"features"`
	}
	_ = json.Unmarshal(env.Data, &data)
	for _, f := range []string{"ai", "ocr", "tts", "metadata"} {
		if !data.Features[f] {
			t.Errorf("feature %s should be on", f)
		}
	}
}

func TestProChatProxyStreamsWithServerModel(t *testing.T) {
	srv := setupPro(t)
	status, _, raw := call(t, srv, http.MethodPost, "/pro/v1/openai/chat/completions",
		`{"model":"default","stream":true,"messages":[{"role":"user","content":"hi"}]}`, testProToken)
	if status != 200 || !strings.Contains(raw, "model=real-model") || !strings.Contains(raw, "[DONE]") {
		t.Fatalf("got HTTP %d body %q", status, raw)
	}
}

func TestProBatchTranslate(t *testing.T) {
	srv := setupPro(t)
	_, env, _ := call(t, srv, http.MethodPost, "/pro/v1/translate/batch",
		`{"texts":["a","b","c"],"from":"Automatic","to":"French"}`, testProToken)
	var data struct {
		Texts []string `json:"texts"`
	}
	_ = json.Unmarshal(env.Data, &data)
	if env.Code != 200 || strings.Join(data.Texts, ",") != "T:a,T:b,T:c" {
		t.Fatalf("got code %d texts %v", env.Code, data.Texts)
	}
}

func TestProBatchTranslateFallsBackWhenShapeBreaks(t *testing.T) {
	srv := setupPro(t)
	_, env, _ := call(t, srv, http.MethodPost, "/pro/v1/translate/batch",
		`{"texts":["BREAK_SHAPE","x"],"to":"French"}`, testProToken)
	var data struct {
		Texts []string `json:"texts"`
	}
	_ = json.Unmarshal(env.Data, &data)
	if len(data.Texts) != 2 || data.Texts[1] != "single:x" {
		t.Fatalf("expected per-item fallback, got %v", data.Texts)
	}
}

func TestProAnalyzeTitle(t *testing.T) {
	srv := setupPro(t)
	_, env, _ := call(t, srv, http.MethodPost, "/pro/v1/title/analyze", `{"title":"Dune [1965] (retail).epub"}`, testProToken)
	var data struct{ Name, Author string }
	_ = json.Unmarshal(env.Data, &data)
	if data.Name != "Dune" || data.Author != "Frank Herbert" {
		t.Fatalf("got %+v", data)
	}
}

func TestProSplitSentencesNormalizesRoles(t *testing.T) {
	srv := setupPro(t)
	_, env, _ := call(t, srv, http.MethodPost, "/pro/v1/speech/split", `{"texts":[{"text":"He said hi. It rained.","index":0}]}`, testProToken)
	var data struct {
		Sentences []struct{ Text, Role string } `json:"sentences"`
	}
	_ = json.Unmarshal(env.Data, &data)
	if len(data.Sentences) != 2 || data.Sentences[0].Role != "male" || data.Sentences[1].Role != "narrator" {
		t.Fatalf("got %+v", data.Sentences)
	}
}

func TestProTTSFallsBackToDefaultVoice(t *testing.T) {
	srv := setupPro(t)
	for voice, want := range map[string]string{"bf_emma": "bf_emma", "unknown-voice": "af_heart"} {
		_, env, _ := call(t, srv, http.MethodPost, "/pro/v1/tts", `{"text":"hello","voice":"`+voice+`","speed":1}`, testProToken)
		var data struct {
			Audio string `json:"audio_base64"`
		}
		_ = json.Unmarshal(env.Data, &data)
		if !strings.HasPrefix(data.Audio, "data:audio/mpeg;base64,") {
			t.Fatalf("voice %s: got %q", voice, data.Audio)
		}
		if got := string(mustDecodeDataURI(t, data.Audio)); got != "ID3fake-mp3-"+want {
			t.Fatalf("voice %s: synthesized %q", voice, got)
		}
	}
}

func TestProOCR(t *testing.T) {
	srv := setupPro(t)
	_, env, _ := call(t, srv, http.MethodPost, "/pro/v1/ocr", `{"image_base64":"iVBORw0KGgoAAAANSUhEUg=="}`, testProToken)
	var data struct{ Text string }
	_ = json.Unmarshal(env.Data, &data)
	if env.Code != 200 || data.Text != "page text" {
		t.Fatalf("got code %d text %q", env.Code, data.Text)
	}
}

func TestProAIUnconfigured(t *testing.T) {
	srv := setupPro(t)
	proAI = proUpstream{}
	status, env, _ := call(t, srv, http.MethodPost, "/pro/v1/title/analyze", `{"title":"x"}`, testProToken)
	if status != http.StatusServiceUnavailable || env.Code != 503 {
		t.Fatalf("got HTTP %d code %d", status, env.Code)
	}
}

func TestProExtractJSON(t *testing.T) {
	var out []string
	if err := proExtractJSON("sure!\n```json\n[\"a\",\"b\"]\n```\nanything else?", &out); err != nil || len(out) != 2 {
		t.Fatalf("got %v %v", out, err)
	}
	if err := proExtractJSON("no json here", &out); err == nil {
		t.Fatal("expected an error")
	}
}

func mustDecodeDataURI(t *testing.T, uri string) []byte {
	t.Helper()
	_, b64, _ := strings.Cut(uri, ",")
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestProTokenVaultRoundTrip(t *testing.T) {
	srv := setupPro(t)
	secret := `{"url":"https://dav.example.com","username":"me","password":"p@ss"}`
	body, _ := json.Marshal(map[string]string{"token": secret})
	_, env, raw := call(t, srv, http.MethodPost, "/pro/v1/token/encrypt", string(body), testProToken)
	var enc struct {
		EncryptedToken string `json:"encrypted_token"`
	}
	if env.Code != 200 || json.Unmarshal(env.Data, &enc) != nil {
		t.Fatalf("encrypt: %s", raw)
	}
	if !strings.HasPrefix(enc.EncryptedToken, proVaultPrefix) || strings.Contains(enc.EncryptedToken, "p@ss") {
		t.Fatalf("unexpected encrypted token %q", enc.EncryptedToken)
	}

	body, _ = json.Marshal(map[string]string{"encrypted_token": enc.EncryptedToken})
	_, env, raw = call(t, srv, http.MethodPost, "/pro/v1/token/decrypt", string(body), testProToken)
	var dec struct {
		Token string `json:"token"`
	}
	if env.Code != 200 || json.Unmarshal(env.Data, &dec) != nil || dec.Token != secret {
		t.Fatalf("decrypt: %s", raw)
	}
}

func TestProTokenVaultRejectsForeignTokens(t *testing.T) {
	srv := setupPro(t)
	enc, err := proEncryptToken("secret")
	if err != nil {
		t.Fatal(err)
	}
	// A different key (e.g. a changed PRO_TOKEN_KEY) can't open it
	t.Setenv("PRO_TOKEN_KEY", "another-key")
	initProVault()
	for _, token := range []string{enc, "official-service-token"} {
		body, _ := json.Marshal(map[string]string{"encrypted_token": token})
		status, env, _ := call(t, srv, http.MethodPost, "/pro/v1/token/decrypt", string(body), testProToken)
		if status != http.StatusBadRequest || env.Code != 400 {
			t.Fatalf("token %q: got HTTP %d code %d", token, status, env.Code)
		}
	}
}

// fakeOAuthProvider answers token requests like a provider would, in the
// given style, and records what it received
func fakeOAuthProvider(t *testing.T, nested bool) (*httptest.Server, *url.Values) {
	t.Helper()
	got := &url.Values{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		*got = r.Form
		tokens := map[string]any{"access_token": "at-" + r.Form.Get("grant_type"), "refresh_token": "rt-new", "expires_in": 3600}
		if nested {
			_ = json.NewEncoder(w).Encode(map[string]any{"state": 1, "data": tokens})
			return
		}
		_ = json.NewEncoder(w).Encode(tokens)
	}))
	t.Cleanup(srv.Close)
	return srv, got
}

func setupOAuth(t *testing.T, key string, provider proOAuthProvider) *httptest.Server {
	t.Helper()
	srv := setupPro(t)
	original, existed := proOAuthProviders[key]
	proOAuthProviders[key] = provider
	t.Cleanup(func() {
		if existed {
			proOAuthProviders[key] = original
		} else {
			delete(proOAuthProviders, key)
		}
	})
	proPublicURL = "https://folio.example.com"
	proOAuthApps = map[string]proOAuthApp{key: {ClientID: "client-id", ClientSecret: "client-secret"}}
	t.Cleanup(func() { proPublicURL = ""; proOAuthApps = map[string]proOAuthApp{} })
	return srv
}

func TestProOAuthAuthorizeRedirectsWithoutToken(t *testing.T) {
	srv := setupOAuth(t, "google", proOAuthProviders["google"])
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Get(srv.URL + "/pro/v1/oauth/google/authorize")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	location, _ := url.Parse(resp.Header.Get("Location"))
	q := location.Query()
	if resp.StatusCode != http.StatusFound || location.Host != "accounts.google.com" ||
		q.Get("client_id") != "client-id" || q.Get("state") != "google" ||
		q.Get("redirect_uri") != "https://folio.example.com/pro/v1/oauth/callback" ||
		q.Get("scope") != "https://www.googleapis.com/auth/drive.file" || q.Get("access_type") != "offline" {
		t.Fatalf("unexpected redirect %d %s", resp.StatusCode, location)
	}

	resp, _ = client.Get(srv.URL + "/pro/v1/oauth/dropbox/authorize")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unconfigured drive should 404, got %d", resp.StatusCode)
	}
}

func TestProOAuthCallbackShowsCode(t *testing.T) {
	srv := setupOAuth(t, "google", proOAuthProviders["google"])
	resp, err := http.Get(srv.URL + "/pro/v1/oauth/callback?code=abc%3C123&state=pcloud&locationid=2")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	// Escaped, with pCloud's region appended
	if !strings.Contains(string(raw), "abc&lt;123$2") {
		t.Fatalf("code missing from page: %s", raw)
	}
}

func TestProOAuthTokenAndRefresh(t *testing.T) {
	provider, got := fakeOAuthProvider(t, false)
	srv := setupOAuth(t, "yandex", proOAuthProvider{EnvName: "YANDEX", TokenURL: provider.URL, TokenStyle: "form"})

	_, env, raw := call(t, srv, http.MethodPost, "/pro/v1/oauth/token", `{"provider":"yandex","code":"the-code"}`, testProToken)
	var tokens proOAuthTokens
	if env.Code != 200 || json.Unmarshal(env.Data, &tokens) != nil || tokens.AccessToken != "at-authorization_code" || tokens.RefreshToken != "rt-new" {
		t.Fatalf("token: %s", raw)
	}
	if got.Get("code") != "the-code" || got.Get("client_secret") != "client-secret" ||
		got.Get("redirect_uri") != "https://folio.example.com/pro/v1/oauth/callback" {
		t.Fatalf("provider got %v", *got)
	}

	_, env, raw = call(t, srv, http.MethodPost, "/pro/v1/oauth/refresh", `{"provider":"yandex","refresh_token":"rt-old"}`, testProToken)
	if env.Code != 200 || json.Unmarshal(env.Data, &tokens) != nil || tokens.AccessToken != "at-refresh_token" || got.Get("refresh_token") != "rt-old" {
		t.Fatalf("refresh: %s / %v", raw, *got)
	}

	status, _, _ := call(t, srv, http.MethodPost, "/pro/v1/oauth/token", `{"provider":"yandex","code":"x"}`, "")
	if status != http.StatusUnauthorized {
		t.Fatalf("token exchange must need the access token, got %d", status)
	}
}

func TestProOAuthNestedAndNonExpiringTokens(t *testing.T) {
	provider, _ := fakeOAuthProvider(t, true)
	srv := setupOAuth(t, "yiyiwu", proOAuthProvider{EnvName: "115", TokenURL: provider.URL, RefreshURL: provider.URL, TokenStyle: "form", NestedData: true})
	_, env, raw := call(t, srv, http.MethodPost, "/pro/v1/oauth/token", `{"provider":"yiyiwu","code":"c"}`, testProToken)
	var tokens proOAuthTokens
	if env.Code != 200 || json.Unmarshal(env.Data, &tokens) != nil || tokens.AccessToken != "at-authorization_code" {
		t.Fatalf("nested token: %s", raw)
	}

	provider, got := fakeOAuthProvider(t, false)
	srv = setupOAuth(t, "pcloud", proOAuthProvider{EnvName: "PCLOUD", TokenURL: provider.URL, TokenStyle: "query", NoRefresh: true})
	_, env, raw = call(t, srv, http.MethodPost, "/pro/v1/oauth/token", `{"provider":"pcloud","code":"c$1"}`, testProToken)
	if env.Code != 200 || json.Unmarshal(env.Data, &tokens) != nil || tokens.RefreshToken != tokens.AccessToken || got.Get("code") != "c" {
		t.Fatalf("pcloud token: %s / %v", raw, *got)
	}
}

func TestProAssets(t *testing.T) {
	srv := setupPro(t)
	proAssetsDir = t.TempDir()
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.MkdirAll(filepath.Join(proAssetsDir, "fonts", "EB_Garamond"), 0o755))
	must(os.WriteFile(filepath.Join(proAssetsDir, "fonts", "EB_Garamond", "EBGaramond-VF.ttf"), []byte("font"), 0o644))
	must(os.MkdirAll(filepath.Join(proAssetsDir, "dicts"), 0o755))
	must(os.WriteFile(filepath.Join(proAssetsDir, "dicts", "oxford.mdx"), []byte("dict"), 0o644))
	must(os.WriteFile(filepath.Join(proAssetsDir, "secret.txt"), []byte("nope"), 0o644))

	_, env, raw := call(t, srv, http.MethodGet, "/pro/v1/assets/catalog", "", testProToken)
	var catalog map[string][]string
	if env.Code != 200 || json.Unmarshal(env.Data, &catalog) != nil ||
		len(catalog["fonts"]) != 1 || catalog["fonts"][0] != "/EB_Garamond/EBGaramond-VF.ttf" ||
		len(catalog["dicts"]) != 1 || len(catalog["backgrounds"]) != 0 {
		t.Fatalf("catalog: %s", raw)
	}

	status, _, body := call(t, srv, http.MethodGet, "/pro/v1/assets/fonts/EB_Garamond/EBGaramond-VF.ttf", "", testProToken)
	if status != http.StatusOK || body != "font" {
		t.Fatalf("font file: %d %q", status, body)
	}
	for _, path := range []string{"/pro/v1/assets/fonts/../secret.txt", "/pro/v1/assets/fonts/%2e%2e/secret.txt", "/pro/v1/assets/other/x"} {
		status, _, body = call(t, srv, http.MethodGet, path, "", testProToken)
		if status == http.StatusOK || strings.Contains(body, "nope") {
			t.Fatalf("%s escaped the assets folder: %d %q", path, status, body)
		}
	}
	status, _, _ = call(t, srv, http.MethodGet, "/pro/v1/assets/fonts/EB_Garamond/EBGaramond-VF.ttf", "", "")
	if status != http.StatusUnauthorized {
		t.Fatalf("assets must need the access token, got %d", status)
	}
}
