# List a guest's upcoming bookings by email address

Spec `spec_05ee6946-d321-45e3-9c22-c1fc68c2a61a` version 1, from https://github.com/goashok/bookings-api/issues/1. Approved by goashok on 2026-11-26.

### Problem
Front-desk staff can't answer a guest who asks "what have I booked?" without looking through each venue's bookings day by day. They need to look up a guest's upcoming bookings by email address. The lookup returns only confirmed bookings that haven't ended, soonest first, with the venue and the table or room named.

### Acceptance criteria
1. `GET /bookings?guestEmail=<address>` answers 200 with `{ "guestEmail": <the address as requested>, "bookings": [...] }`, the same object-wrapping style as `GET /venues/:id/bookings`.
2. The bookings are those whose `guest_email` equals the address ignoring case, so `Ada@Example.com` finds a booking made with `ada@example.com`, and the reverse.
3. Only bookings with status `confirmed` are listed, so a cancelled booking never appears.
4. Only bookings whose `endsAt` is later than the app's `now` are listed, so a booking in progress is listed and one ending exactly at `now` or earlier is not.
5. The bookings are ordered by `startsAt` ascending, and bookings with the same start are ordered by resource name, then id.
6. Each booking has all the existing booking fields (`id`, `resourceId`, `guestName`, `guestEmail`, `partySize`, `startsAt`, `endsAt`, `status`, `createdAt`, `cancelledAt`), shaped as in `GET /bookings/:id`.
7. Each booking also has `venueId`, `venueName`, and `resourceName`, which are the venue's name and the name of the table or room, as strings that are always present.
8. Each booking also has the venue's `timeZone` as a string, so staff can read the times locally.
9. An address with no matching upcoming bookings, or one never seen before, answers 200 with `"bookings": []`, not an error.
10. A request without `guestEmail`, or with an empty `guestEmail`, answers 400 `invalid_request`.
11. The query uses the existing `lower(guest_email)` index by comparing `lower(guest_email) = lower($1)`, with `$1` as a parameter.
12. The README's endpoint table lists the new endpoint, and no new migration or error code is needed.
13. Tests cover: a case-insensitive match in both directions; a cancelled booking excluded; a past booking excluded; a booking in progress included (moving `clock.now`); ordering across several venues; the venue and resource names in the response; another guest's bookings excluded; the empty list; and the 400 for a missing or empty `guestEmail`. `npm test` and `npm run typecheck` pass.

### Out of scope
- Past or cancelled bookings, or a status filter.
- Pagination, limits, or a date range filter.
- Looking up by guest name or phone.
- Authentication or limiting who may look up an address.
- Changing how emails are stored, such as normalising case on write.
- Cancelling bookings from the list.

### Assumptions
- The endpoint is `GET /bookings?guestEmail=...`. The request named no route, and this is the only collection-style route that fits without clashing with `/bookings/:id`.
- "Hasn't ended yet" means `ends_at > now`, so a booking in progress counts as upcoming.
- "The table or room" is the resource's `name`, exposed as `resourceName`. Venue id, resource id and time zone are included as well as the names, because the request said "not just ids".
- The email is trimmed of surrounding whitespace before matching, as `POST /bookings` trims it on write. Matching is case-insensitive only, with no other normalisation such as plus-addressing.
- A malformed address, one with no `@`, is not rejected. It matches nothing and returns an empty list, because the request says an address with no bookings gets an empty list.
- The response is the full list with no cap, since one guest's upcoming bookings are expected to be few.
- No new field can be null: the added fields are always present strings, as the venue and resource always exist. `bookings` is `[]` when nothing is found, not null, and `cancelledAt` stays null for confirmed bookings, as in the existing API.
