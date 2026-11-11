package nodes

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"lms-router-control-plane/internal/domain"
	"net/http"
	"net/url"
)

func storageFileQuery(root, path string) url.Values {
	return url.Values{"root": {root}, "path": {path}}
}

func (c *Client) MutateStorage(ctx context.Context, node domain.Node, operation string, request domain.StorageFileMutation) (domain.StorageFileMutationResult, error) {
	var out domain.StorageFileMutationResult
	if operation != "mkdir" && operation != "rename" && operation != "delete" {
		return out, fmt.Errorf("invalid file operation")
	}
	body, err := json.Marshal(request)
	if err != nil {
		return out, err
	}
	resp, err := c.do(ctx, c.httpClient, node, http.MethodPost, "/api/storage/files/"+operation, bytes.NewReader(body), nil, false)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&failure)
		if failure.Error == "" || len(failure.Error) > 512 {
			failure.Error = "Не удалось изменить файл"
		}
		return out, &NodeError{Status: resp.StatusCode, Message: failure.Error}
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 65536)).Decode(&out)
	return out, err
}

func (c *Client) BrowseStorage(ctx context.Context, node domain.Node, root, path string) (domain.StorageFileListing, error) {
	var out domain.StorageFileListing
	resp, err := c.do(ctx, c.httpClient, node, http.MethodGet, "/api/storage/browse?"+storageFileQuery(root, path).Encode(), nil, nil, true)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return out, &NodeError{Status: resp.StatusCode, Message: "Папка недоступна на ноде"}
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&out); err != nil {
		return out, fmt.Errorf("invalid file listing")
	}
	return out, nil
}

func (c *Client) OpenStorageFile(ctx context.Context, node domain.Node, root, path, method string, inline bool, headers map[string]string) (*http.Response, error) {
	query := storageFileQuery(root, path)
	if inline {
		query.Set("inline", "1")
	}
	return c.do(ctx, c.streamClient, node, method, "/api/storage/file?"+query.Encode(), nil, headers, true)
}
