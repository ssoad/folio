package main

// Self-hosted replacements for Koodo Reader's Pro services. The app talks to
// these endpoints instead of the official API when a self-hosted server is
// configured. AI features go to any OpenAI-compatible provider you run or pay
// for yourself (OpenAI, OpenRouter, Ollama, LiteLLM, ...), speech to any
// OpenAI-compatible TTS server (e.g. Kokoro-FastAPI), metadata to Open Library.
//
// Responses use the same envelope as the official API, {code, msg, data}, so
// the app's existing callers work unchanged.

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type proUpstream struct {
	BaseURL string
	APIKey  string
	Model   string
}

func (u proUpstream) configured() bool {
	return u.BaseURL != "" && u.Model != ""
}

var (
	proEnabled     bool
	proAccessToken string
	proAI          proUpstream
	proOCRModel    string
	proTTS         proUpstream
	proTTSVoice    string
	proHTTP        = &http.Client{Timeout: 5 * time.Minute}
)

const (
	proMaxBodyBytes = 25 << 20 // OCR page images can be large
	// Texts per batch-translation request to the model
	proTranslateBatchSize  = 40
	proTranslateBatchChars = 6000
	proUserAgent           = "Folio-SelfHosted/1.0"
)

func initPro() {
	proEnabled = os.Getenv("ENABLE_PRO_SERVER") == "true"
	if !proEnabled {
		return
	}
	// Token: Docker secret > env
	proAccessToken = getDockerSecret(getEnv("PRO_ACCESS_TOKEN_FILE", "pro_access_token"))
	if proAccessToken == "" {
		proAccessToken = strings.TrimSpace(os.Getenv("PRO_ACCESS_TOKEN"))
	}
	if len(proAccessToken) < 16 {
		log.Fatal("[pro] ENABLE_PRO_SERVER=true requires PRO_ACCESS_TOKEN (or a pro_access_token Docker secret) of at least 16 characters")
	}

	proAI = proUpstream{
		BaseURL: strings.TrimRight(os.Getenv("PRO_AI_BASE_URL"), "/"),
		APIKey:  os.Getenv("PRO_AI_API_KEY"),
		Model:   os.Getenv("PRO_AI_MODEL"),
	}
	proOCRModel = getEnv("PRO_OCR_MODEL", proAI.Model)
	proTTS = proUpstream{
		BaseURL: strings.TrimRight(os.Getenv("PRO_TTS_BASE_URL"), "/"),
		APIKey:  os.Getenv("PRO_TTS_API_KEY"),
		Model:   getEnv("PRO_TTS_MODEL", "kokoro"),
	}
	proTTSVoice = getEnv("PRO_TTS_VOICE", "af_heart")

	log.Printf("[pro] Self-hosted Pro services enabled (AI: %t, OCR: %t, TTS: %t, metadata: true)",
		proAI.configured(), proAI.configured() && proOCRModel != "", proTTS.configured())
}

// ── Routing ───────────────────────────────────────────────────────────────────

func proHandler(w http.ResponseWriter, r *http.Request) {
	if !proAuthenticate(r) {
		proFail(w, http.StatusUnauthorized, 401, "Invalid access token")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, proMaxBodyBytes)

	path := strings.TrimSuffix(r.URL.Path, "/")
	switch {
	case r.Method == http.MethodGet && path == "/pro/v1/status":
		proHandleStatus(w, r)
	case r.Method == http.MethodPost && path == "/pro/v1/openai/chat/completions":
		proHandleChatProxy(w, r)
	case r.Method == http.MethodGet && path == "/pro/v1/openai/models":
		proHandleModels(w, r)
	case r.Method == http.MethodPost && path == "/pro/v1/translate/batch":
		proHandleBatchTranslate(w, r)
	case r.Method == http.MethodPost && path == "/pro/v1/title/analyze":
		proHandleAnalyzeTitle(w, r)
	case r.Method == http.MethodPost && path == "/pro/v1/speech/split":
		proHandleSplitSentences(w, r)
	case r.Method == http.MethodGet && path == "/pro/v1/metadata/search":
		proHandleMetadataSearch(w, r)
	case r.Method == http.MethodPost && path == "/pro/v1/tts":
		proHandleTTS(w, r)
	case r.Method == http.MethodPost && path == "/pro/v1/ocr":
		proHandleOCR(w, r)
	default:
		proFail(w, http.StatusNotFound, 404, "Not Found")
	}
}

