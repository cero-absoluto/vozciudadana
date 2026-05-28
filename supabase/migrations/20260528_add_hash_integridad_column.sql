-- Migración: añadir columna hash_integridad a protests
-- Fecha: 2026-05-28

ALTER TABLE protests
  ADD COLUMN IF NOT EXISTS hash_integridad TEXT DEFAULT NULL;
