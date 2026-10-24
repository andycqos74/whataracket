# Setup

## Prerequisites

- Node 22 (`.nvmrc`) and pnpm 10 (`corepack enable`)
- Docker, for the local Temporal dev server
- A residential internet connection for anything that talks to ClubSpark

## Install and verify

```bash
pnpm install
pnpm typecheck
pnpm typecheck:tests
pnpm lint      # includes the workflow determinism rules
pnpm test
```

CI runs the same four steps on every push. CI never calls ClubSpark.

## Local Temporal

```bash
pnpm temporal:dev          # gRPC on localhost:7233, Web UI on http://localhost:8233
```

## Playwright browser

Browsers are not downloaded on install. When the ClubSpark client is built:

```bash
pnpm --filter @whataracket/clubspark exec playwright install chromium
```

## Secrets

```bash
cp .env.example .env       # fill in; .env is git-ignored
```

Credentials and card details live only in the worker's environment. Never put
them in workflow inputs, logs, fixtures or commits.
