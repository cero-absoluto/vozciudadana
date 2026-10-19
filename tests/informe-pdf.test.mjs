// Offline checks for the report PDF (apps/web/src/lib/informePdf.js, pdfText.js).
// Synthetic data only; no backend, no network. Run: node --test tests/informe-pdf.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { createI18n } from 'vue-i18n';
import { FIXTURES, CONTENT_CASES } from './helpers/informe-fixtures.mjs';

const L = ['es', 'en', 'fr', 'zh'];
const loc = Object.fromEntries(L.map(l => [l, JSON.parse(fs.readFileSync(new URL(`../apps/web/src/locales/${l}.json`, import.meta.url), 'utf8'))]));
const fontBuf = fs.readFileSync(new URL('../apps/web/public/fonts/pdf-sans-subset.ttf', import.meta.url));
const asArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

const server = await createServer({ root: 'apps/web', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const mod = await server.ssrLoadModule('/src/lib/informePdf.js');
const txt = await server.ssrLoadModule('/src/lib/pdfText.js');
test.after(() => server.close());

const tFor = (ui) => createI18n({ legacy: false, locale: ui, fallbackLocale: 'en', messages: loc }).global.t;
const OUT = process.env.PDF_OUT_DIR; // optional: keep the generated PDFs for visual review
let fontLoads = 0;
const loadFont = async () => { fontLoads++; return asArrayBuffer(fontBuf); };

async function build(c, name) {
  const t = tFor(c.ui);
  fontLoads = 0;
  const r = await mod.buildInformePdf({
    data: c.data, protestId: c.data.protest.id, abuseLabel: c.abuse, locale: c.ui, t, loadFont,
    integrity: { hasSnapshotV2: true, snapshot: { integrity_version: 2, integrity_hash: c.data.protest.hash_integridad }, discrepancy: false, unavailable: false },
  });
  if (OUT && name) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(r.doc.output('arraybuffer'))); }
  return r;
}

test('locale files: informe.pdf.* and the two notes exist with the same keys and placeholders in es/en/fr/zh', () => {
  const keys = Object.keys(loc.es.informe.pdf);
  assert.ok(keys.length >= 30);
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  for (const l of L) {
    assert.deepEqual(Object.keys(loc[l].informe.pdf), keys, `${l} keys`);
    for (const k of keys) {
      assert.ok(String(loc[l].informe.pdf[k]).trim(), `${l}.${k} empty`);
      assert.equal(ph(loc[l].informe.pdf[k]), ph(loc.es.informe.pdf[k]), `${l}.${k} placeholders`);
    }
    for (const k of ['limitsNote', 'placeNamesNote']) assert.ok(loc[l].informe[k]?.trim(), `${l}.${k}`);
  }
  assert.equal(loc.es.informe.limitsNote, 'Este informe acredita adhesiones verificadas de participantes; no acredita la veracidad de las demandas ni la representatividad respecto de la población.');
});

test('font file: covers common simplified + traditional Chinese, Cyrillic, Latin-Extended; cmap parses', () => {
  const cov = txt.coverageFromTtf(asArrayBuffer(fontBuf));
  assert.ok(cov.size > 9000);
  for (const ch of '成都市高新区议會臺灣聽證ЖщŁłČїệ—·€，。') assert.ok(cov.has(ch.codePointAt(0)), ch);
  assert.ok(!cov.has('م'.codePointAt(0)) && !cov.has(0x1f525));
});

test('helpers: emoji and invisible marks are removed, © ® kept; wrapText never exceeds the width, breaks CJK and long URLs', () => {
  assert.equal(txt.stripUndrawable('🔒 Cadena ✊🏽 de©®  verificación‍️'), 'Cadena de©® verificación');
  const m = (s) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  for (const sample of ['中文'.repeat(80), 'https://' + 'a'.repeat(120), 'palabra '.repeat(40), '诉求，。！'.repeat(30)]) {
    const lines = txt.wrapText(m, sample, 30);
    assert.ok(lines.length > 1);
    assert.ok(lines.every(l => m(l) <= 31), 'width');
    assert.equal(lines.join('').replace(/\s/g, ''), sample.replace(/\s/g, ''), 'no text lost');
    assert.ok(lines.slice(1).every(l => !/^[，。！？]/.test(l)) || sample.indexOf('！') < 0, 'no closing punctuation at line start');
  }
});

