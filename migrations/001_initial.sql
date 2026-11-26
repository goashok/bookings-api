-- Venues, the things in them people book (tables, rooms), and the bookings.

CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- An IANA time zone, such as Europe/London: opening hours and dates are in it.
  time_zone text NOT NULL,
  -- Opening hours, the same every day, as local wall-clock times.
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  name text NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, name)
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  guest_email text NOT NULL,
  party_size integer NOT NULL CHECK (party_size > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CHECK (ends_at > starts_at)
);

CREATE INDEX bookings_resource_time ON bookings (resource_id, starts_at);
CREATE INDEX bookings_guest_email ON bookings (lower(guest_email));
