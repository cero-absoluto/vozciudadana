-- ============================================================
--  Voice Protest — country_codes reference table
-- ============================================================

create table if not exists country_codes (
  iso2      char(2)  primary key,               -- ISO 3166-1 alpha-2
  dial_code integer  not null,                  -- E.164 prefix, numeric (no "+")
  flag      text     not null,                  -- Unicode flag emoji
  name      text     not null                   -- Country name (Spanish)
);

-- ── RLS ─────────────────────────────────────────────────────
alter table country_codes enable row level security;

create policy "country_codes_public_read"
  on country_codes for select
  using (true);

create policy "country_codes_service_write"
  on country_codes for all
  using (auth.role() = 'service_role');

-- ── Seed data ────────────────────────────────────────────────
insert into country_codes (iso2, dial_code, flag, name) values
  -- América del Norte
  ('US',   1,   '🇺🇸', 'Estados Unidos'),
  ('CA',   1,   '🇨🇦', 'Canadá'),
  ('MX',   52,  '🇲🇽', 'México'),
  -- América Central
  ('GT',   502, '🇬🇹', 'Guatemala'),
  ('SV',   503, '🇸🇻', 'El Salvador'),
  ('HN',   504, '🇭🇳', 'Honduras'),
  ('NI',   505, '🇳🇮', 'Nicaragua'),
  ('CR',   506, '🇨🇷', 'Costa Rica'),
  ('PA',   507, '🇵🇦', 'Panamá'),
  -- Caribe
  ('CU',   53,  '🇨🇺', 'Cuba'),
  ('HT',   509, '🇭🇹', 'Haití'),
  ('DO',   1,   '🇩🇴', 'República Dominicana'),
  -- América del Sur
  ('CO',   57,  '🇨🇴', 'Colombia'),
  ('VE',   58,  '🇻🇪', 'Venezuela'),
  ('EC',   593, '🇪🇨', 'Ecuador'),
  ('PE',   51,  '🇵🇪', 'Perú'),
  ('BO',   591, '🇧🇴', 'Bolivia'),
  ('PY',   595, '🇵🇾', 'Paraguay'),
  ('UY',   598, '🇺🇾', 'Uruguay'),
  ('AR',   54,  '🇦🇷', 'Argentina'),
  ('CL',   56,  '🇨🇱', 'Chile'),
  ('BR',   55,  '🇧🇷', 'Brasil'),
  -- Europa Occidental
  ('ES',   34,  '🇪🇸', 'España'),
  ('PT',   351, '🇵🇹', 'Portugal'),
  ('FR',   33,  '🇫🇷', 'Francia'),
  ('GB',   44,  '🇬🇧', 'Reino Unido'),
  ('IE',   353, '🇮🇪', 'Irlanda'),
  ('DE',   49,  '🇩🇪', 'Alemania'),
  ('AT',   43,  '🇦🇹', 'Austria'),
  ('CH',   41,  '🇨🇭', 'Suiza'),
  ('IT',   39,  '🇮🇹', 'Italia'),
  ('MT',   356, '🇲🇹', 'Malta'),
  ('NL',   31,  '🇳🇱', 'Países Bajos'),
  ('BE',   32,  '🇧🇪', 'Bélgica'),
  ('LU',   352, '🇱🇺', 'Luxemburgo'),
  -- Europa del Norte
  ('SE',   46,  '🇸🇪', 'Suecia'),
  ('NO',   47,  '🇳🇴', 'Noruega'),
  ('DK',   45,  '🇩🇰', 'Dinamarca'),
  ('FI',   358, '🇫🇮', 'Finlandia'),
  ('IS',   354, '🇮🇸', 'Islandia'),
  -- Europa del Este
  ('PL',   48,  '🇵🇱', 'Polonia'),
  ('CZ',   420, '🇨🇿', 'República Checa'),
  ('SK',   421, '🇸🇰', 'Eslovaquia'),
  ('HU',   36,  '🇭🇺', 'Hungría'),
  ('RO',   40,  '🇷🇴', 'Rumanía'),
  ('BG',   359, '🇧🇬', 'Bulgaria'),
  ('UA',   380, '🇺🇦', 'Ucrania'),
  ('BY',   375, '🇧🇾', 'Bielorrusia'),
  ('RU',   7,   '🇷🇺', 'Rusia'),
  -- Oriente Medio y Norte de África
  ('IR',   98,  '🇮🇷', 'Irán'),
  ('TR',   90,  '🇹🇷', 'Turquía'),
  ('SA',   966, '🇸🇦', 'Arabia Saudí'),
  ('AE',   971, '🇦🇪', 'Emiratos Árabes Unidos'),
  ('IL',   972, '🇮🇱', 'Israel'),
  ('EG',   20,  '🇪🇬', 'Egipto'),
  -- Asia
  ('IN',   91,  '🇮🇳', 'India'),
  ('CN',   86,  '🇨🇳', 'China'),
  ('JP',   81,  '🇯🇵', 'Japón'),
  ('KR',   82,  '🇰🇷', 'Corea del Sur'),
  ('ID',   62,  '🇮🇩', 'Indonesia'),
  ('PH',   63,  '🇵🇭', 'Filipinas'),
  -- África subsahariana
  ('ZA',   27,  '🇿🇦', 'Sudáfrica'),
  ('NG',   234, '🇳🇬', 'Nigeria'),
  ('KE',   254, '🇰🇪', 'Kenia'),
  -- Oceanía
  ('AU',   61,  '🇦🇺', 'Australia'),
  ('NZ',   64,  '🇳🇿', 'Nueva Zelanda')
on conflict (iso2) do nothing;
