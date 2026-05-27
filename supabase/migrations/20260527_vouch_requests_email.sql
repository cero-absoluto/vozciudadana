-- Migración: email visible en solicitudes pendientes
-- Fecha: 2026-05-27

ALTER TABLE vouch_requests
  ADD COLUMN IF NOT EXISTS candidate_email TEXT DEFAULT NULL;