for (const l of L) {
  test(`PDF ${l}: complete, multi-page, nothing outside the drawable set, no garbage glyphs, all labels from the locale`, async () => {
    const r = await build(FIXTURES[l], `informe-${l}`);
    assert.ok(r.doc.getNumberOfPages() >= 2, 'pages');
    assert.equal(r.usedEmbeddedFont, l === 'zh', 'embedded font only for zh among these four');
    for (const s of r.drawn) {
      assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(s), `emoji in: ${s}`);
      assert.ok(!/[ØÝ]=/.test(s), `garbled: ${s}`);
    }
    const all = r.drawn.join('\n');
    assert.ok(all.includes(loc[l].informe.pdf.docTitle.replace(/ — .*$/, '')), 'title');
    assert.ok(all.includes(txt.stripUndrawable(loc[l].informe.limitsNote).slice(0, 12)), 'limits note');
    assert.ok(all.includes(FIXTURES[l].data.protest.hash_integridad), 'hash kept');
    assert.ok(all.includes(loc[l].informe.pdf.footer.slice(0, 11)), 'footer');
    // Spanish hard-coded labels must not leak into other languages
    if (l !== 'es') for (const w of ['Destinatario', 'Convocatoria:', 'Distribución geográfica', 'Código fuente', 'SELLO DE INTEGRIDAD', 'Por región']) assert.ok(!all.includes(w), `${l} leaks "${w}"`);
    assert.ok(r.doc.output('arraybuffer').byteLength > 5000);
  });
}

test('font loads only when needed: chinese UI or chinese/Polish/Cyrillic content → yes; plain Spanish/English/French → no', async () => {
  for (const l of ['es', 'en']) { const r = await build(FIXTURES[l]); assert.equal(r.usedEmbeddedFont, false, l); assert.equal(fontLoads, 0); }
  const fr = await build(FIXTURES.fr); assert.equal(fr.usedEmbeddedFont, false, 'fr with œ Œ in WinAnsi');
  const zh = await build(FIXTURES.zh); assert.equal(zh.usedEmbeddedFont, true); assert.equal(fontLoads, 1);
  const a = await build(CONTENT_CASES.esUiChineseContent); assert.equal(a.usedEmbeddedFont, true, 'content decides, not UI language');
  const b = await build(CONTENT_CASES.esUiPolishCyrillic); assert.equal(b.usedEmbeddedFont, true);
  assert.ok(b.drawn.join('\n').includes('Київ') && b.drawn.join('\n').includes('Việt Nam') && b.drawn.join('\n').includes('Łódź'), 'Cyrillic, Vietnamese and Polish drawn');
  const c = await build(CONTENT_CASES.esLatinOnly); assert.equal(c.usedEmbeddedFont, false);
});

test('unsupported scripts and emoji in content: replaced by "?" (never garbage) and the PDF says so', async () => {
  const r = await build(CONTENT_CASES.esUiUnsupported, 'extra-es-unsupported');
  const all = r.drawn.join('\n');
  assert.equal(r.replaced, true);
  assert.ok(all.includes(loc.es.informe.pdf.unsupportedChars));
  assert.ok(!/[؀-ۿ]|🔥|✊/u.test(all));
  const ok = await build(CONTENT_CASES.esLatinOnly);
  assert.equal(ok.replaced, false);
  assert.ok(!ok.drawn.join('\n').includes(loc.es.informe.pdf.unsupportedChars));
});

const NO_INTEGRITY = { hasSnapshotV2: false, snapshot: null, discrepancy: false, unavailable: false };
const attempt = (c, loader) => mod.buildInformePdf({ data: c.data, protestId: 'x', abuseLabel: c.abuse, locale: c.ui, t: tFor(c.ui), loadFont: loader, integrity: NO_INTEGRITY });
const noDoc = async (c, loader) => { let doc = null; await assert.rejects(async () => { doc = await attempt(c, loader); }, (e) => e.name === 'PdfFontError'); assert.equal(doc, null); };

test('font required but unavailable: PdfFontError, no document (zh UI + Latin content, zh content, es UI + Chinese content)', async () => {
  const offline = async () => { throw new Error('offline'); };
  const zhLatin = { ui: 'zh', abuse: FIXTURES.es.abuse, data: { ...FIXTURES.en.data, protest: { ...FIXTURES.en.data.protest } } };
  await noDoc(zhLatin, offline);              // labels need the font even though the content is Latin
  await noDoc(FIXTURES.zh, offline);
  await noDoc(CONTENT_CASES.esUiChineseContent, offline);
});

