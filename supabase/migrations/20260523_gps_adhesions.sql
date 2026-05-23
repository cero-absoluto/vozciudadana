-- Migración: añadir campos GPS a la tabla adhesions
-- Fecha: 2026-05-23
-- Descripción: almacena coordenadas GPS opcionales para reforzar la credibilidad geográfica

ALTER TABLE adhesions
  ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gps_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gps_accuracy DOUBLE PRECISION;
