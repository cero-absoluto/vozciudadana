-- Migración: fiabilidad y señales de verificación en adhesions
-- Fecha: 2026-05-29

ALTER TABLE adhesions
  ADD COLUMN IF NOT EXISTS fiabilidad INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS senales TEXT DEFAULT NULL;
