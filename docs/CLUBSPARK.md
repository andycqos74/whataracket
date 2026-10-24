# ClubSpark — what we know

Target venue: **Parliament Hill Fields Tennis Courts**
<https://clubspark.lta.org.uk/ParliamentHillFieldsTennisCourts>
Venue segment: `ParliamentHillFieldsTennisCourts` · host `clubspark.lta.org.uk`

Status key: ✅ confirmed by working third-party code checked against the live
site (September 2026) · ❓ not yet seen · ⚠️ risk.

None of this has been checked against Parliament Hill Fields itself. The
build starts by capturing it (see [BUILD-PLAN.md](BUILD-PLAN.md), phase 0).

## 1. Network access ⚠️

ClubSpark is behind Cloudflare. From a cloud container (datacenter IP) every
request (curl and real headless Chromium alike) gets a hard
"Sorry, you have been blocked" page. Community projects run from home
connections and get through; one found that Node's global `fetch` is challenged
while a plain `node:https` request is not.

**Consequence:** the worker that talks to ClubSpark runs on a residential
connection. We do not attempt to defeat Cloudflare. If a home connection gets
challenged too, we stop and reconsider rather than escalate.

## 2. Availability ✅ (no login)

```
GET https://clubspark.lta.org.uk/v0/VenueBooking/ParliamentHillFieldsTennisCourts/GetVenueSessions
    ?resourceID=&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&roleId=
```

(Venues hosted on their own domain use a different URL form. That doesn't
apply here, since Parliament Hill Fields is on `clubspark.lta.org.uk`.)

Response shape (trimmed):

```jsonc
{
  "TimeZone": "Europe/London",
  "EarliestStartTime": 420,          // minutes from midnight (07:00)
  "LatestEndTime": 1320,             // 22:00
  "MinimumInterval": 30,             // slot granularity, minutes
  "ResourceGroups": [{ "ID": "…", "Name": "default" }],
  "Resources": [{
    "ID": "4869094a-…",              // court id
    "Name": "Crt 1",
    "Category": 1,                   // 1 = tennis court, 9 = cricket net
    "Lighting": 1,
    "Days": [{
      "Date": "2026-09-19T00:00:00",
      "Sessions": [{
        "ID": "f827f74b-…",
        "Category": 1000,            // see table
        "SubCategory": 0,
        "Name": "Booking",
        "StartTime": 420, "EndTime": 480, "Interval": 60,
        "CourtCost": 10.40, "LightingCost": 0.00,
        "MemberPrice": 0.0, "GuestPrice": 0.0,
        "Recurrence": false
      }]
    }]
  }]
}
```

| Session `Category` | Meaning |
|---|---|
| `0` **with a price** | Free to book (the cell shows the price) |
| `0` without a price | Not bookable: skip |
| `1000` | Existing booking: taken, despite the name "Booking" |
| `2000` | Coaching |
| `4000` | Club |
| `7000` | Maintenance |
| `8000` | Closed |

Notes:
- Prices are decimal pounds in JSON. Convert to integer pence at the boundary.
- Adjacent free sessions on one court merge into longer blocks; a 60-minute
  booking may be two 30-minute cells.
- The API returns priced cells **beyond** the bookable horizon. The booking page
  greys them out using `GetSettings` (below), and so must we.

## 3. Booking window ✅ (no login)

```
GET /v0/VenueBooking/ParliamentHillFieldsTennisCourts/GetSettings
```

- `Roles[].AdvancedBookingPeriod` is the number of days ahead a role may book (7 at
  the venues checked).
- `NewDayBookingAvailabilityTime` is the minute of the day the furthest day opens
  (1200 = 20:00 at the venues checked).
- Rule from the site's own `comp-booking.js`: a day is bookable when
  `0 <= daysAhead <= AdvancedBookingPeriod`, and the furthest day only from
  `NewDayBookingAvailabilityTime` onwards.

Which role applies to us (guest vs member) ❓. It depends on the account.

## 4. Login ❓

Expected: LTA / British Tennis account, a hosted sign-in that redirects back to
ClubSpark. Unknown: the exact flow, MFA, how long the session lasts, and which cookie
carries it.

## 5. Booking and checkout ❓ ⚠️

Not covered by any public project. Expected: select a cell, then a booking
summary, then card checkout (very likely Stripe), then confirmation. Unknown:
- the request(s) that place a hold, and how long a hold lasts;
- whether a card can be saved on the account;
- whether **3-D Secure** challenges appear. Card-at-checkout makes this the main
  risk: a challenge needs the cardholder;
- how to read back "my bookings" (needed for safe retries, see DESIGN §5).

## 6. Terms ⚠️

No explicit ClubSpark ban on automation found. Venues set their own booking
terms. Check Parliament Hill Fields' rules (City of London) before relying on
the tool.

## Sources

- [sakkyb/discordmcp PR #26](https://github.com/sakkyb/discordmcp/pull/26): watcher for three LTA venues; category table, `GetSettings` rule, Cloudflare note
- [tagapagcodebley/tennis-courtship](https://github.com/tagapagcodebley/tennis-courtship): Python watcher using `GetVenueSessions`
- [pdd27673/10s-court-monitor](https://github.com/pdd27673/10s-court-monitor): multi-venue monitor (ClubSpark scraper)
