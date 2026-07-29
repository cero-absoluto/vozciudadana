import { supabase } from '../services/supabase.js';

// ── Discoverability — Phase 2 (Dynamic... no, actually Static — see note) ──
// Per the founder's and the auditor's agreed direction (16 July 2026): avoid
// user-agent-based dynamic rendering entirely. reports.voiceprotest.org is a
// second custom domain pointed at this same Railway service (same origin as
// api.voiceprotest.org — same app, same port). It serves genuinely the same
// HTML to everyone, generated fresh from Supabase on every request — no bot
// detection, no cloaking, nothing cached that could go stale. This is what
// keeps an *active* convocatoria's count and remaining time honest without
// needing periodic regeneration: every hit, human or crawler, gets the
// current row.
//
// Because this app also answers on api.voiceprotest.org, every route here
// is gated on the Host header in the onRequest hook below — without that
// gate, a stray GET /:id at the root would shadow the 404 that
// api.voiceprotest.org today correctly returns for any unmatched path.

const REPORTS_HOST = process.env.REPORTS_HOST || 'reports.voiceprotest.org';
const APP_URL = process.env.APP_URL || 'https://voiceprotest.org';

const ABUSE_LABELS = {
  corruption:          'Corrupción, soborno o malversación',
  influence_peddling:  'Tráfico de influencias',
  nepotism:            'Nepotismo o conflicto de interés',
  illicit_enrichment:  'Enriquecimiento ilícito',
  procurement:         'Irregularidades en contratación pública',
  opacity:             'Opacidad o falta de rendición de cuentas',
  info_access:         'Denegación de acceso a información pública',
  undue_delay:         'Retraso injustificado o silencio administrativo',
  discrimination:      'Discriminación o trato desigual',
  negligence:          'Negligencia grave o mala gestión de servicios públicos',
  legal_breach:        'Incumplimiento de una obligación legal',
  repression:          'Represión de la protesta o censura',
  rights_violation:    'Vulneración de derechos fundamentales',
  excessive_force:     'Uso excesivo de la fuerza o abuso policial',
  surveillance:        'Vigilancia ilegal o violación de la privacidad',
  other_public_abuse:  'Otro abuso de poder público',
};

