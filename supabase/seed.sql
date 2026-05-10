-- ============================================================
--  Seed data — demo protests matching the frontend mock data
-- ============================================================
insert into protests (title, description, demands, country, country_name, scope, region, heat, count, cities, ends_at) values
(
  'Acceso a la vivienda para jóvenes',
  'Los jóvenes españoles necesitan entre 8 y 12 años de ahorro íntegro para reunir el 20% de entrada exigido por los bancos. La tasa de emancipación juvenil en España (15,9%) es la más baja de la UE (media 31,4%).',
  'Que el Gobierno derogue la obligación del 20% de entrada para primera vivienda habitual de menores de 35 años · Que establezca un sistema de garantías públicas · Que publique un plan de acceso a vivienda para jóvenes',
  'ES', 'España', 'national', null, 5, 0, 1,
  now() + interval '48 hours'
),
(
  'Reforma del Parlamento Europeo',
  'Exigimos mayor representación ciudadana y transparencia en las instituciones europeas.',
  'Que se reforme el sistema electoral europeo · Que los ciudadanos puedan proponer leyes directamente · Que las sesiones sean íntegramente públicas',
  null, 'Unión Europea', 'regional', 'eu', 88, 412000, 890,
  now() + interval '90 minutes'
),
(
  'Libertad para presos políticos',
  'Más de 250 personas detenidas arbitrariamente. Exigimos su liberación inmediata.',
  'Liberación inmediata e incondicional · Sanciones internacionales · Acceso a observadores independientes de DDHH.',
  null, 'Global', 'global', null, 98, 211000, 521,
  now() + interval '1 hour'
),
(
  'Contra la corrupción del gobierno',
  'Denunciamos la corrupción sistémica. Exigimos transparencia total y fin de la impunidad.',
  'Que dimita el presidente · Que se abra una investigación independiente · Que se publiquen todos los contratos públicos · Fin de la impunidad.',
  'ES', 'España', 'national', null, 95, 187432, 284,
  now() + interval '114 minutes'
),
(
  'Crisis climática — Acuerdo de París',
  'Los compromisos del Acuerdo de París no se están cumpliendo.',
  'Que se tomen medidas urgentes.',
  null, 'Global', 'global', null, 76, 890000, 1240,
  now() + interval '24 hours'
),
(
  'Política agraria común de la UE',
  'La PAC actual no protege a los pequeños agricultores ni a la biodiversidad.',
  'Que se reforme la PAC.',
  null, 'Unión Europea', 'regional', 'eu', 65, 128000, 340,
  now() + interval '150 minutes'
),
(
  'Internet libre en Irán',
  'El régimen ha bloqueado más de 15.000 sitios.',
  'Que se desbloqueen todas las plataformas · Que cese la vigilancia · Que se libere a todos los periodistas presos.',
  'IR', 'Irán', 'national', null, 90, 89234, 198,
  now() + interval '68 minutes'
),
(
  'Transparencia en contratos públicos',
  'Contratos millonarios adjudicados sin concurso público.',
  'Que se abran licitaciones.',
  'MX', 'México', 'national', null, 65, 41230, 97,
  now() + interval '2 hours'
);
