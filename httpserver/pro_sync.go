package main

// Folio Cloud: library sync to the Folio server itself, for plans with the
// "sync" feature. The app's sync engine talks to it like its Docker data
// source (list, upload, download and delete with ?dir= and filename=), with
// Basic auth carrying the account's app token as the password.
//
// Each account's data is one file, data/sync/<user id>.folio: a SQLite
// database whose rows are the synced files. Everything in it is encrypted
// with AES-256-GCM under a key derived for that account from the server's
// vault secret: file contents, and the folder, name, size and time of each
// file. Rows are found by an HMAC of folder and name, so the file reveals
// only how many entries there are and roughly how large they are.

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const proSyncPrefix = "/pro/v1/sync/"

var (
	proSyncDir string
	// Books are uploaded whole
	proSyncMaxBodyBytes int64 = 512 << 20
	// From the vault secret (initProVault); each account's key comes from it
	proSyncRootKey []byte

	proSyncMu     sync.Mutex
	proSyncStores = map[string]*syncStore{}
)

func initProSync() {
	abs, err := filepath.Abs(getEnv("PRO_SYNC_DIR", "./data/sync"))
	if err != nil {
		log.Fatalf("Cannot resolve the sync directory: %v", err)
	}
	proSyncDir = abs
	if mb, err := strconv.ParseInt(os.Getenv("PRO_SYNC_MAX_UPLOAD_MB"), 10, 64); err == nil && mb > 0 {
		proSyncMaxBodyBytes = mb << 20
	}
}

func isProSyncPath(path string) bool {
	return strings.HasPrefix(path, proSyncPrefix)
}

// The sync engine sends "Basic base64(folio:<app token>)"; the rest of the
// server reads bearer tokens
func proSyncBearer(r *http.Request) {
	encoded, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Basic ")
	if !ok {
		return
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return
	}
	if _, token, found := strings.Cut(string(decoded), ":"); found && token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
}

func hmacSum(key []byte, parts ...string) []byte {
	mac := hmac.New(sha256.New, key)
	for _, part := range parts {
		mac.Write([]byte(part))
		mac.Write([]byte{0})
	}
	return mac.Sum(nil)
}

// ── An account's store ───────────────────────────────────────────────────────

type syncStore struct {
	db     *sql.DB
	aead   cipher.AEAD
	tagKey []byte
	// One writer at a time; SQLite would make the others wait anyway
	mu sync.Mutex
}

// What's encrypted alongside each file's contents
type syncMeta struct {
	Dir      string `json:"d"`
	Name     string `json:"n"`
	Size     int64  `json:"s"`
	Modified int64  `json:"m"`
}

var errSyncKey = errors.New("the sync data was encrypted with another key")

// "owner" for the owner token, else the account id
func syncOwner(p *principal) string {
	if !p.Owner && p.User != nil {
		return strconv.FormatInt(p.User.ID, 10)
	}
	return "owner"
}

func syncStorePath(owner string) string {
	return filepath.Join(proSyncDir, owner+".folio")
}

