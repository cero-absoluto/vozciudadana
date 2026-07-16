// ── Shared source-checking primitives ───────────────────────────────────────
// Used by BOTH routes/source.js (the informational preview shown while
// drafting) and routes/protests.js (the real, hard admission gate). Keeping
// these in one place is deliberate: we previously had two separate verb-check
// implementations (frontend vs backend) that quietly disagreed with each
// other. Do not duplicate anything from this file elsewhere — import it.
//
// Design principle (confirmed with the founder, July 2026): Voice Protest
// never blocks a convocatoria for having a low-quality or unrecognised
// source — that judgement is shown to participants as information, never
// enforced. The ONE thing that IS enforced is that the source has some real,
// checkable connection to the reported event — see hasMinimalConnection().
// That is an anti-abuse floor, not a quality bar.

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

// Official bulletins / gazettes — the strongest possible documentary basis,
// short of a court ruling: primary legal/administrative publication, not
// reporting about the fact. Deliberately its own tier, above generic
// "official_government", per the founder's distinction between "medios
// nacionales importantes y boletines oficiales" and everything else.
const KNOWN_OFFICIAL_BULLETINS = new Set([
  'boe.es',           // Boletín Oficial del Estado (Spain)
  'borme.es',         // Boletín Oficial del Registro Mercantil (Spain)
  'eur-lex.europa.eu', 'official-journal.europa.eu', // DOUE / EU Official Journal
  'boa.aragon.es', 'bocm.es', 'docv.gva.es', 'diariodfa.info',
  'boja.junta-andalucia.es', 'bocyl.jcyl.es', 'boc.cantabria.es',
  'officielebekendmakingen.nl', // Staatscourant / Staatsblad (Netherlands)
]);

const KNOWN_OFFICIAL = new Set([
  'boe.es', 'congreso.es', 'senado.es', 'poderjudicial.es', 'ine.es',
  'rtve.es', 'europarl.europa.eu', 'un.org', 'who.int', 'oecd.org',
  'worldbank.org', 'imf.org', 'amnesty.org', 'hrw.org', 'transparency.org',
  'bbc.co.uk', 'bbc.com', 'reuters.com', 'apnews.com', 'theguardian.com',
  'ft.com', 'economist.com', 'lemonde.fr', 'spiegel.de', 'elpais.com',
  'lavanguardia.com', 'elmundo.es', 'abc.es', 'publico.es',
  'eldiariomontanes.es', 'elcomercio.es', 'larioja.com', 'diariodeburgos.es',
  'elcorreo.com', 'diariovasco.com', 'heraldo.es', 'elperiodicoextremadura.com',
  'laopiniondemalaga.es', 'laopiniondezamora.es', 'laopiniondecordoba.es',
  'nytimes.com', 'washingtonpost.com', 'politico.eu', 'euronews.com',
]);

// Known user-generated / social platforms — never a documentary source in
// themselves (this is distinct from BLOCKED_SOURCE_DOMAINS in protests.js,
// which blocks petition-aggregation platforms specifically).
const BLOCKED_DOMAINS = new Set([
  'facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
  'youtube.com', 'reddit.com', 'whatsapp.com', 'telegram.org',
  'medium.com', 'substack.com', 'blogspot.com', 'wordpress.com',
]);

function registrableDomainOf(hostname) {
  const h = hostname.replace(/\.$/, '').toLowerCase();
  const parts = h.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : h;
}

// ── Domain type classification ─────────────────────────────────────────────
function classifyDomain(domain, wikidataType) {
  if (wikidataType) return wikidataType;

  const registrable = registrableDomainOf(domain);

  if (KNOWN_OFFICIAL_BULLETINS.has(domain) || KNOWN_OFFICIAL_BULLETINS.has(registrable)) {
    return 'official_bulletin';
  }
  if (OFFICIAL_TLDS.some(tld => domain.endsWith(tld))) return 'official_government';
  if (domain.endsWith('.edu') || domain.endsWith('.ac.uk')) return 'academic';

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
    official_bulletin:  38, // highest tier — primary legal/administrative record
    official_government: 35,
    parliament:          35,
    court:               35,
    public_institution:  30,
    dataset:             30,
    public_broadcaster:  28,
    academic:            28,
    reputable_media:     25,
    ngo:                 20,
    unknown:             5,
    blocked:             0,
  };
  return scores[sourceType] ?? 5;
}

// ── Keyword relevance score (informational — never gates) ─────────────────
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

