import { supabase } from '../services/supabase.js';

// ── Blocked IP ranges and schemes ─────────────────────────────────────────
const BLOCKED_SCHEMES = ['file:', 'ftp:', 'data:', 'javascript:'];
const PRIVATE_HOSTNAMES = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/ ;

// ── Domain classification via known lists ──────────────────────────────────
const OFFICIAL_TLDS = ['.gov', '.gob', '.gov.uk', '.gov.au', '.gov.br', '.gob.es',
  '.gob.mx', '.gouv.fr', '.gouv.be', '.gc.ca', '.europa.eu', '.un.org',
  '.who.int', '.oecd.org', '.worldbank.org', '.imf.org', '.eur-lex.europa.eu'];

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
  if (KNOWN_OFFICIAL.has(domain)) {
    if (['bbc.com','bbc.co.uk','rtve.es','euronews.com'].includes(domain)) return 'public_broadcaster';
    if (['reuters.com','apnews.com','theguardian.com','ft.com','nytimes.com',
         'washingtonpost.com','elpais.com','elmundo.es','lavanguardia.com',
         'lemonde.fr','spiegel.de','economist.com'].includes(domain)) return 'reputable_media';
    if (['amnesty.org','hrw.org','transparency.org'].includes(domain)) return 'ngo';
    return 'public_institution';
  }
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
  const isOfficial = ['official_government','parliament','court','public_institution','public_broadcaster'].includes(sourceType);
  switch (status) {
    case 'VERIFIED_SOURCE':
      return isOfficial
        ? 'The source is from an official institution and appears to support the claim.'
        : 'The provided source appears to strongly support the claim.';
    case 'RELEVANT_SOURCE':
      return 'The provided source appears to support the claim.';
    case 'WEAK_SOURCE':
      return isOfficial
        ? 'The source is from a recognized institution, but its relevance to the claim is not clear.'
        : 'The source could be related to the claim, but relevance is weak.';
    case 'UNAVAILABLE_SOURCE':
      return 'The source could not be accessed. It may be behind a paywall or temporarily unavailable.';
    case 'PAYWALLED_SOURCE':
      return 'The source appears to be behind a paywall. It has been recorded but could not be fully verified.';
    case 'UNRELATED_SOURCE':
      return 'The provided source does not clearly support the claim.';
    case 'BLOCKED_SOURCE':
      return 'This type of source is not accepted. Please provide a news article, official document or dataset.';
    default:
      return 'The source requires manual review before the protest can be published.';
  }
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
          source_url:  { type: 'string', minLength: 10, maxLength: 2000 },
          title:       { type: 'string', maxLength: 255, default: '' },
          demands:     { type: 'string', maxLength: 2000, default: '' },
          tipo_abuso:  { type: 'string', maxLength: 120, default: '' },
          target_name: { type: 'string', maxLength: 255, default: '' },
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
    });
  });
}
