# Disposable PostgreSQL ownership rehearsal

Run `node launch.mjs` from this directory after installing the pinned test-only dependencies with `npm ci --ignore-scripts`. The launcher starts a fresh PostgreSQL 17.6 cluster bound only to 127.0.0.1:55449, generates a synthetic password, runs run.mjs and shuts down/removes only its own temporary cluster. No production URL is accepted by the runner. No provider deliveries occur.

In this workspace the existing matching binary and pg installation was reused through CENSUS_NATIVE_BIN_MODULE and CENSUS_NATIVE_PG_MODULE; nothing downloaded. The restricted single-UID namespace requires explicit CENSUS_ALLOW_NAMESPACE_UID_ADAPTER=1 and uses the included previously-reviewed local UID shim, not a SQL permission bypass. Ordinary OS users need no shim. See launch.mjs for all isolation checks.
