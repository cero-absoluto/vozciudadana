# Ko-fi — Reference Guide
## Configuration, webhook setup and multi-protest mapping

**Last updated:** June 2026  
**Relevant files:** `apps/api/src/routes/webhooks.js` · `supabase/migrations/20260618_add_kofi_webhook_support.sql` · `supabase/migrations/20260618_add_kofi_protest_map.sql`

---

## Part 1 — Initial setup

### Production configuration

| Field | Value |
|---|---|
| Webhook URL | `https://api.voiceprotest.org/api/webhooks/kofi` |
| Railway variable | `KOFI_VERIFICATION_TOKEN` |
| Railway variable | `KOFI_DEFAULT_PROTEST_ID` |

### How to configure in Ko-fi

1. Go to **ko-fi.com** → log in → **More** → **API** or **Webhooks**
2. Paste `https://api.voiceprotest.org/api/webhooks/kofi` in the **Webhook URL** field
3. Copy the **verification token** Ko-fi shows on that page
4. Go to **Railway** → your service → **Variables** → add:
   - `KOFI_VERIFICATION_TOKEN` — the token from Ko-fi
   - `KOFI_DEFAULT_PROTEST_ID` — the UUID of the active protest (from Supabase → protests table)
5. **Redeploy in Railway** so both variables are loaded
6. Back in Ko-fi, press **Send test** — Railway logs should show `200` and `Ko-fi webhook: no matching protest_id found` (expected for test payload — the real protest_id is not included in Ko-fi test webhooks)

> ⚠️ Both variables must be added **before** redeploying. If added after, Railway won't load them until the next redeploy.

---

## Part 2 — Technical notes

### Why Content-Type matters

Ko-fi sends webhooks as `application/x-www-form-urlencoded` with a single field `data` containing a JSON string. Fastify requires an explicit content type parser for this format — without it, the server returns `415 Unsupported Media Type`.

This parser is registered in `kofiWebhookRoutes` and must not be removed.

### What the webhook does with each donation

1. Verifies `verification_token` against `KOFI_VERIFICATION_TOKEN` — rejects with 401 if mismatch
2. Extracts only: amount, currency, Ko-fi transaction ID (hashed), direct link code
3. Discards everything else: donor name, email, message, PayPal account
4. Resolves `protest_id` — see Part 3 for resolution order
5. Caps computable amount at `MAX_DONATION_EUR` (€100) — excess marked `over_limit_pending_review`
6. Updates protest `saldo_euros` and records in `donaciones` and `financial_movements`
7. Always returns `200` if the webhook is authentic — even for over-limit donations (payment already processed by Ko-fi/PayPal before the webhook fires)

### Donation routing

Donations made from a specific event's screen are automatically assigned to that event's verification balance. Donations made directly through Ko-fi without a reference to a specific event are credited to the platform sustainability fund.

This means: if a donor wants their contribution to reach a specific protest, they must follow the Ko-fi link from that protest's detail screen — not from the general ko-fi.com/voiceprotest page.

---

## Part 3 — Multi-protest mapping

### When to use this section

Only needed when two or more protests are accepting donations simultaneously. During beta with a single active protest, `KOFI_DEFAULT_PROTEST_ID` is sufficient.

### How protest_id is resolved (priority order)

```
1. Ko-fi Direct Link code → lookup in kofi_protest_map table (active = true)
        ↓ not found
2. KOFI_DEFAULT_PROTEST_ID environment variable in Railway
        ↓ not set
3. Donation credited to platform sustainability fund only (logged as warning)
```

No code changes or Railway redeployments needed for step 1 — only Supabase rows and Ko-fi configuration.

### Step-by-step for multiple protests

**Step 1 — Get protest UUIDs from Supabase**

```sql
select id, title from protests where status = 'active' order by created_at desc;
```

**Step 2 — Create a Direct Link in Ko-fi for each protest**

1. Go to Ko-fi → **Shop** or **Donation Links**
2. Create a new donation page per protest
3. Note the **exact code** Ko-fi assigns — this is the `direct_link_code`

> Verify the exact value by checking Railway logs after a test donation: look for `direct_link_code` in the payload.

**Step 3 — Insert rows in Supabase**

```sql
insert into kofi_protest_map (kofi_code, protest_id) values
  ('protest-a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('protest-b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
```

Run **without RLS**.

**Step 4 — Update the Ko-fi button URL per protest**

Each protest's "Support this event" button should link to its specific Ko-fi Direct Link, not the generic ko-fi.com/voiceprotest page.

**Step 5 — Verify with a test donation**

Check Railway logs for `protest_id resolved from kofi_protest_map` and verify the `saldo_euros` updated in Supabase.

### Disabling a mapping

```sql
-- Disable without deleting
update kofi_protest_map set active = false where kofi_code = 'protest-a';

-- Re-enable
update kofi_protest_map set active = true where kofi_code = 'protest-a';
```

---

## Part 4 — Verification queries

After any donation, verify in Supabase:

```sql
-- Donation recorded correctly
select * from donaciones order by created_at desc limit 5;

-- Protest balance updated
select id, title, saldo_euros, donaciones_count
from protests
where id = '[PROTEST_ID]';

-- Over-limit donations pending manual review
select * from financial_movements
where type = 'over_limit_pending_review';
```

---

## Part 5 — Troubleshooting

| Symptom / Log message | Cause | Fix |
|---|---|---|
| `415 Unsupported Media Type` | Old `webhooks.js` without the form parser | Deploy latest `webhooks.js` |
| `KOFI_VERIFICATION_TOKEN not configured` | Variable added after last deployment | Redeploy in Railway |
| `Invalid verification token` (401) | Token mismatch | Copy token from Ko-fi panel to Railway exactly |
| `no matching protest_id found` + bar doesn't update | `KOFI_DEFAULT_PROTEST_ID` not set or wrong UUID | Add/correct variable in Railway, redeploy |
| `no matching protest_id found` on Send test only | Normal — Ko-fi test payload has no protest reference | Ignore for test; real donations resolve correctly |
| Donation goes to wrong protest | `kofi_code` mismatch in mapping table | Check Railway logs for exact `direct_link_code` received, update Supabase row |
| Over-limit donation not reflected in full | Amount > €100 — only €100 credited | Review `over_limit_pending_review` rows in `financial_movements` |
