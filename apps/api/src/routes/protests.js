import { supabase } from '../services/supabase.js';
import { createHmac } from 'crypto';

const VALID_SCOPES    = ['national', 'regional', 'local', 'global'];
const VALID_REGIONS   = ['region', 'provincia', 'ciudad', 'distrito', 'institucion'];
const VALID_RISK      = ['low', 'med', 'high', 'critical'];

// ── Backend admission rules — these mirror and enforce frontend validation ──
// Frontend = helps the user. Backend = real border. These rules cannot be
// bypassed by calling the API directly. All four checks are required because
// Voice Protest must not function as a petition platform.

// 1. Closed list of accepted abuse types — tipo_abuso is required and must
//    be one of these values. null or arbitrary strings are rejected.
const VALID_ABUSE_TYPES = new Set([
  'corruption',           // Corruption or embezzlement
  'nepotism',             // Nepotism or favoritism
  'rights_violation',     // Violation of fundamental rights
  'negligence',           // Serious negligence
  'repression',           // Repression or censorship
  'opacity',              // Opacity or lack of accountability
  'other_public_abuse',   // Other public power abuse
]);

// 2. Blocked source domains — petition platforms are not documentary sources.
//    A petition does not prove a fact; it is itself a petition.
//    Stored as registrable domains (eTLD+1). The check strips all subdomains
//    so that secure.change.org, chng.it etc. are also caught.
const BLOCKED_SOURCE_DOMAINS = new Set([
  'change.org',
  'chng.it',          // Change.org's own URL shortener
  'avaaz.org',
  'gopetition.com',
  'ipetitions.com',
  'petitions.net',
  'thepetitionsite.com',
  'care2.com',
  'sumofus.org',
  'moveon.org',
  'openpetition.eu',
  'openpetition.de',
  'mesopinions.com',
  'petitions.change.org',
]);

/**
 * Extract the registrable domain (eTLD+1) from a hostname.
 * "secure.change.org" → "change.org"
 * "change.org." (FQDN with trailing dot) → "change.org"
 */
function registrableDomain(hostname) {
  // Remove trailing dot (FQDN notation)
  const h = hostname.replace(/\.$/, '').toLowerCase();
  // Return last two parts (covers .org, .com, .net, .eu, .de)
  // This is a simplified eTLD+1 — sufficient for our known blocklist.
  const parts = h.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : h;
}

// 3. Prohibited verb roots — demands phrased as requests, proposals or
//    improvement suggestions indicate a petition, not a public abuse report.
//    Includes common conjugations (1st person plural) to catch natural phrasing.
//    Matched with word boundaries to avoid false positives (e.g. "esperamos"
//    should not match "esperar" as a substring).
const PROHIBITED_VERB_ROOTS = [
  // Infinitivos ES
  'pedir', 'solicitar', 'rogar', 'proponer', 'sugerir', 'recomendar',
  'mejorar', 'agradecer', 'desear', 'esperar', 'apoyar', 'respaldar',
  // Conjugaciones 1ª persona plural ES (las más naturales en peticiones)
  'pedimos', 'solicitamos', 'rogamos', 'proponemos', 'sugerimos',
  'recomendamos', 'mejoramos', 'deseamos', 'esperamos', 'apoyamos',
  // EN
  'ask', 'request', 'beg', 'propose', 'suggest', 'recommend',
  'improve', 'thank', 'wish', 'hope', 'support', 'endorse',
  'we ask', 'we request', 'we propose', 'we suggest',
];

// 4. Required action verb roots — at least one must be present in demands.
//    NOTE: roots must be verb-specific to avoid colliding with nouns.
//    'public' was removed — it matches inside "público", "publicidad", etc.
const REQUIRED_VERB_ROOTS = [
  // ES — raíces verbales específicas
  'exigi', 'exig', 'denuncia', 'denunci', 'demanda', 'rechaza', 'condena',
  'cese', 'cesar', 'dimt', 'dimitir', 'investig', 'publiqu', 'publica',
  'revel', 'restitu', 'deten', 'suspend', 'paraliz', 'interp', 'acus',
  // ES conjugaciones
  'exigimos', 'denunciamos', 'demandamos', 'rechazamos', 'condenamos',
  'dimitimos', 'investigamos', 'revelamos', 'suspendemos',
  // EN
  'demand', 'denounce', 'reject', 'condemn', 'dismiss', 'resign',
  'investigate', 'reveal', 'restore', 'halt', 'suspend', 'prosecute',
];
const COUNTRY_RE      = /^[A-Z]{2}$/;

