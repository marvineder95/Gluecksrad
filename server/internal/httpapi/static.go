package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// StaticHandler liefert die statischen Frontend-Dateien aus staticDir und fällt
// für unbekannte Nicht-API-Pfade auf index.html zurück (SPA / Hash-Routing).
// In Produktion kann stattdessen Nginx die Statik ausliefern.
func StaticHandler(staticDir string) http.HandlerFunc {
	root, _ := filepath.Abs(staticDir)
	return func(w http.ResponseWriter, r *http.Request) {
		// API-Pfade gehören nicht hierher (sollten von chi gematcht sein).
		if strings.HasPrefix(r.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "Not found")
			return
		}
		clean := filepath.Clean(r.URL.Path)
		// Pfad-Traversal verhindern
		full := filepath.Join(root, clean)
		if !strings.HasPrefix(full, root) {
			writeError(w, http.StatusForbidden, "Forbidden")
			return
		}
		if clean == "/" {
			http.ServeFile(w, r, filepath.Join(root, "index.html"))
			return
		}
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			http.ServeFile(w, r, full)
			return
		}
		// Fallback: SPA -> index.html
		http.ServeFile(w, r, filepath.Join(root, "index.html"))
	}
}
