# Source and push security release

The S3/S5 release pins source connections to validated public addresses and requires verified device possession for push subscription changes. Push endpoints are restricted to supported providers and their ownership is preserved atomically by `save_owned_push_subscription`.

Deploy the additive service-only RPC before the API, then publish the coordinated browser update. No real notification or OTP sends are part of release validation. Roll back API and web together if required; the unused service-only function may remain installed.

Validation for the reviewed runtime source: 413 Node tests passed, 2 skipped; 13 isolated PostgreSQL 17.6 checks passed; web build passed. Production delivery to every provider and IPv6 connectivity are not certified by these tests.

Deployment status is tracked separately; this document does not assert that the release is live.
