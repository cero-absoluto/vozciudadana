# H7 — Origen del país en la elegibilidad nacional (reproducción y diseño mínimo)

**Estado:** PROPUESTA v0.2 (ronda 2, tras auditoría de ChatGPT) · 19 oct 2026 · **no adoptada** · sin cambios de admisión. Separada de la PR #26 (H2) y de la propuesta general (#27, D9).
**Alcance de este documento:** reproducción local con datos sintéticos, regla canónica exacta y diseño mínimo de una fuente fiable del país. **No** implementa ni adopta la corrección; **no** toca la normalización E.164, hashes, nullifiers, claves, datos ni migraciones. Sin producción, SMS ni gastos. I4/D3 siguen pausados.

## 1. Qué demuestra la reproducción (`tests/h7-national-country.mjs`, 8 pruebas)

Ejecución: `node --experimental-test-module-mocks --test tests/h7-national-country.mjs` (sin red, sin Supabase ni Twilio reales). Recorre el código real de `routes/users.js`, `routes/protests.js` y `lib/adhesionService.js` con la base y Twilio simulados.

| # | Prueba | Demuestra | No demuestra |
|---|---|---|---|
| 1 | Número ES, declara ES, convocatoria nacional ES | Camino legítimo: adhesión creada (201) | — |
| 2 | Número FR, declara FR | La comprobación existe: 403 `NATIONAL_ONLY` | — |
| 3 | **Número FR verificado, declara `country_code=ES`** | **`verify-otp` guarda el valor declarado; `/join` lo compara y crea la adhesión (201)** | Que un atacante real lo logre contra producción: es un modelo del código |
| 4 | **Rama «mismo número, otro dispositivo»:** segunda verificación declarando FR | Se reutiliza la fila existente y su `country_code` no se toca ni se contrasta con el número | Cómo lo gestiona la base real |
| 5 | Dispositivo ya verificado vuelve con `device_secret` | `reauth` devuelve el país almacenado y emite token sin OTP: las verificaciones existentes arrastran el valor declarado | — |
| 6 | **Rama «mismo `device_id`, otro número»:** declaraciones ES y luego FR | La fila se reescribe (upsert por id) con la última declaración | Que esto sea una regla única: las ramas 4 y 6 son distintas y no equivalen a «el primero gana» ni a «el último gana» en general |
| 7 | Sin `country_code` declarado | País nulo ⇒ 403: hoy el país es obligatorio de facto, pero lo aporta el cliente | — |
| 8 | Tabla `country_codes` sembrada | El prefijo **no** determina un único país: `+1` → US, CA, DO | Cobertura real de la base (la prueba lee la migración, no la tabla viva) |

**Sin verificar:** Twilio real; restricciones reales de la base (FK `devices.country_code → country_codes(iso2)` rechazaría códigos fuera de la tabla; no se modela); el cliente web (el selector de país de `AuthScreen` mantiene coherentes país y prefijo para un usuario legítimo; la elusión requiere llamar a la API directamente); cuántas adhesiones existentes podrían estar afectadas: **no es auditable** hoy, porque solo se guarda el HMAC del número y el país declarado, no el país real del número.

## 2. La regla canónica exacta

Textos vigentes (citados):

- Alineación §20.1 (Nacional): *«Eligibility: participants with a verified SIM from the declared country. Persons residing abroad who retain a national SIM remain eligible.»*
- Alineación §20.7: *«for national events it is determined solely by the SIM country matching the event's country»*; §14.4: la elegibilidad se basa en *«SIM prefix or institutional email domain, not IP address»*.
- Metodología §2 (tabla): Nacional/Global → verificación por código SMS a un teléfono real; señal geográfica *«Country of SIM registration (phone prefix)»*.
- Metodología §4: *«SIM country (phone prefix) — a signal of the country in which the SIM is registered. It is a proxy, not a citizenship or residence determination.»*
- Metodología §4 (clasificación): el país se compara por códigos ISO 3166-1 alpha-2 *«captured at verification time»*, nunca por nombres.

