package http

import (
	"context"
	"errors"
	"io"
	"lms-router-control-plane/internal/domain"
	"lms-router-control-plane/internal/nodes"
	"net/http"
	"strings"
	"time"
)

type storageFilesClient interface {
	BrowseStorage(context.Context, domain.Node, string, string) (domain.StorageFileListing, error)
	OpenStorageFile(context.Context, domain.Node, string, string, string, bool, map[string]string) (*http.Response, error)
}
type storageFileMutationClient interface {
	MutateStorage(context.Context, domain.Node, string, domain.StorageFileMutation) (domain.StorageFileMutationResult, error)
}

func fileMutationPath(path string) bool {
	parts := strings.Split(strings.TrimPrefix(path, "/api/ui/nodes/"), "/")
	return strings.HasPrefix(path, "/api/ui/nodes/") && len(parts) == 3 && parts[0] != "" && parts[1] == "files" && (parts[2] == "mkdir" || parts[2] == "rename" || parts[2] == "delete")
}
func (h *Handler) nodeFileMutation(w http.ResponseWriter, r *http.Request, id, operation string) {
	if r.Method != http.MethodPost {
		h.methodNotAllowed(w)
		return
	}
	client, ok := h.nodeClient.(storageFileMutationClient)
	if !ok || h.nodeRepo == nil {
		writeJSON(w, 501, map[string]string{"error": "Обновите ноду и роутер для управления файлами"})
		return
	}
	var request domain.StorageFileMutation
	if err := decodeJSON(r, &request); err != nil {
		h.badRequest(w, "Некорректный запрос")
		return
	}
	if len(request.Root) > 4096 || len(request.Path) > 4096 || len(request.Name) > 255 {
		h.badRequest(w, "Слишком длинный путь")
		return
	}
	node, err := h.nodeRepo.GetByID(r.Context(), id)
	if err != nil {
		h.notFound(w)
		return
	}
	if !node.Enabled {
		writeJSON(w, 409, map[string]string{"error": "Нода отключена"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	out, err := client.MutateStorage(ctx, node, operation, request)
	if err != nil {
		var failure *nodes.NodeError
		if errors.As(err, &failure) && (failure.Status == 400 || failure.Status == 403 || failure.Status == 404 || failure.Status == 409) {
			writeJSON(w, failure.Status, map[string]string{"error": failure.Message})
			return
		}
		writeJSON(w, 502, map[string]string{"error": "Нода не смогла изменить файл"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, out)
}

func (h *Handler) nodeFiles(w http.ResponseWriter, r *http.Request, id string, content bool) {
	if r.Method != http.MethodGet && !(content && r.Method == http.MethodHead) {
		h.methodNotAllowed(w)
		return
	}
	client, ok := h.nodeClient.(storageFilesClient)
	if !ok || h.nodeRepo == nil {
		writeJSON(w, 501, map[string]string{"error": "Обновите роутер для файлового менеджера"})
		return
	}
	root, path := r.URL.Query().Get("root"), r.URL.Query().Get("path")
	if len(root) > 4096 || len(path) > 4096 || strings.ContainsAny(root+path, "\x00\r\n") {
		h.badRequest(w, "Некорректный путь")
		return
	}
	node, err := h.nodeRepo.GetByID(r.Context(), id)
	if err != nil {
		h.notFound(w)
		return
	}
	if !node.Enabled {
		writeJSON(w, 409, map[string]string{"error": "Нода отключена"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if !content {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		listing, err := client.BrowseStorage(ctx, node, root, path)
		if err != nil {
			var failure *nodes.NodeError
			if errors.As(err, &failure) && (failure.Status == 400 || failure.Status == 403 || failure.Status == 404) {
				writeJSON(w, failure.Status, map[string]string{"error": "Папка недоступна. Проверьте хранилище, путь и версию ноды."})
				return
			}
			writeJSON(w, 502, map[string]string{"error": "Не удалось прочитать папку на ноде"})
			return
		}
		writeJSON(w, 200, listing)
		return
	}
	headers := map[string]string{}
	for _, name := range []string{"Range", "If-Range"} {
		if value := r.Header.Get(name); value != "" {
			headers[name] = value
		}
	}
	resp, err := client.OpenStorageFile(r.Context(), node, root, path, r.Method, r.URL.Query().Get("inline") == "1", headers)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "Файл недоступен на ноде"})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		if value := resp.Header.Get("Content-Range"); resp.StatusCode == 416 && value != "" {
			w.Header().Set("Content-Range", value)
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": "Файл недоступен на ноде"})
		return
	}
	for _, name := range append(proxiedFileHeaders, "Content-Disposition") {
		if value := resp.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(resp.StatusCode)
	if r.Method != http.MethodHead {
		_, _ = io.Copy(w, resp.Body)
	}
}
