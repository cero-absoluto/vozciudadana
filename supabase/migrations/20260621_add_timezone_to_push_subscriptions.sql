-- Migration: add timezone to push_subscriptions
--
-- Used by the hourly push job to avoid sending 'closing' notifications
-- to participants who are asleep (23:00–07:00 local time).
-- The timezone is captured from the browser's Intl.DateTimeFormat API
-- at subscription time and stored as an IANA timezone string
-- (e.g. 'Europe/Madrid', 'Pacific/Auckland').

alter table push_subscriptions
  add column if not exists timezone text default null;

comment on column push_subscriptions.timezone is
  'IANA timezone string (e.g. Europe/Madrid) captured at subscription time.
   Used to suppress closing notifications during nighttime hours (23:00–07:00 local).';
