# Build plan

The repository is scaffolded. Nothing below is built yet.

## Phase 0: capture the real flow (needs you, at home)

The tool is built (`tools/capture`, see below); the captures are not done.

The container that wrote this cannot reach ClubSpark (CLUBSPARK.md §1).
- [x] `tools/capture`: a Playwright script that opens a **visible** browser and
      records network requests while you log in and book one slot by hand.
      Before saving, it strips cookies, auth headers, tokens and card fields.
- [ ] Run it at home against Parliament Hill Fields; commit the redacted
      fixtures (`packages/clubspark/fixtures/`).
      `pnpm capture fixtures` (public JSON) and `pnpm capture flow` (visible
      browser, writes to git-ignored `captures/`). First run
      `pnpm --filter @whataracket/capture exec playwright install chromium`.
- [ ] Record `GetSettings` and a week of `GetVenueSessions` for the venue as
      test fixtures.
- [ ] Answer CLUBSPARK.md §4–5: login flow, hold/checkout requests, Stripe,
      3-D Secure, "my bookings".
- [ ] Decide DESIGN §6 (card details). §7: ntfy is built; confirm it.

## Phase 1: watch (no booking)

- [x] `domain`: `BookingRequest` type, release-window maths, `pickSlot`
      (merging adjacent cells, price cap, court preference). Unit and property tests.
- [x] `clubspark`: `getSettings`, `getAvailability` over `node:https`; parse
      into domain types; fixture tests (synthetic until phase 0 captures land).
- [x] `workflows`: `BookingRequestWorkflow` in **notify-only** mode: poll, match,
      notify. Time-skipping workflow tests.
- [x] `worker` + a small CLI to start, cancel and query requests.
- [ ] Run it at home for a few days to confirm the matches are right.

## Phase 2: book and pay

- [ ] `clubspark`: login (session reuse), `bookAndPay`, `findMyBooking`.
- [ ] 3-D Secure handling plus the `cardholderApproved` signal.
- [ ] Exactly-once guarantees (DESIGN §5) with workflow tests for timeouts mid-checkout.
- [ ] First real booking supervised, on a cheap off-peak slot.

## Phase 3: run it properly

- [ ] Payload codec for Temporal history.
- [x] Worker as a service: Docker image and Portainer stacks (docs/DEPLOY.md),
      with or without a bundled Temporal.
- [ ] Release-time mode tuned against the venue's real release time.
