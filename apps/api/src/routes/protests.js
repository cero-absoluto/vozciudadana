import { supabase } from '../services/supabase.js';
import { createHmac } from 'crypto';

const VALID_SCOPES    = ['national', 'regional', 'global'];
const VALID_REGIONS   = ['region', 'provincia', 'ciudad', 'distrito', 'institucion'];
const VALID_RISK      = ['low', 'med', 'high', 'critical'];
const COUNTRY_RE      = /^[A-Z]{2}$/;

// ── Configurable costs and fees (set via Railway env vars) ──────────────
const SMS_COST_EUR      = parseFloat(process.env.SMS_COST_EUR      || '0.05');
const EMAIL_COST_EUR    = parseFloat(process.env.EMAIL_COST_EUR     || '0.01');
const PLATFORM_FEE_PCT  = parseFloat(process.env.PLATFORM_FEE_PERCENT || '10') / 100;
const MAX_DONATION_EUR  = parseFloat(process.env.MAX_DONATION_EUR   || '10');

/** @param {import('fastify').FastifyInstance} app */
export default async function protestRoutes(app) {
  // GET /api/protests — list active protests (optionally filter by scope/country)
  app.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          scope:   { type: 'string', enum: VALID_SCOPES },
          country: { type: 'string', minLength: 2, maxLength: 2 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { scope, country } = req.query;

    let query = supabase
      .from('protests')
      .select('*')
      .gt('ends_at', new Date().toISOString())
      .order('heat', { ascending: false })
      .limit(100);

    if (scope)   query = query.eq('scope', scope);
    if (country) query = query.eq('country', country.toUpperCase());

    const { data, error } = await query;
    if (error) throw error;
    return data;
  });

  // GET /api/protests/:id
  app.get('/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { data, error } = await supabase
      .from('protests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) return reply.notFound('Protest not found');
    return data;
  });

  // POST /api/protests — create a new protest
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'country_name', 'scope', 'duration_h'],
        properties: {
          title:        { type: 'string', minLength: 1, maxLength: 255 },
          description:  { type: 'string', maxLength: 5000 },
          demands:      { type: 'string', maxLength: 2000 },
          country:      { type: 'string', minLength: 2, maxLength: 2, nullable: true },
          country_name: { type: 'string', minLength: 1, maxLength: 120 },
          scope:        { type: 'string', enum: VALID_SCOPES },
          region:       { anyOf: [{ type: 'string', enum: VALID_REGIONS }, { type: 'null' }] },
          focal_point:  { type: 'string', maxLength: 500, nullable: true },
          category:     { type: 'string', maxLength: 120, nullable: true },
          duration_h:   { type: 'number', minimum: 0.5, maximum: 720 },
          starts_at:    { type: 'string', format: 'date-time', nullable: true },
          risk_level:   { type: 'string', enum: VALID_RISK },
          convocatoria_pais:        { type: 'string', nullable: true },
          convocatoria_region:      { type: 'string', nullable: true },
          convocatoria_institucion: { type: 'string', nullable: true },
          dominio_email:            { type: 'string', nullable: true },
          fuente_url:               { type: 'string', nullable: true },
          tipo_abuso:               { type: 'string', nullable: true },
          requiere_censo:           { type: 'boolean', nullable: true },
          // ── Wikidata target validation ──────────────────────────────────
          target_wikidata_id: { type: 'string', nullable: true },
          target_type:        { type: 'string', nullable: true },
          target_country:     { type: 'string', nullable: true },
          target_validation:  { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { title, description, demands, country, country_name, scope, region,
        focal_point, category, duration_h, starts_at, risk_level,
        convocatoria_pais, convocatoria_region, convocatoria_institucion, dominio_email,
        fuente_url, tipo_abuso, requiere_censo,
        target_wikidata_id, target_type, target_country, target_validation } = req.body;

    const ends_at = new Date(
      new Date(starts_at ?? Date.now()).getTime() + duration_h * 3_600_000
    ).toISOString();

    const { data, error } = await supabase
      .from('protests')
      .insert({
        title, description, demands,
        country: country ? country.toUpperCase() : null,
        country_name, scope, region: region ?? null,
        focal_point: focal_point ?? null,
        category: category ?? null,
        risk_level: risk_level ?? 'low',
        starts_at: starts_at ?? new Date().toISOString(),
        ends_at,
        convocatoria_pais: convocatoria_pais ?? null,
        convocatoria_region: convocatoria_region ?? null,
        convocatoria_institucion: convocatoria_institucion ?? null,
        dominio_email: dominio_email ?? null,
        fuente_url: fuente_url ?? null,
        tipo_abuso: tipo_abuso ?? null,
        requiere_censo: requiere_censo ?? false,
        // ── Wikidata target validation ──────────────────────────────────
        target_wikidata_id: target_wikidata_id ?? null,
        target_type:        target_type ?? null,
        target_country:     target_country ?? null,
        target_validation:  target_validation ?? 'NEEDS_REVIEW',
      })
      .select()
      .single();

    if (error) throw error;
    return reply.code(201).send(data);
  });

  // POST /api/protests/:id/join — anonymous adhesion
  app.post('/:id/join', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['phone_hash', 'device_id', 'recaptcha_token'],
        properties: {
          phone_hash:      { type: 'string', minLength: 64, maxLength: 64 },
          doc_hash:        { type: 'string', minLength: 64, maxLength: 64, nullable: true },
          device_id:       { type: 'string', minLength: 8, maxLength: 128 },
          recaptcha_token: { type: 'string', minLength: 1 },
          gps_lat:         { type: 'number', nullable: true },
          gps_lng:         { type: 'number', nullable: true },
          gps_accuracy:    { type: 'number', nullable: true },
          ip_ciudad:       { type: 'string', nullable: true },
          ip_pais:         { type: 'string', nullable: true },
          ip_region:       { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { phone_hash, doc_hash, device_id, recaptcha_token, gps_lat, gps_lng, gps_accuracy, ip_ciudad, ip_pais, ip_region } = req.body;
    await verifyRecaptcha(recaptcha_token, 'join_protest', reply);

    // Fetch protest metadata and idempotency check in parallel
    const [{ data: protest, error: protestErr }, { data: existing }] = await Promise.all([
      supabase.from('protests').select('scope, country, saldo_euros').eq('id', req.params.id).maybeSingle(),
      supabase.from('adhesions').select('id').eq('protest_id', req.params.id).eq('device_id', device_id).is('deleted_at', null).maybeSingle(),
    ]);

    if (protestErr || !protest) return reply.notFound('Protest not found');
    if (existing) return reply.conflict('Device already joined this protest');

    // Nullifier check — evita doble adhesión con el mismo número aunque cambie el dispositivo
    const nullifierCheck = createHmac('sha256', process.env.NULLIFIER_SECRET || 'dev-secret')
      .update(phone_hash + req.params.id)
      .digest('hex');
    const { data: existingNullifier } = await supabase
      .from('adhesions')
      .select('id')
      .eq('protest_id', req.params.id)
      .eq('nullifier', nullifierCheck)
      .is('deleted_at', null)
      .maybeSingle();
    if (existingNullifier) return reply.conflict('Phone already joined this protest');

    // Verificar saldo disponible (null = sin límite, 0 = agotado)
    if (protest.saldo_euros !== null && protest.saldo_euros <= 0) {
      return reply.status(402).send({ code: 'SALDO_AGOTADO', error: 'Esta convocatoria no tiene saldo. Apóyala con una donación.' });
    }

    // National protests: device country must match protest country
    if (protest.scope === 'national' && protest.country) {
      const { data: dev } = await supabase
        .from('devices')
        .select('country_code')
        .eq('id', device_id)
        .maybeSingle();

      if (!dev?.country_code || dev.country_code !== protest.country) {
        return reply.status(403).send({ code: 'NATIONAL_ONLY', error: 'protests country does not match device country' });
      }
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    let ciudad = null;
    let region = null;
    let pais   = null;

    // Si hay GPS, usar geocodificación GPS (más precisa) ignorando IP
    if (gps_lat != null && gps_lng != null) {
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${gps_lat}&lon=${gps_lng}&format=json`,
          { headers: { 'Accept-Language': 'es', 'User-Agent': 'VozCiudadana/1.0' } }
        );
        const geoData = await geoRes.json();
        ciudad = geoData.address?.city || geoData.address?.town || geoData.address?.village ||
                 geoData.address?.suburb || geoData.address?.hamlet ||
                 geoData.address?.locality || geoData.address?.municipality || null;
        region = geoData.address?.state || geoData.address?.county || null;
        pais   = geoData.address?.country || null;
      } catch { /* silencioso */ }
    }

    // Si no hay GPS o falló, usar datos de IP enviados por el frontend
    if (!ciudad) {
      ciudad = ip_ciudad || null;
      region = ip_region || null;
      pais   = ip_pais   || null;
    }

    // Si tampoco hay datos del frontend, consultar ip-api como último recurso
    if (!ciudad) {
      try {
        const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country&lang=es`);
        const geo = await geoRes.json();
        ciudad = geo.city || null;
        region = geo.regionName || null;
        pais   = geo.country || null;
      } catch { /* silencioso */ }
    }

    const idioma = req.headers['accept-language']?.split(',')[0] || null;

    // Nullifier: HMAC-SHA256(phone_hash, protest_id) — evita correlación entre convocatorias
    const nullifier = createHmac('sha256', process.env.NULLIFIER_SECRET || 'dev-secret')
      .update(phone_hash + req.params.id)
      .digest('hex');

    // Timestamp redondeado a la hora — evita correlación temporal
    const created_at = new Date(
      Math.floor(Date.now() / 3_600_000) * 3_600_000
    ).toISOString();

    // Calcular fiabilidad según señales disponibles
    const tieneGps = gps_lat != null && gps_lng != null;
    const tieneSim = !!phone_hash;
    const tieneIpPais = !!pais;

    let fiabilidad = 60;
    let senales = [];

    if (tieneGps && tieneSim && tieneIpPais) {
      fiabilidad = 95;
      senales = ['gps', 'sim', 'ip'];
    } else if (tieneGps && tieneSim) {
      fiabilidad = 92;
      senales = ['gps', 'sim'];
    } else if (tieneSim && tieneIpPais) {
      fiabilidad = 85;
      senales = ['sim', 'ip'];
    } else if (tieneSim) {
      fiabilidad = 75;
      senales = ['sim'];
    } else if (tieneIpPais) {
      fiabilidad = 60;
      senales = ['ip'];
    }

    // GPS coordinates used only for geocoding — not stored
    const gps_confirmed = (gps_lat != null && gps_lng != null);

    const { data, error } = await supabase
      .from('adhesions')
      .insert({ protest_id: req.params.id, phone_hash, doc_hash: doc_hash ?? null,
                device_id, ciudad, region, pais, idioma, nullifier, created_at,
                gps_confirmed,
                fiabilidad, senales: senales.join(',') })
      .select()
      .single();

    if (error) throw error;

    const { error: rpcErr } = await supabase.rpc('increment_protest_count', { protest_id: req.params.id });
    await supabase.rpc('update_cities_count', { protest_id: req.params.id });
    if (rpcErr) req.log.error({ rpcErr }, 'increment_protest_count failed');

    // Descontar saldo por adhesion y registrar movimiento financiero
    if (protest.saldo_euros !== null && protest.saldo_euros > 0) {
      await supabase.from('protests')
        .update({ saldo_euros: Math.max(0, protest.saldo_euros - SMS_COST_EUR) })
        .eq('id', req.params.id);

      // Audit trail — register verification cost in financial_movements
      await supabase.from('financial_movements').insert({
        type:        'verification_sms',
        protest_id:  req.params.id,
        adhesion_id: data.id,
        amount:      SMS_COST_EUR,
        currency:    'EUR',
        destination: 'verification_cost',
        description: `SMS verification cost for adhesion ${data.id}`,
      });
    }

    // Fire push notification on milestones
    try {
      const { data: updated } = await supabase.from('protests').select('count, title').eq('id', req.params.id).single();
      const milestones = [10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000];
      if (updated && milestones.includes(updated.count)) {
        const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
          : 'http://localhost:3000';
        fetch(`${baseUrl}/api/push/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protest_id:   req.params.id,
            title:        `🗳️ ${updated.count} verified citizens`,
            body:         updated.title,
            url:          `https://voiceprotest.org/#/protest/${req.params.id}`,
            admin_secret: process.env.ADMIN_SECRET,
          }),
        }).catch(() => {});
      }
    } catch { /* silencioso */ }

    return reply.code(201).send({ receipt: data.id });
  });

  // POST /api/protests/:id/viral — record a share
  app.post('/:id/viral', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { error } = await supabase.rpc('increment_viral_count', { protest_id: req.params.id });
    if (error) req.log.error({ error }, 'increment_viral_count failed');
    return { ok: true };
  });

  // GET /api/protests/:id/donaciones — historial publico anonimo
  app.get('/:id/donaciones', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { data: protest } = await supabase
      .from('protests')
      .select('saldo_euros, donaciones_count, donaciones_total, ultima_donacion, title')
      .eq('id', req.params.id)
      .single();

    const { data: donaciones } = await supabase
      .from('donaciones')
      .select('importe, created_at')
      .eq('protest_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const adhesiones_posibles = Math.floor((protest?.saldo_euros || 0) / SMS_COST_EUR);

    return {
      saldo_euros:       protest?.saldo_euros || 0,
      adhesiones_posibles,
      donaciones_count:  protest?.donaciones_count || 0,
      donaciones_total:  protest?.donaciones_total || 0,
      ultima_donacion:   protest?.ultima_donacion || null,
      historial:         donaciones || [],
    };
  });

  // POST /api/protests/:id/donar — registrar donacion manual (desde panel admin)
  app.post('/:id/donar', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['importe', 'admin_secret'],
        properties: {
          importe:      { type: 'number', minimum: 0.50, maximum: 100 },
          mensaje:      { type: 'string', maxLength: 200, nullable: true },
          admin_secret: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { importe, mensaje, admin_secret } = req.body;

    if (admin_secret !== process.env.ADMIN_SECRET) {
      return reply.status(401).send({ error: 'No autorizado' });
    }

    const { data: protest } = await supabase
      .from('protests')
      .select('saldo_euros, donaciones_count, donaciones_total')
      .eq('id', req.params.id)
      .single();

    if (!protest) return reply.notFound('Convocatoria no encontrada');

    // 90/10 split — configurable via PLATFORM_FEE_PERCENT env var
    const fee_percent         = Math.round(PLATFORM_FEE_PCT * 100);
    const importe_plataforma  = parseFloat((importe * PLATFORM_FEE_PCT).toFixed(2));
    const importe_convocatoria = parseFloat((importe - importe_plataforma).toFixed(2));

    const nuevo_saldo   = (protest.saldo_euros || 0) + importe_convocatoria;
    const nuevo_count   = (protest.donaciones_count || 0) + 1;
    const nuevo_total   = (protest.donaciones_total || 0) + importe;

    await supabase.from('protests').update({
      saldo_euros:      nuevo_saldo,
      donaciones_count: nuevo_count,
      donaciones_total: nuevo_total,
      ultima_donacion:  new Date().toISOString(),
    }).eq('id', req.params.id);

    // Record donation with split
    const { data: donacion } = await supabase.from('donaciones').insert({
      protest_id:            req.params.id,
      importe,
      importe_convocatoria,
      importe_plataforma,
      fee_percent,
      mensaje: mensaje || null,
    }).select().single();

    // Record platform fund income
    await supabase.from('platform_fund').insert({
      type:        'income',
      amount:      importe_plataforma,
      source:      'donation_fee',
      protest_id:  req.params.id,
      description: `${fee_percent}% platform fee from donation of €${importe}`,
    });

    // Record financial movements
    await supabase.from('financial_movements').insert([
      {
        type:        'donation_protest',
        protest_id:  req.params.id,
        donation_id: donacion?.id || null,
        amount:      importe_convocatoria,
        destination: 'protest_balance',
        description: `Donation credited to protest (${100 - fee_percent}%)`,
      },
      {
        type:        'donation_platform',
        protest_id:  req.params.id,
        donation_id: donacion?.id || null,
        amount:      importe_plataforma,
        destination: 'platform_fund',
        description: `Platform fee from donation (${fee_percent}%)`,
      },
    ]);

    return { ok: true, saldo_nuevo: nuevo_saldo, adhesiones_posibles: Math.floor(nuevo_saldo / SMS_COST_EUR) };
  });

  // GET /api/protests/archivo — convocatorias cerradas
  app.get('/archivo', async (req, reply) => {
    const { data, error } = await supabase
      .from('protests')
      .select('id, title, country, country_name, scope, count, cities_count, ends_at, starts_at, saldo_euros, donaciones_total')
      .lt('ends_at', new Date().toISOString())
      .order('ends_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    return data ?? [];
  });

  // GET /api/protests/:id/informe — datos para el informe público
  app.get('/:id/informe', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { data: protest, error } = await supabase
      .from('protests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) return reply.notFound('Convocatoria no encontrada');

    const { data: adhesions } = await supabase
      .from('adhesions')
      .select('ciudad, region, pais, idioma, created_at, gps_confirmed, fiabilidad, senales')
      .eq('protest_id', req.params.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    const ciudades = [...new Set(adhesions.map(a => a.ciudad).filter(Boolean))];
    const paises = [...new Set(adhesions.map(a => a.pais).filter(Boolean))];
    const idiomas = [...new Set(adhesions.map(a => a.idioma).filter(Boolean))];

    const distribucion_regiones = adhesions.reduce((acc, a) => {
      if (a.region) acc[a.region] = (acc[a.region] || 0) + 1;
      return acc;
    }, {});

    const adhesiones_con_gps = adhesions.filter(a => a.gps_confirmed === true).length;

    const fiabilidad_alta    = adhesions.filter(a => a.fiabilidad >= 85).length;
    const fiabilidad_media   = adhesions.filter(a => a.fiabilidad >= 75 && a.fiabilidad < 85).length;
    const fiabilidad_base    = adhesions.filter(a => a.fiabilidad >= 60 && a.fiabilidad < 75).length;
    const fiabilidad_sin_dato = adhesions.filter(a => !a.fiabilidad).length;

    const porDia = {};
    adhesions.forEach(a => {
      const dia = a.created_at?.substring(0, 10);
      if (dia) porDia[dia] = (porDia[dia] || 0) + 1;
    });
    const diasOrdenados = Object.keys(porDia).sort();
    const adhesionesPorDia = diasOrdenados.map(d => ({ fecha: d, count: porDia[d] }));

    const mediaDiaria = adhesionesPorDia.length > 0
      ? Math.round((adhesions.length / adhesionesPorDia.length) * 10) / 10
      : 0;

    const diaPico = adhesionesPorDia.reduce((max, d) => d.count > (max?.count || 0) ? d : max, null);

    const hoy = new Date().toISOString().substring(0, 10);
    const ayer = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
    const adhesionesHoy = porDia[hoy] || 0;
    const adhesionesAyer = porDia[ayer] || 0;

    return {
      protest,
      total_adhesiones: protest.count,
      adhesiones_con_gps,
      adhesiones_sin_gps: protest.count - adhesiones_con_gps,
      ciudades_distintas: ciudades.length,
      paises_distintos: paises.length,
      idiomas_distintos: idiomas.length,
      distribucion_paises: paises,
      distribucion_ciudades: ciudades,
      distribucion_regiones,
      primera_adhesion: adhesions[0]?.created_at || null,
      ultima_adhesion: adhesions[adhesions.length - 1]?.created_at || null,
      desglose_fiabilidad: {
        alta:     { count: fiabilidad_alta,     rango: '85-95%', descripcion: 'GPS + SIM + IP verificados' },
        media:    { count: fiabilidad_media,    rango: '75-84%', descripcion: 'SIM verificada' },
        base:     { count: fiabilidad_base,     rango: '60-74%', descripcion: 'Solo IP verificada' },
        sin_dato: { count: fiabilidad_sin_dato, rango: '—',      descripcion: 'Adhesiones anteriores al sistema' },
      },
      velocidad: {
        adhesiones_por_dia: adhesionesPorDia,
        media_diaria:       mediaDiaria,
        dia_pico:           diaPico,
        adhesiones_hoy:     adhesionesHoy,
        tendencia_hoy:      adhesionesHoy - adhesionesAyer,
      },
    };
  });
}

/**
 * Verify a reCAPTCHA v3 token server-side.
 */
async function verifyRecaptcha(token, expectedAction, reply) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return;

  const res = await fetch(
    `https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    { method: 'POST' }
  );
  const json = await res.json();

  if (!json.success || json.score < 0.5) {
    reply.badRequest('reCAPTCHA verification failed');
    throw new Error('recaptcha');
  }
}

