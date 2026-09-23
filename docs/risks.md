# Known Problems / Tradeoffs

1. Secrets storage

- Storing HMAC secrets directly in SQLite is convenient but weaker operationally.
- Prefer encrypted secret storage or file with strict permissions (`600`) in production.

2. Router resource constraints

- Poll intervals and active job volume can overload weak routers.
- Default conservative polling (10s) and cap concurrent node calls.

3. Single-node failure impact

- If one node is slow/unavailable, retries can block queue progress.
- Need bounded timeouts and backoff with per-node circuit-breaking behavior later.

4. Inconsistent status windows

- Node and router states can be briefly out-of-sync.
- Router should treat node as source of truth for active jobs and reconcile periodically.

5. LAN UI auth

- Assuming trusted LAN is risky.
- Add at least basic auth (nginx or app) before exposing broadly.

6. SQLite durability

- SQLite is fine for MVP, but write contention and corruption risk exist on unstable storage.
- Use WAL mode, backups, and graceful shutdown.

7. API evolution

- Node API currently has no batch get endpoint.
- Polling many jobs one-by-one may become expensive; batch API may be needed later.