func openSyncStore(owner string) (*syncStore, error) {
	proSyncMu.Lock()
	defer proSyncMu.Unlock()
	if store, ok := proSyncStores[owner]; ok {
		return store, nil
	}
	if len(proSyncRootKey) == 0 {
		return nil, errors.New("the sync key is not set")
	}
	if err := os.MkdirAll(proSyncDir, 0o700); err != nil {
		return nil, err
	}
	accountKey := hmacSum(proSyncRootKey, "account", owner)
	block, err := aes.NewCipher(hmacSum(accountKey, "encrypt"))
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	// A rollback journal, not WAL, so the account stays one file
	db, err := sql.Open("sqlite", syncStorePath(owner)+"?_pragma=journal_mode(DELETE)&_pragma=busy_timeout(10000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	store := &syncStore{db: db, aead: aead, tagKey: hmacSum(accountKey, "lookup")}
	if err := store.init(); err != nil {
		db.Close()
		return nil, err
	}
	os.Chmod(syncStorePath(owner), 0o600)
	if err := store.importFolder(filepath.Join(proSyncDir, owner)); err != nil {
		log.Printf("[sync] Moving account %s's files into its store: %v", owner, err)
	}
	proSyncStores[owner] = store
	return store, nil
}

func (s *syncStore) init() error {
	_, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS files (tag BLOB PRIMARY KEY, meta BLOB NOT NULL, data BLOB NOT NULL);
		CREATE TABLE IF NOT EXISTS info (key TEXT PRIMARY KEY, value BLOB NOT NULL)`)
	if err != nil {
		return err
	}
	// A known value, so a changed server secret fails loudly instead of
	// serving garbage
	var check []byte
	err = s.db.QueryRow(`SELECT value FROM info WHERE key = 'check'`).Scan(&check)
	if errors.Is(err, sql.ErrNoRows) {
		sealed, err := s.seal([]byte("folio-sync-v1"), []byte("check"))
		if err != nil {
			return err
		}
		_, err = s.db.Exec(`INSERT INTO info (key, value) VALUES ('check', ?)`, sealed)
		return err
	}
	if err != nil {
		return err
	}
	if plain, err := s.open(check, []byte("check")); err != nil || string(plain) != "folio-sync-v1" {
		return errSyncKey
	}
	return nil
}

func (s *syncStore) seal(plain, aad []byte) ([]byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return s.aead.Seal(nonce, nonce, plain, aad), nil
}

func (s *syncStore) open(sealed, aad []byte) ([]byte, error) {
	size := s.aead.NonceSize()
	if len(sealed) < size {
		return nil, errors.New("sync entry is too short")
	}
	return s.aead.Open(nil, sealed[:size], sealed[size:], aad)
}

func (s *syncStore) tag(dir, name string) []byte {
	return hmacSum(s.tagKey, dir, name)
}

// Contents and details are bound to their entry, so rows can't be swapped
func aadFor(tag []byte, field string) []byte {
	return append(append([]byte{}, tag...), field...)
}

func (s *syncStore) put(dir, name string, data []byte, modified int64) error {
	tag := s.tag(dir, name)
	meta, _ := json.Marshal(syncMeta{Dir: dir, Name: name, Size: int64(len(data)), Modified: modified})
	sealedMeta, err := s.seal(meta, aadFor(tag, "meta"))
	if err != nil {
		return err
	}
	sealedData, err := s.seal(data, aadFor(tag, "data"))
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err = s.db.Exec(`INSERT INTO files (tag, meta, data) VALUES (?, ?, ?)
		ON CONFLICT(tag) DO UPDATE SET meta = excluded.meta, data = excluded.data`, tag, sealedMeta, sealedData)
	return err
}

func (s *syncStore) get(dir, name string) ([]byte, error) {
	tag := s.tag(dir, name)
	var sealed []byte
	if err := s.db.QueryRow(`SELECT data FROM files WHERE tag = ?`, tag).Scan(&sealed); err != nil {
		return nil, err
	}
	return s.open(sealed, aadFor(tag, "data"))
}

func (s *syncStore) remove(dir, name string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	res, err := s.db.Exec(`DELETE FROM files WHERE tag = ?`, s.tag(dir, name))
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (s *syncStore) all() ([]syncMeta, error) {
	rows, err := s.db.Query(`SELECT tag, meta FROM files`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []syncMeta
	for rows.Next() {
		var tag, sealed []byte
		if err := rows.Scan(&tag, &sealed); err != nil {
			return nil, err
		}
		plain, err := s.open(sealed, aadFor(tag, "meta"))
		if err != nil {
			return nil, err
		}
		var meta syncMeta
		if err := json.Unmarshal(plain, &meta); err != nil {
			return nil, err
		}
		out = append(out, meta)
	}
	return out, rows.Err()
}

// Accounts synced before encryption had a plain folder; its files move into
// the store and the folder goes
func (s *syncStore) importFolder(root string) error {
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return nil
	}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		info, _ := d.Info()
		modified := time.Now().Unix()
		if info != nil {
			modified = info.ModTime().Unix()
		}
		dir := cleanSyncDir(filepath.ToSlash(filepath.Dir(rel)))
		return s.put(dir, filepath.Base(rel), data, modified)
	})
	if err != nil {
		return err
	}
	return os.RemoveAll(root)
}

// Deleting an account deletes its synced data
func removeSyncStore(userID int64) {
	owner := strconv.FormatInt(userID, 10)
	proSyncMu.Lock()
	if store, ok := proSyncStores[owner]; ok {
		store.db.Close()
		delete(proSyncStores, owner)
	}
	proSyncMu.Unlock()
	if proSyncDir == "" {
		return
	}
	os.Remove(syncStorePath(owner))
	os.Remove(syncStorePath(owner) + "-journal")
	os.RemoveAll(filepath.Join(proSyncDir, owner))
}

// ── The file API ─────────────────────────────────────────────────────────────

// Folders are names inside the account's store, not paths on disk:
// "/config/", "config" and "a/../config" are all "config"
func cleanSyncDir(dir string) string {
	return strings.Trim(path.Clean("/"+dir), "/")
}

// GET list, POST upload, GET download, DELETE delete, as on the file server
func proHandleSync(w http.ResponseWriter, r *http.Request) {
	store, err := openSyncStore(syncOwner(principalFrom(r)))
	if err != nil {
		log.Printf("[sync] Cannot open the account's store: %v", err)
		writePlain(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	dir := cleanSyncDir(r.URL.Query().Get("dir"))
	switch action := strings.TrimPrefix(strings.TrimSuffix(r.URL.Path, "/"), proSyncPrefix); {
	case action == "upload" && r.Method == http.MethodPost:
		syncUpload(w, r, store, dir)
	case action == "download" && r.Method == http.MethodGet:
		syncDownload(w, r, store, dir)
	case action == "delete" && r.Method == http.MethodDelete:
		syncDelete(w, r, store, dir)
	case action == "list" && r.Method == http.MethodGet:
		syncList(w, store, dir)
	default:
		writePlain(w, http.StatusNotFound, "Not Found")
	}
}

func syncFileName(name string) (string, bool) {
	safe := sanitizeFilename(name)
	return safe, safe != "" && safe != "." && safe != ".." && safe != "/"
}

func syncUpload(w http.ResponseWriter, r *http.Request, store *syncStore, dir string) {
	mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") || params["boundary"] == "" {
		writePlain(w, http.StatusBadRequest, "Invalid Content-Type. Expected multipart/form-data")
		return
	}
	mr := multipart.NewReader(r.Body, params["boundary"])
	var data []byte
	var filename string
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writePlain(w, http.StatusBadRequest, "Error reading multipart data")
			return
		}
		if part.FileName() != "" {
			filename = part.FileName()
			var buf bytes.Buffer
			if _, err := io.Copy(&buf, part); err != nil {
				writePlain(w, http.StatusRequestEntityTooLarge, "File too large")
				return
			}
			data = buf.Bytes()
		}
		part.Close()
	}
	name, ok := syncFileName(filename)
	if data == nil || !ok {
		writePlain(w, http.StatusBadRequest, "No valid file uploaded")
		return
	}
	if err := store.put(dir, name, data, time.Now().Unix()); err != nil {
		log.Printf("[sync] Store write: %v", err)
		writePlain(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":   true,
		"filename":  name,
		"directory": dir,
		"message":   "File uploaded successfully",
	})
}

func syncDownload(w http.ResponseWriter, r *http.Request, store *syncStore, dir string) {
	name, ok := syncFileName(r.URL.Query().Get("filename"))
	if !ok {
		writePlain(w, http.StatusBadRequest, "Invalid filename")
		return
	}
	data, err := store.get(dir, name)
	if errors.Is(err, sql.ErrNoRows) {
		writePlain(w, http.StatusNotFound, "File not found")
		return
	}
	if err != nil {
		log.Printf("[sync] Store read: %v", err)
		writePlain(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	encoded := url.PathEscape(name)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, encoded, encoded))
	w.Write(data)
}

func syncDelete(w http.ResponseWriter, r *http.Request, store *syncStore, dir string) {
	name, ok := syncFileName(r.URL.Query().Get("filename"))
	if !ok {
		writePlain(w, http.StatusBadRequest, "Invalid filename")
		return
	}
	found, err := store.remove(dir, name)
	if err != nil {
		log.Printf("[sync] Store delete: %v", err)
		writePlain(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if !found {
		writePlain(w, http.StatusNotFound, "File not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":   true,
		"filename":  name,
		"directory": dir,
		"message":   "File deleted successfully",
	})
}

// The files in a folder, and the folders directly below it
func syncList(w http.ResponseWriter, store *syncStore, dir string) {
	metas, err := store.all()
	if err != nil {
		log.Printf("[sync] Store list: %v", err)
		writePlain(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	list := []fileEntry{}
	folders := map[string]int64{}
	for _, meta := range metas {
		if meta.Dir == dir {
			size := meta.Size
			when := time.Unix(meta.Modified, 0).UTC().Format(time.RFC3339)
			list = append(list, fileEntry{Name: meta.Name, Type: "file", Size: &size, ModifiedTime: when, CreatedTime: when})
			continue
		}
		rest, ok := strings.CutPrefix(meta.Dir, dir+"/")
		if dir == "" {
			rest, ok = meta.Dir, meta.Dir != ""
		}
		if ok {
			child, _, _ := strings.Cut(rest, "/")
			if meta.Modified > folders[child] {
				folders[child] = meta.Modified
			}
		}
	}
	for child, modified := range folders {
		when := time.Unix(modified, 0).UTC().Format(time.RFC3339)
		list = append(list, fileEntry{Name: child, Type: "directory", ModifiedTime: when, CreatedTime: when})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Type != list[j].Type {
			return list[i].Type == "directory"
		}
		return list[i].Name < list[j].Name
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"directory":  dir,
		"files":      list,
		"totalCount": len(list),
	})
}
