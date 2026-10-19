// Builds the public-report PDF (moved out of InformeScreen.vue so it can be tested
// without a browser). Layout, sections and the integrity-seal lines are the same
// as before; what changed is that every fixed label comes from the locale files
// (informe.pdf.*) and every drawn string goes through makeDrawable().
import { jsPDF } from 'jspdf';
import { makeDrawable, needsEmbeddedFont, coverageFromTtf, wrapText, isWinAnsi } from './pdfText.js';

const DATE_LOCALES = { es: 'es-ES', en: 'en-GB', fr: 'fr-FR', zh: 'zh-CN' };
export const FONT_FILE = 'fonts/pdf-sans-subset.ttf';
/** SHA-256 of the bundled font; a copy that differs (partial, corrupt, stale cache) is rejected. */
export const FONT_SHA256 = '865b564e4a78d202ea772025dc603656e676c233832bb9910afd319fafc2c2f0';

export function dateLocaleTag(locale) {
  return DATE_LOCALES[String(locale || '').slice(0, 2)] || 'en-GB';
}

/** Date + time with an explicit zone, so the PDF reads the same wherever it is opened. */
export function formatPdfDateTime(iso, locale) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(dateLocaleTag(locale), {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) + ' UTC';
}

/** The font needed by this PDF could not be loaded or registered; nothing was generated. */
export class PdfFontError extends Error {
  constructor(cause) { super('PDF font unavailable'); this.name = 'PdfFontError'; this.cause = cause; }
}

let fontCache = null;
let fontFailures = 0; // consecutive failures; after one, the next attempt bypasses every cache
/** Default browser loader: fetched only when a PDF actually needs it. */
export async function fetchEmbeddedFont() {
  if (fontCache) return fontCache;
  // The app's service worker caches successful same-origin GETs; after a failure we force a fresh
  // copy so a corrupt cached response cannot make every retry fail.
  const retry = fontFailures > 0;
  const res = await fetch(`${import.meta.env.BASE_URL}${FONT_FILE}${retry ? `?r=${Date.now()}` : ''}`, retry ? { cache: 'reload' } : undefined);
  if (!res.ok) throw new Error('font unavailable');
  const buffer = await res.arrayBuffer();
  await assertFontIntegrity(buffer);
  fontCache = buffer;
  return fontCache;
}

/** Throws unless the downloaded bytes are exactly the bundled font (skipped where Web Crypto is unavailable). */
export async function assertFontIntegrity(buffer) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return;
  const digest = new Uint8Array(await subtle.digest('SHA-256', buffer));
  const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  if (hex !== FONT_SHA256) throw new Error('font checksum mismatch');
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * @param {object} p
 * @param {object} p.data            payload of GET /api/protests/:id/informe
 * @param {object} p.integrity       { protest, snapshot, hasSnapshotV2, discrepancy, unavailable } (flags already computed by the screen)
 * @param {string} p.protestId       route id shown in the integrity seal
 * @param {string} p.abuseLabel      translated abuse type
 * @param {string} p.locale          UI locale
 * @param {(key:string, params?:object)=>string} p.t
 * @param {()=>Promise<ArrayBuffer>} [p.loadFont]  injected in tests
 * @returns {Promise<{doc: jsPDF, drawn: string[], usedEmbeddedFont: boolean, replaced: boolean, fileName: string}>}
 */
