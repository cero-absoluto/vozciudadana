# PDF font (lazy-loaded)

`pdf-sans-subset.ttf` is used **only** when a report PDF has to draw characters that the
built-in PDF fonts cannot (Chinese, Cyrillic, Greek, Polish/Czech letters, Vietnamese…).
It is downloaded when the user asks for such a PDF, never on page load.

Build (reproducible, SIL OFL 1.1 sources, renamed family as the licences require):

1. `npm pack @expo-google-fonts/noto-sans@0.4.2` → `400Regular/NotoSans_400Regular.ttf`
2. `npm pack @expo-google-fonts/noto-sans-sc@0.4.4` → `400Regular/NotoSansSC_400Regular.ttf`
3. `pyftsubset` each (no hinting, no layout features):
   - Noto Sans: U+0020–007E, 00A0–024F, 1E00–1EFF, 0370–03FF, 0400–052F, 2010–2027, 2030–203A, 20AC, 2116, 2122, 2190–2193
   - Noto Sans SC: the same Latin/Cyrillic/Greek/punctuation, kana (3040–30FF), CJK punctuation (3000–303F),
     full-width forms, all GB2312 hanzi (6 763) and Big5 level-1 hanzi (5 495)
4. `fontTools.merge` (Noto Sans first, Noto Sans SC second), tables GDEF/GPOS/GSUB/STAT/BASE/vhea/vmtx/gasp dropped,
   family renamed to "Voice Protest PDF Sans".

Not covered (drawn as "?" with a notice in the PDF): Arabic, Hebrew, Indic scripts, Thai, Korean, rare hanzi,
emoji. Licences: `OFL-NotoSans.txt`, `OFL-NotoSansSC.txt`.