**Formulación operativa (R-N1), derivada solo de esos textos:** en una convocatoria de ámbito nacional, una adhesión por `phone_otp` es elegible si y solo si el país asociado al número que superó el OTP coincide con el país declarado de la convocatoria. Ese país es el **del prefijo/plan de numeración** (el proxy que la propia Metodología llama «SIM country (phone prefix)»). **No** es nacionalidad, residencia, ubicación, ni país real de registro de la SIM.

**Elusión de la regla vigente frente a política nueva.**
- *Elusión (lo que muestra H7):* el valor que aplica la regla lo aporta el cliente en lugar de derivarse del número verificado. Hacer cumplir R-N1 con un valor del servidor **no cambia quién es elegible según los textos**; es cumplimiento de la regla existente.
- *Políticas nuevas (fuera de este encargo y de cualquier «corrección»):* excluir prefijos compartidos o ambiguos, líneas VoIP, números portados o en itinerancia, exigir otra señal además del prefijo, o reclasificar adhesiones ya creadas.
- *Observaciones fuera de alcance, no investigadas:* (a) Alineación §20.2 dice que lo regional exige también SIM nacional, pero `adhesionService.js` solo aplica la comprobación a `scope === 'national'`; (b) si `protests.country` es nulo, la comprobación se omite. Se anotan para decisión aparte.

## 3. Comparación de fuentes con fixtures sintéticas

Script: `docs/proposals/h7-evidence/compare-numbering-sources.mjs`; resultado: `docs/proposals/h7-evidence/numbering-comparison.json`. Compara, sobre los 245 ejemplos móviles **sintéticos** de una biblioteca de metadatos de numeración (`libphonenumber-js` 1.12.10, MIT, solo instalada aparte para medir; **no** se añade al repositorio), dos fuentes de país:

| Fuente | Cobertura / resultado sobre 245 países de ejemplo |
|---|---|
| **A. Tabla `country_codes` actual** (66 países, 64 prefijos, solo por prefijo) | 148 sin mapear (60,4 %); 63 únicos correctos; **9 únicos erróneos** (p. ej. JE, GG, IM → GB; KZ → RU; AX → FI; VA → IT); 25 ambiguos (los del plan «+1»: US, CA, DO y 22 más) |
| **B. Metadatos de numeración versionados** (prefijo + código de zona/rangos) | 236 correctos (96,3 %); 0 sin resultado; 9 que la numeración no distingue del país mayor (AX→FI, CC/CX→AU, SJ→NO, VA→IT, IM→GB, BL/MF→GP, EH→MA) |

Lectura: la tabla actual **no sirve como fuente completa** (cobertura baja, atribuciones erróneas entre territorios que comparten plan, ambigüedad en todo el plan «+1»). Los metadatos versionados resuelven la mayoría de ambigüedades de prefijo, pero quedan casos que la numeración **no puede** distinguir. Límites: los ejemplos son números bien formados que publica la biblioteca, no una muestra de usuarios; no mide portabilidad, itinerancia, VoIP ni rangos nuevos; el «país» es el del plan de numeración.

## 4. Propuesta mínima (diseño, no implementada)

**Fuente.** El número E.164 que Twilio Verify aprobó en `POST /verify-otp`, no ningún campo declarado. El país se deriva **en el servidor** con metadatos de numeración **versionados y locales** (sin consulta externa ni pago por defecto). La tabla `country_codes` actual se descarta como fuente (§3).

**UNA regla (R-N1′).** Sea `derived_country` el país único que los metadatos asignan al número verificado. En una convocatoria nacional, la adhesión por `phone_otp` es elegible si y solo si `derived_country == protest.country`. No hay desempate por valor declarado.

**Resultado de la derivación (tres estados, persistidos junto al dispositivo y firmados en el `participation_token`):**
- `unique`: un país → se aplica R-N1′. Es el único estado que puede llamarse «país derivado del número verificado».
- `ambiguous`: los metadatos no pueden distinguir entre varios países (p. ej. territorios que comparten plan). **No** se convierte en `unique` por autodeclaración ni se etiqueta como verificado. Su tratamiento es una **decisión de producto explícita** (D9b), no un detalle técnico: (i) no elegible en convocatorias nacionales (cambia admisiones actuales), o (ii) elegible solo como una clase separada y visible en el informe («país no determinable por el número»), sin contar como país derivado.
- `unmapped`: ningún país asignable → no cumple R-N1′ de ningún país.

