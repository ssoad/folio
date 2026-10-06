package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// A request the way the sync engine sends it: Basic auth with the app token
// as the password
func syncDo(t *testing.T, srv *httptest.Server, method, path, token string, body io.Reader, contentType string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+path, body)
	req.SetBasicAuth("folio", token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(raw)
}

func uploadSync(t *testing.T, srv *httptest.Server, token, dir, name, content string) int {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("file", name)
	part.Write([]byte(content))
	mw.Close()
	status, _ := syncDo(t, srv, http.MethodPost, "/pro/v1/sync/upload?dir="+dir, token, &buf, mw.FormDataContentType())
	return status
}

func listSync(t *testing.T, srv *httptest.Server, token, dir string) []fileEntry {
	t.Helper()
	var list struct {
		Files []fileEntry `json:"files"`
	}
	status, raw := syncDo(t, srv, http.MethodGet, "/pro/v1/sync/list?dir="+dir, token, nil, "")
	if status != http.StatusOK {
		t.Fatalf("list %q: HTTP %d %s", dir, status, raw)
	}
	json.Unmarshal([]byte(raw), &list)
	return list.Files
}

func setupSync(t *testing.T) *httptest.Server {
	t.Helper()
	srv := setupAccounts(t)
	proSyncDir = t.TempDir()
	t.Cleanup(func() {
		proSyncMu.Lock()
		for owner, store := range proSyncStores {
			store.db.Close()
			delete(proSyncStores, owner)
		}
		proSyncMu.Unlock()
	})
	return srv
}

// A signed-up account with a plan that has sync
func syncAccount(t *testing.T, srv *httptest.Server, email string) (string, int64) {
	t.Helper()
	pro, err := getPackageByName("Pro")
	if err != nil {
		pro = makePackage(t, "Pro", []string{"sync"}, nil)
	}
	token := register(t, srv, email)
	u, _ := getUserByEmail(email)
	grantSubscription(u.ID, pro.ID, 0, "admin", "")
	return token, u.ID
}

func getPackageByName(name string) (*Package, error) {
	for _, p := range listPackages(false) {
		if p.Name == name {
			return &p, nil
		}
	}
	return nil, os.ErrNotExist
}

func TestSyncNeedsThePlanFeature(t *testing.T) {
	srv := setupSync(t)
	reader := register(t, srv, "reader@example.com")
	if status := uploadSync(t, srv, reader, "config", "sync.json", "{}"); status != http.StatusForbidden {
		t.Fatalf("upload without a plan: HTTP %d", status)
	}
	if status, _ := syncDo(t, srv, http.MethodGet, "/pro/v1/sync/list?dir=config", "wrong-token", nil, ""); status != http.StatusUnauthorized {
		t.Fatalf("list with a bad token: HTTP %d", status)
	}
	if features(t, srv, reader)["sync"] {
		t.Fatal("sync reported without a plan")
	}
}

func TestSyncRoundTripIsPerAccount(t *testing.T) {
	srv := setupSync(t)
	alice, _ := syncAccount(t, srv, "alice@example.com")
	bob, _ := syncAccount(t, srv, "bob@example.com")
	if !features(t, srv, alice)["sync"] {
		t.Fatal("sync not reported for the plan")
	}
	if status := uploadSync(t, srv, alice, "config", "sync.json", `{"a":1}`); status != http.StatusOK {
		t.Fatalf("upload: HTTP %d", status)
	}
	uploadSync(t, srv, alice, "config", "sync.json", `{"a":2}`)
	uploadSync(t, srv, alice, "book", "1.epub", "epub bytes")
	status, body := syncDo(t, srv, http.MethodGet, "/pro/v1/sync/download?dir=config&filename=sync.json", alice, nil, "")
	if status != http.StatusOK || body != `{"a":2}` {
		t.Fatalf("download after replacing: HTTP %d %q", status, body)
	}
	files := listSync(t, srv, alice, "config")
	if len(files) != 1 || files[0].Name != "sync.json" || *files[0].Size != 7 {
		t.Fatalf("list config: %+v", files)
	}
	root := listSync(t, srv, alice, "")
	if len(root) != 2 || root[0].Type != "directory" || root[0].Name != "book" || root[1].Name != "config" {
		t.Fatalf("list root: %+v", root)
	}
	// Bob has his own, empty store
	if status, _ := syncDo(t, srv, http.MethodGet, "/pro/v1/sync/download?dir=config&filename=sync.json", bob, nil, ""); status != http.StatusNotFound {
		t.Fatalf("bob read alice's file: HTTP %d", status)
	}
	if files := listSync(t, srv, bob, "config"); len(files) != 0 {
		t.Fatalf("bob sees alice's files: %+v", files)
	}
	if status, _ := syncDo(t, srv, http.MethodDelete, "/pro/v1/sync/delete?dir=config&filename=sync.json", alice, nil, ""); status != http.StatusOK {
		t.Fatalf("delete: HTTP %d", status)
	}
	if status, _ := syncDo(t, srv, http.MethodDelete, "/pro/v1/sync/delete?dir=config&filename=sync.json", alice, nil, ""); status != http.StatusNotFound {
		t.Fatalf("deleting twice: HTTP %d", status)
	}
}

