-- ============================================================
--  Seed data — demo protests matching the frontend mock data
-- ============================================================
insert into protests (title, description, demands, country, country_name, scope, region, heat, count, cities, ends_at) values
(
  'Contra la corrupción del gobierno',
  'Denunciamos la corrupción sistémica. Exigimos transparencia total y fin de la impunidad.',
  'Que dimita el presidente · Que se abra una investigación independiente · Que se publiquen todos los contratos públicos',
  'ES', 'España', 'national', null, 95, 187432, 284,
  now() + interval '2 hours'
),
(
  'Reforma del Parlamento Europeo',
  'Exigimos mayor representación ciudadana y transparencia en las instituciones europeas.',
  'Que se tomen medidas inmediatas en respuesta a esta convocatoria ciudadana.',
  null, 'Unión Europea', 'regional', 'eu', 88, 412000, 890,
  now() + interval '90 minutes'
),
(
  'Libertad para presos políticos',
  'Más de 250 personas detenidas arbitrariamente. Exigimos su liberación inmediata.',
  'Liberación inmediata e incondicional · Sanciones internacionales · Acceso a observadores de DDHH',
  null, 'Global', 'global', null, 98, 211000, 521,
  now() + interval '1 hour'
);
