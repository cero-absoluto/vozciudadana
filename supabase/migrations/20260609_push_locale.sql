-- Migration: Add locale column to push_subscriptions
-- Date: 2026-06-09
-- Purpose: Store user language preference with push subscription
--          so notifications can be sent in the user's language.

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'en';

COMMENT ON COLUMN push_subscriptions.locale IS
  'User language preference at time of subscription. Used to send notifications in the correct language.';
