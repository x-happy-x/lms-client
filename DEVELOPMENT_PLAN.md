# Development Plan

## Phase 1: Foundation

Goals:

- Build a minimal but runnable `routerd` service baseline.
- Lock core runtime contracts required by later phases (DB, config, lifecycle).
- Prepare strict compatibility with `lms-node` API and HMAC model.

Tasks:

- Initialize Go module and implement `cmd/routerd/main.go` with structured startup/shutdown flow.
- Add `internal/app` bootstrap:
  - load config from file/env
  - construct logger
  - wire SQLite, repositories placeholders, HTTP server placeholders, scheduler placeholders
- Define `internal/app/config` schema with MVP settings:
  - `http.listen_addr`
  - `sqlite.path`
  - `sqlite.busy_timeout_ms`
  - `scheduler.poll_interval` (default 10s)
  - `nodes.default_request_timeout`
- Implement SQLite lifecycle in `internal/store/sqlite`:
  - open DB with WAL mode enabled
  - run migrations from `internal/store/sqlite/migration`
  - health-check ping on startup
  - graceful close on shutdown
- Add migration runner with monotonic version tracking (`schema_migrations` table).
- Add minimal `/api/ui/system/health` and `/api/ui/system/version` stubs in `internal/http` for operational checks.
- Add Makefile targets for fast local checks:
  - `make run`
  - `make test`
  - `make lint` (or placeholder if linter is not connected yet)
- Add smoke test for startup path:
  - app starts with empty DB
  - migrations apply once and are idempotent
  - health endpoint returns `200`

Exit criteria:

- `routerd` starts locally and serves health/version endpoints.
- SQLite DB file is created, WAL is active, migrations are applied exactly once.
- Config is validated at boot with clear fail-fast errors for missing/invalid values.
- Foundation is ready for Phase 2 without refactoring bootstrap or DB initialization.

## Phase 2: Domain and Store

- Define `Job`, `Node`, `Profile` domain models.
- Define statuses and transition rules.
- Implement SQLite repos + tests.

## Phase 3: Node Client (HMAC)

- Implement signing helper (Variant A).
- Implement node API calls: create/get/cancel.
- Add retry/backoff policy.

## Phase 4: Scheduler

- Dispatcher: assign queued job to node.
- Poller: refresh active jobs periodically.
- Cancel propagation and local reconciliation.

## Phase 5: Router HTTP API

- `POST /api/ui/jobs`
- `GET /api/ui/jobs`
- `GET /api/ui/jobs/{id}`
- `POST /api/ui/jobs/{id}/cancel`
- `GET/POST /api/ui/nodes`
- `GET/POST /api/ui/profiles`

## Phase 6: UI

- Jobs table + details.
- Create job form.
- Nodes/profiles settings pages.
- Polling from router API.

## Phase 7: Deployment

- Nginx config for static + `/api` proxy.
- Entware init script for `routerd`.
- release packaging checklist.

## Phase 8: Hardening

- auth for UI (basic auth or session).
- input validation and safer defaults.
- structured logging and operational docs.
