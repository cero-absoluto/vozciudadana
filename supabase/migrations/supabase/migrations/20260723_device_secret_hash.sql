-- VP-SEC-002 / VP-SEC-003 fix (23 July 2026)
-- A bare device_id used to act as a permanent bearer credential: anyone who
-- knew it could call GET /device/:id and receive that device's phone_hash
-- in clear, with no second factor at all. This column stores only an HMAC
-- of a random secret minted once, at first verification, and returned to
-- the client exactly that one time (never stored in recoverable form here,
-- never returned again by the API). Re-authenticating a returning device
-- now requires presenting that secret, not just its public device_id.

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS device_secret_hash TEXT;

-- Existing rows (created before this migration) have no secret and cannot
-- be retrofitted with one server-side — there is nothing to hash, since the
-- whole point is that the raw secret is only ever known by the client.
-- Their device_secret_hash stays NULL, which the reauth endpoint already
-- treats as "cannot re-authenticate" (falls through to a fresh OTP,
-- exactly as if the device had never been seen before). This is a graceful
-- degradation, not a break: existing users simply verify by SMS once more
-- the next time they return, then get a device_secret going forward.

COMMENT ON COLUMN devices.device_secret_hash IS
  'HMAC(device_secret, DEVICE_SECRET_PEPPER). The raw secret is never stored — only returned once to the client at first verification, in the response body of POST /verify-otp. NULL for devices created before 23 July 2026, which re-verify by SMS once more and receive a secret from that point on.';
