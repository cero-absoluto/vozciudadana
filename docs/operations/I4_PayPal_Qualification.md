# PayPal Orders feasibility — isolated qualification contract

Owner authorized the concrete package on 4 October 2026. Only closed synthetic contracts, targeted tests, regression verification and the existing validation branch are in scope. No account conversion, credentials, SDK, provider network, real sandbox account, SMS, production route, migration or financial operation.

Owner-reported channel is Ko-fi connected to a personal PayPal account in Spain. This is not independent account/eligibility verification. Stichting is not constituted; intended future titular role remains separate from current account ownership. No provider selection, current holder identity or production authorization is inferred.

`paypalQualification.js` requires a branded in-memory transport and isolated/nonproduction mode. It binds synthetic order, financing intent, receiver, EUR amount and local/event/year deadlines. Unknown references never trigger retrieval. Capture assessments require explicit fixture-only verified-session/reservation declarations; these booleans are not production authorization. It records no SQL reservation, sends no capture and offers no public endpoint. Server-side OTP/cap enforcement and durable capture commands still need an independent implementation gate.

One operation reference can replay its original assessment; a different operation cannot assess another capture for the same order. This in-memory map is a qualification model, not durable idempotency or actual PSP retry evidence. Restart loses state and does not prove no payment. Local expiry stops new assessments but never releases a hold. Exact replay describes an existing assessment, not permission for a late provider submission.

Observations check reference/intent/receiver/amount/currency, freshness and fixture revision. Payer approval, order COMPLETED without capture evidence, pending, failed attempt, unknown outcome and VOIDED all retain hold. No definitive no-capture semantics are established by this harness. Network/query failure is review with hold. Refund/debit and terminal contradiction require review; no gross-cap restoration or financial correction occurs.

COMPLETED capture can yield EVIDENCED_SUCCESS_FIXTURE only with a bound synthetic request, capture reference and the explicit synthetic effectiveSuccessfulAt field within all boundaries. This field and revisions are harness inventions, not claimed PayPal fields. PayPal capture create_time/update_time, redirect and webhook receipt are not mapped to effective success. Optional payer profile fields are absent from returned assessments. Fixture transport may hold synthetic payload only; this is not certification of provider data retention or deployed request/log minimization.

`qualification()` always returns NOT_QUALIFIED with account eligibility, successful-time mapping, definitive no-capture evidence, costs and retention unresolved. Caller assertions cannot override it. No vendor SDK or tariff is selected; fees reported by a processor would need authenticated reconciliation before allocation. The 10-minute candidate policy remains unchanged.

Required cases include missing financing authority, changed bindings/receiver/currency, closed local/event/year windows, duplicate request/notification assessments, lost response, pending-to-completed after boundary, malformed evidence, terminal contradiction, and no PII in results. Existing funding/lifecycle/qualification/integrity regressions remain mandatory. Exact execution IDs/results belong to the review report.

No migrations or public API signature changes. Rollback is isolated branch reversion; previous migrations, quota/ledger/final snapshots and evidence remain intact. Future productive capture support requires a separately reviewable migration/API/data model, request authority, provider mapping, costs/retention and rollout/rollback gate.

Sources inspected 4 October 2026:
- https://developer.paypal.com/api/rest/integration/orders-api/
- https://developer.paypal.com/api/rest/integration/orders-api/api-use-cases/standard/
- https://developer.paypal.com/sdk/orders/v2/definitions/capture/
- https://developer.paypal.com/api/rest/production/

The production guidance includes legacy credential examples alongside Premier/Business requirements; it is not a complete Spain-specific Orders account eligibility ruling. Personal account receipt through Ko-fi is not declared prohibited. No request to convert/create an account is included.

After verified execution/documentation return A1 READ-ONLY. I4 OPEN; VP-ISS-019 CAUSE NOT ESTABLISHED; VP-SEC-032 pending; historical final/provenance evidence untouched.
