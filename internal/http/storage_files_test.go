package http

import (
	"context"
	"encoding/json"
	"io"
	"lms-router-control-plane/internal/domain"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type filesStub struct {
	previewStub
	root, path, method, operation string
	headers                       map[string]string
}

func (s *filesStub) BrowseStorage(_ context.Context, _ domain.Node, root, path string) (domain.StorageFileListing, error) {
	s.root = root
	s.path = path
	return domain.StorageFileListing{Root: root, Path: path, Entries: []domain.StorageFileEntry{}}, nil
}
func (s *filesStub) OpenStorageFile(_ context.Context, _ domain.Node, root, path, method string, inline bool, headers map[string]string) (*http.Response, error) {
	s.root = root
	s.path = path
	s.method = method
	s.headers = headers
	return &http.Response{StatusCode: 206, Header: http.Header{"Content-Type": {"video/mp4"}, "Content-Range": {"bytes 2-5/10"}, "Content-Disposition": {"inline; filename=lesson.mp4"}}, Body: io.NopCloser(strings.NewReader("2345"))}, nil
}
func (s *filesStub) MutateStorage(_ context.Context, _ domain.Node, operation string, request domain.StorageFileMutation) (domain.StorageFileMutationResult, error) {
	s.operation = operation
	return domain.StorageFileMutationResult{Path: request.Path}, nil
}
func TestFileManagerProxiesPathsRangesAndHeadWithoutBuffering(t *testing.T) {
	client := &filesStub{}
	handler := NewHandler(Dependencies{NodeRepo: networkRepo{}, NodeClient: client})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/ui/nodes/test/files?root=%2Fmnt%2Fdisk8tb&path=folder%2Flesson", nil))
	if w.Code != 200 || client.root != "/mnt/disk8tb" || client.path != "folder/lesson" {
		t.Fatalf("listing %d %s", w.Code, w.Body.String())
	}
	for _, method := range []string{"GET", "HEAD"} {
		r := httptest.NewRequest(method, "/api/ui/nodes/test/files/content?root=%2Fmnt%2Fdisk8tb&path=lesson.mp4&inline=1", nil)
		r.Header.Set("Range", "bytes=2-5")
		w = httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != 206 || client.method != method || client.headers["Range"] != "bytes=2-5" || w.Header().Get("X-Accel-Buffering") != "no" {
			t.Fatal("stream metadata lost")
		}
		if method == "HEAD" && w.Body.Len() != 0 {
			t.Fatal("HEAD returned a body")
		}
		if method == "GET" && w.Body.String() != "2345" {
			t.Fatal("stream changed")
		}
	}
}
func TestFileManagerMutationsRequireEditorAndExactRoute(t *testing.T) {
	role := "viewer"
	account := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"user": accountUser{Login: "test", Role: role}, "app": "lms_node"})
	}))
	defer account.Close()
	client := &filesStub{}
	handler := NewHandler(Dependencies{NodeRepo: networkRepo{}, NodeClient: client, AccountOrigin: account.URL, PublicOrigin: "https://lms.example"})
	request := func(method, path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(`{"root":"/downloads","path":"folder","name":"new"}`))
		r.Header.Set("Authorization", "Bearer "+testAccountToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := request("GET", "/api/ui/nodes/test/files"); w.Code != 200 {
		t.Fatal("viewer cannot browse")
	}
	if w := request("POST", "/api/ui/nodes/test/files/delete"); w.Code != 403 || client.operation != "" {
		t.Fatal("viewer changed files")
	}
	role = "editor"
	forged := httptest.NewRequest("POST", "/api/ui/nodes/test/files/delete", strings.NewReader(`{"root":"/downloads","path":"folder"}`))
	forged.AddCookie(&http.Cookie{Name: "lms_session", Value: testAccountToken})
	forged.Header.Set("Origin", "https://evil.example")
	denied := httptest.NewRecorder()
	handler.ServeHTTP(denied, forged)
	if denied.Code != 403 {
		t.Fatal("cross-origin file mutation accepted")
	}
	for _, operation := range []string{"mkdir", "rename", "delete"} {
		if w := request("POST", "/api/ui/nodes/test/files/"+operation); w.Code != 200 || client.operation != operation {
			t.Fatalf("editor operation %s denied: %d", operation, w.Code)
		}
	}
	if w := request("PUT", "/api/ui/nodes/test"); w.Code != 403 {
		t.Fatal("file permission escalated to node administration")
	}
	if w := request("POST", "/api/ui/nodes/test/files/delete/other"); w.Code != 403 {
		t.Fatal("nonexact mutation path bypassed node authorization")
	}
}
