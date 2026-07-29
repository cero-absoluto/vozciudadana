import { supabase } from '../services/supabase.js';
import { buildEvidentialScope } from '../lib/evidentialScope.js';
import { evaluateSource, BLOCKED_DOMAINS } from '../lib/sourceCheck.js';
import { verifyRecaptcha } from '../lib/recaptcha.js';
import { verifyParticipationToken } from '../lib/participationToken.js';
import { notifyIndexNow } from '../lib/indexNow.js';
import {
  createVerifiedAdhesion, AlreadyJoinedError, ProtestNotFoundError,
  ProtestClosedError, BalanceExhaustedError, NationalCountryMismatchError,
} from '../lib/adhesionService.js';

const VALID_SCOPES    = ['national', 'regional', 'local', 'global'];
const VALID_REGIONS   = ['region', 'provincia', 'ciudad', 'distrito', 'institucion'];
const VALID_RISK      = ['low', 'med', 'high', 'critical'];

// ── Backend admission rules — these mirror and enforce frontend validation ──
// Frontend = helps the user. Backend = real border. These rules cannot be
// bypassed by calling the API directly. All five checks are required because
// Voice Protest must not function as a petition platform.

// 1. Closed list of accepted abuse types — tipo_abuso is required and must
//    be one of these values. null or arbitrary strings are rejected.
//    Grounded in recognised public-integrity frameworks: UNCAC (corruption),
//    European Ombudsman / EU Charter art. 41 (maladministration), and the
//    ECHR / EU Charter (rights). The target must still be a public institution.
const VALID_ABUSE_TYPES = new Set([
  // — Integrity and corruption (UNCAC ch. III) —
  'corruption',           // Corruption, bribery or embezzlement (art. 15–17)
  'influence_peddling',   // Trading in influence (art. 18)
  'nepotism',             // Nepotism, favouritism or conflict of interest
  'illicit_enrichment',   // Illicit enrichment (art. 20)
  'procurement',          // Public procurement irregularities
  // — Maladministration (European Ombudsman / EU Charter art. 41) —
  'opacity',              // Opacity or lack of accountability
  'info_access',          // Denial of access to public information
  'undue_delay',          // Unjustified delay or administrative silence
  'discrimination',       // Discrimination or unequal treatment
  'negligence',           // Gross negligence or mismanagement of public services
  'legal_breach',         // Failure to fulfil a legal obligation
  // — Rights and liberties (ECHR / EU Charter) —
  'repression',           // Repression of protest or censorship
  'rights_violation',     // Violation of fundamental rights
  'excessive_force',      // Excessive use of force or police abuse
  'surveillance',         // Unlawful surveillance or privacy violation
  // — Catch-all —
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
async function validateAdmissionRules({ fuente_url, title, description, demands, tipo_abuso, target_wikidata_id, focal_point }) {

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

  // Rule 1a — social media / user-generated content platforms are not
  // accepted as a documentary source either. Voice Protest requires a
  // source someone else can independently check (a news article, official
  // document, dataset, or NGO report) — not a social media post, which can
  // be edited, deleted, or was never subject to any editorial process.
  if (BLOCKED_DOMAINS.has(sourceDomain)) {
    return {
      ok: false, status: 400,
      error: 'Source not accepted',
      reason: 'Social media posts are not accepted as documentary sources. Please provide a news article, official document, dataset or NGO report.',
    };
  }

  // Rule 1b — the source must have some real, checkable connection to the
  // reported event. This is deliberately NOT a quality bar — a source with
  // an unrecognised outlet or a weak topical match still passes. It exists
  // only to reject a URL that is disconnected from the event entirely (e.g.
  // pasting an arbitrary working link just to get past the form field).
  // Never blocks on reputation, language, or documentary strength — only on
  // "no connection found at all". See lib/sourceCheck.js for the full
  // rationale and the informational-vs-hard-gate distinction.
  let sourceInfo;
  try {
    sourceInfo = await evaluateSource(fuente_url, { title, demands, tipo_abuso, target_name: focal_point });
  } catch {
    return {
      ok: false, status: 400,
      error: 'Source not accepted',
      reason: 'The source URL could not be read. Please check the link and try again.',
    };
  }
  if (!sourceInfo.fetchOk) {
    return {
      ok: false, status: 400,
      error: 'Source not accepted',
      reason: 'The source URL could not be reached (it may be broken, offline, or return an error). Please provide a working link.',
    };
  }
  if (!sourceInfo.minimalConnection.ok) {
    return {
      ok: false, status: 400,
      error: 'Source not accepted',
      reason: 'We could not confirm that this source is related to the reported event — neither the recipient\'s name nor any distinctive word from the title or demands appears on the page. Please provide a source that actually discusses this event.',
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

  return { ok: true, computedTargetValidation, sourceInfo };
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
  'Q15265344','Q3918','Q16917','Q178790','Q190928','Q35120',
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
  'Q543654',  // ayuntamiento / city council (generic)
  'Q22996476', // ayuntamiento (Spanish specific — local government institution in Spain)
  'Q2074737', // municipality of Spain
]);

// Per-process cache of verdicts by entity ID. Only successful classifications
// are cached (never a transient timeout), so repeated targets are instant and
// resilient to brief Wikidata hiccups. Cleared on restart; a persistent table
// is the recommended next step so manual-review decisions accumulate.
const _targetCache = new Map();

/**
 * Verify a Wikidata entity server-side.
 * Returns 'ALLOWED', 'REJECTED', or 'NEEDS_REVIEW'.
 * Never trusts the client-supplied target_validation.
 *
 * Instead of matching only the entity's direct type (P31) against a flat list
 * of leaf QIDs — which forces us to enumerate every national institution type
 * by hand — we walk the subclass hierarchy transitively (P31/P279*) and match
 * the resulting class closure against a small set of public-institution
 * classes. A "ministry of X" or "city council of Y" is then recognised through
 * its parent classes automatically, without a per-country whitelist entry.
 *
 * ALLOWED takes precedence over REJECTED: a public enterprise is also, higher
 * up the tree, a "business", so we must let the allowed public class win;
 * a private company or a political party never reaches an allowed public class
 * and is therefore rejected.
 *
 * Privacy note: this call goes from our backend to Wikidata's public SPARQL
 * endpoint using the entity ID only — no user data is transmitted.
 */
async function verifyTargetBackend(wikidataId) {
  if (!wikidataId || !/^Q\d+$/.test(wikidataId)) return 'NEEDS_REVIEW';
  if (_targetCache.has(wikidataId)) return _targetCache.get(wikidataId);
  try {
    const sparql = `SELECT DISTINCT ?type WHERE {
      wd:${wikidataId} wdt:P31/wdt:P279* ?type .
    } LIMIT 400`;
    const url = 'https://query.wikidata.org/sparql?query=' +
      encodeURIComponent(sparql) + '&format=json';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VoiceProtest/1.0 (voiceprotest.org)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return 'NEEDS_REVIEW';
    const json = await res.json();
    const types = json.results?.bindings ?? [];
    let allowed = false, rejected = false;
    for (const row of types) {
      const typeId = row.type?.value?.split('/').pop();
      if (BACKEND_ALLOWED_TYPES.has(typeId))  allowed  = true;
      if (BACKEND_REJECTED_TYPES.has(typeId)) rejected = true;
    }
    const verdict = allowed ? 'ALLOWED' : (rejected ? 'REJECTED' : 'NEEDS_REVIEW');
    _targetCache.set(wikidataId, verdict);
    return verdict;
  } catch {
    // Wikidata timeout or network error — fail safe to NEEDS_REVIEW,
    // not to ALLOWED. The event is created but stays pending review.
    // Not cached, so a later retry can still classify the entity.
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
  // Threat-model review, 22 July 2026: creation previously had no
  // reCAPTCHA requirement and no route-specific rate limit — a scripted
  // flood of creation attempts could rack up real cost (each attempt
  // triggers a Wikidata lookup and a fetch of the source URL, in
  // validateAdmissionRules(), before ever being rejected) without a single
  // one needing to succeed. Both added here; unified in one review with
  // the /join endpoint's existing pattern rather than a separate ad hoc fix.
  app.post('/', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['title', 'country_name', 'scope', 'duration_h', 'fuente_url', 'tipo_abuso', 'demands', 'recaptcha_token'],
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
          convocatoria_lat:         { type: 'number', nullable: true },
          convocatoria_lon:         { type: 'number', nullable: true },
          dominio_email:            { type: 'string', nullable: true },
          fuente_url:               { type: 'string', minLength: 10, maxLength: 2000 },
          tipo_abuso:               { type: 'string', enum: [...VALID_ABUSE_TYPES] },
          requiere_censo:           { type: 'boolean', nullable: true },
          target_wikidata_id: { type: 'string', nullable: true },
          target_type:        { type: 'string', nullable: true },
          target_country:     { type: 'string', nullable: true },
          target_validation:  { type: 'string', nullable: true },
          recaptcha_token:    { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { title, description, demands, country, country_name, scope, region,
        focal_point, category, duration_h, starts_at, risk_level,
        convocatoria_pais, convocatoria_region, convocatoria_institucion, dominio_email,
        convocatoria_osm_id, convocatoria_ciudad_nombre,
        convocatoria_lat, convocatoria_lon,
        fuente_url, tipo_abuso, requiere_censo,
        target_wikidata_id, target_type, target_country, target_validation,
        recaptcha_token } = req.body;

    await verifyRecaptcha(recaptcha_token, 'create_protest', req, reply);

    const ends_at = new Date(
      new Date(starts_at ?? Date.now()).getTime() + duration_h * 3_600_000
    ).toISOString();

    // ── Backend admission rules ────────────────────────────────────────────
    // Delegated to validateAdmissionRules() — a shared function that can be
    // reused by any future endpoint without risk of the rules drifting apart.
    const admission = await validateAdmissionRules({
      fuente_url, title, description, demands, tipo_abuso, target_wikidata_id, focal_point,
    });
    if (!admission.ok) {
      return reply.status(admission.status).send({
        error:  admission.error,
        reason: admission.reason,
      });
    }
    const { computedTargetValidation, sourceInfo } = admission;

    // ── Local/regional scopes require an OSM geographic entity ─────────────
    // Both local and regional scopes require an OSM geographic entity to enable
    // the three-tier geographic breakdown in the public report.
    // EXCEPTION: institutional convocatorias (those carrying an institutional
    // email domain) are a distinct participation model verified by email, not by
    // geography — they reuse scope='regional' internally but require no OSM entity.
    if ((scope === 'local' || scope === 'regional') && !convocatoria_osm_id && !dominio_email) {
      return reply.status(400).send({
        error: 'Geographic entity required',
        reason: scope === 'local'
          ? 'Local protests must specify a municipality. Please select a municipality from the search.'
          : 'Regional protests must specify a region. Please select a region from the search.',
      });
    }

    // ── Institutional convocatorias must declare the institution's country ─────
    // Eligibility stays by email (not territorial), but the country places the
    // institution on the map so it can be reached through the country-first
    // navigation. Without it the convocatoria would be unreachable on the map.
    if (dominio_email && !convocatoria_pais) {
      return reply.status(400).send({
        error: 'Country required',
        reason: "Institutional convocatorias must declare the institution's country so they appear on the map.",
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
        convocatoria_lat: convocatoria_lat ?? null,
        convocatoria_lon: convocatoria_lon ?? null,
        dominio_email: dominio_email ?? null,
        fuente_url: fuente_url ?? null,
        tipo_abuso: tipo_abuso ?? null,
        requiere_censo: requiere_censo ?? false,
        // ── Wikidata target validation ──────────────────────────────────
        target_wikidata_id: target_wikidata_id ?? null,
        target_type:        target_type ?? null,
        target_country:     target_country ?? null,
        target_validation:  computedTargetValidation,
        // ── Source quality snapshot (informational — see lib/sourceCheck.js) ──
        source_type:              sourceInfo.sourceType,
        source_confidence_score:  sourceInfo.confidenceScore,
        source_checked_at:        new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    notifyIndexNow(supabase, data.id, req.log); // fire-and-forget, never blocks the response
    return reply.code(201).send(data);
  });

  // POST /api/protests/:id/join — anonymous adhesion
  //
  // VP-SEC-001 fix (23 July 2026): this endpoint used to accept phone_hash
  // and device_id directly from the client body and trust them outright.
  // Fixed with a signed participation_token (see routes/users.js).
  //
  // VP-SEC-008 fix (Fase 2 — Despliegue A, 23 July 2026): the actual
  // creation of the adhesion — nullifier, geocoding, the insert, the count
  // increment — no longer lives here. It is delegated to
  // AdhesionService.createVerifiedAdhesion(), the single authorised place
  // in the application allowed to create an adhesion, shared with the
  // institutional path once it migrates (Despliegue B). This route's job,
  // per the auditor's division of responsibility, is only to prove that
  // THIS identity is authentic — not to decide what it may do.
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
        required: ['participation_token', 'recaptcha_token'],
        properties: {
          participation_token: { type: 'string', minLength: 1 },
          doc_hash:        { type: 'string', minLength: 64, maxLength: 64, nullable: true },
          recaptcha_token: { type: 'string', minLength: 1 },
          gps_lat:         { type: 'number', nullable: true },
          gps_lng:         { type: 'number', nullable: true },
          gps_accuracy:    { type: 'number', nullable: true },
          sms_sent:        { type: 'boolean', nullable: true },
          ip_ciudad:       { type: 'string', nullable: true },
          ip_pais:         { type: 'string', nullable: true },
          ip_region:       { type: 'string', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { participation_token, doc_hash, recaptcha_token,
      gps_lat, gps_lng, gps_accuracy, sms_sent } = req.body;
    await verifyRecaptcha(recaptcha_token, 'join_protest', req, reply);

    const tokenPayload = verifyParticipationToken(participation_token, { expectedPurpose: 'join_protest' });
    if (!tokenPayload) {
      return reply.code(401).send({ error: 'VERIFICATION_REQUIRED', reason: 'Missing, invalid, or expired verification. Please verify your phone number again.' });
    }
    const { device_id, phone_hash } = tokenPayload;

    // Auditor's explicit requirement: never trust the token's payload blindly
    // for identity — re-check the device it names against the database.
    // This is what lets a device be revoked or invalidated (e.g. suspected
    // compromise, abuse) even while a previously-issued token has not yet
    // expired: the token proves "this was really issued after a real OTP,
    // at some point" — this check proves "and that is still true right now."
    const { data: device } = await supabase
      .from('devices')
      .select('id, phone_hash, verified_at, country_code')
      .eq('id', device_id)
      .maybeSingle();
    if (!device || device.phone_hash !== phone_hash || !device.verified_at) {
      return reply.code(401).send({ error: 'VERIFICATION_REQUIRED', reason: 'Missing, invalid, or expired verification. Please verify your phone number again.' });
    }

    // Fetched here (not only inside the service) because the route itself
    // still needs scope/saldo for concerns that are its own, not the
    // service's: SMS billing, milestone push notifications, and issuing the
    // GPS-reinforcement token — none of which are part of "can this
    // adhesion exist," which is what the service decides.
    const { data: protest, error: protestErr } = await supabase
      .from('protests')
      .select('scope, saldo_euros, convocatoria_osm_id, convocatoria_ciudad_nombre')
      .eq('id', req.params.id)
      .maybeSingle();
    if (protestErr || !protest) return reply.notFound('Protest not found');

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    const idioma = req.headers['accept-language']?.split(',')[0] || null;

    let data;
    try {
      data = await createVerifiedAdhesion({
        protestId: req.params.id,
        identity: {
          subjectHash: phone_hash,
          method: 'phone_otp',
          deviceId: device_id,
          countryCode: device.country_code,
          institutionalDomain: null,
        },
        location: { latitude: gps_lat ?? null, longitude: gps_lng ?? null, accuracyMeters: gps_accuracy ?? null, ip, language: idioma },
        documentHash: doc_hash ?? null,
        institutionalMembership: null,
      });
    } catch (err) {
      if (err instanceof AlreadyJoinedError) return reply.code(409).send({ error: err.code, reason: err.message });
      if (err instanceof ProtestNotFoundError) return reply.notFound(err.message);
      if (err instanceof ProtestClosedError) return reply.code(410).send({ error: err.code, reason: err.message });
      if (err instanceof BalanceExhaustedError) return reply.status(402).send({ code: 'SALDO_AGOTADO', error: err.message });
      if (err instanceof NationalCountryMismatchError) return reply.status(403).send({ code: err.code, error: err.message });
      throw err;
    }

    // Descontar saldo por adhesion — solo si se envió SMS real (sms_sent !== false)
    if (protest.saldo_euros !== null && protest.saldo_euros > 0 && sms_sent !== false) {
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

    // Generate a single-use GPS update token — auditor requirement:
    // nullifier must never travel to the client; use a separate token instead.
    // Issued for BOTH local and regional scopes: territorial verification
    // applies to any convocatoria with a declared OSM territory.
    // (Bug fixed July 2026: token was local-only, which made the entire
    // regional reinforcement flow unreachable — the button appeared, GPS was
    // requested, but no PATCH could ever be sent. Third bug of the same
    // 'local-only' family, after the button visibility and the reverse-geocode
    // zoom; full chain now audited end to end.)
    let gps_update_token = null;
    if (protest.scope === 'local' || protest.scope === 'regional') {
      const { randomUUID } = await import('crypto');
      gps_update_token = randomUUID();
      const { error: tokErr } = await supabase.from('gps_update_tokens').insert({
        token:       gps_update_token,
        adhesion_id: data.id,
        protest_id:  req.params.id,
      });
      if (tokErr) {
        // Never hand the client a token that does not exist in the database —
        // the later PATCH would 404 and the failure would be undiagnosable.
        req.log.error({ tokErr }, 'gps_update_token insert failed — reinforcement disabled for this adhesion');
        gps_update_token = null;
      } else {
        req.log.info({ adhesion_id: data.id, scope: protest.scope }, 'gps_update_token issued');
      }
    }

    // ── Territorial match (separate axis from geographic confidence) ────────
    // local_verified answers "is this participant physically inside the
    // convocatoria's declared territory?" — derived from the GPS→OSM entity,
    // NOT from the device confidence score (which only measures signal quality).
    // The two must never be conflated by readers of the report.
    const isTerritorial = (protest.scope === 'local' || protest.scope === 'regional') && protest.convocatoria_osm_id != null;

    // local_verified: primary check is OSM ID match (most precise).
    // Fallback: name match against convocatoria_ciudad_nombre — handles cases
    // where Nominatim returns a different OSM object ID for the same territory
    // depending on zoom level or object type (relation vs node vs way).
    let local_verified = null;
    if (isTerritorial && data.adhesion_osm_id != null) {
      if (data.adhesion_osm_id === protest.convocatoria_osm_id) {
        // Primary: exact OSM ID match
        local_verified = true;
      } else if (protest.convocatoria_ciudad_nombre && (data.region || data.ciudad)) {
        // Fallback: normalize and compare region name
        const normalize = s => s?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
        const territoryName = protest.scope === 'local' ? (data.ciudad || data.region) : data.region;
        local_verified = normalize(territoryName) === normalize(protest.convocatoria_ciudad_nombre);
      } else {
        local_verified = false;
      }
    } else if (isTerritorial) {
      local_verified = false;
    }

    return reply.code(201).send({
      receipt: data.id,
      scope: protest.scope,
      convocatoria_osm_id: protest.convocatoria_osm_id ?? null,
      convocatoria_ciudad_nombre: protest.convocatoria_ciudad_nombre ?? null,
      local_verified,
      geo_scope_match:  isTerritorial ? (protest.scope === 'local' ? 'municipality' : 'region') : null,
      geo_scope_source: (isTerritorial && data.adhesion_osm_id != null) ? 'gps_osm' : null,
      gps_update_token,
    });
  });

  // PATCH /api/protests/:id/adhesion — update GPS data post-adhesion
  // Auditor conditions (June 2026):
  // - nullifier never sent to client — uses single-use token instead
  // - GPS update is one-time only (token invalidated after use)
  // - Token expires after 24h
  // - Fiabilidad recalculated with GPS signal
  app.patch('/:id/adhesion', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['gps_update_token', 'gps_lat', 'gps_lng'],
        properties: {
          gps_update_token: { type: 'string' },
          gps_lat:          { type: 'number' },
          gps_lng:          { type: 'number' },
          gps_accuracy:     { type: 'number', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { gps_update_token, gps_lat, gps_lng, gps_accuracy } = req.body;

    // VP-SEC-004 fix (23 July 2026): same validation as POST /:id/join — an
    // out-of-range value here was previously accepted at face value with no
    // check at all.
    if (gps_lat < -90 || gps_lat > 90 || gps_lng < -180 || gps_lng > 180 ||
        (gps_accuracy != null && (gps_accuracy <= 0 || gps_accuracy > 50_000))) {
      return reply.badRequest('GPS coordinates out of range');
    }

    // Validate token — must exist, not used, not expired, match protest
    const { data: tokenRow } = await supabase
      .from('gps_update_tokens')
      .select('adhesion_id, used, expires_at, protest_id')
      .eq('token', gps_update_token)
      .maybeSingle();

    if (!tokenRow) return reply.status(404).send({ error: 'Token not found' });
    if (tokenRow.used) return reply.status(409).send({ error: 'Token already used' });
    if (new Date(tokenRow.expires_at) < new Date()) return reply.status(410).send({ error: 'Token expired' });
    if (tokenRow.protest_id !== req.params.id) return reply.status(403).send({ error: 'Token mismatch' });

    // Fetch the protest scope — needed to reverse-geocode at the correct OSM
    // admin level. Must mirror the adhesion-creation logic exactly: zoom=6 for
    // regional (region entity), zoom=10 for local (municipality entity).
    // (Bug fixed July 2026: this endpoint previously hardcoded zoom=10, so GPS
    // reinforcement on REGIONAL convocatorias derived a municipality osm_id
    // that could never match the region's convocatoria_osm_id — participants
    // physically inside the region were misclassified as gps_nacional.)
    const { data: patchProtest } = await supabase
      .from('protests')
      .select('scope')
      .eq('id', tokenRow.protest_id)
      .maybeSingle();

    // Reverse geocode GPS coordinates via Nominatim (backend proxy — user IP not exposed)
    const zoomLevel = patchProtest?.scope === 'regional' ? 6 : 10;
    let adhesion_osm_id = null;
    let ciudad = null, region = null, pais = null, pais_code = null;
    try {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${gps_lat}&lon=${gps_lng}&format=json&zoom=${zoomLevel}`,
        { headers: { 'Accept-Language': 'es', 'User-Agent': 'VoiceProtest/1.0' }, signal: AbortSignal.timeout(6000) }
      );
      const geoData = await geoRes.json();
      ciudad = geoData.address?.city || geoData.address?.town || geoData.address?.village || null;
      region = geoData.address?.state || geoData.address?.county || null;
      pais   = geoData.address?.country || null;
      pais_code = geoData.address?.country_code?.toUpperCase() || null;
      if (geoData.osm_id) adhesion_osm_id = parseInt(geoData.osm_id);
      req.log.info({ zoomLevel, adhesion_osm_id, osm_name: geoData.display_name?.slice(0, 60) }, 'GPS reinforcement: reverse geocode result');
    } catch { /* silencioso — GPS update proceeds without osm_id */ }

    // Recalculate fiabilidad with GPS signal
    // GPS + SIM = 92%, GPS + SIM + IP = 95%
    const { data: adhesion } = await supabase
      .from('adhesions')
      .select('senales, fiabilidad')
      .eq('id', tokenRow.adhesion_id)
      .maybeSingle();

    let nuevaFiabilidad = adhesion?.fiabilidad || 75;
    let senales = adhesion?.senales ? adhesion.senales.split(',') : [];
    if (!senales.includes('gps')) {
      senales.push('gps');
      if (senales.includes('sim') && senales.includes('ip')) nuevaFiabilidad = 95;
      else if (senales.includes('sim')) nuevaFiabilidad = 92;
      else nuevaFiabilidad = 60;
    }

    // Update adhesion — single write.
    //
    // Bug fixed 24 July 2026 (found via a real test case: joined without
    // GPS — ciudad/region set from IP fallback to a wrong city hundreds of
    // km away, a known failure mode already documented in the Methodology
    // — then confirmed GPS on the reinforcement card). This UPDATE
    // previously deliberately left ciudad/region/pais untouched, on the
    // assumption "they were set correctly at join time from IP" — an
    // assumption already contradicted by the project's own documented
    // empirical finding about mobile-carrier IP geolocation, before this
    // line was even written. The result: gps_confirmed flipped to true and
    // adhesion_osm_id updated to the correct region, while the human-
    // readable ciudad/region text silently kept showing the old, wrong,
    // IP-derived city — an internal inconsistency between the machine-
    // matched OSM id and the displayed place name. Now both update together,
    // from the same reverse-geocode call, so they can never disagree.
    //
    // GPS coordinates (gps_lat/gps_lng/gps_accuracy) are still NEVER stored:
    // those columns were removed in migration 20260607_gps_confirmed.sql to
    // align the database with the privacy policy. GPS is used here only to
    // reverse-geocode and derive osm_id/ciudad/region/pais; the coordinates
    // themselves are discarded immediately after this call.
    // Only overwrite the geographic text fields if this reverse-geocode call
    // actually returned something — if Nominatim timed out or failed (the
    // catch above), ciudad/region/pais/pais_code are all still null here,
    // and silently including them in the update would overwrite whatever
    // was already correctly stored with nothing. Omitting them from the
    // object entirely (rather than passing null) leaves the existing
    // database values untouched in that case.
    const geoFields = (ciudad || region || pais) ? { ciudad, region, pais, pais_code } : {};

    const { error: updErr } = await supabase.from('adhesions').update({
      gps_confirmed:   true,
      adhesion_osm_id,
      ...geoFields,
      fiabilidad:      nuevaFiabilidad,
      senales:         senales.join(','),
    }).eq('id', tokenRow.adhesion_id);
    if (updErr) {
      req.log.error({ updErr }, 'GPS reinforcement update failed');
      return reply.status(500).send({ error: 'GPS update failed' });
    }

    // Invalidate token — one-time use
    await supabase.from('gps_update_tokens').update({ used: true }).eq('token', gps_update_token);

    req.log.info({ adhesion_id: tokenRow.adhesion_id, fiabilidad: nuevaFiabilidad, adhesion_osm_id }, 'GPS reinforcement completed');
    return { ok: true, fiabilidad: nuevaFiabilidad, adhesion_osm_id };
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
  // The only endpoint genuinely fetched from third-party origins — widget.js,
  // embedded on someone else's page, calls this directly. Everything else
  // uses the restrictive default set in server.js (VP-SEC-006 fix).
  app.get('/:id/informe', {
    config: { cors: { origin: true } },
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
      .select('ciudad, region, pais, pais_code, idioma, created_at, gps_confirmed, fiabilidad, senales, adhesion_osm_id')
      .eq('protest_id', req.params.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    const ciudades = [...new Set(adhesions.map(a => a.ciudad).filter(Boolean))];
    // Use pais_code (ISO) preferentially — more reliable than pais name.
    // For GPS-confirmed adhesions, the GPS country takes priority over IP country
    // since IP geolocation can misclassify WiFi connections (e.g. Santander WiFi
    // appearing as a foreign country). Falls back to pais name for legacy rows.
    const getPaisCode = (a) => {
      if (a.gps_confirmed && a.pais_code) return a.pais_code;
      return a.pais_code || (a.pais ? a.pais.slice(0,2).toUpperCase() : null);
    };
    const paises = [...new Set(adhesions.map(getPaisCode).filter(Boolean))];
    const idiomas = [...new Set(adhesions.map(a => a.idioma).filter(Boolean))];

    const distribucion_regiones = adhesions.reduce((acc, a) => {
      if (a.region) acc[a.region] = (acc[a.region] || 0) + 1;
      return acc;
    }, {});

    const adhesiones_con_gps = adhesions.filter(a => a.gps_confirmed === true).length;

    // ── Local scope geographic breakdown ──────────────────────────────────
    // For local protests, classify adhesions into three tiers:
    // 1. GPS confirmed within the declared municipality (osm_id match)
    // 2. National participants (SIM from same country, no local GPS)
    // 3. International participants (SIM from different country)
    let desglose_geografico_local = null;
    if ((protest.scope === 'local' || protest.scope === 'regional') && protest.convocatoria_osm_id) {
      // OSM ID match (primary) OR region name match (fallback for same-territory
      // different-object cases where Nominatim returns a different ID at zoom=6)
      const normalize = s => s?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const isLocalVerified = (a) => {
        if (!a.gps_confirmed) return false;
        if (a.adhesion_osm_id && a.adhesion_osm_id === protest.convocatoria_osm_id) return true;
        if (protest.convocatoria_ciudad_nombre) {
          // For local scope: compare city name; for regional: compare region name
          const territoryName = protest.scope === 'local' ? (a.ciudad || a.region) : a.region;
          if (territoryName) return normalize(territoryName) === normalize(protest.convocatoria_ciudad_nombre);
        }
        return false;
      };
      const gps_local = adhesions.filter(isLocalVerified).length;
      const gps_nacional = adhesions.filter(a =>
        a.gps_confirmed && !isLocalVerified(a)
      ).length;
      // Country match by ISO code, never by localized name.
      // (Bug fixed July 2026: adhesion `pais` arrives in English from ipapi
      // ("Spain") or Spanish from Nominatim ("España"), while
      // protest.country_name is Spanish — name comparison misclassified every
      // no-GPS domestic participant as international. protest.country holds
      // the ISO code selected at creation.)
      const sameCountry = (a) => {
        if (a.pais_code && protest.country) return a.pais_code === protest.country;
        // Legacy rows without pais_code: best-effort name comparison
        return a.pais === protest.country_name;
      };
      const nacionales_sin_gps = adhesions.filter(a =>
        !a.gps_confirmed && (sameCountry(a) || (!a.pais && !a.pais_code))
      ).length;
      const internacionales = adhesions.filter(a =>
        (a.pais || a.pais_code) && !sameCountry(a) && !a.gps_confirmed
      ).length;

      desglose_geografico_local = {
        // For regional scope, this is the region name; for local, the municipality name
        municipio: protest.convocatoria_ciudad_nombre,
        scope: protest.scope,
        gps_local,
        gps_nacional,
        nacionales_sin_gps,
        internacionales,
        total: adhesions.length,
        // Explicit, named territorial-verification field. Kept deliberately
        // separate from any confidence/fiabilidad metric: local_verified means
        // "GPS placed the participant inside the convocatoria's declared OSM
        // entity", NOT "high signal confidence". Journalists, participants and
        // auditors must not read a confidence percentage as territorial belonging.
        local_verified: {
          count:            gps_local,
          total:            adhesions.length,
          geo_scope_match:  protest.scope === 'local' ? 'municipality' : 'region',
          geo_scope_source: 'gps_osm',
        },
      };
    }

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

    // Statement of Evidential Scope — deterministic, generated from the report
    // metadata (scope, dominio_email, requiere_censo, local_verified). It cannot
    // be authored or edited by the convocatoria creator; it is part of the
    // evidence system, exactly like the integrity hash. participation_rate stays
    // null unless a real, auditable registered census exists for the convocatoria
    // (census_eligible is intentionally not passed until that exists — never estimated).
    const evidential_scope = buildEvidentialScope(protest, {
      total: protest.count,
      desglose_geografico_local,
      paises_distintos: paises.length,
    });

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
      desglose_geografico_local,
      evidential_scope,
    };
  });
}

/**
 * Verify a reCAPTCHA v3 token server-side.
 */
// verifyRecaptcha now lives in lib/recaptcha.js — shared with routes/users.js,
// which used to have its own separate, drifted copy (VP-SEC-007 fix).


