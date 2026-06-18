-- Migration: support Ko-fi webhook donations with strict donor-data minimization.
-- No donor-identifying columns are added anywhere — only aggregate/financial fields.

alter table financial_movements
  add column if not exists tx_ref text;

create unique index if not exists financial_movements_tx_ref_idx
  on financial_movements (tx_ref)
  where tx_ref is not null;

alter table donaciones
  add column if not exists proveedor text default 'manual';

alter table donaciones
  add column if not exists moneda text default 'EUR';
