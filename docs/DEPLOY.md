# Deploy on a home server (Docker / Portainer)

The worker must run on a **residential connection**: ClubSpark's Cloudflare
blocks datacenter IPs (CLUBSPARK.md §1). A home server is ideal. It only
connects out, to Temporal and ClubSpark, so nothing needs port-forwarding.

Two stack files, both in `deploy/stack/`:

| File | Use when |
|---|---|
| `docker-compose.yml` | You want Temporal in the same stack (SQLite-backed dev server + Web UI). |
| `worker-only.yml` | Temporal already runs somewhere; set `TEMPORAL_ADDRESS`. |

## Portainer

1. **Stacks → Add stack → Repository.**
2. Repository URL `https://github.com/andycqos74/whataracket`, reference
   the branch you deploy (e.g. `refs/heads/main`), compose path
   `deploy/stack/docker-compose.yml` (or `worker-only.yml`).
3. Environment variables (all optional unless noted):

   | Variable | Default | Notes |
   |---|---|---|
   | `NTFY_TOPIC_URL` | – | e.g. `https://ntfy.sh/<long-random-topic>`. Unset = log only. Treat the topic as a secret. |
   | `NTFY_TOKEN` | – | Only for a protected ntfy server. |
   | `TEMPORAL_ADDRESS` | – | **Required** for `worker-only.yml`, e.g. `192.168.1.20:7233`. |
   | `TEMPORAL_NAMESPACE` | `default` | worker-only |
   | `TEMPORAL_TASK_QUEUE` | `whataracket` | |
   | `TEMPORAL_UI_PORT` / `TEMPORAL_GRPC_PORT` | `8233` / `7233` | full stack: host ports |
   | `CLUBSPARK_ROLE` | – | Role whose booking horizon applies (e.g. `Guest`). Unset = shortest. |
   | `INSTALL_CHROMIUM` | `false` | `true` adds Chromium for phase 2 checkout. |

4. **Deploy the stack.** Portainer builds the worker image from the repo's
   `Dockerfile`. Turn on "Re-pull image and redeploy" / GitOps updates if you
   want pushes to redeploy.

Temporal Web UI: `http://<server>:8233`.

## Plain Docker Compose

```bash
docker compose -f deploy/stack/docker-compose.yml up -d --build
```

## Managing requests

Requests are JSON (see `deploy/requests/example.json` and the
`BookingRequest` type in `packages/domain/src/request.ts`). Use the CLI inside
the worker container (Portainer: container → Console, `/bin/sh`):

```bash
whataracket check '<json>'        # show what matches right now (calls ClubSpark once)
whataracket start '<json>'        # start watching; notifies new matching slots once each
whataracket list
whataracket status tue-thu-evenings
whataracket pause|resume|cancel tue-thu-evenings
whataracket update tue-thu-evenings '<json>'
```

Arguments can be the JSON itself or a file path, e.g. under the `/requests`
volume. From another machine, point `TEMPORAL_ADDRESS` at the server's gRPC
port and run `pnpm cli ...` from a checkout after `pnpm build`.

Phase 1 is **notify-only**: `"action": "notify"`. It never logs in or pays.

## Updating

Redeploy the stack (Portainer: "Pull and redeploy"). Running requests carry on,
because their state lives in Temporal. A change to workflow logic can break
replay of requests already running; if one gets stuck after an update, cancel
it and start it again. The only state lost is which slots were already notified.
