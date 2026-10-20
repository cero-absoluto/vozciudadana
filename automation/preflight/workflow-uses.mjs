// Lector ESTRICTO de la estructura de un workflow de GitHub Actions, solo para extraer las referencias `uses`.
// Sin dependencias (el preflight corre en un runner sin `npm install`, y tocar package.json/lockfile activaría deploy.yml).
// Subconjunto de YAML que usan los workflows: mapas y secuencias por sangría, escalares planos/entrecomillados, `|`/`>`,
// colecciones en línea `{…}` y `[…]`, claves planas o entrecomilladas con espacio antes de `:`.
// FALLA CERRADO: anclas, alias, etiquetas, `<<`, `?`, varios documentos, tabuladores en la sangría, claves duplicadas o cualquier
// construcción no reconocida lanzan Unsafe y el preflight rechaza el documento (nunca se interpreta «a medias»).
export class Unsafe extends Error {}
const bad = (msg, n) => { throw new Unsafe(`${msg}${n ? ` (línea ${n})` : ''}`); };

function stripComment(s) { // quita `# …` fuera de comillas (el # debe ir al inicio o tras un espacio)
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === '"') { if (c === '\\') i++; else if (c === '"') q = null; }
    else if (q === "'") { if (c === "'") { if (s[i + 1] === "'") i++; else q = null; } }
    else if (c === '"' || c === "'") { if (i === 0 || /[\s:,[{-]/.test(s[i - 1])) q = c; }
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}
function unquote(s, n) { // s empieza por " o ' y debe cerrar al final exacto; devuelve {value, end}
  const q = s[0];
  if (q === "'") { let v = ''; for (let i = 1; i < s.length; i++) { if (s[i] === "'") { if (s[i + 1] === "'") { v += "'"; i++; } else return { value: v, end: i + 1 }; } else v += s[i]; } return null; }
  let v = '';
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (c === '"') return { value: v, end: i + 1 };
    if (c !== '\\') { v += c; continue; }
    const e = s[++i];
    const simple = { '"': '"', '\\': '\\', '/': '/', n: '\n', t: '\t', r: '\r', 0: '\0', ' ': ' ', _: ' ' };
    if (e in simple) v += simple[e];
    else if (e === 'x' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) { v += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 1, i + 5))) { v += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; }
    else bad(`escape no soportado \\${e ?? ''}`, n);
  }
  return null;
}
const INDICATOR = /^[&*!?@`%]/;

// ── colecciones en línea ────────────────────────────────────────────────────────────────────────────────
function parseFlow(text, n) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  function value(stop) {
    ws(); const c = text[i];
    if (c === undefined) bad('colección en línea sin cerrar', n);
    if (c === '{') return map();
    if (c === '[') return seq();
    if (c === '"' || c === "'") { const r = unquote(text.slice(i), n); if (!r) bad('comilla sin cerrar', n); i += r.end; return r.value; }
    if (INDICATOR.test(text.slice(i))) bad('ancla, alias o etiqueta en colección en línea', n);
    let j = i; while (j < text.length && !stop.includes(text[j]) && !(text[j] === ':' && /\s|[,}\]]|$/.test(text[j + 1] ?? ' ') )) j++;
    const v = text.slice(i, j).trim(); i = j; return v;
  }
  function key() {
    ws(); const c = text[i];
    if (c === '"' || c === "'") { const r = unquote(text.slice(i), n); if (!r) bad('comilla sin cerrar', n); i += r.end; return r.value; }
    if (INDICATOR.test(text.slice(i))) bad('construcción no admitida en clave', n);
    let j = i; while (j < text.length && !(text[j] === ':' && /\s|[,}\]]|$/.test(text[j + 1] ?? ' ')) && !',}]'.includes(text[j])) j++;
    const k = text.slice(i, j).trim(); i = j; return k;
  }
  function map() {
    i++; const o = new Map(); ws();
    if (text[i] === '}') { i++; return o; }
    for (;;) {
      const k = key(); ws(); let v = null;
      if (text[i] === ':') { i++; ws(); v = (text[i] === ',' || text[i] === '}') ? null : value(',}'); }
      if (k === '<<') bad('clave de mezcla <<', n); if (o.has(k)) bad(`clave duplicada «${k}»`, n); o.set(k, v); ws();
      if (text[i] === ',') { i++; ws(); if (text[i] === '}') { i++; return o; } continue; }
      if (text[i] === '}') { i++; return o; }
      bad('colección en línea mal formada', n);
    }
  }
  function seq() {
    i++; const a = []; ws();
    if (text[i] === ']') { i++; return a; }
    for (;;) {
      a.push(value(',]')); ws();
      if (text[i] === ',') { i++; ws(); if (text[i] === ']') { i++; return a; } continue; }
      if (text[i] === ']') { i++; return a; }
      bad('colección en línea mal formada', n);
    }
  }
  const v = value(''); ws(); if (i !== text.length) bad('texto tras la colección en línea', n); return v;
}
function flowBalanced(s) { // ¿cierra la colección en línea? (respeta comillas)
  let d = 0, q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === '"') { if (c === '\\') i++; else if (c === '"') q = null; }
    else if (q === "'") { if (c === "'") { if (s[i + 1] === "'") i++; else q = null; } }
    else if (c === '"' || c === "'") q = c;
    else if (c === '{' || c === '[') d++;
    else if (c === '}' || c === ']') d--;
  }
  return d === 0 && q === null;
}

// ── documento por sangría ───────────────────────────────────────────────────────────────────────────────
export function parseWorkflow(source) {
  if (typeof source !== 'string') bad('entrada no textual');
  let text = source.replace(/^﻿/, ''); if (/\r(?!\n)/.test(text)) bad('retorno de carro suelto'); text = text.replace(/\r\n/g, '\n');
  if (/\0/.test(text)) bad('NUL en el documento');
  const raw = text.split('\n'); const L = []; let sawDoc = false;
  raw.forEach((line, idx) => {
    const n = idx + 1;
    if (/^(---|\.\.\.)(\s|$)/.test(line)) { if (line.startsWith('---') && !sawDoc && L.every((x) => x.blank)) { sawDoc = true; if (line.slice(3).trim() && !line.slice(3).trim().startsWith('#')) bad('contenido tras ---', n); return; } bad('varios documentos o marcador ...', n); }
    if (line.startsWith('%')) bad('directiva YAML', n);
    const ind = /^ */.exec(line)[0].length; if (/^ *\t/.test(line)) bad('tabulador en la sangría', n);
    L.push({ n, raw: line, indent: ind, text: line.slice(ind), blank: line.trim() === '' });
  });
  let p = 0;
  const skip = () => { while (p < L.length && (L[p].blank || L[p].text.startsWith('#'))) p++; };
  const cur = () => { skip(); return p < L.length ? L[p] : null; };

  function blockScalar(parentIndent) { // contenido opaco: no se interpreta
    while (p < L.length && (L[p].blank || L[p].indent > parentIndent)) p++;
    return '[bloque]';
  }
  function scalarFrom(rest, line, parentIndent) { // valor en la misma línea (rest ya sin comentario)
    const first = rest[0];
    if (first === '|' || first === '>') { if (!/^[|>][+-]?\d?[+-]?$/.test(rest)) bad('indicador de bloque no admitido', line.n); p++; return blockScalar(parentIndent); }
    if (first === '{' || first === '[') {
      let acc = rest; p++;
      while (!flowBalanced(acc)) { if (p >= L.length) bad('colección en línea sin cerrar', line.n); acc += ` ${stripComment(L[p].raw).trim()}`; p++; }
      return parseFlow(acc, line.n);
    }
    if (INDICATOR.test(rest)) bad('ancla, alias, etiqueta o directiva', line.n);
    if (first === '"' || first === "'") {
      let acc = rest; p++;
      let r = unquote(acc, line.n);
      while (!r) { if (p >= L.length) bad('comilla sin cerrar', line.n); acc += `\n${L[p].raw.trim()}`; p++; r = unquote(acc, line.n); }
      if (acc.slice(r.end).trim() && !acc.slice(r.end).trim().startsWith('#')) bad('texto tras el escalar entrecomillado', line.n);
      return r.value;
    }
    p++; let v = rest; // plano: las líneas más sangradas que la clave continúan el escalar
    while (p < L.length && (L[p].blank || L[p].indent > parentIndent)) { if (!L[p].blank && L[p].text.startsWith('#')) { p++; continue; } if (!L[p].blank) v += ` ${stripComment(L[p].text)}`; p++; }
    return v.trim();
  }
  function splitKey(t, n) { // → {key, rest} o null si no es una clave
    if (t[0] === '"' || t[0] === "'") {
      const r = unquote(t, n); if (!r) return null; const after = t.slice(r.end); const m = /^ *:(?: +|$)/.exec(after); if (!m) return null;
      return { key: r.value, rest: after.slice(m[0].length) };
    }
    if (INDICATOR.test(t) || t[0] === '{' || t[0] === '[' || t[0] === '-' && /^-(\s|$)/.test(t)) return null;
    const m = /^([^#]*?) *:(?: +|$)/.exec(t); if (!m || /^\s*$/.test(m[1])) return null;
    return { key: m[1].trim(), rest: t.slice(m[0].length) };
  }
  function node(minIndent) {
    const line = cur(); if (!line || line.indent < minIndent) return null;
    if (/^-(\s|$)/.test(line.text)) return sequence(line.indent);
    if (splitKey(stripComment(line.text), line.n)) return mapping(line.indent);
    return scalarFrom(stripComment(line.text), line, line.indent - 1);
  }
  function sequence(indent) {
    const a = [];
    for (;;) {
      const line = cur(); if (!line || line.indent !== indent || !/^-(\s|$)/.test(line.text)) { if (line && line.indent > indent) bad('sangría inesperada en secuencia', line.n); return a; }
      const rest = line.text.slice(1); const off = rest.length - rest.trimStart().length; const body = stripComment(rest.trim());
      if (body === '') { p++; const sub = node(indent + 1); a.push(sub); continue; }
      L[p] = { ...line, indent: indent + 1 + off, text: line.text.slice(1 + off) }; // el resto de la línea se lee como contenido a esa sangría
      a.push(node(indent + 1 + off));
    }
  }
  function mapping(indent) {
    const o = new Map();
    for (;;) {
      const line = cur(); if (!line || line.indent < indent) return o;
      if (line.indent > indent) bad('sangría inesperada en mapa', line.n);
      if (/^-(\s|$)/.test(line.text)) return o;
      const t = stripComment(line.text); const kv = splitKey(t, line.n); if (!kv) bad('línea que no es clave: valor', line.n);
      if (kv.key === '<<') bad('clave de mezcla <<', line.n); if (o.has(kv.key)) bad(`clave duplicada «${kv.key}»`, line.n);
      const rest = kv.rest.trim(); let v;
      if (rest === '') { p++; const nxt = cur(); v = nxt && (nxt.indent > indent || (nxt.indent === indent && /^-(\s|$)/.test(nxt.text))) ? node(nxt.indent) : null; }
      else v = scalarFrom(rest, line, indent);
      o.set(kv.key, v);
    }
  }
  const first = cur(); if (!first) bad('documento vacío');
  const doc = node(0); if (cur()) bad('contenido sin interpretar al final', cur().n);
  return doc;
}

const PIN = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/;
/** {pinned, unpinned} de TODAS las referencias `uses` (pasos y workflows reutilizables). Lanza Unsafe si no se puede interpretar con seguridad. */
export function analyzeUses(source) {
  const doc = parseWorkflow(source);
  if (!(doc instanceof Map)) bad('la raíz no es un mapa');
  const jobs = doc.get('jobs'); if (!(jobs instanceof Map) || jobs.size === 0) bad('falta el mapa `jobs`');
  const pinned = [], unpinned = [];
  const check = (v, where) => {
    if (typeof v !== 'string' || v === '') bad(`\`uses\` no es una cadena (${where})`);
    const ref = v.trim(); if (ref.startsWith('./')) return;
    (PIN.test(ref) ? pinned : unpinned).push(ref);
  };
  for (const [id, job] of jobs) {
    if (!(job instanceof Map)) bad(`el job ${id} no es un mapa`);
    if (job.has('uses')) check(job.get('uses'), `job ${id}`);
    const steps = job.get('steps');
    if (steps !== undefined && steps !== null) {
      if (!Array.isArray(steps)) bad(`steps de ${id} no es una lista`);
      steps.forEach((s, k) => { if (!(s instanceof Map)) bad(`paso ${k} de ${id} no es un mapa`); if (s.has('uses')) check(s.get('uses'), `${id} paso ${k}`); });
    }
  }
  return { pinned, unpinned };
}
