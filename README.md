# LMS Router Control Plane (`lms-client`)

Control-plane service for home router (Entware): UI + lightweight API + SQLite.

## What it does

- Accepts UI requests to create and manage jobs.
- Selects a remote node and pushes job to node API.
- Polls active jobs from node API and syncs status/progress.
- Serves normalized data for UI.

## Planned repository structure

See `AGENTS.md` and `docs/architecture.md`.

## Planned MVP execution flow

1. UI sends `POST /api/ui/jobs` to router.
2. Router validates input, selects node/profile.
3. Router sends signed `POST /api/jobs` to selected node.
4. Router stores `remote_job_id` and marks local job as `RUNNING`.
5. Background poller refreshes active jobs every N seconds.
6. UI reads from router (`GET /api/ui/jobs`) only.

## Status

Bootstrap/planning stage. Implementation files are scaffolded but backend/UI logic is not yet coded.

## Router deploy scripts

Repository includes deploy scripts similar to `nginx-proxy-manager`:

- `scripts/deploy-routerd.env` - deploy target and behavior settings.
- `scripts/deploy-routerd.sh` - full deploy (build backend + UI + upload + restart).
- `scripts/deploy-routerd-fast.sh` - fast deploy (`SKIP_INSTALL=1`).
- `scripts/setup-router.sh` - run on router to link init/nginx files.

Quick start:

1. Copy and edit `scripts/deploy-routerd.env`.
2. Run `make deploy` (or `make deploy-fast`).