func proAuthenticate(r *http.Request) bool {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(strings.TrimSpace(token)), []byte(proAccessToken)) == 1
}

func proOK(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, map[string]any{"code": 200, "msg": "success", "data": data})
}

func proFail(w http.ResponseWriter, status, code int, msg string) {
	writeJSON(w, status, map[string]any{"code": code, "msg": msg})
}

func proRequireAI(w http.ResponseWriter) bool {
	if !proAI.configured() {
		proFail(w, http.StatusServiceUnavailable, 503, "AI is not configured on this server (set PRO_AI_BASE_URL and PRO_AI_MODEL)")
		return false
	}
	return true
}

// ── Status ────────────────────────────────────────────────────────────────────

func proHandleStatus(w http.ResponseWriter, _ *http.Request) {
	proOK(w, map[string]any{
		"version": 1,
		"features": map[string]bool{
			"ai":       proAI.configured(),
			"ocr":      proAI.configured() && proOCRModel != "",
			"tts":      proTTS.configured(),
			"metadata": true,
		},
	})
}

// ── OpenAI-compatible chat proxy ──────────────────────────────────────────────

// The app's own OpenAI-compatible adapter points here, so the assistant,
// translation, dictionary and book assistant use the server's model and key.
func proHandleChatProxy(w http.ResponseWriter, r *http.Request) {
	if !proRequireAI(w) {
		return
	}
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil {
		proFail(w, http.StatusBadRequest, 400, "Invalid JSON body")
		return
	}
	body["model"] = proAI.Model
	payload, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, proAI.BaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		proFail(w, http.StatusInternalServerError, 500, "Cannot build upstream request")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if proAI.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+proAI.APIKey)
	}
	resp, err := proHTTP.Do(req)
	if err != nil {
		proFail(w, http.StatusBadGateway, 502, "AI provider unreachable")
		return
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(resp.StatusCode)
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 4096)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr != nil {
			return
		}
	}
}

func proHandleModels(w http.ResponseWriter, _ *http.Request) {
	if !proRequireAI(w) {
		return
	}
	// The real model is chosen by the server; the app only needs one entry
	writeJSON(w, http.StatusOK, map[string]any{
		"object": "list",
		"data":   []map[string]string{{"id": "default", "object": "model", "owned_by": "self-hosted"}},
	})
}

// ── Model helpers ─────────────────────────────────────────────────────────────

var proThinkRe = regexp.MustCompile(`(?s)<think>.*?</think>`)

// proChat sends a non-streaming chat completion and returns the reply text.
func proChat(ctx context.Context, model string, messages []map[string]any) (string, error) {
	payload, _ := json.Marshal(map[string]any{"model": model, "messages": messages, "stream": false})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, proAI.BaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if proAI.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+proAI.APIKey)
	}
	resp, err := proHTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("AI provider returned HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || len(parsed.Choices) == 0 {
		return "", errors.New("unexpected response from AI provider")
	}
	return strings.TrimSpace(proThinkRe.ReplaceAllString(parsed.Choices[0].Message.Content, "")), nil
}

func proAsk(ctx context.Context, system, user string) (string, error) {
	return proChat(ctx, proAI.Model, []map[string]any{
		{"role": "system", "content": system},
		{"role": "user", "content": user},
	})
}

