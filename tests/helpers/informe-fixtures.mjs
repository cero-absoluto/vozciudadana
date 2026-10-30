// Synthetic /api/protests/:id/informe payloads (no real data) for the PDF tests.
const HASH = 'f9b048c884950967933b3cbd74cb0edfeae3721033c104a8e0e9473c26e55f33';
const rep = (s, n) => Array.from({ length: n }, () => s).join(' ');

const base = {
  total_adhesiones: 1234, paises_distintos: 3, ciudades_distintas: 15, adhesiones_con_gps: 410,
  primera_adhesion: '2026-07-16T19:00:00Z', ultima_adhesion: '2026-07-31T10:00:00Z',
  desglose_fiabilidad: { alta: { count: 410, descripcion: '' }, media: { count: 600, descripcion: '' }, base: { count: 224, descripcion: '' } },
  desglose_geografico_local: { municipio: null, scope: 'local', gps_local: 410, gps_nacional: 25, nacionales_sin_gps: 700, internacionales: 62, sin_pais: 37, total: 1234 },
  velocidad: { adhesiones_por_dia: [] },
};

function protest(over) {
  return {
    id: '9774b676-a6a2-41ea-93d2-cf525fa9b21b', scope: 'local', country: 'ES', status: 'closed',
    starts_at: '2026-07-31T08:00:00Z', ends_at: '2026-07-31T12:30:00Z', tipo_abuso: 'opacity',
    hash_integridad: HASH, integrity_version: 2, dominio_email: null, ...over,
  };
}

