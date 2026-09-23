# Architecture

## Components

- **UI**: static SPA served by Nginx.
- **Router backend (`routerd`)**: control-plane API and scheduling.
- **SQLite**: local durable control-plane state.
- **Node agents**: remote workers that execute downloads.

## Data flow

- UI -> Router API
- Router -> Node API (signed, HMAC)
- Router poller -> Node status endpoints
- Router -> UI (aggregated and normalized state)

## Storage strategy

- Keep concise state fields in `jobs` (percent/speed/eta/message/output_path/error).
- Avoid storing verbose logs.

## Scheduling model

- MVP: simple policy (manual node selection or first healthy node).
- Poll active jobs every 10s by default.

## Boundaries

- Router does not run download processes.
- Node does not call back router.
