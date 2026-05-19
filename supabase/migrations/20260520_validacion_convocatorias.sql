-- Migración: criterios de validación de convocatorias
-- Fecha: 2026-05-20
-- Descripción: añade URL de fuente y tipo de abuso a la tabla protests

ALTER TABLE protests
  ADD COLUMN IF NOT EXISTS fuente_url TEXT,
  ADD COLUMN IF NOT EXISTS tipo_abuso TEXT;
