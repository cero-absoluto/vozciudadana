# Isolated PostgreSQL quota rehearsal

Runs the proposed SQL against a fresh disposable PostgreSQL 17.6 cluster on loopback port 55450. Accepts no production connection URL; generates its own local password without printing it and removes its own temporary cluster after stopping it. The launcher and namespace UID adapter derive from the earlier reviewed census/push harness. The adapter affects OS ownership reporting only, not SQL roles, isolation or locks.

Dependencies are pinned separately: @embedded-postgres/linux-x64 17.6.0-beta.15 and pg 8.16.3. Existing local copies were reused; no application dependency changes. Run `node launch.mjs` as an ordinary user. In the restricted single-UID test namespace, use the explicitly guarded CENSUS_ALLOW_NAMESPACE_UID_ADAPTER=1 and the CENSUS_NATIVE_BIN_MODULE / CENSUS_NATIVE_PG_MODULE file URLs pointing to the existing pinned test packages.

The test uses synthetic OTP rows, multiple independent SQL connections and an observed advisory-lock wait to exercise concurrent quota spending and SMS reservations. Browser roles are denied both functions and bucket data. The cron.schedule adapter tests the cleanup SQL construction and duplicate-name guard, not an actual pg_cron worker; real scheduling remains a deployment verification step.
