package domain

import "context"

type JobRepository interface {
	Create(ctx context.Context, job Job) error
	GetByID(ctx context.Context, id string) (Job, error)
	List(ctx context.Context, activeOnly bool) ([]Job, error)
	Update(ctx context.Context, job Job) error
}

type NodeRepository interface {
	Create(ctx context.Context, node Node) error
	GetByID(ctx context.Context, id string) (Node, error)
	ListEnabled(ctx context.Context) ([]Node, error)
	ListAll(ctx context.Context) ([]Node, error)
	Update(ctx context.Context, node Node) error
}

type ProfileRepository interface {
	Create(ctx context.Context, profile Profile) error
	GetByID(ctx context.Context, id string) (Profile, error)
	ListEnabled(ctx context.Context) ([]Profile, error)
	ListAll(ctx context.Context) ([]Profile, error)
	Update(ctx context.Context, profile Profile) error
}
