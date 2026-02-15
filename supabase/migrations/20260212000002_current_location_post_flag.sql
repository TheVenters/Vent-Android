-- Marks posts that were created using the poster's current location
alter table public.pins
  add column if not exists posted_from_current_location boolean not null default false;