func TestSyncIsOneEncryptedFilePerAccount(t *testing.T) {
	srv := setupSync(t)
	alice, id := syncAccount(t, srv, "alice@example.com")
	uploadSync(t, srv, alice, "config", "notes-secret-name.db", "my private highlight text")
	uploadSync(t, srv, alice, "book", "1.epub", "the whole book in plain words")
	entries, _ := os.ReadDir(proSyncDir)
	if len(entries) != 1 || entries[0].Name() != strconv.FormatInt(id, 10)+".folio" || entries[0].IsDir() {
		names := []string{}
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("sync dir holds %v, want one file", names)
	}
	raw, _ := os.ReadFile(filepath.Join(proSyncDir, entries[0].Name()))
	for _, plain := range []string{"my private highlight", "plain words", "notes-secret-name", "1.epub", "config", "book"} {
		if bytes.Contains(raw, []byte(plain)) {
			t.Fatalf("store contains %q unencrypted", plain)
		}
	}
	// Another server secret can't read it, and says so
	proSyncMu.Lock()
	for owner, store := range proSyncStores {
		store.db.Close()
		delete(proSyncStores, owner)
	}
	proSyncMu.Unlock()
	saved := proSyncRootKey
	proSyncRootKey = hmacSum([]byte("another secret"), "folio-sync-v1")
	if _, err := openSyncStore(strconv.FormatInt(id, 10)); err != errSyncKey {
		t.Fatalf("opening with the wrong key: %v", err)
	}
	proSyncRootKey = saved
	if status, body := syncDo(t, srv, http.MethodGet, "/pro/v1/sync/download?dir=book&filename=1.epub", alice, nil, ""); status != http.StatusOK || body != "the whole book in plain words" {
		t.Fatalf("download with the right key again: HTTP %d %q", status, body)
	}
}

func TestSyncFoldersAreNamesNotPaths(t *testing.T) {
	srv := setupSync(t)
	alice, _ := syncAccount(t, srv, "alice@example.com")
	for _, dir := range []string{"../99/config", "/../../etc", "a/../../b"} {
		if status := uploadSync(t, srv, alice, dir, "x.txt", "x"); status != http.StatusOK {
			t.Fatalf("upload to %q: HTTP %d", dir, status)
		}
	}
	// Nothing but the account's file on disk
	entries, _ := os.ReadDir(proSyncDir)
	if len(entries) != 1 {
		t.Fatalf("files outside the store: %d entries", len(entries))
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(proSyncDir), "99")); err == nil {
		t.Fatal("a folder was created outside the sync dir")
	}
	if files := listSync(t, srv, alice, "99/config"); len(files) != 1 {
		t.Fatalf("\"../99/config\" should be the store's \"99/config\": %+v", files)
	}
}

func TestSyncMovesAnOldFolderIntoTheStore(t *testing.T) {
	srv := setupSync(t)
	alice, id := syncAccount(t, srv, "alice@example.com")
	old := filepath.Join(proSyncDir, strconv.FormatInt(id, 10))
	os.MkdirAll(filepath.Join(old, "config"), 0o755)
	os.WriteFile(filepath.Join(old, "config", "books.db"), []byte("old library"), 0o644)
	if status, body := syncDo(t, srv, http.MethodGet, "/pro/v1/sync/download?dir=config&filename=books.db", alice, nil, ""); status != http.StatusOK || body != "old library" {
		t.Fatalf("old file after moving: HTTP %d %q", status, body)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("old folder left behind")
	}
}

func TestDeletingAnAccountDeletesItsSyncData(t *testing.T) {
	srv := setupSync(t)
	alice, id := syncAccount(t, srv, "alice@example.com")
	uploadSync(t, srv, alice, "config", "sync.json", "{}")
	removeSyncStore(id)
	if _, err := os.Stat(syncStorePath(strconv.FormatInt(id, 10))); !os.IsNotExist(err) {
		t.Fatal("the account's store is still there")
	}
}
