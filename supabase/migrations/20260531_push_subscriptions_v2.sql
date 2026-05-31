ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS protest_id UUID REFERENCES protests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_push_protest ON push_subscriptions(protest_id);
CREATE INDEX IF NOT EXISTS idx_push_ends ON push_subscriptions(ends_at);
