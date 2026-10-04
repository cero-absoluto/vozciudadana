# I4 provider qualification and cutover rehearsal

Owner gate: approved by “si” on 4 October2026 after the concrete proposal in review report version20. “continua” during execution preserves that scope. Temporary A3: isolated contracts, synthetic tests, existing validation branch and CI only. Return A1 after verification. I4 overall remains OPEN.

This module is a qualification harness, not a Stripe/Mollie integration. It cannot call an SDK/network, create a checkout, send OTP, cancel/refund/settle or modify a SQL reservation. It is not imported by server.js. No new dependencies or migrations. The nine existing candidate migrations remain unchanged. Existing financial expiry functions retain their synthetic-only semantics: do not attach a real provider to them. The harness identifies blockers; it does not claim to have solved remote lifecycle persistence.

## Contracts and evidence

Profiles are pinned to the facts consulted on2026-10-04; these are not selected accounts, API versions, fees or enabled methods. Stripe Checkout minimum30min and maximum24h must fit actual creation plus local/event/year deadlines. PaymentIntent.created is not the successful payment time. That mapping remains unproven here, so compatible duration alone never yields qualification.

Mollie iDEAL15min, creditcard30min and PayPal6h documented expirations are descriptive; published instructions say to fetch status rather than predict expiry. They are not modeled as a guaranteed custom deadline. The official PHP Payment resource exposes paidAt separately from createdAt; its fixture use does not certify live method/capture/time semantics. Stripe and Mollie profiles consequently return NOT_QUALIFIED for the current10min policy. This does not declare either vendor globally unsuitable.

The observer accepts only a branded closed in-memory transport and prebound synthetic references. Unknown IDs/URLs do not trigger retrieval. Retrieved amount/currency/provider/method/creation/mode, freshness and revision are checked; raw webhook fields, redirect URLs and receipt time are never payment evidence. Synthetic revision numbers/freshness clocks are harness inventions, not claimed provider fields. Real authenticated acquisition, causal ordering, reconciliation and durable provenance need a later provider-specific package.

Local timeout, open/pending/authorized and cancel_requested retain the fixture reservation. Only definitive retrieved no-payment status produces an assessment permitting release; even this assessment has no SQL side effect. Cancel failure422/timeout is not cancellation. Attempt-canceled under multi-method checkout is not payment-canceled. Contradictory/old/terminal-reversing snapshots, malformed or late successful times and closed events go to review. A Mollie paidAt fixture produces evidenced success only inside all boundaries, without PII. Stripe success remains review until its mapping is established. Existing successful quota/year/ledger behavior remains covered by funding regressions; this module does not bypass it.

## Cutover rehearsal

Explicit synthetic evidence is required for observed freeze, complete inventory, reconciled references, known quota continuity, preserved finals, rehearsed rollback, accepted qualification and one synthetic candidate writer. Nonzero/unknown pending-reference counts or competing writers block the verdict. REHEARSAL_READY is a fixture assessment with productionActivation=false, not an authorization, durable freeze or proof of actual inventory. The current provider candidates cannot pass qualification merely because a caller supplies booleans.

No production credentials/accounts, PSP testmode, SDK install, live OTP, main merge, deploy, DDL, cron or financial/history operation. No assumption that Stichting exists, that timezone determines jurisdiction or that the Owner is personally the legal holder. VP-ISS-019 CAUSE NOT ESTABLISHED; VP-SEC-032 OWNER DECISION PENDING; I3 provenance unchanged.

## Validation and rollback

Run npm run test:funding:qualification for20 standalone cases; npm run test:funding and integrity regressions; native PostgreSQL17 suite requires the documented loopback ephemeral database and real restricted logins. Three native read-only cases compose the observer with existing SQL quota/ledger/final snapshots, proving no mutations even with20 notifications. Those cases do not prove remote lifecycle SQL integration. CI publishes only i4-validation-20261003.

Rollback is revert of the isolated commit and reconstruction of the disposable fixture DB from unchanged migrations. Do not rewrite journals/finals or release actual pending reserves on rollback.

Sources:
- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/api/payment_intents/object
- https://docs.mollie.com/docs/handling-payment-status
- https://docs.mollie.com/reference/cancel-payment
- https://docs.mollie.com/reference/webhooks
- https://github.com/mollie/mollie-api-php/blob/main/src/Resources/Payment.php

Activation remains blocked on real legal holder/jurisdiction, eligible PSP/OTP accounts, cost/budget, selected methods, enforceable window/time evidence, durable lifecycle design, legal retention, key custody/retirement, Owner authentication and historical reconciliation. This document assigns no canonical decision identifier or vendor selection.