// ── Minimal-connection gate (this one DOES block — see file header) ───────
// Deliberately low bar: this is not a quality judgement, only a check that
// the URL is not disconnected from the reported event. Passes if EITHER:
//   (a) the recipient's own name appears in the fetched page text — the most
//       reliable anchor across languages, since institution proper nouns
//       are usually unchanged (e.g. "Utrecht" reads the same in NL/EN); or
//   (b) at least 2 distinct significant words (>4 chars) from title+demands
//       appear in the fetched page text.
// Never used to compare against a quality bar — only against "no connection
// at all", which is exactly the gap a random/unrelated URL would fail.
function hasMinimalConnection(sourceText, { title = '', demands = '', target_name = '' }) {
  if (!sourceText) return { ok: false, reason: 'source_unreadable' };
  const haystack = sourceText.toLowerCase();

  const name = (target_name || '').trim().toLowerCase();
  if (name.length > 2 && haystack.includes(name)) {
    return { ok: true, reason: 'target_name_match' };
  }

  const needles = [title, demands]
    .join(' ')
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 4);
  const distinctHits = new Set(needles.filter(w => haystack.includes(w)));
  if (distinctHits.size >= 2) {
    return { ok: true, reason: 'keyword_match', matched: [...distinctHits] };
  }

  return { ok: false, reason: 'no_connection_found' };
}

// ── Safe URL fetch with timeout and size limit ─────────────────────────────
// Treats 404 and 5xx as real failures (the URL does not work). Treats
// 401/403/429 as "paywall-like": still returns whatever HTML came back
// (often enough to extract og:title/og:description from a paywalled
// article) but flags it via `paywallLike` so callers can label it
// accordingly instead of silently treating it as a normal 200.
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

    const status = res.status;
    if (status === 404 || status >= 500) {
      return { ok: false, reason: status === 404 ? 'not_found' : 'server_error', status };
    }
    const paywallLike = [401, 403, 429].includes(status);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html') && !contentType.includes('text') && !contentType.includes('json')) {
      return { ok: false, reason: 'non_html', status };
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
    return { ok: true, html, status, finalUrl: res.url, paywallLike };
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

// ── High-level combined evaluation ──────────────────────────────────────────
// Runs the full pipeline once: fetch → classify domain → extract meta →
// relevance → minimal-connection check. Both the preview endpoint
// (routes/source.js) and the real admission gate (routes/protests.js) call
// this SAME function, so the confidenceScore formula lives in exactly one
// place and the two can never quietly disagree again.
async function evaluateSource(url, { title = '', demands = '', tipo_abuso = '', target_name = '' } = {}) {
  const parsed = new URL(url);
  const domain = parsed.hostname.replace(/^www\./, '');

  const wikidataType = await wikidataDomainLookup(domain);
  const sourceType    = classifyDomain(domain, wikidataType);
  const domainScore   = domainBaseScore(sourceType);

  const fetchResult = await safeFetch(parsed.href);

  if (!fetchResult.ok) {
    return {
      fetchOk: false, reason: fetchResult.reason, domain, sourceType, domainScore,
      minimalConnection: { ok: false, reason: 'source_unreadable' },
      confidenceScore: domainScore, relevanceScore: 0, meta: {},
      paywallLike: false, wikidataType,
    };
  }

  const meta = extractMeta(fetchResult.html, fetchResult.finalUrl);
  const searchText = [meta.title, meta.description, meta.bodyText].filter(Boolean).join(' ');

  const relevanceScore = computeRelevance(searchText, { title, demands, tipo_abuso, target_name });
  const minimalConnection = hasMinimalConnection(searchText, { title, demands, target_name });

  const accessScore    = 15;
  const metaScore      = (meta.title ? 5 : 0) + (meta.description ? 5 : 0);
  const dateScore      = meta.publishedAt ? 10 : 0;
  const canonicalScore = meta.canonical ? 5 : 0;
  const confidenceScore = Math.min(100,
    domainScore + accessScore + metaScore + dateScore + canonicalScore + relevanceScore);

  return {
    fetchOk: true, domain, sourceType, domainScore, confidenceScore, relevanceScore,
    meta, paywallLike: !!fetchResult.paywallLike, wikidataType, minimalConnection,
  };
}

export {
  OFFICIAL_TLDS, UNIVERSITY_MEDIA, KNOWN_OFFICIAL, KNOWN_OFFICIAL_BULLETINS, BLOCKED_DOMAINS,
  registrableDomainOf, classifyDomain, domainBaseScore, computeRelevance,
  hasMinimalConnection, safeFetch, extractMeta, wikidataDomainLookup, evaluateSource,
};
