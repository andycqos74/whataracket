# whataracket

Watches a ClubSpark venue for tennis court slots that match your request, then
books and pays for them as soon as they come free, either at the venue's daily
release time or when someone cancels.

Built on Temporal: each booking request is a long-running workflow that polls,
sleeps durably, books exactly once, and waits for you when your bank wants to
approve a payment.

**Status:** scaffolded, not built. See [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md).

- [docs/DESIGN.md](docs/DESIGN.md): architecture, workflow, payment, open decisions
- [docs/CLUBSPARK.md](docs/CLUBSPARK.md): the ClubSpark API as far as it is known
- [docs/SETUP.md](docs/SETUP.md): install, local Temporal, secrets

Target venue: [Parliament Hill Fields Tennis Courts](https://clubspark.lta.org.uk/ParliamentHillFieldsTennisCourts).

## Layout

```
packages/domain      pure booking rules (imported by workflows)
packages/clubspark   ClubSpark client: HTTPS availability, Playwright checkout
packages/activities  Temporal activities
packages/workflows   Temporal workflows
apps/worker          worker process; runs on a home connection
deploy/compose       local Temporal dev server
```

## Rules

1. **Workflow and domain code does no I/O, reads no clock, and touches no
   environment.** `pnpm lint` enforces it.
2. **Never double-book or double-pay.** Checkout is never retried blindly. An
   unknown outcome is resolved by reading the account's bookings first.
3. **Secrets stay in the worker environment.** Never in workflow inputs,
   history, logs, fixtures or commits.
4. **Be polite to ClubSpark.** Poll every few minutes with jitter, and never
   try to defeat Cloudflare.
