-- Migración: verificación institucional (Bloque 3)
-- Fecha: 2026-05-19
-- Descripción: tablas para verificación por email institucional y grafo de vouches

-- Participantes institucionales verificados
-- email_hash: SHA-256(lowercase(email)) — el email nunca se almacena
-- expires_at: 31 de agosto del año académico en curso
CREATE TABLE IF NOT EXISTS institutional_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash TEXT UNIQUE NOT NULL,
  protest_id UUID REFERENCES protests(id),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT date_trunc('hour', now())
);

-- OTP temporal por email (se destruye al validar o caducar)
CREATE TABLE IF NOT EXISTS email_otp_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash TEXT NOT NULL,
  protest_id UUID REFERENCES protests(id),
  otp_code TEXT NOT NULL,
  requested_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '10 minutes'
);

-- Control de rate limiting: máximo 3 intentos por hash en 10 minutos
CREATE TABLE IF NOT EXISTS email_otp_rate_limit (
  email_hash TEXT NOT NULL,
  protest_id UUID NOT NULL,
  attempt_count INTEGER DEFAULT 1,
  first_attempt_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (email_hash, protest_id)
);

-- Grupos para el grafo de vouches
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  protest_id UUID REFERENCES protests(id),
  academic_year TEXT,
  vouch_threshold INTEGER DEFAULT 2,
  max_vouches_per_member INTEGER DEFAULT 5,
  genesis_hash TEXT NOT NULL,
  demo_mode BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Miembros del grupo
CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id),
  email_hash TEXT NOT NULL,
  is_genesis BOOLEAN DEFAULT false,
  vouches_received INTEGER DEFAULT 0,
  vouches_given INTEGER DEFAULT 0,
  accredited_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  UNIQUE(group_id, email_hash)
);

-- Solicitudes de unión al grupo
CREATE TABLE IF NOT EXISTS vouch_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id),
  candidate_hash TEXT NOT NULL,
  requested_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending' -- pending, accredited, expired
);

-- Vouches entre miembros
CREATE TABLE IF NOT EXISTS vouches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id),
  voucher_hash TEXT NOT NULL,
  candidate_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, voucher_hash, candidate_hash)
);

-- Links de invitación personal
CREATE TABLE IF NOT EXISTS invite_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id),
  inviter_hash TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  uses_count INTEGER DEFAULT 0,
  max_uses INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Función process_vouch: acredita a un candidato si alcanza el umbral
CREATE OR REPLACE FUNCTION process_vouch(
  p_group_id UUID,
  p_voucher_hash TEXT,
  p_candidate_hash TEXT
) RETURNS JSONB AS $$
DECLARE
  v_vouches_given INTEGER;
  v_vouches_received INTEGER;
  v_threshold INTEGER;
  v_max_vouches INTEGER;
BEGIN
  -- Comprobar que el avalador está acreditado
  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = p_group_id
    AND email_hash = p_voucher_hash
    AND accredited_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'voucher_not_accredited');
  END IF;

  -- Comprobar límite de vouches del avalador
  SELECT vouches_given, (SELECT max_vouches_per_member FROM groups WHERE id = p_group_id)
  INTO v_vouches_given, v_max_vouches
  FROM group_members
  WHERE group_id = p_group_id AND email_hash = p_voucher_hash;

  IF v_vouches_given >= v_max_vouches THEN
    RETURN jsonb_build_object('success', false, 'reason', 'voucher_limit_reached');
  END IF;

  -- Insertar vouch
  INSERT INTO vouches (group_id, voucher_hash, candidate_hash)
  VALUES (p_group_id, p_voucher_hash, p_candidate_hash)
  ON CONFLICT DO NOTHING;

  -- Actualizar contador del avalador
  UPDATE group_members
  SET vouches_given = vouches_given + 1
  WHERE group_id = p_group_id AND email_hash = p_voucher_hash;

  -- Contar vouches recibidos por el candidato
  SELECT COUNT(*) INTO v_vouches_received
  FROM vouches
  WHERE group_id = p_group_id AND candidate_hash = p_candidate_hash;

  -- Acreditar si alcanza el umbral
  SELECT vouch_threshold INTO v_threshold FROM groups WHERE id = p_group_id;

  IF v_vouches_received >= v_threshold THEN
    UPDATE group_members
    SET accredited_at = now(),
        vouches_received = v_vouches_received
    WHERE group_id = p_group_id AND email_hash = p_candidate_hash;

    RETURN jsonb_build_object('success', true, 'accredited', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'accredited', false, 'vouches_received', v_vouches_received);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Log de administración público (append-only, nunca contiene datos personales)
CREATE TABLE IF NOT EXISTS admin_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL, -- 'member', 'system', 'demo'
  action_type TEXT NOT NULL, -- 'proposition_created', 'vouch_issued', 'rate_limit_hit', etc.
  target_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
