package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"time"

	"lms-router-control-plane/internal/app/config"
	httpapi "lms-router-control-plane/internal/http"
	"lms-router-control-plane/internal/nodes"
	"lms-router-control-plane/internal/scheduler"
	"lms-router-control-plane/internal/store/sqlite"
)

type App struct {
	cfg     config.Config
	logger  *slog.Logger
	version string

	db         *sqlite.DB
	httpServer *http.Server

	jobRepo     *sqlite.JobRepository
	nodeRepo    *sqlite.NodeRepository
	profileRepo *sqlite.ProfileRepository
	nodeClient  *nodes.Client
	scheduler   *scheduler.Service
}

func New(ctx context.Context, cfg config.Config, logger *slog.Logger, version string) (*App, error) {
	db, err := sqlite.Open(ctx, cfg.SQLite)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	if err := sqlite.RunMigrations(ctx, db.SQL); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	jobRepo := sqlite.NewJobRepository(db.SQL)
	nodeRepo := sqlite.NewNodeRepository(db.SQL)
	profileRepo := sqlite.NewProfileRepository(db.SQL)
	nodeClient := nodes.NewClient(nodes.ClientConfig{
		DefaultTimeout: cfg.Nodes.DefaultRequestTimeout,
		MaxAttempts:    3,
		BackoffBase:    200 * time.Millisecond,
		Rand:           rand.New(rand.NewSource(time.Now().UnixNano())),
	})
	schedulerSvc := scheduler.NewService(
		jobRepo,
		nodeRepo,
		nodeClient,
		scheduler.Config{PollInterval: cfg.Scheduler.PollInterval},
		logger,
	)
	handler := httpapi.NewHandler(httpapi.Dependencies{
		DB:            db.SQL,
		Version:       version,
		JobRepo:       jobRepo,
		NodeRepo:      nodeRepo,
		ProfileRepo:   profileRepo,
		JobController: schedulerSvc,
		NodeClient:    nodeClient,
		StaticDir:     staticDir(),
	})

	httpServer := &http.Server{
		Addr:              cfg.HTTP.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	return &App{
		cfg:         cfg,
		logger:      logger,
		version:     version,
		db:          db,
		httpServer:  httpServer,
		jobRepo:     jobRepo,
		nodeRepo:    nodeRepo,
		profileRepo: profileRepo,
		nodeClient:  nodeClient,
		scheduler:   schedulerSvc,
	}, nil
}

func staticDir() string {
	if value := os.Getenv("ROUTERD_STATIC_DIR"); value != "" {
		return value
	}
	if _, err := os.Stat("/opt/routerd/static/index.html"); err == nil {
		return "/opt/routerd/static"
	}
	return "web/ui/dist"
}

func (a *App) Run(ctx context.Context) error {
	errCh := make(chan error, 1)

	a.logger.Info("starting routerd",
		"addr", a.cfg.HTTP.ListenAddr,
		"sqlite_path", a.cfg.SQLite.Path,
		"poll_interval", a.cfg.Scheduler.PollInterval.String(),
		"version", a.version,
	)

	go func() {
		err := a.httpServer.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
	}()

	go func() {
		if err := a.scheduler.Run(ctx); err != nil {
			errCh <- err
			return
		}
	}()

	select {
	case <-ctx.Done():
		a.logger.Info("shutdown signal received")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := a.httpServer.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown http server: %w", err)
		}
		if err := a.db.Close(); err != nil {
			return fmt.Errorf("close sqlite: %w", err)
		}
		return nil
	case err := <-errCh:
		if err != nil {
			_ = a.db.Close()
			return fmt.Errorf("http server: %w", err)
		}
		if closeErr := a.db.Close(); closeErr != nil {
			return fmt.Errorf("close sqlite: %w", closeErr)
		}
		return nil
	}
}