// ── Shared admission rules validator ──────────────────────────────────────
// Extracted as a standalone function so any future endpoint (e.g. an update
// endpoint) can reuse the same rules without risk of drift.
//
// Returns: { ok: true, computedTargetValidation } on pass
//          { ok: false, status, error, reason } on fail
//
// Does NOT call reply directly — the caller decides what to do with the result.
// Rule 4 calls Wikidata asynchronously; the function is therefore async.
async function validateAdmissionRules({ fuente_url, title, description, demands, tipo_abuso, target_wikidata_id }) {

  // Rule 1 — fuente_url must not be a petition platform
  let sourceDomain = '';
  try {
    const parsedUrl = new URL(fuente_url);
    sourceDomain = registrableDomain(parsedUrl.hostname);
  } catch {
    return { ok: false, status: 400, error: 'Invalid source URL format', reason: 'The source URL is not valid.' };
  }
  if (BLOCKED_SOURCE_DOMAINS.has(sourceDomain)) {
    return {
      ok: false, status: 400,
      error: 'Source not accepted',
      reason: 'Petition platforms are not accepted as documentary sources. Please provide a news article, official document or statistical data.',
    };
  }

  // Rule 2 — demands must not be phrased exclusively as requests or proposals
  // Scans title + description + demands to prevent hiding petition language
  // in fields other than demands. Uses word-boundary regex to avoid false
  // positives from substrings (e.g. "esperamos" matching "esperar",
  // "público" matching the now-removed root "public").
  const scanText = [title, description, demands].filter(Boolean).join(' ').toLowerCase();
  const wordBoundary = root => new RegExp(`\\b${root}\\b`, 'i');
  const hasProhibitedVerb = PROHIBITED_VERB_ROOTS.some(v => wordBoundary(v).test(scanText));
  const hasActionVerb     = REQUIRED_VERB_ROOTS.some(v => wordBoundary(v).test(scanText));

  if (hasProhibitedVerb && !hasActionVerb) {
    return {
      ok: false, status: 400,
      error: 'Demands not accepted',
      reason: 'Demands must use action verbs (demand, denounce, resign, investigate) not request verbs (ask, request, propose, suggest). Voice Protest is not a petition platform.',
    };
  }

  // Rule 3 — tipo_abuso must be from the closed list
  // Schema enum already enforces this, but we double-check to prevent
  // bypass through serialization edge cases.
  if (!VALID_ABUSE_TYPES.has(tipo_abuso)) {
    return {
      ok: false, status: 400,
      error: 'Invalid abuse type',
      reason: `tipo_abuso must be one of: ${[...VALID_ABUSE_TYPES].join(', ')}`,
    };
  }

  // Rule 4 — verify recipient server-side via Wikidata
  // Never trust target_validation from the client. We recompute it here
  // from target_wikidata_id and ignore whatever the client sent.
  // Privacy: only the entity ID is sent to Wikidata, no user data.
  let computedTargetValidation = 'NEEDS_REVIEW';
  if (target_wikidata_id) {
    computedTargetValidation = await verifyTargetBackend(target_wikidata_id);
    if (computedTargetValidation === 'REJECTED') {
      return {
        ok: false, status: 400,
        error: 'Recipient not accepted',
        reason: 'The recipient must be a public institution with a public mandate or public funds. Political parties, private companies and individuals are not accepted.',
      };
    }
  }

  return { ok: true, computedTargetValidation };
}

// ── Backend Wikidata target verification ───────────────────────────────────
// The frontend sends target_wikidata_id + target_validation, but we cannot
// trust the client-supplied validation status. A direct API caller can send
// target_validation:"ALLOWED" for any entity — including political parties.
// The backend must recompute this from target_wikidata_id itself.
//
// These lists mirror CreateScreen.vue ALLOWED_TYPES / REJECTED_TYPES exactly.
// Keep them in sync when updating the frontend lists.
const BACKEND_REJECTED_TYPES = new Set([
  'Q5',         // human being
  'Q4830453',   // business / for-profit company
  'Q431289',    // brand
  'Q476028',    // sports club
  'Q215380',    // music band
  'Q11424',     // film
  'Q7278',      // political party
  'Q7210356',   // political organisation
]);

const BACKEND_ALLOWED_TYPES = new Set([
  'Q1193236','Q11033','Q1004705','Q7275','Q2297946','Q1002697',
  'Q327333','Q37260','Q35749','Q637846','Q11204','Q15284',
  'Q6465','Q2659904','Q178706','Q1639634','Q270791',
  'Q15265344','Q3918','Q16917','Q178790','Q190928','Q35120','Q43229',
  'Q30185','Q1255921','Q294414','Q4164871','Q699567','Q83307',
  'Q372436','Q107363442','Q48352','Q2101','Q212238','Q13218630',
  'Q16533','Q193391','Q82955','Q1097498','Q15275719','Q42178','Q486839',
  'Q902522','Q62078547','Q875538','Q38723','Q189004','Q23002054',
  'Q166107','Q2085381','Q17320256','Q28863770','Q970671','Q1301371',
  'Q1149035','Q2188189','Q253019','Q1752939','Q4120845','Q6243229',
  'Q748720','Q31855','Q2275247',
  'Q93288','Q179076','Q170156','Q484652','Q7207745','Q1172599',
  'Q1063239','Q245065','Q388785','Q185441','Q1329623',
  'Q3550302','Q3559299','Q56289041','Q30461','Q11696','Q18810062',
  'Q1268020','Q234497','Q2615890','Q1752019','Q1302361','Q1311553',
  'Q324913','Q7257424','Q732717','Q768526','Q16970','Q163740',
]);

