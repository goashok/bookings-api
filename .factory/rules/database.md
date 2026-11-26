# Database

- Schema changes go in a new file in `migrations/`, numbered after the last one
  (`002_<what>.sql`). Never edit a migration already on `main`; it has run in production.
- Add every new table to the `TRUNCATE` list in `test/support.ts`, or rows leak between tests.
- A check that must hold across requests (like "no two bookings overlap") runs in a transaction
  that locks the row it depends on, as `POST /bookings` does with the resource.