**Datos persistidos (solo diseño; requiere esquema/migración en un encargo posterior):** `numbering_country` (ISO2 o nulo), `numbering_resolution` (`unique`/`ambiguous`/`unmapped`), `numbering_meta_version`. El `country_code` declarado deja de ser autoridad; puede conservarse solo como dato informativo.

**Transición (qué cambia respecto al comportamiento actual).** Hoy un número de prefijo no mapeado puede declarar un país permitido y pasar: eso es H7. Con R-N1′ esos casos dejan de pasar. Por tanto, **rechazarlos sí cambia las admisiones actuales** y debe describirse como tal. Con la fuente A serían el 60,4 % de los países de la muestra; con la B, solo los `ambiguous`/`unmapped` residuales. La decisión D9a (corrección de un control previsto) cubre aplicar R-N1′; los casos `ambiguous` quedan fuera hasta D9b.

**Verificaciones y dispositivos existentes.** No se tocan datos ni adhesiones ya creadas (append-only, sin hashes ni nullifiers). Un dispositivo ya verificado no conserva el número, solo su HMAC; su `numbering_*` no puede recalcularse. Propuesta: pedir reverificación **solo cuando falte procedencia fiable** (dispositivo sin `numbering_resolution`), con mensaje claro; no se envía SMS automáticamente y no se autoriza ningún gasto ni migración aquí. Los dispositivos con procedencia fiable siguen entrando por `device_secret` sin OTP.

**Expectativas por escenario para una implementación futura (no se invierten las pruebas 3–6 sin más):**

| Escenario | Hoy (esta PR) | Esperado con R-N1′ |
|---|---|---|
| 3. Número FR verificado, declara ES | 201 | 403 `NATIONAL_ONLY` (`derived=FR`) |
| 4. Mismo número, otro dispositivo | Fila reutilizada, país intacto | La nueva verificación correcta **actualiza la procedencia** (`numbering_*`) en la fila existente; la declaración no la sobrescribe |
| 5. Dispositivo heredado vuelve con `device_secret` | 201 con país declarado | Sin procedencia fiable → solicitar reverificación (D9c); con procedencia fiable → entra sin OTP |
| 6. Mismo `device_id`, otro número legítimo | Fila reescrita con la última declaración | Nueva verificación deriva del número nuevo; 201 si coincide con la convocatoria, 403 si no (no es automáticamente 403) |
| 7. Sin país declarado | 403 | Irrelevante: el país no se declara |
| 8. Prefijo compartido / ambiguo / sin mapear | Pasa si declara un país permitido | `ambiguous` y `unmapped` según D9b; nunca pasan por autodeclaración |

**Lo que no afirma:** que el país del plan sea nacionalidad, residencia, ubicación o país real de registro de la SIM. Portabilidad, itinerancia, operadores virtuales, eSIM y números VoIP siguen siendo posibles.

## 5. Decisiones imprescindibles del Owner

| Id | Decisión | Inclinación (no vinculante) |
|---|---|---|
| D9a | ¿Hacer cumplir R-N1′ con valor derivado en el servidor, como corrección de un control previsto, en una PR de implementación aparte? | Sí, tras revisar este diseño |
| D9b | Casos `ambiguous`: ¿no elegibles (i) o clase separada visible en el informe (ii)? | Decisión de producto; no la tomo yo |
| D9c | Dispositivos sin procedencia: ¿reverificación solo cuando falte procedencia? | Sí, con mensaje claro y sin envío automático |
| D9d | Fuente de metadatos: ¿adoptar un conjunto de metadatos de numeración versionado (nueva dependencia o archivo de datos propio con licencia compatible)? | Sí; la tabla actual no basta (§3) |

## 6. Límites

Reproducción sobre un modelo del código con servicios simulados; no es una prueba de explotación ni de producción. No se ha medido el alcance histórico real (solo se guarda el HMAC). La comparación usa ejemplos sintéticos de una biblioteca, no tráfico real. Esta v0.2 no se ha contrastado todavía con ChatGPT ni Codex.
