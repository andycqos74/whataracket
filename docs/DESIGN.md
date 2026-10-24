# Design

Monitor ClubSpark for court slots that match a request, and book and pay for
them as soon as they are available.

## 1. Why Temporal

The work here is mostly waiting, then one action that must never happen twice.
- A request lives for days or weeks. Durable timers survive restarts and
  deploys.
- Signals and queries let you pause, edit or cancel a request, or ask what it
  has seen, without a database.
- A booking that times out after payment must not be retried blindly. Activity
  history plus a "do I already hold this?" check gives exactly-once booking.
- 3-D Secure needs a human. A workflow can wait for a signal with a deadline.

## 2. Components

```
packages/domain      pure: BookingRequest, slot matching, release-window maths
packages/clubspark   I/O: availability over HTTPS; login + checkout via Playwright
packages/activities  Temporal activities wrapping clubspark + notifications
packages/workflows   BookingRequestWorkflow (deterministic, lint-enforced)
apps/worker          worker process (runs at home, see §8)
```

ESLint fails the build if workflow or domain code reads the clock, does I/O,
touches `process`, or imports the ClubSpark client.

## 3. Booking request (parameters)

| Field | Example | Notes |
|---|---|---|
| venue | `ParliamentHillFieldsTennisCourts` | ClubSpark segment |
| courts | any / `["Court 3", "Court 4"]` | preference order |
| days | Tue, Thu | |
| window | 18:00–20:00 | earliest start, latest end |
| duration | 60 min | merged from adjacent cells |
| dateRange | 2026-11-01 → 2026-12-20 | |
| maxPricePence | 1500 | court + lighting |
| mode | `once` / `recurring` | recurring = one booking per matching date |
| pollEvery | 5 min | cancellations; ± jitter |
| notify | ntfy topic | |

## 4. Workflow

```
BookingRequestWorkflow(request)
  settings = activity getSettings(venue)                # booking horizon + release time
  loop until done / cancelled / dateRange passed:
    if next release time is near:
      sleep until release − few seconds                 # be first at release
    sessions = activity getAvailability(venue, dates)   # HTTPS GET, no login
    match    = pickSlot(sessions, request, settings)    # pure (domain)
    if match:
      outcome = activity bookAndPay(match, bookingKey)  # Playwright
      if outcome = NeedsCardholder → notify, await signal 'approved' (≤ hold expiry)
      if outcome = Unknown         → activity findMyBooking(match) before any retry
      notify(outcome)
    sleep(pollEvery ± jitter)
  continueAsNew periodically to keep history small
```

Signals: `pause`, `resume`, `cancel`, `updateRequest`, `cardholderApproved`.
Queries: `status` (last poll, last seen slots, bookings made).

As built in phase 1 (`packages/workflows/src/booking-request.ts`):
- **Time** comes from a `now` local activity, recorded in history, so the
  workflow never reads the clock itself.
- **Notify-only:** each matching slot is announced once (tracked by
  `date|court|start`); polling continues until the date range passes or the
  request is cancelled. `mode` matters only once booking exists.
- **Release time:** when the next release opens a wanted date, the workflow
  polls `releaseDelaySeconds` (default 3) *after* it, since a poll before it
  cannot see the new day. Phase 2 can add an earlier wake-up to log in first.
- **No wanted date bookable yet:** no request is sent; it sleeps to the next release.
- **Cloudflare block:** one notification, then a one-hour back-off.

## 5. Never double-book, never double-pay

- `bookAndPay` has **no automatic retries** once checkout has started. It
  reports `Booked`, `Failed(before payment)`, `NeedsCardholder` or `Unknown`.
- `Unknown` (timeout or crash mid-checkout) always triggers `findMyBooking`
  against the account's bookings before anything else happens.
- Pre-payment steps (login, select slot) retry freely.
- `recurring` mode records each booked date in workflow state and never books
  the same date twice.

## 6. Payment: card at checkout (open decisions)

The venue takes card payment at checkout, probably through Stripe.
- **3-D Secure.** If the bank challenges, the bot cannot complete it. Plan:
  the activity detects the challenge, keeps the page open, notifies you to
  approve in your banking app, and waits for completion or a
  `cardholderApproved` signal until the hold expires.
- **Card details.** *Decision needed:*
  1. a card saved on the ClubSpark/Stripe account, if supported (best: no
     card data on our side);
  2. card details in worker secrets (env or file), entered into the Stripe
     form by Playwright. They are never logged and never in workflow history.
- A spend cap (`maxPricePence` per booking, plus a per-request total) is checked
  before payment.

## 7. Notifications

Phase 1 uses [ntfy](https://ntfy.sh) push to your phone (`NTFY_TOPIC_URL`),
and falls back to the worker log when it is unset. It is free, needs no
account, and supports action buttons, so "Approve done" can send the
`cardholderApproved` signal. Alternatives: email, Telegram.

## 8. Where it runs

- **Temporal server**: anywhere. Locally use `pnpm temporal:dev`. In production,
  your existing self-hosted Temporal.
- **Worker**: on a **residential connection** (home machine, Pi or home server),
  because ClubSpark's Cloudflare blocks datacenter IPs (CLUBSPARK.md §1). The
  worker connects out to Temporal, so nothing at home needs to be exposed.
- The worker needs Chromium for Playwright.

## 9. Secrets and history

- Credentials and card details are read by activities from the worker
  environment only. Workflow inputs carry the request parameters, nothing else.
- A payload codec (encryption) for Temporal history, like the lottery's, is
  planned so booking details are not plain text in the Temporal UI.

## 10. Politeness

- Poll every few minutes for cancellations, never in seconds; add jitter.
- At release time, one well-timed request, not a burst.
- Availability calls go out without a session; the login session is reused
  and refreshed only on expiry.
