package nodes

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"lms-router-control-plane/internal/domain"
	"net/http"
	"strconv"
)

func (c *Client) mediaJSON(ctx context.Context, node domain.Node, path string, request any, out any) error {
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	resp, err := c.do(ctx, c.slowClient, node, http.MethodPost, path, bytes.NewReader(body), nil, true)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return &NodeError{Status: resp.StatusCode, Message: "Нода не смогла получить видео; проверьте доступность источника и версию lms-node"}
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out); err != nil {
		return fmt.Errorf("decode media metadata: %w", err)
	}
	return nil
}
func (c *Client) MediaInfo(ctx context.Context, node domain.Node, request domain.NodeMediaRequest) (domain.MediaInfo, error) {
	var out domain.MediaInfo
	err := c.mediaJSON(ctx, node, "/api/media/info", request, &out)
	return out, err
}
func (c *Client) PrepareMedia(ctx context.Context, node domain.Node, request domain.NodeMediaRequest) (domain.NodeMediaPreview, error) {
	var out domain.NodeMediaPreview
	err := c.mediaJSON(ctx, node, "/api/media/preview", request, &out)
	return out, err
}
func (c *Client) OpenMedia(ctx context.Context, node domain.Node, id string, height, fps, start int) (*http.Response, error) {
	return c.do(ctx, c.previewClient, node, http.MethodGet, "/api/media/preview/"+id+"?height="+strconv.Itoa(height)+"&fps="+strconv.Itoa(fps)+"&start="+strconv.Itoa(start), nil, nil, true)
}

func (c *Client) MediaCapabilities(ctx context.Context, node domain.Node) (domain.NodeMediaCapabilities, error) {
	var out domain.NodeMediaCapabilities
	response, err := c.do(ctx, c.slowClient, node, http.MethodGet, "/api/media/capabilities", nil, nil, true)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return out, fmt.Errorf("node does not support yt-dlp capabilities")
	}
	err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&out)
	return out, err
}
func (c *Client) DiagnoseMedia(ctx context.Context, node domain.Node, request domain.NodeDiagnosticRequest) (domain.NodeDiagnosticResult, error) {
	var out domain.NodeDiagnosticResult
	err := c.mediaJSON(ctx, node, "/api/media/diagnose", request, &out)
	return out, err
}
