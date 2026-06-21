import { supabase } from '../services/supabase.js';

// ── Blocked IP ranges and schemes ─────────────────────────────────────────
const BLOCKED_SCHEMES = ['file:', 'ftp:', 'data:', 'javascript:'];
const PRIVATE_HOSTNAMES = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/ ;

// ── Domain classification via known lists ──────────────────────────────────
const OFFICIAL_TLDS = ['.gov', '.gob', '.gov.uk', '.gov.au', '.gov.br', '.gob.es',
  '.gob.mx', '.gouv.fr', '.gouv.be', '.gc.ca', '.europa.eu', '.un.org',
  '.who.int', '.oecd.org', '.worldbank.org', '.imf.org', '.eur-lex.europa.eu'];

const UNIVERSITY_MEDIA = new Set([
  'dub.uu.nl', 'dub.nl',           // Utrecht University news
  'dare.uva.nl',                    // Amsterdam University
  'cursor.tue.nl',                  // TU Eindhoven
  'sg.uu.nl',                       // Utrecht student media
]);

const KNOWN_OFFICIAL = new Set([
  'boe.es', 'congreso.es', 'senado.es', 'poderjudicial.es', 'ine.es',
  'rtve.es', 'europarl.europa.eu', 'un.org', 'who.int', 'oecd.org',
  'worldbank.org', 'imf.org', 'amnesty.org', 'hrw.org', 'transparency.org',
  'bbc.co.uk', 'bbc.com', 'reuters.com', 'apnews.com', 'theguardian.com',
  'ft.com', 'economist.com', 'lemonde.fr', 'spiegel.de', 'elpais.com',
  'lavanguardia.com', 'elmundo.es', 'abc.es', 'publico.es',
  'nytimes.com', 'washingtonpost.com', 'politico.eu', 'euronews.com',
]);

const BLOCKED_DOMAINS = new Set([
  'facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
  'youtube.com', 'reddit.com', 'whatsapp.com', 'telegram.org',
  'medium.com', 'substack.com', 'blogspot.com', 'wordpress.com',
]);

// ── Domain type classification ─────────────────────────────────────────────
function classifyDomain(domain, wikidataType) {
  if (wikidataType) return wikidataType;
  if (OFFICIAL_TLDS.some(tld => domain.endsWith(tld))) return 'official_government';
  if (domain.endsWith('.edu') || domain.endsWith('.ac.uk')) return 'academic';

  // Check both the full domain and its registrable domain (eTLD+1)
  // so subdomains like eldiariocantabria.publico.es are classified correctly.
  const parts = domain.replace(/\.$/, '').split('.');
  const registrable = parts.length >= 2 ? parts.slice(-2).join('.') : domain;

  const domainToCheck = KNOWN_OFFICIAL.has(domain) ? domain : (KNOWN_OFFICIAL.has(registrable) ? registrable : null);

  if (domainToCheck) {
    if (['bbc.com','bbc.co.uk','rtve.es','euronews.com'].includes(domainToCheck)) return 'public_broadcaster';
    if (['reuters.com','apnews.com','theguardian.com','ft.com','nytimes.com',
         'washingtonpost.com','elpais.com','elmundo.es','lavanguardia.com',
         'lemonde.fr','spiegel.de','economist.com'].includes(domainToCheck)) return 'reputable_media';
    if (['amnesty.org','hrw.org','transparency.org'].includes(domainToCheck)) return 'ngo';
    return 'public_institution';
  }
  if (UNIVERSITY_MEDIA.has(domain)) return 'academic';
  if (BLOCKED_DOMAINS.has(domain)) return 'blocked';
  return 'unknown';
}

// ── Domain confidence base score ───────────────────────────────────────────
function domainBaseScore(sourceType) {
  const scores = {
    official_government: 35,
    parliament:          35,
    court:               35,
    public_institution:  30,
    public_broadcaster:  28,
    academic:            28,
    reputable_media:     25,
    dataset:             30,
    ngo:                 20,
    unknown:             5,
    blocked:             0,
  };
  return scores[sourceType] ?? 5;
}

// ── Keyword relevance score ────────────────────────────────────────────────
function computeRelevance(sourceText, { title = '', demands = '', tipo_abuso = '', target_name = '' }) {
  if (!sourceText) return 0;
  const haystack = sourceText.toLowerCase();
  const needles  = [title, demands, tipo_abuso, target_name]
    .join(' ')
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 4);

  if (needles.length === 0) return 15; // no context provided — neutral
  const hits = needles.filter(w => haystack.includes(w)).length;
  const ratio = hits / needles.length;
  return Math.round(ratio * 30); // max 30 points
}