// proExtractJSON parses the first JSON value in a model reply, tolerating
// Markdown fences and text around it.
func proExtractJSON(reply string, into any) error {
	start := strings.IndexAny(reply, "[{")
	if start == -1 {
		return errors.New("no JSON in reply")
	}
	closing := byte('}')
	if reply[start] == '[' {
		closing = ']'
	}
	end := strings.LastIndexByte(reply, closing)
	if end < start {
		return errors.New("unterminated JSON in reply")
	}
	return json.Unmarshal([]byte(reply[start:end+1]), into)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// ── Batch translation (full-book translation mode) ────────────────────────────

func proHandleBatchTranslate(w http.ResponseWriter, r *http.Request) {
	if !proRequireAI(w) {
		return
	}
	var in struct {
		Texts []string `json:"texts"`
		From  string   `json:"from"`
		To    string   `json:"to"`
	}
	if err := decodeJSON(r, &in); err != nil || in.To == "" {
		proFail(w, http.StatusBadRequest, 400, "Expected {texts, from, to}")
		return
	}
	out := make([]string, len(in.Texts))
	for start := 0; start < len(in.Texts); {
		end, chars := start, 0
		for end < len(in.Texts) && end-start < proTranslateBatchSize && (end == start || chars+len(in.Texts[end]) <= proTranslateBatchChars) {
			chars += len(in.Texts[end])
			end++
		}
		translated, err := proTranslateBatch(r.Context(), in.Texts[start:end], in.From, in.To)
		if err != nil {
			proFail(w, http.StatusBadGateway, 502, err.Error())
			return
		}
		copy(out[start:end], translated)
		start = end
	}
	proOK(w, map[string]any{"texts": out})
}

func proTranslateBatch(ctx context.Context, texts []string, from, to string) ([]string, error) {
	source := "the source language"
	if from != "" && !strings.EqualFold(from, "Automatic") {
		source = from
	}
	input, _ := json.Marshal(texts)
	system := fmt.Sprintf("You translate book text from %s into %s. You receive a JSON array of paragraphs "+
		"and reply with only a JSON array of the translated paragraphs: same length, same order, no commentary. "+
		"Keep names, numbers and formatting.", source, to)
	reply, err := proAsk(ctx, system, string(input))
	if err == nil {
		var translated []string
		if proExtractJSON(reply, &translated) == nil && len(translated) == len(texts) {
			return translated, nil
		}
	}
	// The model didn't keep the array shape; translate one by one
	out := make([]string, len(texts))
	for i, text := range texts {
		if strings.TrimSpace(text) == "" {
			continue
		}
		reply, err := proAsk(ctx, fmt.Sprintf("Translate the user's text from %s into %s. Reply with the translation only.", source, to), text)
		if err != nil {
			return nil, err
		}
		out[i] = reply
	}
	return out, nil
}

// ── Book title analysis (import and edit dialogs) ─────────────────────────────

func proHandleAnalyzeTitle(w http.ResponseWriter, r *http.Request) {
	if !proRequireAI(w) {
		return
	}
	var in struct {
		Title string `json:"title"`
	}
	if err := decodeJSON(r, &in); err != nil || strings.TrimSpace(in.Title) == "" {
		proFail(w, http.StatusBadRequest, 400, "Expected {title}")
		return
	}
	reply, err := proAsk(r.Context(),
		`You clean up e-book file names. Given a file name or messy title, reply with only JSON {"name": "<book title>", "author": "<author or empty string>"}. `+
			`Drop file extensions, release-group tags, years in brackets, edition noise and site names. Don't invent an author.`,
		in.Title)
	if err != nil {
		proFail(w, http.StatusBadGateway, 502, err.Error())
		return
	}
	var out struct {
		Name   string `json:"name"`
		Author string `json:"author"`
	}
	if err := proExtractJSON(reply, &out); err != nil || out.Name == "" {
		proFail(w, http.StatusBadGateway, 502, "Could not analyze the title")
		return
	}
	proOK(w, out)
}

// ── Sentence splitting with speaker roles (AI multi-role speech) ──────────────

var proSpeechRoles = map[string]bool{"narrator": true, "male": true, "female": true, "child": true}

func proHandleSplitSentences(w http.ResponseWriter, r *http.Request) {
	if !proRequireAI(w) {
		return
	}
	var in struct {
		Texts []struct {
			Text  string `json:"text"`
			Index int    `json:"index"`
		} `json:"texts"`
	}
	if err := decodeJSON(r, &in); err != nil {
		proFail(w, http.StatusBadRequest, 400, "Expected {texts: [{text, index}]}")
		return
	}
	input, _ := json.Marshal(in.Texts)
	reply, err := proAsk(r.Context(),
		`You prepare book text for a multi-voice audiobook. You receive a JSON array of {text, index} paragraphs. `+
			`Split them into sentences, keeping the original wording, and label who speaks each one: "narrator" for narration, `+
			`or "male", "female" or "child" for dialogue by such a character. `+
			`Reply with only a JSON array of {"text": string, "role": string, "index": <index of the source paragraph>} in reading order.`,
		string(input))
	if err != nil {
		proFail(w, http.StatusBadGateway, 502, err.Error())
		return
	}
	var sentences []struct {
		Text  string `json:"text"`
		Role  string `json:"role"`
		Index int    `json:"index"`
	}
	if err := proExtractJSON(reply, &sentences); err != nil {
		proFail(w, http.StatusBadGateway, 502, "Could not split the text")
		return
	}
	for i := range sentences {
		if !proSpeechRoles[sentences[i].Role] {
			sentences[i].Role = "narrator"
		}
	}
	proOK(w, map[string]any{"sentences": sentences})
}

// ── Metadata search (Open Library) ────────────────────────────────────────────

type proBookMetadata struct {
	Key          string  `json:"key"`
	Name         string  `json:"name"`
	Author       string  `json:"author"`
	Publisher    string  `json:"publisher,omitempty"`
	Description  string  `json:"description,omitempty"`
	Cover        string  `json:"cover,omitempty"`
	ISBN         string  `json:"isbn,omitempty"`
	RatingSource string  `json:"rating_source,omitempty"`
	Rating       float64 `json:"rating,omitempty"`
	RatingCount  int     `json:"rating_count,omitempty"`
	Categories   string  `json:"categories,omitempty"`
	PubDate      string  `json:"pub_date,omitempty"`
	Language     string  `json:"language,omitempty"`
	Pages        int     `json:"pages,omitempty"`
}

func proHandleMetadataSearch(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	author := strings.TrimSpace(r.URL.Query().Get("author"))
	if name == "" {
		proFail(w, http.StatusBadRequest, 400, "Expected ?name=")
		return
	}
	params := url.Values{}
	params.Set("title", name)
	if author != "" {
		params.Set("author", author)
	}
	params.Set("limit", "10")
	params.Set("fields", "key,title,author_name,publisher,first_publish_year,isbn,cover_i,language,subject,number_of_pages_median,ratings_average,ratings_count")

	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://openlibrary.org/search.json?"+params.Encode(), nil)
	req.Header.Set("User-Agent", proUserAgent)
	resp, err := proHTTP.Do(req)
	if err != nil {
		proFail(w, http.StatusBadGateway, 502, "Open Library unreachable")
		return
	}
	defer resp.Body.Close()
	var parsed struct {
		Docs []struct {
			Key            string   `json:"key"`
			Title          string   `json:"title"`
			AuthorName     []string `json:"author_name"`
			Publisher      []string `json:"publisher"`
			FirstPublished int      `json:"first_publish_year"`
			ISBN           []string `json:"isbn"`
			CoverID        int      `json:"cover_i"`
			Language       []string `json:"language"`
			Subject        []string `json:"subject"`
			Pages          int      `json:"number_of_pages_median"`
			Rating         float64  `json:"ratings_average"`
			RatingCount    int      `json:"ratings_count"`
		} `json:"docs"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&parsed) != nil {
		proFail(w, http.StatusBadGateway, 502, "Unexpected response from Open Library")
		return
	}
	first := func(list []string) string {
		if len(list) > 0 {
			return list[0]
		}
		return ""
	}
	results := make([]proBookMetadata, 0, len(parsed.Docs))
	for _, doc := range parsed.Docs {
		item := proBookMetadata{
			Key:         strings.TrimPrefix(doc.Key, "/works/"),
			Name:        doc.Title,
			Author:      strings.Join(doc.AuthorName, ", "),
			Publisher:   first(doc.Publisher),
			ISBN:        first(doc.ISBN),
			Language:    first(doc.Language),
			Pages:       doc.Pages,
			Rating:      doc.Rating,
			RatingCount: doc.RatingCount,
		}
		if doc.CoverID > 0 {
			item.Cover = fmt.Sprintf("https://covers.openlibrary.org/b/id/%d-L.jpg", doc.CoverID)
		}
		if doc.FirstPublished > 0 {
			item.PubDate = strconv.Itoa(doc.FirstPublished)
		}
		if doc.Rating > 0 {
			item.RatingSource = "Open Library"
		}
		if len(doc.Subject) > 5 {
			doc.Subject = doc.Subject[:5]
		}
		item.Categories = strings.Join(doc.Subject, ", ")
		results = append(results, item)
	}
	proFillDescriptions(r.Context(), results)
	proOK(w, results)
}

// Search results carry no description; fetch the work records for the top hits
func proFillDescriptions(ctx context.Context, results []proBookMetadata) {
	const maxDescriptions = 5
	var wg sync.WaitGroup
	for i := range results {
		if i >= maxDescriptions || results[i].Key == "" {
			break
		}
		wg.Add(1)
		go func(item *proBookMetadata) {
			defer wg.Done()
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://openlibrary.org/works/"+url.PathEscape(item.Key)+".json", nil)
			req.Header.Set("User-Agent", proUserAgent)
			resp, err := proHTTP.Do(req)
			if err != nil {
				return
			}
			defer resp.Body.Close()
			var work struct {
				Description json.RawMessage `json:"description"`
			}
			if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&work) != nil || len(work.Description) == 0 {
				return
			}
			// Either a plain string or {"type": ..., "value": ...}
			var text string
			if json.Unmarshal(work.Description, &text) != nil {
				var typed struct {
					Value string `json:"value"`
				}
				if json.Unmarshal(work.Description, &typed) == nil {
					text = typed.Value
				}
			}
			item.Description = text
		}(&results[i])
	}
	wg.Wait()
}

// ── Text to speech ────────────────────────────────────────────────────────────

func proHandleTTS(w http.ResponseWriter, r *http.Request) {
	if !proTTS.configured() {
		proFail(w, http.StatusServiceUnavailable, 503, "TTS is not configured on this server (set PRO_TTS_BASE_URL)")
		return
	}
	var in struct {
		Text  string  `json:"text"`
		Voice string  `json:"voice"`
		Speed float64 `json:"speed"`
	}
	if err := decodeJSON(r, &in); err != nil || strings.TrimSpace(in.Text) == "" {
		proFail(w, http.StatusBadRequest, 400, "Expected {text, voice, speed}")
		return
	}
	if in.Speed <= 0 {
		in.Speed = 1
	}
	voice := in.Voice
	if voice == "" {
		voice = proTTSVoice
	}
	audio, status, err := proSynthesize(r.Context(), in.Text, voice, in.Speed)
	// The app offers voices from several engines; fall back to the server's
	// default voice when the TTS server doesn't know the requested one
	if err != nil && status >= 400 && status < 500 && voice != proTTSVoice {
		audio, _, err = proSynthesize(r.Context(), in.Text, proTTSVoice, in.Speed)
	}
	if err != nil {
		proFail(w, http.StatusBadGateway, 502, err.Error())
		return
	}
	proOK(w, map[string]any{"audio_base64": "data:audio/mpeg;base64," + base64.StdEncoding.EncodeToString(audio)})
}

func proSynthesize(ctx context.Context, text, voice string, speed float64) ([]byte, int, error) {
	payload, _ := json.Marshal(map[string]any{
		"model":           proTTS.Model,
		"input":           text,
		"voice":           voice,
		"speed":           speed,
		"response_format": "mp3",
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, proTTS.BaseURL+"/audio/speech", bytes.NewReader(payload))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if proTTS.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+proTTS.APIKey)
	}
	resp, err := proHTTP.Do(req)
	if err != nil {
		return nil, 0, errors.New("TTS server unreachable")
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 50<<20))
	if resp.StatusCode >= 300 {
		return nil, resp.StatusCode, fmt.Errorf("TTS server returned HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}
	return body, resp.StatusCode, nil
}

// ── OCR for scanned PDFs ──────────────────────────────────────────────────────

func proHandleOCR(w http.ResponseWriter, r *http.Request) {
	if !proRequireAI(w) {
		return
	}
	var in struct {
		ImageBase64 string `json:"image_base64"`
		Lang        string `json:"lang"`
	}
	if err := decodeJSON(r, &in); err != nil || in.ImageBase64 == "" {
		proFail(w, http.StatusBadRequest, 400, "Expected {image_base64}")
		return
	}
	image := in.ImageBase64
	if !strings.HasPrefix(image, "data:") {
		image = "data:" + sniffImageType(image) + ";base64," + image
	}
	prompt := "Transcribe all text on this book page exactly as printed, in reading order. " +
		"Keep paragraph breaks, drop page headers, footers and page numbers. Output only the text."
	if in.Lang != "" && in.Lang != "auto" {
		prompt += " The page is written in " + in.Lang + "."
	}
	text, err := proChat(r.Context(), proOCRModel, []map[string]any{{
		"role": "user",
		"content": []map[string]any{
			{"type": "text", "text": prompt},
			{"type": "image_url", "image_url": map[string]string{"url": image}},
		},
	}})
	if err != nil {
		proFail(w, http.StatusBadGateway, 502, err.Error())
		return
	}
	proOK(w, map[string]any{"text": text})
}

func sniffImageType(b64 string) string {
	head, err := base64.StdEncoding.DecodeString(b64[:min(len(b64), 16)])
	if err == nil && len(head) >= 3 && head[0] == 0xFF && head[1] == 0xD8 {
		return "image/jpeg"
	}
	if err == nil && len(head) >= 4 && string(head[1:4]) == "PNG" {
		return "image/png"
	}
	if err == nil && len(head) >= 4 && string(head[:4]) == "RIFF" {
		return "image/webp"
	}
	return "image/png"
}
