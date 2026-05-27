-- Migración: ondas de confianza y límite de invitaciones
-- Fecha: 2026-05-27

ALTER TABLE group_members
  ADD COLUMN IF NOT EXISTS wave INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS invites_sent INTEGER DEFAULT 0;

UPDATE group_members SET wave = 0 WHERE is_genesis = true;
