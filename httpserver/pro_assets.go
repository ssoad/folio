package main

// Downloadable fonts, dictionaries and backgrounds, served from a folder on
// the server (PRO_ASSETS_DIR, default ./assets):
//
//	assets/fonts/<path as in the app's font list>   e.g. fonts/EB_Garamond/EBGaramond-VF.ttf
//	assets/dicts/<id>.mdx
//	assets/backgrounds/desktop/<name>.png          full size
//	assets/backgrounds/desktop-thumbnail/<name>.png optional preview
//
// The app lists only what the folder contains.

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var proAssetKinds = map[string]bool{"fonts": true, "dicts": true, "backgrounds": true}

var proAssetsDir string

func initProAssets() {
	dir := getEnv("PRO_ASSETS_DIR", "./assets")
	if abs, err := filepath.Abs(dir); err == nil {
		dir = abs
	}
	proAssetsDir = dir
}

// GET /pro/v1/assets/catalog → {fonts: [paths], dicts: [paths], backgrounds: [paths]}
func proHandleAssetCatalog(w http.ResponseWriter, _ *http.Request) {
	catalog := map[string][]string{}
	for kind := range proAssetKinds {
		files := []string{}
		root := filepath.Join(proAssetsDir, kind)
		_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err != nil || entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
				return nil
			}
			rel, err := filepath.Rel(root, path)
			if err == nil {
				files = append(files, "/"+filepath.ToSlash(rel))
			}
			return nil
		})
		sort.Strings(files)
		catalog[kind] = files
	}
	proOK(w, catalog)
}

// GET /pro/v1/assets/{kind}/{path}
func proHandleAssetFile(w http.ResponseWriter, r *http.Request, rest string) {
	kind, rel, ok := strings.Cut(rest, "/")
	if !ok || !proAssetKinds[kind] || rel == "" {
		proFail(w, http.StatusNotFound, 404, "Not Found")
		return
	}
	root := filepath.Join(proAssetsDir, kind)
	target := filepath.Join(root, filepath.FromSlash(rel))
	// Stay inside the kind's folder
	if within, err := filepath.Rel(root, target); err != nil || within == ".." || strings.HasPrefix(within, ".."+string(filepath.Separator)) {
		proFail(w, http.StatusNotFound, 404, "Not Found")
		return
	}
	info, err := os.Stat(target)
	if err != nil || info.IsDir() {
		proFail(w, http.StatusNotFound, 404, "Not Found")
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, target)
}
