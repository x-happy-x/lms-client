package scheduler

import (
	"context"
	"errors"
	"lms-router-control-plane/internal/domain"
	"lms-router-control-plane/internal/store/sqlite"
	"testing"
	"time"
)

type routeChangingClient struct {
	fakeNodeClient
	response domain.NodeJobStatusResponse
	failure  error
	calls    int
}

func (c *routeChangingClient) SetNetworkRoute(context.Context, domain.Node, string, string) (domain.NodeJobStatusResponse, error) {
	c.calls++
	return c.response, c.failure
}
func TestNetworkMutationPersistsOnlyAfterNodeAcceptanceAndDoesNotDuplicateQueuedRemote(t *testing.T) {
	ctx := context.Background()
	db := setupDB(t)
	jobs := sqlite.NewJobRepository(db.SQL)
	nodes := sqlite.NewNodeRepository(db.SQL)
	now := time.Now().UTC()
	nodeID, remoteID := "node", "remote"
	if err := nodes.Create(ctx, domain.Node{ID: nodeID, Name: "node", Enabled: true, BaseURL: "https://node.test", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	job := domain.Job{ID: "job", CreatedAt: now, UpdatedAt: now, Type: domain.JobTypeDirect, URL: "https://course.test/file", Status: domain.JobStatusRunning, NodeID: &nodeID, RemoteJobID: &remoteID}
	if err := jobs.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	creates := 0
	client := &routeChangingClient{response: domain.NodeJobStatusResponse{Status: "QUEUED", NetworkRouteLabel: "Europe"}, fakeNodeClient: fakeNodeClient{createFn: func(context.Context, domain.Node, domain.NodeJobCreateRequest) (domain.NodeJobCreateResponse, error) {
		creates++
		return domain.NodeJobCreateResponse{}, nil
	}, getFn: func(context.Context, domain.Node, string) (domain.NodeJobStatusResponse, error) {
		return domain.NodeJobStatusResponse{Status: "QUEUED"}, nil
	}}}
	service := NewService(jobs, nodes, client, Config{}, nil)
	changed, err := service.SetJobNetworkRoute(ctx, "job", "eu", "Europe")
	if err != nil || changed.NetworkRouteID != "eu" || changed.Status != domain.JobStatusRunning {
		t.Fatalf("change %+v %v", changed, err)
	}
	if err := service.tick(ctx); err != nil {
		t.Fatal(err)
	}
	if creates != 0 {
		t.Fatal("route change dispatched duplicate remote job")
	}
	client.failure = errors.New("fixture route unavailable")
	if _, err := service.SetJobNetworkRoute(ctx, "job", "other", "Other"); err == nil {
		t.Fatal("failed node mutation accepted")
	}
	stored, err := jobs.GetByID(ctx, "job")
	if err != nil || stored.NetworkRouteID != "eu" {
		t.Fatal("failed change overwrote selection")
	}
	client.failure = nil
	client.response.Status = "PAUSED"
	stored.Status = domain.JobStatusPaused
	if err := jobs.Update(ctx, stored); err != nil {
		t.Fatal(err)
	}
	changed, err = service.SetJobNetworkRoute(ctx, "job", "", "")
	if err != nil || changed.Status != domain.JobStatusPaused {
		t.Fatal("paused mutation started a download")
	}
	changed.Status = domain.JobStatusDone
	if err := jobs.Update(ctx, changed); err != nil {
		t.Fatal(err)
	}
	calls := client.calls
	if _, err := service.SetJobNetworkRoute(ctx, "job", "eu", "Europe"); err == nil || client.calls != calls {
		t.Fatal("finished job route changed")
	}
}
