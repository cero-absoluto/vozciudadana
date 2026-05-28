-- Migración: corrección del trigger de hash de integridad
-- Fecha: 2026-05-28

CREATE OR REPLACE FUNCTION calcular_hash_integridad()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ends_at <= NOW() AND NEW.hash_integridad IS NULL THEN
    NEW.hash_integridad := encode(
      digest(
        NEW.id::text || NEW.title || COALESCE(NEW.demands, '') || NEW.count::text || NEW.ends_at::text,
        'sha256'
      ),
      'hex'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