export async function buildInformePdf({ data: d, integrity, protestId, abuseLabel, locale, t, loadFont = fetchEmbeddedFont }) {
  const dg = d.desglose_geografico_local;
  const regions = d.distribucion_regiones ? Object.entries(d.distribucion_regiones) : [];
  const cities = (d.distribucion_ciudades || []).slice(0, 15);
  const territory = d.protest.convocatoria_ciudad_nombre || '—';
  const geoTerritory = dg ? (dg.municipio || d.protest.convocatoria_ciudad_nombre || dg.scope || '') : '';
  const hasGeoNote = regions.length > 0 || cities.length > 0;
  const tp = (k, params) => t('informe.pdf.' + k, params);

  // ── Decide the font from everything that will be drawn ───────────────────
  const uiStrings = [
    t('informe.chainTitle'), t('informe.chain1'), t('informe.chain2'), t('informe.chain3'),
    t('informe.chain4Title'), t('informe.chain4'), t('informe.geoIpCaveat'), t('informe.placeNamesNote'),
    t('informe.limitsNote'), t('informe.verifyUnavailable'), t('informe.historicalDiscrepancy'),
    t('informe.recordedHashLabel', { version: 1 }), t('informe.snapshotHashLabel', { version: 2 }),
    ...['docTitle', 'generated', 'recipient', 'institution', 'country', 'convocation', 'start', 'end', 'abuseType',
      'source', 'demands', 'results', 'gpsVerifiedIn', 'participantsN', 'extraNational', 'international', 'totalVerified',
      'verifiedMembers', 'verifiedAdhesions', 'distinctCountries', 'distinctCities', 'firstAdhesion', 'lastAdhesion',
      'geoDistribution', 'territorialCheck', 'gpsInside', 'nationalNoGps', 'byRegion', 'cities', 'seal', 'convocationId',
      'sourceCode', 'footer', 'page', 'unsupportedChars'].map(k => tp(k, { territory: '', n: 1, i: 1, domain: '' })),
  ];
  const contentStrings = [
    d.protest.title, d.protest.focal_point, d.protest.country_name, d.protest.fuente_url, d.protest.demands,
    d.protest.convocatoria_ciudad_nombre, d.protest.dominio_email, abuseLabel, geoTerritory,
    ...regions.map(([r]) => r), ...cities,
  ].filter(Boolean);

  // The embedded font is required whenever the labels or the content need it. If it cannot be
  // loaded or registered we do NOT produce a degraded PDF (its own notices would be unreadable
  // too): the caller shows a translated error and the user can retry.
  let font = null; // { buffer, covered }
  if (needsEmbeddedFont([...uiStrings, ...contentStrings])) {
    try {
      const buffer = await loadFont();
      const covered = coverageFromTtf(buffer);
      if (covered.size < 1000) throw new Error('font file invalid');
      font = { buffer, covered };
    } catch (cause) { fontFailures++; fontCache = null; throw new PdfFontError(cause); }
  }
  const covers = font ? (cp) => font.covered.has(cp) : isWinAnsi;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  if (font) {
    try {
      doc.addFileToVFS('pdf-sans-subset.ttf', toBase64(font.buffer));
      doc.addFont('pdf-sans-subset.ttf', 'PdfSans', 'normal', 400, 'Identity-H');
      doc.setFont('PdfSans', 'normal');
      if (!(doc.getTextWidth('A') > 0) || !(doc.getTextWidth('中') > 0)) throw new Error('font not usable');
    } catch (cause) { fontFailures++; fontCache = null; throw new PdfFontError(cause); }
    fontFailures = 0;
  }

  const drawn = [];
  let replaced = false;
  const W = 210; const M = 18; const CW = W - M * 2;
  let y = 0;

  // `ui` strings come from the locale files; `content` strings are user data. Any visible
  // character replaced by "?" in either is reported in the PDF.
  const ui = (s) => { const r = makeDrawable(s, covers); if (r.replaced) replaced = true; return r.text; };
  const content = (s) => { const r = makeDrawable(s, covers, { flagStripped: true }); if (r.replaced) replaced = true; return r.text; };

  function setFont(style) {
    if (font) doc.setFont('PdfSans', 'normal'); // single weight bundled; emphasis comes from size and colour
    else doc.setFont('helvetica', style);
  }
  const measure = (s) => doc.getTextWidth(s);
  function setBg() { doc.setFillColor(12, 11, 20); doc.rect(0, 0, 210, 297, 'F'); }
  function ensure(h) { if (y + h > 272) { doc.addPage(); setBg(); y = 22; } }
  function put(text, x, align) { drawn.push(text); doc.text(text, x, y, align ? { align } : undefined); }
  function nl(h = 7) { y += h; }
  function line() { doc.setDrawColor(76, 255, 164); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); nl(6); }
  function h2(txt) { ensure(14); setFont('bold'); doc.setFontSize(13); doc.setTextColor(76, 255, 164); put(ui(txt), M); nl(8); }
  function para(txt, { x = M, w = CW, step = 7, size = 11, color = [220, 218, 240], style = 'normal', isContent = false } = {}) {
    setFont(style); doc.setFontSize(size); doc.setTextColor(...color);
    wrapText(measure, isContent ? content(txt) : ui(txt), w).forEach(l => { ensure(step); put(l, x); nl(step); });
  }
  function kv(k, v, isContent = false) {
    const label = (isContent ? content(k) : ui(k)) + ':';
    setFont('bold'); doc.setFontSize(10); doc.setTextColor(76, 255, 164);
    ensure(14);
    if (measure(label) > 44) {
      put(label, M); nl(5);
      para(String(v), { x: M + 8, w: CW - 8, step: 6, color: [240, 238, 255], isContent });
    } else {
      put(label, M);
      setFont('normal'); doc.setFontSize(11); doc.setTextColor(240, 238, 255);
      const lines = wrapText(measure, isContent ? content(String(v)) : ui(String(v)), CW - 48);
      lines.forEach((l, i) => { if (i > 0) ensure(6); put(l, M + 48); nl(i === lines.length - 1 ? 7 : 6); });
    }
  }
  function note(txt, o = {}) { para(txt, { size: 8, step: 4, color: [140, 140, 140], style: 'italic', ...o }); }

  // ── Header ───────────────────────────────────────────────────────────────
  setBg(); y = 20;
  doc.setFillColor(30, 27, 50); doc.rect(0, 10, 210, 30, 'F');
  y = 18; setFont('bold'); doc.setFontSize(10); doc.setTextColor(76, 255, 164); put(ui(tp('docTitle')), M);
  y = 24; setFont('normal'); doc.setFontSize(8); doc.setTextColor(180, 178, 200); put('www.voiceprotest.org', M);
  y = 30; doc.setTextColor(140, 138, 170); put(ui(tp('generated')) + ': ' + new Date().toISOString(), M);
  y = 46;
  setFont('bold'); doc.setFontSize(20); doc.setTextColor(255, 255, 255);
  wrapText(measure, content(d.protest.title), CW).forEach(l => { ensure(8); put(l, M); nl(8); });
  nl(2); line();

  // ── 1. Recipient ─────────────────────────────────────────────────────────
  h2('1. ' + tp('recipient').toUpperCase());
  kv(tp('institution'), d.protest.focal_point || '—', true);
  kv(tp('country'), d.protest.country_name || '—', true);
  nl(2); line();

  // ── 2. Convocation ───────────────────────────────────────────────────────
  h2('2. ' + tp('convocation').toUpperCase());
  kv(tp('start'), formatPdfDateTime(d.protest.starts_at, locale));
  kv(tp('end'), formatPdfDateTime(d.protest.ends_at, locale));
  kv(tp('abuseType'), abuseLabel, true);
  if (d.protest.fuente_url) {
    ensure(14);
    setFont('bold'); doc.setFontSize(10); doc.setTextColor(76, 255, 164); put(ui(tp('source')) + ':', M);
    setFont('normal'); doc.setFontSize(9); doc.setTextColor(100, 160, 255);
    wrapText(measure, content(d.protest.fuente_url), CW - 48).forEach((l, i) => { ensure(5); put(l, i === 0 ? M + 48 : M + 4); nl(5); });
    nl(2);
  }
  if (d.protest.demands) { nl(1); para(tp('demands') + ': ' + d.protest.demands, { isContent: true }); }
  nl(2); line();

  // ── 3. Results ───────────────────────────────────────────────────────────
  h2('3. ' + tp('results').toUpperCase());
  if ((d.protest.scope === 'local' || d.protest.scope === 'regional') && dg) {
    kv(tp('gpsVerifiedIn', { territory }), tp('participantsN', { n: dg.gps_local }), true);
    if (dg.gps_nacional > 0) kv(tp('extraNational'), dg.gps_nacional);
    if (dg.internacionales > 0) kv(tp('international'), dg.internacionales);
    kv(tp('totalVerified'), d.total_adhesiones);
  } else if (d.protest.dominio_email) {
    kv(tp('verifiedMembers', { domain: d.protest.dominio_email }), d.total_adhesiones, true);
  } else {
    kv(tp('verifiedAdhesions'), d.total_adhesiones);
    kv(tp('distinctCountries'), d.paises_distintos);
  }
  if (d.ciudades_distintas > 0) kv(tp('distinctCities'), d.ciudades_distintas);
  kv(tp('firstAdhesion'), formatPdfDateTime(d.primera_adhesion, locale));
  kv(tp('lastAdhesion'), formatPdfDateTime(d.ultima_adhesion, locale));
  nl(1);
  note(t('informe.limitsNote'), { size: 9, step: 4.5, color: [200, 198, 225] });
  nl(2); line();

  // ── 4. Geographic distribution ───────────────────────────────────────────
  h2('4. ' + tp('geoDistribution').toUpperCase());
  if (dg) {
    para(tp('territorialCheck', { territory: geoTerritory }) + ':', { isContent: true });
    if (dg.gps_local > 0) para('  ' + tp('gpsInside') + ': ' + dg.gps_local);
    if (dg.nacionales_sin_gps > 0) para('  ' + tp('nationalNoGps') + ': ' + dg.nacionales_sin_gps);
    if (dg.internacionales > 0) para('  ' + tp('international') + ': ' + dg.internacionales);
    nl(1);
  }
  if (hasGeoNote) {
    note(t('informe.geoIpCaveat'));
    note(t('informe.placeNamesNote'));
    nl(1);
  }
  if (regions.length) {
    para(tp('byRegion') + ':');
    regions.forEach(([r, c]) => para('  ' + r + ': ' + c, { isContent: true }));
  }
  if (cities.length) para(tp('cities') + ': ' + cities.join(' · '), { isContent: true });
  nl(2); line();

  // ── 5. Verification chain ────────────────────────────────────────────────
  h2('5. ' + t('informe.chainTitle').toUpperCase());
  para('1. reCAPTCHA v3 — ' + t('informe.chain1'));
  para('2. SMS/Email OTP — ' + t('informe.chain2'));
  para('3. HMAC-SHA256 — ' + t('informe.chain3'));
  para('4. ' + t('informe.chain4Title') + ' — ' + t('informe.chain4'));
  nl(2); line();

  // ── 6. Integrity seal (hashes and their rules are untouched) ─────────────
  h2('6. ' + tp('seal').toUpperCase());
  kv(tp('convocationId'), protestId);
  kv(tp('sourceCode'), 'github.com/cero-absoluto/vozciudadana (AGPL 3.0)');
  kv(tp('generated'), new Date().toISOString());
  if (d.protest.hash_integridad) {
    const hashLines = (hash) => { ensure(4); doc.setFont('courier', 'normal'); doc.setFontSize(9); doc.setTextColor(76, 255, 164); wrapText(measure, hash, CW).forEach(l => { ensure(4); put(l, M); nl(4); }); };
    nl(1); para(t('informe.recordedHashLabel', { version: d.protest.integrity_version || 1 }));
    hashLines(d.protest.hash_integridad);
    if (integrity.hasSnapshotV2) {
      nl(2); para(t('informe.snapshotHashLabel', { version: integrity.snapshot.integrity_version }));
      hashLines(integrity.snapshot.integrity_hash);
    }
    if (integrity.discrepancy) { nl(2); para(t('informe.historicalDiscrepancy')); }
    if (integrity.unavailable) { nl(2); para(t('informe.verifyUnavailable')); }
  }
  if (replaced) { nl(3); note(tp('unsupportedChars')); }

  // ── Footer on every page ─────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(20, 18, 35); doc.rect(0, 285, 210, 12, 'F');
    setFont('normal'); doc.setFontSize(8); doc.setTextColor(140, 138, 170);
    y = 291;
    put(ui(tp('footer')), M);
    put(ui(tp('page', { i, n: totalPages })), W - M, 'right');
  }

  // Titles without any Latin letter or digit (e.g. Chinese) used to give a name made only of dashes.
  const slug = String(d.protest.title).replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40);
  const fileName = 'voiceprotest-informe-' + (/[a-z0-9]/.test(slug) ? slug : String(protestId).slice(0, 8)) + '.pdf';
  return { doc, drawn, usedEmbeddedFont: !!font, replaced, fileName };
}
