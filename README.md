# bookings-api

Bookings for venues: the tables, rooms or courts in them, and the times people book them. A small
HTTP API in TypeScript on Node, with PostgreSQL.

This repository is also where [Cradleworks](https://github.com/goashok/cradleworks) shows its
work: issues labelled `factory` are taken from a spec to a reviewed pull request by the factory,
with a person approving the spec and the change. Its settings are in `.factory/`.

## Run it

```sh
npm ci
docker compose up -d                       # a local PostgreSQL on port 5433
DATABASE_URL=postgres://bookings:bookings@localhost:5433/bookings npm start
```

The API listens on port 3000 (`PORT`) and applies any new migrations when it starts
(`npm run migrate` applies them alone).

## Test it

```sh
npm test                 # every test, on PGlite: PostgreSQL inside the test process
npm run typecheck
TEST_DATABASE_URL=postgres://… npx vitest run --no-file-parallelism   # the same tests on a real PostgreSQL
```

CI runs all three on every pull request.

## The API

Request and response bodies are JSON. Times are instants with an offset
(`2026-11-26T19:00:00Z`); a venue's opening hours and dates are in its own time zone.

| Endpoint | What it does |
| --- | --- |
| `GET /health` | `{ ok: true }` when the database answers |
| `POST /venues` | `{ name, timeZone, opensAt, closesAt }`, with an IANA time zone and `HH:MM` times |
| `GET /venues/:id` | a venue |
| `POST /venues/:id/resources` | `{ name, capacity }`: a table, room or court in the venue |
| `GET /venues/:id/resources` | the venue's resources, by name |
| `POST /bookings` | `{ resourceId, guestName, guestEmail, partySize, startsAt, endsAt }` |
| `GET /bookings?guestEmail=` | the guest's confirmed bookings that haven't ended, soonest first, with venue and resource names and the venue's time zone |
| `GET /bookings/:id` | a booking |
| `POST /bookings/:id/cancel` | cancels a confirmed booking |
| `GET /venues/:id/bookings?date=YYYY-MM-DD` | the confirmed bookings starting on that local day |
| `GET /resources/:id/availability?date=YYYY-MM-DD&minutes=60` | free times that day, every 15 minutes |

A booking must start in the future, last 15 minutes to 4 hours in steps of 15 minutes, fit the
party into the resource, fall within the venue's opening hours, and not overlap another confirmed
booking of the same resource.

### Errors

Every error is `{ "error": "<code>", "message": "<words for a person>" }`.

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | the body or query doesn't match the endpoint |
| 404 | `not_found` | no such venue, resource, booking or endpoint |
| 409 | `already_booked` | the resource is booked at an overlapping time |
| 409 | `already_cancelled` | the booking was cancelled before |
| 422 | `unknown_time_zone`, `invalid_opening_hours`, `duplicate_resource` | a venue or resource that can't be made |
| 422 | `invalid_time`, `invalid_duration`, `in_the_past`, `party_too_large`, `outside_opening_hours` | a booking that breaks a rule |
| 422 | `invalid_date` | a date that isn't on the calendar |

## Layout

```text
src/app.ts         the HTTP app: routes and error handling
src/venues.ts      venues and resources
src/bookings.ts    bookings, cancelling, a venue's day, availability
src/time.ts        local times in a venue's time zone
src/db.ts          the database: queries and transactions
src/migrate.ts     applies migrations/*.sql
test/              the tests, and test/support.ts which sets them up
```