const SOURCE_LABELS = {
  official_bulletin:   'Boletín oficial',
  official_government: 'Fuente institucional', parliament: 'Fuente institucional',
  court: 'Fuente institucional', public_institution: 'Fuente institucional', dataset: 'Fuente institucional',
  public_broadcaster:  'Medio de comunicación', reputable_media: 'Medio de comunicación',
  academic:            'Fuente académica',
  ngo:                 'Organización civil',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Defence in depth: fuente_url already passes through hard admission rules
// at creation time (routes/protests.js — petition/social-media domain
// blocks, minimal-connection check), so a non-http(s) scheme shouldn't
// reach this table today. But this render path trusts whatever is in the
// row, with no re-validation of its own — a future change to the creation
// rules, or a direct database edit, could put something like
// "javascript:..." in fuente_url, and esc() alone only prevents breaking
// the HTML, not a scheme that executes when clicked. Only ever render the
// source as a link if it's actually http(s).
function safeHref(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch { return null; }
}

// Short-lived cache (Discoverability Phase 2 hardening, per internal
// review 18 July 2026): every hit to /:id previously ran a fresh Supabase
// query, with no caching and only the app-wide 120 req/min rate limit to
// slow abuse — fine at today's traffic, but a real cost amplification
// vector once a link gets shared widely or a crawler revisits aggressively.
// A short TTL keeps counts and time-remaining close enough to live for a
// public report/share page (unlike the actual adhesion flow, which always
// reads Supabase directly, never this cache) while absorbing repeat hits.
const RENDER_CACHE_TTL_MS = 30_000;
const renderCache = new Map(); // id -> { html, status, expires }

function getCached(id) {
  const entry = renderCache.get(id);
  if (!entry || entry.expires < Date.now()) return null;
  return entry;
}
function setCached(id, html, status) {
  renderCache.set(id, { html, status, expires: Date.now() + RENDER_CACHE_TTL_MS });
  // Bound the map so a scan/enumeration attempt (many distinct ids) can't
  // grow it unboundedly — oldest entries are evicted first.
  if (renderCache.size > 2000) {
    renderCache.delete(renderCache.keys().next().value);
  }
}

function renderReportHtml(protest) {
  const isClosed = new Date(protest.ends_at) < new Date();
  const abuseLabel = ABUSE_LABELS[protest.tipo_abuso] || 'Abuso de poder público';
  const sourceLabel = SOURCE_LABELS[protest.source_type] || 'Sin verificar';
  const appLink = `${APP_URL}/#/${isClosed ? 'informe' : 'detail'}/${protest.id}`;
  const title = esc(protest.title);
  const description = esc(
    (protest.description || '').slice(0, 200) ||
    `${abuseLabel} — dirigida a ${protest.focal_point || 'una institución pública'}.`
  );
  const canonical = `https://${REPORTS_HOST}/${protest.id}`;

  const statusLine = isClosed
    ? `Cerrada · ${protest.count ?? 0} adhesiones verificadas`
    : `Activa · ${protest.count ?? 0} adhesiones · cierra ${new Date(protest.ends_at).toLocaleString('es-ES')}`;

  const schema = isClosed
    ? {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: protest.title,
        description,
        url: canonical,
        creator: { '@type': 'Organization', name: 'Stichting Voice Protest', url: `${APP_URL}/` },
        license: 'https://www.gnu.org/licenses/agpl-3.0.html',
        temporalCoverage: `${protest.starts_at}/${protest.ends_at}`,
      }
    : {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: protest.title,
        description,
        url: canonical,
        startDate: protest.starts_at,
        endDate: protest.ends_at,
        eventStatus: 'https://schema.org/EventScheduled',
        eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
        // Required by Google's Event rich-result guidelines even for online
        // events — omitting it entirely (as the first version of this file
        // did) meant Google silently disqualified the whole block rather
        // than reporting a validation error, which is why Rich Results
        // Test showed "No items detected" instead of a fixable warning.
        location: {
          '@type': 'VirtualLocation',
          url: appLink,
        },
        organizer: { '@type': 'Organization', name: 'Stichting Voice Protest', url: `${APP_URL}/` },
      };

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Voice Protest</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index, follow">

<meta property="og:type" content="website">
<meta property="og:site_name" content="Voice Protest">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${APP_URL}/icon-512.png">

<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">

<script type="application/ld+json">${JSON.stringify(schema)}</script>

<style>
  :root { color-scheme: dark; }
  body { background:#0A0A0F; color:#EDEDF2; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    max-width:680px; margin:0 auto; padding:40px 24px 64px; line-height:1.6; }
  .status { font-size:13px; color:#9C9CB0; margin-bottom:6px; text-transform:uppercase; letter-spacing:.3px; }
  h1 { font-size:26px; font-weight:800; margin:0 0 18px; }
  .field-label { font-size:12px; font-weight:700; color:#9C9CB0; text-transform:uppercase; letter-spacing:.3px; margin-top:22px; margin-bottom:6px; }
  .field-value { font-size:16px; color:#EDEDF2; }
  a { color:#4CFFA4; }
  .cta { display:inline-block; margin-top:32px; padding:12px 22px; background:#4CFFA4; color:#060A10; font-weight:700; border-radius:8px; text-decoration:none; }
  footer { margin-top:48px; padding-top:20px; border-top:1px solid #1E1E28; color:#7A7A8C; font-size:13px; }
</style>
</head>
<body>
  <div class="status">${statusLine}</div>
  <h1>${title}</h1>

  <div class="field-label">Dirigido a</div>
  <div class="field-value">${esc(protest.focal_point || '—')}</div>

  <div class="field-label">Tipo de abuso</div>
  <div class="field-value">${esc(abuseLabel)}</div>

  ${protest.description ? `<div class="field-label">Descripción</div><div class="field-value">${esc(protest.description)}</div>` : ''}

  ${protest.demands ? `<div class="field-label">Qué exige</div><div class="field-value">${esc(protest.demands)}</div>` : ''}

  ${protest.fuente_url ? (() => {
    const href = safeHref(protest.fuente_url);
    return href
      ? `<div class="field-label">Fuente</div><div class="field-value"><a href="${esc(href)}" rel="noopener">${esc(protest.fuente_url)}</a> · ${esc(sourceLabel)}</div>`
      : `<div class="field-label">Fuente</div><div class="field-value">${esc(protest.fuente_url)} · ${esc(sourceLabel)}</div>`;
  })() : ''}

  <a class="cta" href="${appLink}">${isClosed ? 'Ver el informe completo →' : 'Unirse a la convocatoria →'}</a>

  <footer>Stichting Voice Protest · AGPL-3.0 · <a href="${APP_URL}/">voiceprotest.org</a></footer>
</body>
</html>`;
}

function renderNotFoundHtml() {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="robots" content="noindex">
<title>Convocatoria no encontrada — Voice Protest</title></head>
<body style="background:#0A0A0F;color:#EDEDF2;font-family:sans-serif;max-width:600px;margin:80px auto;text-align:center">
<h1>Convocatoria no encontrada</h1>
<p>Puede que el enlace sea incorrecto o que ya no esté disponible.</p>
<a href="${APP_URL}/" style="color:#4CFFA4">Ir a voiceprotest.org →</a>
</body></html>`;
}

export default async function reportsRoutes(app) {
  app.addHook('onRequest', async (req, reply) => {
    const host = (req.headers.host || '').split(':')[0];
    if (host !== REPORTS_HOST) {
      return reply.code(404).send({ error: 'Not found' });
    }
  });

  // GET reports.voiceprotest.org/robots.txt — this is a separate origin
  // from voiceprotest.org, so it needs its own robots.txt; crawlers check
  // per-origin, they don't inherit the main site's file.
  app.get('/robots.txt', async (req, reply) => {
    reply.type('text/plain');
    return `User-agent: *\nAllow: /\n\nSitemap: https://${REPORTS_HOST}/sitemap.xml\n`;
  });

  // GET reports.voiceprotest.org/{key}.txt — IndexNow key verification
  // (24 July 2026). A fully static route, registered before the
  // UUID-schema-validated /:id route below, so Fastify's router matches
  // this literal path first rather than trying (and failing) to validate
  // the key filename as a convocatoria id.
  app.get('/e8122c52eea9425398ef936e7f559047.txt', async (req, reply) => {
    reply.type('text/plain');
    return 'e8122c52eea9425398ef936e7f559047';
  });

  // GET reports.voiceprotest.org/sitemap.xml — dynamic, always current;
  // replaces the static Phase 1 sitemap for public convocatoria/report URLs.
  // Stricter, route-specific rate limit on top of the app-wide 120/min
  // (server.js): this is the single most expensive query in the plugin —
  // up to 5,000 rows, unauthenticated — and under the shared global limit
  // it could be hit hard enough, on its own, to eat into the budget other
  // legitimate API routes rely on.
  app.get('/sitemap.xml', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { data, error } = await supabase
      .from('protests')
      .select('id, updated_at, created_at')
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) return reply.code(500).send('Internal server error');

    const urls = (data || []).map(p => `  <url>
    <loc>https://${REPORTS_HOST}/${p.id}</loc>
    <lastmod>${new Date(p.updated_at || p.created_at).toISOString()}</lastmod>
  </url>`).join('\n');

    reply.type('application/xml');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  });

  // GET reports.voiceprotest.org/ — plain landing, links to the main app.
  app.get('/', async (req, reply) => {
    reply.type('text/html');
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Voice Protest — Informes públicos</title>
<meta name="description" content="Informes públicos y convocatorias activas de Voice Protest, verificados y auditables.">
<meta http-equiv="refresh" content="0; url=${APP_URL}/"></head>
<body>Redirigiendo a <a href="${APP_URL}/">voiceprotest.org</a>…</body></html>`;
  });

  // GET reports.voiceprotest.org/:id — the actual public report/convocatoria
  // page. Same content for a crawler and a person — no user-agent check.
  app.get('/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } },
  }, async (req, reply) => {
    const cached = getCached(req.params.id);
    if (cached) {
      reply.type('text/html').code(cached.status);
      return cached.html;
    }

    const { data: protest, error } = await supabase
      .from('protests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    reply.type('text/html');
    if (error || !protest) {
      setCached(req.params.id, renderNotFoundHtml(), 404);
      reply.code(404);
      return renderNotFoundHtml();
    }
    const html = renderReportHtml(protest);
    setCached(req.params.id, html, 200);
    return html;
  });
}
