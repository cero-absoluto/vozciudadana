export const legacyReceiptMigration=new URL('../../supabase/migrations/20261004201818_funding_legacy_receipt_journal.sql',import.meta.url);
export const legacyReceiptSecret='synthetic-legacy-receipt-secret-only-20261004';
export const legacyReceiptInput=(suffix='a',extra={})=>({reference:'synthetic_legacy_'+suffix,amountCents:100,currency:'EUR',effectiveAt:null,eventRef:null,...extra});
export const legacyReceiptAdapterOptions={secret:legacyReceiptSecret,fundingSecret:'fixture-finance-independent-'.repeat(2),ownerSecret:'fixture-owner-independent-'.repeat(2),participationSecret:'fixture-participation-independent-'.repeat(2),mode:'isolated'};
