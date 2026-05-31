-- Añadir saldo y contador de donaciones a cada convocatoria
ALTER TABLE protests 
  ADD COLUMN IF NOT EXISTS saldo_euros DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS donaciones_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS donaciones_total DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS ultima_donacion TIMESTAMPTZ;

-- Tabla de historial de donaciones anónimas
CREATE TABLE IF NOT EXISTS donaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  protest_id UUID REFERENCES protests(id) ON DELETE CASCADE,
  importe DECIMAL(10,2) NOT NULL,
  mensaje TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para consultas rápidas por convocatoria
CREATE INDEX IF NOT EXISTS idx_donaciones_protest ON donaciones(protest_id);