// ── Safe URL fetch with timeout and size limit ─────────────────────────────
async function safeFetch(url, timeoutMs = 8000, maxBytes = 500_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'VoiceProtest-SourceValidator/1.0 (+https://voiceprotest.org)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en,es;q=0.9',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html') && !contentType.includes('text') && !contentType.includes('json')) {
      return { ok: false, reason: 'non_html', status: res.status };
    }

    // Stream with size limit
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { reader.cancel(); break; }
      chunks.push(value);
    }
    const html = new TextDecoder().decode(
      new Uint8Array(chunks.reduce((acc, c) => [...acc, ...c], []))
    );
    return { ok: true, html, status: res.status, finalUrl: res.url };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'fetch_error', message: e.message };
  }
}

// ── Metadata extraction from HTML ─────────────────────────────────────────
function extractMeta(html, baseUrl) {
  const get = (pattern) => { const m = html.match(pattern); return m?.[1]?.trim() || null; };

  const title =
    get(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i) ||
    get(/<meta[^>]+name="twitter:title"[^>]+content="([^"]+)"/i) ||
    get(/<title[^>]*>([^<]+)<\/title>/i);

  const description =
    get(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i) ||
    get(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);

  const canonical =
    get(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i) ||
    get(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i) ||
    baseUrl;

  const image =
    get(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);

  const author =
    get(/<meta[^>]+name="author"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+property="article:author"[^>]+content="([^"]+)"/i);

  const publishedAt =
    get(/<meta[^>]+property="article:published_time"[^>]+content="([^"]+)"/i) ||
    get(/<meta[^>]+name="date"[^>]+content="([^"]+)"/i) ||
    get(/"datePublished"\s*:\s*"([^"]+)"/i);

  const language =
    get(/<html[^>]+lang="([^"]+)"/i) ||
    get(/<meta[^>]+property="og:locale"[^>]+content="([^"]+)"/i);

  // Extract first meaningful paragraphs as preview text
  const bodyText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 2000)
    .trim();

  return { title, description, canonical, image, author, publishedAt, language, bodyText };
}