/**
 * Verify a Wikidata entity server-side.
 * Returns 'ALLOWED', 'REJECTED', or 'NEEDS_REVIEW'.
 * Never trusts the client-supplied target_validation.
 *
 * Privacy note: this call goes from our backend to Wikidata's public SPARQL
 * endpoint using the entity ID only — no user data is transmitted.
 */
async function verifyTargetBackend(wikidataId) {
  if (!wikidataId || !/^Q\d+$/.test(wikidataId)) return 'NEEDS_REVIEW';
  try {
    const sparql = `SELECT DISTINCT ?type WHERE {
      wd:${wikidataId} wdt:P31 ?type .
    } LIMIT 30`;
    const url = 'https://query.wikidata.org/sparql?query=' +
      encodeURIComponent(sparql) + '&format=json';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VoiceProtest/1.0 (voiceprotest.org)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return 'NEEDS_REVIEW';
    const json = await res.json();
    const types = json.results?.bindings ?? [];
    let allowed = false;
    for (const row of types) {
      const typeId = row.type?.value?.split('/').pop();
      if (BACKEND_REJECTED_TYPES.has(typeId)) return 'REJECTED';
      if (BACKEND_ALLOWED_TYPES.has(typeId)) allowed = true;
    }
    return allowed ? 'ALLOWED' : 'NEEDS_REVIEW';
  } catch {
    // Wikidata timeout or network error — fail safe to NEEDS_REVIEW,
    // not to ALLOWED. The event is created but stays pending review.
    return 'NEEDS_REVIEW';
  }
}

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
        required: ['title', 'country_name', 'scope', 'duration_h', 'fuente_url', 'tipo_abuso', 'demands'],
        properties: {
          title:        { type: 'string', minLength: 1, maxLength: 255 },
          description:  { type: 'string', maxLength: 5000 },
          demands:      { type: 'string', minLength: 10, maxLength: 2000 },
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
          convocatoria_osm_id:      { type: 'number', nullable: true },
          convocatoria_ciudad_nombre: { type: 'string', nullable: true },
          dominio_email:            { type: 'string', nullable: true },
          fuente_url:               { type: 'string', minLength: 10, maxLength: 2000 },
          tipo_abuso:               { type: 'string', enum: [...VALID_ABUSE_TYPES] },
          requiere_censo:           { type: 'boolean', nullable: true },
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
        convocatoria_osm_id, convocatoria_ciudad_nombre,
        fuente_url, tipo_abuso, requiere_censo,
        target_wikidata_id, target_type, target_country, target_validation } = req.body;

    const ends_at = new Date(
      new Date(starts_at ?? Date.now()).getTime() + duration_h * 3_600_000
    ).toISOString();

    // ── Backend admission rules ────────────────────────────────────────────
    // Delegated to validateAdmissionRules() — a shared function that can be
    // reused by any future endpoint without risk of the rules drifting apart.
    const admission = await validateAdmissionRules({
      fuente_url, title, description, demands, tipo_abuso, target_wikidata_id,
    });
    if (!admission.ok) {
      return reply.status(admission.status).send({
        error:  admission.error,
        reason: admission.reason,
      });
    }
    const { computedTargetValidation } = admission;

    // ── Local scope requires a municipality OSM ID ─────────────────────────
    // For local protests, the convocante must select a specific municipality
    // via the Nominatim search in the frontend. The osm_id is stored and used
    // later to classify participants by geographic proximity in the report.
    // GPS is NOT used as an exclusion filter — it is used as a signal that
    // enriches the report with local/national/international breakdown.
    if (scope === 'local' && !convocatoria_osm_id) {
      return reply.status(400).send({
        error: 'Municipality required',
        reason: 'Local protests must specify a municipality. Please select a municipality from the search.',
      });
    }

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
        convocatoria_osm_id: convocatoria_osm_id ?? null,
        convocatoria_ciudad_nombre: convocatoria_ciudad_nombre ?? null,
        dominio_email: dominio_email ?? null,
        fuente_url: fuente_url ?? null,
        tipo_abuso: tipo_abuso ?? null,
        requiere_censo: requiere_censo ?? false,
        // ── Wikidata target validation ──────────────────────────────────
        target_wikidata_id: target_wikidata_id ?? null,
        target_type:        target_type ?? null,
        target_country:     target_country ?? null,
        target_validation:  computedTargetValidation,
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
      supabase.from('protests').select('scope, country, saldo_euros, convocatoria_osm_id, convocatoria_ciudad_nombre').eq('id', req.params.id).maybeSingle(),
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

    return reply.code(201).send({
      receipt: data.id,
      scope: protest.scope,
      convocatoria_osm_id: protest.convocatoria_osm_id ?? null,
      convocatoria_ciudad_nombre: protest.convocatoria_ciudad_nombre ?? null,
    });
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

