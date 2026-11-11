package nodes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"lms-router-control-plane/internal/domain"
	"net/http"
)

func (c *Client) NetworkRoutes(ctx context.Context, node domain.Node) (domain.NodeNetworkRoutes, error) {
	var result domain.NodeNetworkRoutes
	res, err := c.do(ctx, c.httpClient, node, http.MethodGet, "/api/network/routes", nil, nil, true)
	if err != nil {
		return result, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return result, fmt.Errorf("node network routes unavailable")
	}
	err = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&result)
	return result, err
}
func (c *Client) ExtractMediaWithRoute(ctx context.Context, node domain.Node, url, profile, routeID string) (domain.NodeMediaExtractResponse, error) {
	var result domain.NodeMediaExtractResponse
	err := c.mediaJSON(ctx, node, "/api/jobs/extract", map[string]string{"url": url, "impersonate": profile, "networkRouteId": routeID}, &result)
	return result, err
}