test('font required but corrupt / empty / not a font: PdfFontError, no document', async () => {
  await noDoc(FIXTURES.zh, async () => new ArrayBuffer(10));
  await noDoc(FIXTURES.zh, async () => asArrayBuffer(Buffer.from('not a font at all'.repeat(200))));
  const truncated = asArrayBuffer(fontBuf).slice(0, 4000);
  await noDoc(FIXTURES.zh, async () => truncated);
});

test('retry after a failed font load works and does not poison later PDFs', async () => {
  let n = 0;
  const flaky = async () => { if (n++ === 0) throw new Error('offline'); return asArrayBuffer(fontBuf); };
  await noDoc(FIXTURES.zh, flaky);
  const ok = await attempt(FIXTURES.zh, flaky);
  assert.equal(ok.usedEmbeddedFont, true);
  assert.equal(ok.replaced, false);
  assert.ok(ok.drawn.join('\n').includes('成都'));
});

test('font not needed: a failing loader is never called and the PDF is produced', async () => {
  let called = 0;
  const r = await attempt(FIXTURES.es, async () => { called++; throw new Error('x'); });
  assert.equal(called, 0);
  assert.equal(r.usedEmbeddedFont, false);
});

test('labels are fully covered in every language (no "?" from the UI itself): replaced is false for the four fixtures', async () => {
  for (const l of L) { const r = await build(FIXTURES[l]); assert.equal(r.replaced, false, l); }
});

test('screen error messages exist in the four languages and are plain translated text', () => {
  for (const l of L) for (const k of ['pdfErrorFont', 'pdfErrorGeneric']) { assert.ok(loc[l].informe[k]?.trim().length > 20, `${l}.${k}`); assert.ok(!/\?{3,}/.test(loc[l].informe[k])); }
});

test('dates: UTC with explicit zone, localised; same instant in every language', () => {
  const iso = '2026-07-31T08:00:00Z';
  assert.equal(mod.formatPdfDateTime(iso, 'es'), '31 jul 2026, 08:00 UTC');
  assert.match(mod.formatPdfDateTime(iso, 'fr'), /31 juil\.? 2026.*08:00 UTC/);
  assert.match(mod.formatPdfDateTime(iso, 'zh'), /2026年7月31日.*08:00 UTC/);
  assert.equal(mod.formatPdfDateTime(null, 'es'), '—');
});

test('file name: Latin titles keep the old slug; titles without Latin letters fall back to the id prefix (no all-dash names)', async () => {
  const es = await build(FIXTURES.es);
  assert.match(es.fileName, /^voiceprotest-informe-recinto-ferial-en-las-llamas--los-vecino\.pdf$/);
  const zh = await build(FIXTURES.zh);
  assert.equal(zh.fileName, 'voiceprotest-informe-9774b676.pdf');
});

test('default loader: after a failure the retry bypasses caches (fresh URL, cache: reload); a good copy is then cached', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return n++ === 0 ? new Response(Buffer.from('garbage'.repeat(500))) : new Response(fontBuf); };
  try {
    await assert.rejects(() => mod.buildInformePdf({ data: FIXTURES.zh.data, protestId: 'x', abuseLabel: 'a', locale: 'zh', t: tFor('zh'), integrity: NO_INTEGRITY }), (e) => e.name === 'PdfFontError');
    const ok = await mod.buildInformePdf({ data: FIXTURES.zh.data, protestId: 'x', abuseLabel: 'a', locale: 'zh', t: tFor('zh'), integrity: NO_INTEGRITY });
    assert.equal(ok.usedEmbeddedFont, true);
    assert.equal(calls.length, 2);
    assert.ok(!calls[0].url.includes('?r=') && calls[0].opts === undefined);
    assert.match(calls[1].url, /fonts\/pdf-sans-subset\.ttf\?r=\d+$/);
    assert.equal(calls[1].opts.cache, 'reload');
    await mod.buildInformePdf({ data: FIXTURES.zh.data, protestId: 'x', abuseLabel: 'a', locale: 'zh', t: tFor('zh'), integrity: NO_INTEGRITY });
    assert.equal(calls.length, 2, 'cached after success');
  } finally { globalThis.fetch = realFetch; }
});
