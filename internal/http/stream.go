package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"

	"lms-router-control-plane/internal/nodes"
	"lms-router-control-plane/internal/store/sqlite"
)

// Response headers copied from the node when proxying a file.
var proxiedFileHeaders = []string{
	"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Cache-Control",
}

// streamJobOutput proxies a job's output (or its preview thumbnail) from the node to the
// LAN client. Nothing is stored on the router; Range requests are forwarded so browsers
// can seek in videos and download managers can resume.
func (h *Handler) streamJobOutput(w http.ResponseWriter, r *http.Request, jobID string, preview bool) {
	if h.nodeClient == nil || h.jobRepo == nil || h.nodeRepo == nil {
		h.internalError(w, "node client is not configured")
		return
	}
	job, err := h.jobRepo.GetByID(r.Context(), jobID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			h.notFound(w)
			return
		}
		h.internalError(w, err.Error())
		return
	}
	if job.NodeID == nil || job.RemoteJobID == nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "job has no output on a node yet"})
		return
	}
	node, err := h.nodeRepo.GetByID(r.Context(), *job.NodeID)
	if err != nil {
		if errors.Is(err, sqlite.ErrNotFound) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "job node not found"})
			return
		}
		h.internalError(w, err.Error())
		return
	}

	var resp *http.Response
	if preview {
		resp, err = h.nodeClient.OpenJobPreview(r.Context(), node, *job.RemoteJobID)
	} else {
		headers := map[string]string{}
		for _, name := range []string{"Range", "If-Range"} {
			if value := r.Header.Get(name); value != "" {
				headers[name] = value
			}
		}
		resp, err = h.nodeClient.OpenJobOutput(r.Context(), node, *job.RemoteJobID, headers)
	}
	if err != nil {
		if errors.Is(err, nodes.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "output is not available on the node"})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			if value := resp.Header.Get("Content-Range"); value != "" {
				w.Header().Set("Content-Range", value)
			}
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		writeJSON(w, resp.StatusCode, map[string]string{"error": nodeErrorText(resp.StatusCode, body)})
		return
	}

	for _, name := range proxiedFileHeaders {
		if value := resp.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	fileName := nodes.DecodeFileName(resp.Header.Get("X-File-Name"))
	if fileName == "" && job.OutputPath != nil {
		fileName = path.Base(*job.OutputPath)
	}
	if !preview {
		contentType := w.Header().Get("Content-Type")
		if contentType == "" || strings.HasPrefix(contentType, "application/octet-stream") {
			if byExt := mime.TypeByExtension(path.Ext(fileName)); byExt != "" {
				w.Header().Set("Content-Type", byExt)
			}
		}
		disposition := "attachment"
		if r.URL.Query().Get("inline") == "1" {
			disposition = "inline"
		}
		w.Header().Set("Content-Disposition", contentDisposition(disposition, fileName))
		w.Header().Set("X-File-Name", url.PathEscape(fileName))
	}
	// Tell nginx not to buffer multi-GB bodies on the router's disk.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(resp.StatusCode)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = io.Copy(w, resp.Body)
}

// contentDisposition builds a header that keeps non-ASCII names (RFC 6266 filename*).
func contentDisposition(kind, fileName string) string {
	if fileName == "" {
		return kind
	}
	fallback := strings.Map(func(r rune) rune {
		if r < 0x20 || r > 0x7e || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, fileName)
	return fmt.Sprintf(`%s; filename="%s"; filename*=UTF-8''%s`, kind, fallback, url.PathEscape(fileName))
}

func nodeErrorText(status int, body []byte) string {
	text := strings.TrimSpace(string(body))
	if strings.HasPrefix(text, "{") {
		var payload struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(body, &payload); err == nil && payload.Error != "" {
			return payload.Error
		}
	}
	if text == "" {
		return fmt.Sprintf("node returned %d", status)
	}
	return text
}
