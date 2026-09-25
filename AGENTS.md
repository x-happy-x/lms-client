# AGENTS.md

This repository contains the **Router Control Plane** for the LMS download system.

## System Role

- Runs on home router (Entware) behind LAN/Nginx.
- Provides UI + lightweight backend.
- Stores control-plane state (`jobs`, `nodes`, `profiles`) in SQLite.
- Pushes jobs to remote Node agents over HTTPS using HMAC auth (Variant A).
- Polls node job status and exposes normalized state for UI.

Router responsibilities only:

- Dispatching, scheduling, status aggregation.
- Managing node/profile metadata.
- Serving UI API for LAN clients.
- Streaming finished job files and media previews from nodes to LAN clients
  (`GET /api/ui/jobs/{id}/file`, `/preview`), without storing them on the router.

Router does **not**:

- Download files from the internet itself (nodes do).
- Keep copies of job files: file/preview requests are proxied as streams.
- Store large logs/artifacts.
- Replace fail2ban/nginx security concerns on nodes.

---

## MVP Goals

1. Implement backend API for UI:
   - create/list/get/cancel jobs
   - manage nodes
   - manage profiles
2. Implement robust node client:
   - signed `POST /api/jobs`
   - signed `GET /api/jobs/{id}`
   - signed `POST /api/jobs/{id}/cancel`
   - signed `GET /api/jobs/{id}/file` (Range) and `/preview` for streaming to LAN clients
3. Implement background poller (default every 10s) for active jobs.
4. Store all control-plane state in SQLite.
5. Ship a deployable single backend binary (`routerd`) + static UI.

---

## Non-goals (MVP)

- No caching or transcoding of files on the router (streaming proxy only).
- No heavy analytics.
- No distributed queue.
- No long-term logs retention.

---

## Recommended Stack

- Backend: Go (single binary, low memory footprint)
- DB: SQLite
- UI: Vite + React static bundle
- Reverse proxy: Nginx (Entware)

---

## Project Layout

- `cmd/routerd` - backend entrypoint
- `internal/app` - wiring/config/bootstrap
- `internal/http` - router API used by UI
- `internal/domain` - core models and contracts
- `internal/store/sqlite` - repositories + migrations
- `internal/scheduler` - dispatcher/poller/retry
- `internal/nodes` - remote node client + HMAC signing
- `web/ui` - frontend sources
- `deploy` - nginx/entware deployment files
- `docs` - architecture, API, risks

---

## Definition of Done (MVP)

- UI can create job and observe progress through router API.
- Router pushes job to selected node and tracks `remote_job_id`.
- Poller updates active jobs from node state.
- Cancel from UI propagates to node and local state.
- HMAC signing works for all node requests.
- Router startup and restart preserve state via SQLite.

---

## Deployment Notes

- Local client domain: `https://lms.local/`
- After changes affecting router/backend/UI/deploy config, deploy the updated client service.
- After deployment, verify that `https://lms.local/` responds successfully.
