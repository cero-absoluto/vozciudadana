// Text helpers for the public-report PDF (jsPDF).
//
// jsPDF's built-in fonts (helvetica/courier) only draw WinAnsi characters.
// Anything else (emoji, Chinese, Cyrillic, Polish letters…) comes out as
// garbage. These helpers (a) decide, from the *content* that will be drawn
// and not only from the UI language, whether the embedded font is needed,
// (b) remove what cannot be drawn instead of printing garbage, and
// (c) wrap text for scripts without spaces.

const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** True when the built-in (WinAnsi) PDF fonts can draw this code point. */
export function isWinAnsi(cp) {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)
    || WIN_ANSI_EXTRA.includes(String.fromCodePoint(cp));
}

/**
 * Coarse ranges the bundled font is meant to cover (Latin Extended-A/B and
 * Additional (Vietnamese), Greek, Cyrillic, punctuation, CJK, kana, full-width forms). Used only to decide
 * whether downloading the font is worthwhile; the exact coverage is read from
 * the font itself once it is loaded.
 */
export function inEmbeddedFontRanges(cp) {
  return (cp >= 0x100 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff) || (cp >= 0x370 && cp <= 0x52f)
    || (cp >= 0x2010 && cp <= 0x203a) || cp === 0x20ac || cp === 0x2116 || cp === 0x2122
    || (cp >= 0x2190 && cp <= 0x2193) || (cp >= 0x3000 && cp <= 0x30ff)
    || (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xff01 && cp <= 0xffe5);
}

const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFE00-\uFE0F\u20E3\u{E0100}-\u{E01EF}\u{E0020}-\u{E007F}]/gu;
const PICTO_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu;
const CONTROL_RE = /[\p{Cc}\u2028\u2029]/gu;

/**
 * NFC-normalise, drop emoji/invisible marks, turn control characters into spaces.
 * `removedVisible` is true when a visible character (emoji/pictograph) was dropped,
 * so callers can report it instead of silently changing user content.
 */
export function stripUndrawableInfo(input) {
  let removedVisible = false;
  let s = String(input ?? '').normalize('NFC');
  s = s.replace(CONTROL_RE, ' ').replace(INVISIBLE_RE, '');
  // Keep © ® ™ and other WinAnsi characters that Unicode also tags as pictographic.
  s = s.replace(PICTO_RE, (ch) => {
    if (ch.length === 1 && isWinAnsi(ch.codePointAt(0))) return ch;
    removedVisible = true;
    return '';
  });
  return { text: s.replace(/ {2,}/g, ' ').trim(), removedVisible };
}

export function stripUndrawable(input) { return stripUndrawableInfo(input).text; }

/** Does any text need the embedded font (as opposed to the built-in ones)? */
export function needsEmbeddedFont(texts) {
  for (const text of texts) {
    for (const ch of stripUndrawable(text)) {
      const cp = ch.codePointAt(0);
      if (!isWinAnsi(cp) && inEmbeddedFontRanges(cp)) return true;
    }
  }
  return false;
}

/**
 * Make `text` drawable. `covers(cp)` says which code points the active font
 * can draw. Returns the cleaned text and whether visible characters had to be
 * replaced by "?" (so the PDF can say so instead of hiding it). With
 * `flagStripped` an emoji removed from the text also counts as a visible change
 * (used for user content; the emoji that locale strings carry on purpose do not).
 */
export function makeDrawable(text, covers, { flagStripped = false } = {}) {
  const info = stripUndrawableInfo(text);
  let replaced = flagStripped && info.removedVisible;
  let out = '';
  for (const ch of info.text) {
    const cp = ch.codePointAt(0);
    if (covers(cp)) out += ch;
    else { out += '?'; replaced = true; }
  }
  return { text: out, replaced };
}

/** Code points mapped by a TrueType font (cmap formats 4 and 12). */
export function coverageFromTtf(buffer) {
  const dv = new DataView(buffer);
  const numTables = dv.getUint16(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(rec), dv.getUint8(rec + 1), dv.getUint8(rec + 2), dv.getUint8(rec + 3));
    if (tag === 'cmap') { cmapOffset = dv.getUint32(rec + 8); break; }
  }
  const covered = new Set();
  if (cmapOffset < 0) return covered;
  const subtables = dv.getUint16(cmapOffset + 2);
  for (let i = 0; i < subtables; i++) {
    const sub = cmapOffset + dv.getUint32(cmapOffset + 4 + i * 8 + 4);
    const format = dv.getUint16(sub);
    if (format === 12) {
      const groups = dv.getUint32(sub + 12);
      for (let g = 0; g < groups; g++) {
        const at = sub + 16 + g * 12;
        const start = dv.getUint32(at); const end = dv.getUint32(at + 4); const glyph = dv.getUint32(at + 8);
        for (let cp = start; cp <= end; cp++) if (glyph + (cp - start) !== 0) covered.add(cp);
      }
    } else if (format === 4) {
      const segX2 = dv.getUint16(sub + 6);
      const ends = sub + 14; const starts = ends + segX2 + 2;
      const deltas = starts + segX2; const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = dv.getUint16(ends + s * 2); const start = dv.getUint16(starts + s * 2);
        const delta = dv.getInt16(deltas + s * 2); const ro = dv.getUint16(ranges + s * 2);
        for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
          let glyph;
          if (ro === 0) glyph = (cp + delta) & 0xffff;
          else {
            const g = dv.getUint16(ranges + s * 2 + ro + (cp - start) * 2);
            glyph = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (glyph !== 0) covered.add(cp);
        }
      }
    }
  }
  return covered;
}

const CJK_CHAR_RE = /[　-〿぀-ヿ㐀-鿿＀-￯]/u;
// Closing punctuation / small kana must not start a line.
const NO_LINE_START = '，。、；：！？）］｝」』》〉”’、.,;:!?)]}%…ー々ぁぃぅぇぉっゃゅょゎ';

/**
 * Greedy line wrapping that also works for text without spaces (Chinese) and
 * for words longer than the line (URLs). `measure(str)` returns the width in
 * the unit of `maxW` using the font currently set on the document.
 */
export function wrapText(measure, text, maxW) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    const tokens = paragraph.match(/[　-〿぀-ヿ㐀-鿿＀-￯]|[^\s　-〿぀-ヿ㐀-鿿＀-￯]+|\s+/gu) || [];
    let line = '';
    const flush = () => { lines.push(line.replace(/\s+$/u, '')); line = ''; };
    for (const token of tokens) {
      const isSpace = /^\s+$/u.test(token);
      if (isSpace && line === '') continue;
      if (measure(line + token) <= maxW || (isSpace)) { line += token; continue; }
      if (line !== '' && !(CJK_CHAR_RE.test(token) && NO_LINE_START.includes(token))) flush();
      if (line === '' && measure(token) > maxW) {
        // A single word wider than the line: break it by characters.
        for (const ch of token) {
          if (line !== '' && measure(line + ch) > maxW) flush();
          line += ch;
        }
      } else {
        line += token;
      }
    }
    if (line !== '' || tokens.length === 0) flush();
  }
  return lines;
}
