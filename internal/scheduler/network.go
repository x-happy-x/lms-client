package scheduler

import (
	"context"
	"fmt"
	"lms-router-control-plane/internal/domain"
)

func (s *Service) SetJobNetworkRoute(ctx context.Context, id, routeID, label string) (domain.Job, error) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	job, err := s.jobRepo.GetByID(ctx, id)
	if err != nil {
		return domain.Job{}, err
	}
	if job.Status == domain.JobStatusDone || job.Status == domain.JobStatusCanceled {
		return domain.Job{}, fmt.Errorf("Нельзя менять маршрут завершённой загрузки")
	}
	if job.NetworkRouteID == routeID {
		return job, nil
	}
	if job.RemoteJobID != nil && job.NodeID != nil {
		node, err := s.nodeRepo.GetByID(ctx, *job.NodeID)
		if err != nil {
			return domain.Job{}, err
		}
		client, ok := s.nodeClient.(interface {
			SetNetworkRoute(context.Context, domain.Node, string, string) (domain.NodeJobStatusResponse, error)
		})
		if !ok {
			return domain.Job{}, fmt.Errorf("Обновите роутер для смены маршрута")
		}
		response, err := client.SetNetworkRoute(ctx, node, *job.RemoteJobID, routeID)
		if err != nil {
			return domain.Job{}, fmt.Errorf("Нода не смогла сменить маршрут; прежний выбор сохранён")
		}
		if response.Status != "" {
			job.Status = domain.JobStatus(response.Status)
			// A remote queued job is already dispatched; never create a duplicate on the next tick.
			if job.Status == domain.JobStatusQueued {
				job.Status = domain.JobStatusRunning
			}
		}
		if response.NetworkRouteLabel != "" {
			label = response.NetworkRouteLabel
		}
	}
	job.NetworkRouteID = routeID
	job.NetworkRouteLabel = label
	job.UpdatedAt = s.now().UTC()
	if err := s.jobRepo.Update(ctx, job); err != nil {
		return domain.Job{}, err
	}
	return job, nil
}
