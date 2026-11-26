# Conventions

- TypeScript that Node runs directly (Node 22.18 or later): erasable syntax only, so no `enum`,
  `namespace` or constructor parameter properties. Import local files with their `.ts` extension.
- One file per area: `venues.ts`, `bookings.ts`. Routes, rules and SQL for an area live together.
- Times: store instants (`timestamptz`), and read opening hours and dates in the venue's own time
  zone with the helpers in `src/time.ts`. Never use the server's local time.
- Get the time from the `now` the app was built with, never `new Date()` in a route, so tests can
  fix it.
- Errors a caller can act on are `ApiError`s (`src/errors.ts`): `notFound`, `ruleBroken` (422) or
  `conflict` (409), each with a stable `error` code and a `message` written for a person. Add new
  codes to the README's list.
- SQL is written by hand, with `$1` parameters; never build a query from request text.
