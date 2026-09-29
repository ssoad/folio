package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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