export const FIXTURES = {
  es: {
    ui: 'es', data: { ...base,
      desglose_geografico_local: { ...base.desglose_geografico_local, municipio: 'Santander' },
      protest: protest({
        title: 'Recinto ferial en Las Llamas: los vecinos exigen participar en la decisión sobre un equipamiento permanente que afectaría al barrio durante décadas',
        focal_point: 'Alcalde de Santander y Concejalía de Urbanismo, Infraestructuras y Movilidad del Ayuntamiento',
        country_name: 'España', convocatoria_ciudad_nombre: 'Santander',
        fuente_url: 'https://eldiariocantabria.publico.es/articulo/cantabria/vecinos-mueven-ficha-posible-instalacion-gran-superficie-hormigon-llamas-convocan-reunion-coordinar-acciones/20260619131333194578.html?utm_source=newsletter&utm_medium=email',
        demands: rep('Exigimos la paralización de la designación de Las Llamas como recinto ferial permanente hasta que exista un proceso de participación vecinal, la publicación de los estudios de impacto acústico y de tráfico y la evaluación de ubicaciones alternativas con criterios públicos.', 5),
      }),
      distribucion_regiones: { Cantabria: 800, Andalusia: 40, 'Comunidad Autónoma del País Vasco / Euskal Autonomia Erkidegoa': 30, 'Castilla y León': 20 },
      distribucion_ciudades: ['Santander', 'Torrelavega', 'Malaga', 'Sevilla', 'Bilbao', 'Valladolid', 'Camargo', 'Piélagos', 'Castro-Urdiales', 'Laredo', 'Santoña', 'Reinosa', 'Cabezón de la Sal', 'Los Corrales de Buelna', 'Santillana del Mar', 'Extra 16'],
    }, abuse: 'Opacidad o falta de rendición de cuentas',
  },
  en: {
    ui: 'en', data: { ...base,
      desglose_geografico_local: { ...base.desglose_geografico_local, municipio: 'Springfield' },
      protest: protest({
        title: 'Central Park Pavilion Redevelopment: residents demand a binding public consultation before any construction contract is awarded or signed',
        focal_point: 'Mayor of Springfield and the Municipal Planning, Infrastructure and Mobility Committee', country_name: 'United Kingdom', country: 'GB',
        convocatoria_ciudad_nombre: 'Springfield', fuente_url: 'https://example.org/news/2026/07/residents-demand-consultation-pavilion-redevelopment-binding-public-vote-before-contract?ref=feed&utm_campaign=local',
        demands: rep('We demand that the redevelopment be suspended until a binding public consultation has taken place, the acoustic and traffic impact studies are published, and alternative sites are assessed against public criteria.', 6),
      }),
      distribucion_regiones: { England: 700, Scotland: 30, 'Greater London Authority Area': 20 },
      distribucion_ciudades: ['Springfield', 'Shelbyville', 'Capital City', 'Ogdenville', 'North Haverbrook', 'Brockway', 'Cypress Creek'],
    }, abuse: 'Opacity or lack of accountability',
  },
  fr: {
    ui: 'fr', data: { ...base,
      desglose_geografico_local: { ...base.desglose_geografico_local, municipio: 'Lyon' },
      protest: protest({
        title: "Réaménagement de l'esplanade : les habitants exigent une consultation publique contraignante avant l'attribution de tout marché de travaux à l'échelle du quartier",
        focal_point: "Maire de Lyon et Adjointe à l'urbanisme, aux infrastructures et à la mobilité", country_name: 'France', country: 'FR',
        convocatoria_ciudad_nombre: 'Lyon', fuente_url: 'https://exemple.fr/actualites/2026/07/les-habitants-reclament-une-consultation-contraignante-avant-lattribution-du-marche-damenagement-de-lesplanade',
        demands: rep("Nous demandons la suspension du projet jusqu'à la tenue d'une consultation contraignante, la publication des études d'impact acoustique et de circulation, et l'évaluation d'autres sites selon des critères publics. Œuvres, cœur, être, où.", 5),
      }),
      distribucion_regiones: { 'Auvergne-Rhône-Alpes': 800, 'Île-de-France': 40, "Provence-Alpes-Côte d'Azur": 30 },
      distribucion_ciudades: ['Lyon', 'Villeurbanne', 'Saint-Étienne', 'Grenoble', 'Marseille', 'Paris', 'Vénissieux'],
    }, abuse: "Opacité ou manque de transparence",
  },
  zh: {
    ui: 'zh', data: { ...base,
      desglose_geografico_local: { ...base.desglose_geografico_local, municipio: '成都' },
      protest: protest({
        title: '成都市高新区会展中心选址：居民要求在任何施工合同签署之前先举行具有约束力的公开听证，并公布噪音与交通影响评估报告',
        focal_point: '成都市人民政府及高新区城乡规划与交通管理委员会', country_name: '中国', country: 'CN',
        convocatoria_ciudad_nombre: '成都', fuente_url: 'https://example.cn/news/2026/07/chengdu-residents-demand-public-hearing-before-exhibition-center-contract-is-signed?from=timeline',
        demands: rep('我们要求在举行具有约束力的公开听证之前暂停会展中心的选址决定，公布噪音和交通影响评估研究报告，并依据公开标准评估其他备选地点。繁體字測試：議會、臺灣、聽證會。', 6),
      }),
      distribucion_regiones: { '四川省': 700, '重庆市': 30, '香港特別行政區': 20 },
      distribucion_ciudades: ['成都', '绵阳', '德阳', '乐山', '眉山', '重庆', '香港', 'Chengdu', '臺北'],
    }, abuse: '不透明或缺乏问责',
  },
};

// Same UI language, different *content* characters.
export const CONTENT_CASES = {
  esUiChineseContent: { ui: 'es', data: FIXTURES.zh.data, abuse: 'Opacidad o falta de rendición de cuentas' },
  esUiPolishCyrillic: { ui: 'es', abuse: 'Opacidad', data: { ...FIXTURES.es.data, protest: { ...FIXTURES.es.data.protest,
    title: 'Zażółć gęślą jaźń: Київ та Москва — Łódź, Gdańsk, Český Krumlov, Việt Nam',
    focal_point: 'Мэрия Киева и Gmina Łódź', country_name: 'Україна',
  }, distribucion_regiones: { 'Київська область': 5, 'Łódzkie': 3 }, distribucion_ciudades: ['Київ', 'Łódź'] } },
  esUiUnsupported: { ui: 'es', abuse: 'Opacidad', data: { ...FIXTURES.es.data, protest: { ...FIXTURES.es.data.protest,
    title: 'Manifestación 🔥 por la plaza ✊🏽 — مظاهرة سلمية — Việt Nam',
  } } },
  esLatinOnly: { ui: 'es', abuse: 'Opacidad', data: { ...FIXTURES.es.data, protest: { ...FIXTURES.es.data.protest, title: 'Título corto con ñ, é y — raya', demands: 'Demanda corta.' } } },
};