// ── Wikidata domain lookup ─────────────────────────────────────────────────
async function wikidataDomainLookup(domain) {
  try {
    const query = `SELECT ?typeLabel WHERE {
      ?item wdt:P856 ?url .
      ?item wdt:P31 ?type .
      FILTER(CONTAINS(LCASE(str(?url)), "${domain}"))
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
    } LIMIT 3`;
    const res = await fetch(
      'https://query.wikidata.org/sparql?query=' + encodeURIComponent(query) + '&format=json',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    return data.results?.bindings?.[0]?.typeLabel?.value || null;
  } catch { return null; }
}

// ── Validation status from score ───────────────────────────────────────────
function statusFromScore(score) {
  if (score >= 80) return 'VERIFIED_SOURCE';
  if (score >= 60) return 'RELEVANT_SOURCE';
  if (score >= 40) return 'WEAK_SOURCE';
  return 'NEEDS_REVIEW';
}

function messageForStatus(status, sourceType) {
  // Language rule: we describe documentary quality, never truth or credibility.
  // Per Audit Alignment Framework v2.1: "Voice Protest does not assess the
  // truthfulness of claims. It may provide informational indicators regarding
  // the documentary quality and apparent relevance of sources submitted by
  // event creators."
  switch (status) {
    case 'VERIFIED_SOURCE':
      return 'Your event has a strong documentary basis.';
    case 'RELEVANT_SOURCE':
      return 'Your event has a reasonable documentary basis.';
    case 'WEAK_SOURCE':
      return 'Your supporting source may not be clearly related to the reported issue. Consider providing a more specific source.';
    case 'UNAVAILABLE_SOURCE':
      return 'The source could not be accessed. It may be behind a paywall or temporarily unavailable. Participants will not be able to verify it directly.';
    case 'PAYWALLED_SOURCE':
      return 'The source appears to be behind a paywall. It has been recorded but participants may not be able to access it directly.';
    case 'UNRELATED_SOURCE':
      return 'The relationship between the submitted source and the reported issue is unclear. Participants may find it difficult to understand the documentary basis of the event.';
    case 'BLOCKED_SOURCE':
      return 'This type of source is not accepted. Please provide a news article, official document or dataset.';
    default:
      return 'The source requires manual review before the event can be published.';
  }
}

// ── Event-level documentary score ─────────────────────────────────────────
// Combines source quality, institutional verification, action verb presence,
// and documentary relevance into a single informational indicator shown to
// the event creator. This score describes documentary quality only — it does
// not assess truth, legitimacy or representativeness.
// It is never used to block publication (only hard admission rules block).
function computeEventScore({ sourceScore, sourceStatus, hasActionVerb, hasBlockedVerb, wikidataVerified, relevanceScore }) {
  let score = 0;

  // Source quality (max 35)
  if (sourceStatus === 'VERIFIED_SOURCE')  score += 35;
  else if (sourceStatus === 'RELEVANT_SOURCE')  score += 25;
  else if (sourceStatus === 'WEAK_SOURCE')       score += 10;
  else if (sourceStatus === 'PAYWALLED_SOURCE')  score += 8;

  // Institution verified as public in Wikidata (max 20)
  if (wikidataVerified) score += 20;

  // Action verb present in demands (max 20)
  if (hasActionVerb && !hasBlockedVerb) score += 20;
  else if (hasActionVerb && hasBlockedVerb) score += 10; // mixed — partial

  // Documentary relevance: article text ↔ title+demands (max 30, already computed)
  score += Math.min(relevanceScore || 0, 30);

  return Math.min(100, Math.max(0, score));
}

function eventScoreMessage(score) {
  if (score >= 70) return 'Your event has a strong documentary basis.';
  if (score >= 40) return 'Your supporting source may not be clearly related to the reported issue. Consider providing a more specific source.';
  return 'The relationship between the submitted source and the reported issue is unclear. Participants may find it difficult to understand the documentary basis of the event.';
}

// ── Main route handler ─────────────────────────────────────────────────────
/** @param {import('fastify').FastifyInstance} app */
export default async function sourceRoutes(app) {

  app.post('/validate', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['source_url'],
        properties: {
          source_url:       { type: 'string', minLength: 10, maxLength: 2000 },
          title:            { type: 'string', maxLength: 255, default: '' },
          demands:          { type: 'string', maxLength: 2000, default: '' },
          tipo_abuso:       { type: 'string', maxLength: 120, default: '' },
          target_name:      { type: 'string', maxLength: 255, default: '' },
          has_action_verb:  { type: 'boolean', default: false },
          has_blocked_verb: { type: 'boolean', default: false },
          wikidata_verified:{ type: 'boolean', default: false },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { source_url, title = '', demands = '', tipo_abuso = '', target_name = '' } = req.body;

    // ── 1. Parse and validate URL ────────────────────────────────────────
    let parsed;
    try {
      const normalized = source_url.startsWith('http') ? source_url : `https://${source_url}`;
      parsed = new URL(normalized);
    } catch {
      return reply.badRequest('Invalid URL format.');
    }

    if (BLOCKED_SCHEMES.includes(parsed.protocol)) {
      return reply.status(422).send({
        source_validation_status: 'BLOCKED_SOURCE',
        message: 'This URL scheme is not allowed.',
      });
    }

    const hostname = parsed.hostname;
    if (PRIVATE_HOSTNAMES.test(hostname)) {
      return reply.status(422).send({
        source_validation_status: 'BLOCKED_SOURCE',
        message: 'Private or local URLs are not allowed.',
      });
    }

    const domain = hostname.replace(/^www\./, '');

    // ── 2. Check blocked domains ─────────────────────────────────────────
    if (BLOCKED_DOMAINS.has(domain)) {
      return reply.status(422).send({
        source_validation_status: 'BLOCKED_SOURCE',
        source_domain: domain,
        source_type: 'blocked',
        message: messageForStatus('BLOCKED_SOURCE', 'blocked'),
      });
    }

    // ── 3. Classify domain ───────────────────────────────────────────────
    const wikidataType = await wikidataDomainLookup(domain);
    const sourceType   = classifyDomain(domain, wikidataType);
    let   domainScore  = domainBaseScore(sourceType);

    // ── 4. Fetch URL content ─────────────────────────────────────────────
    const fetchResult = await safeFetch(parsed.href);
    let meta = {};
    let accessScore = 0;
    let metaScore   = 0;
    let dateScore   = 0;
    let canonicalScore = 0;
    let validationStatus;
    let sourceError = null;

    if (!fetchResult.ok) {
      const isProbablyPaywall = fetchResult.status === 403 || fetchResult.status === 401 || fetchResult.status === 429;
      validationStatus = isProbablyPaywall ? 'PAYWALLED_SOURCE' : 'UNAVAILABLE_SOURCE';
      sourceError = fetchResult.reason || `HTTP ${fetchResult.status}`;
    } else {
      accessScore    = 15;
      meta           = extractMeta(fetchResult.html, fetchResult.finalUrl);
      metaScore      = (meta.title ? 5 : 0) + (meta.description ? 5 : 0);
      dateScore      = meta.publishedAt ? 10 : 0;
      canonicalScore = meta.canonical ? 5 : 0;

      // ── 5. Relevance score ─────────────────────────────────────────────
      const searchText = [meta.title, meta.description, meta.bodyText].filter(Boolean).join(' ');
      const relevanceScore = computeRelevance(searchText, { title, demands, tipo_abuso, target_name });

      const confidenceScore = Math.min(100,
        domainScore + accessScore + metaScore + dateScore + canonicalScore + relevanceScore
      );

      validationStatus = statusFromScore(confidenceScore);

      // ── 6. Save to Supabase ───────────────────────────────────────────
      const record = {
        source_url:               parsed.href,
        canonical_url:            meta.canonical || parsed.href,
        source_domain:            domain,
        source_type:              sourceType,
        source_title:             meta.title,
        source_description:       meta.description,
        source_author:            meta.author,
        published_at:             meta.publishedAt || null,
        language:                 meta.language,
        preview_image:            meta.image,
        source_confidence_score:  confidenceScore,
        source_relevance_score:   relevanceScore,
        source_validation_status: validationStatus,
        source_validation_source: wikidataType ? 'WIKIDATA' : 'INTERNAL',
        source_checked_at:        new Date().toISOString(),
        source_error:             null,
      };

      await supabase.from('source_validations').insert(record).select().single();

      return reply.send({
        source_url:               parsed.href,
        canonical_url:            meta.canonical || parsed.href,
        source_domain:            domain,
        source_type:              sourceType,
        source_title:             meta.title,
        source_description:       meta.description,
        source_author:            meta.author,
        published_at:             meta.publishedAt,
        language:                 meta.language,
        preview_image:            meta.image,
        source_confidence_score:  confidenceScore,
        source_relevance_score:   relevanceScore,
        source_validation_status: validationStatus,
        message:                  messageForStatus(validationStatus, sourceType),
        event_score:              computeEventScore({
          sourceScore:      confidenceScore,
          sourceStatus:     validationStatus,
          hasActionVerb:    req.body.has_action_verb ?? false,
          hasBlockedVerb:   req.body.has_blocked_verb ?? false,
          wikidataVerified: req.body.wikidata_verified ?? false,
          relevanceScore,
        }),
        event_score_message: eventScoreMessage(computeEventScore({
          sourceScore:      confidenceScore,
          sourceStatus:     validationStatus,
          hasActionVerb:    req.body.has_action_verb ?? false,
          hasBlockedVerb:   req.body.has_blocked_verb ?? false,
          wikidataVerified: req.body.wikidata_verified ?? false,
          relevanceScore,
        })),
      });
    }

    // Unavailable / paywalled — save minimal record
    await supabase.from('source_validations').insert({
      source_url:               parsed.href,
      source_domain:            domain,
      source_type:              sourceType,
      source_confidence_score:  domainScore,
      source_relevance_score:   0,
      source_validation_status: validationStatus,
      source_validation_source: 'INTERNAL',
      source_checked_at:        new Date().toISOString(),
      source_error:             sourceError,
    });

    return reply.send({
      source_url:               parsed.href,
      source_domain:            domain,
      source_type:              sourceType,
      source_confidence_score:  domainScore,
      source_relevance_score:   0,
      source_validation_status: validationStatus,
      message:                  messageForStatus(validationStatus, sourceType),
      event_score:              computeEventScore({
        sourceScore:      domainScore,
        sourceStatus:     validationStatus,
        hasActionVerb:    req.body.has_action_verb ?? false,
        hasBlockedVerb:   req.body.has_blocked_verb ?? false,
        wikidataVerified: req.body.wikidata_verified ?? false,
        relevanceScore:   0,
      }),
      event_score_message: eventScoreMessage(computeEventScore({
        sourceScore:      domainScore,
        sourceStatus:     validationStatus,
        hasActionVerb:    req.body.has_action_verb ?? false,
        hasBlockedVerb:   req.body.has_blocked_verb ?? false,
        wikidataVerified: req.body.wikidata_verified ?? false,
        relevanceScore:   0,
      })),
    });
  });
}
