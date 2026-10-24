# Build plan

The repository is scaffolded. Nothing below is built yet.

## Phase 0: capture the real flow (needs you, at home)

The container that wrote this cannot reach ClubSpark (CLUBSPARK.md §1).
- [ ] `tools/capture`: a Playwright script that opens a **visible** browser and
      records network requests while you log in and book one slot by hand.
      Before saving, it strips cookies, auth headers, tokens and card fields.
- [ ] Run it at home against Parliament Hill Fields; commit the redacted
      fixtures (`packages/clubspark/fixtures/`).
- [ ] Record `GetSettings` and a week of `GetVenueSessions` for the venue as
      test fixtures.
- [ ] Answer CLUBSPARK.md §4–5: login flow, hold/checkout requests, Stripe,
      3-D Secure, "my bookings".
- [ ] Decide DESIGN §6 (card details) and §7 (notifications).

## Phase 1: watch (no booking)

- [ ] `domain`: `BookingRequest` type, release-window maths, `pickSlot`
      (merging adjacent cells, price cap, court preference). Unit and property tests.
- [ ] `clubspark`: `getSettings`, `getAvailability` over `node:https`; parse
      into domain types; fixture tests.
- [ ] `workflows`: `BookingRequestWorkflow` in **notify-only** mode: poll, match,
      notify. Time-skipping workflow tests.
- [ ] `worker` + a small CLI to start, cancel and query requests.
- [ ] Run it at home for a few days to confirm the matches are right.

## Phase 2: book and pay

- [ ] `clubspark`: login (session reuse), `bookAndPay`, `findMyBooking`.
- [ ] 3-D Secure handling plus the `cardholderApproved` signal.
- [ ] Exactly-once guarantees (DESIGN §5) with workflow tests for timeouts mid-checkout.
- [ ] First real booking supervised, on a cheap off-peak slot.

## Phase 3: run it properly

- [ ] Payload codec for Temporal history.
- [ ] Worker as a service (systemd or Docker) at home, pointed at your Temporal.
- [ ] Release-time mode tuned against the venue's real release time.
