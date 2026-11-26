# Testing

- `npm test` runs every test on PGlite, PostgreSQL in the test process: no database server needed.
  CI also runs them on a real PostgreSQL, where concurrent requests really overlap.
- Tests call the API through `setup()` in `test/support.ts`: `call`, `book` and `venueWithTable`.
  The clock starts at `NOW` (Monday 23 November 2026, 09:00 UTC); move it with `clock.now`.
- Every change to a rule or an endpoint comes with tests for it, including the refusal and its
  message.
- `npm run typecheck` must pass.
