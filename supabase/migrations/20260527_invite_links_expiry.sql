-- Migración: links de invitación de un solo uso con caducidad 48 horas
-- Fecha: 2026-05-27

ALTER TABLE invite_links
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '48 hours',
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ DEFAULT NULL;
