-- Migración: corrección constraint scope
-- Fecha: 2026-05-19
-- Descripción: actualiza la constraint de scope para aceptar 'regional' en lugar de 'local'

ALTER TABLE protests DROP CONSTRAINT protests_scope_check;
ALTER TABLE protests ADD CONSTRAINT protests_scope_check
  CHECK (scope = ANY (ARRAY['national'::text, 'regional'::text, 'global'::text]));
