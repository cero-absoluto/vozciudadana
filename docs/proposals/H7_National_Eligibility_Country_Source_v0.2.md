# H7 — Origen del país en la elegibilidad nacional (reproducción y diseño mínimo)

**Estado:** PROPUESTA v0.2 (ronda adicional autorizada por el Owner, tras Codex) · 19 oct 2026 · **no adoptada** · sin cambios de admisión. Separada de la PR #26 (H2) y de la propuesta general (#27, D9).
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

Script: `docs/proposals/h7-evidence/compare-numbering-sources.mjs`; resultado: `docs/proposals/h7-evidence/numbering-comparison.json`. Conjunto de prueba: los **245 ejemplos móviles sintéticos** que publica una biblioteca de metadatos de numeración (`libphonenumber-js` 1.12.10, MIT; instalada aparte solo para medir, **no** añadida al repositorio). **Todos los porcentajes describen ese conjunto de prueba, no una precisión general.**

**Fuente A — tabla `country_codes` actual** (66 países, 64 prefijos, solo por prefijo). Resultados en el conjunto: 148 sin mapear (60,4 %); 63 con un único país igual al del ejemplo; 9 con un único país distinto del del ejemplo (p. ej. JE, GG, IM → GB; KZ → RU; AX → FI; VA → IT); 25 con varios países en la tabla (plan «+1»).

**Fuente B — salida real de la biblioteca** (`parsePhoneNumberFromString(e164).country`, sin interpretar). En el conjunto: 236 devuelven el ISO del ejemplo (96,3 %); 9 devuelven otro ISO (AX→FI, BL→GP, CC→AU, CX→AU, EH→MA, IM→GB, MF→GP, SJ→NO, VA→IT); 0 sin resultado. **La biblioteca no expone un conjunto de candidatos ni un estado «ambiguo»**: devuelve un ISO o ninguno (en el conjunto de prueba, `getPossibleCountries()` devolvió un solo país en los 245 casos). En 7 de esos 9 casos el ejemplo publicado para ese país es **el mismo número** que el ejemplo del país devuelto; en IM y SJ los ejemplos son distintos.

**Clasificación adicional, con fuente identificada (no es salida de la biblioteca).** Fuente: los metadatos de la propia biblioteca (`getCountries()` y `getCountryCallingCode()`): cuántos ISO comparten un código de llamada (12 códigos, 51 países en total). Es un **indicio a nivel de plan**, no una medida de ambigüedad real: en el conjunto, los 194 ejemplos de códigos no compartidos devolvieron todos el ISO del ejemplo; entre los 51 de códigos compartidos, 42 devolvieron el ISO del ejemplo y 9 devolvieron otro. Los 9 casos de «otro ISO» están todos en códigos compartidos; eso se comprueba contra los metadatos, **no se usa para construir candidatos**. Quedan **sin determinar** qué números de un código compartido son realmente indistinguibles: la biblioteca no lo dice y este documento no lo inventa.

Límites: ejemplos bien formados publicados por la biblioteca, no una muestra de usuarios; no se mide portabilidad, itinerancia, VoIP ni rangos nuevos; el «país» es el del plan de numeración.

## 4. Propuesta mínima (diseño, no implementada)

**Fuente.** El número E.164 que Twilio Verify aprobó en `POST /verify-otp`, no ningún campo declarado. El país se derivaría **en el servidor**, con metadatos de numeración versionados y locales (sin consulta externa ni pago por defecto). La tabla `country_codes` actual no resuelve las atribuciones del §3 en el conjunto de prueba.

**UNA regla (R-N1′).** Sea `derived_country` el ISO que devuelve la derivación **cuando la resolución es `resolved_unshared`** (ver abajo). En una convocatoria nacional, para una adhesión por `phone_otp` con resolución `resolved_unshared`, es elegible si y solo si `derived_country == protest.country`. El país declarado por el cliente no interviene.

**Resolución (tres valores, solo diseño):**
- `resolved_unshared`: la derivación devuelve un ISO y el código de llamada está asignado a un único ISO en los metadatos. **Es el único caso en que R-N1′ está definida.**
- `shared_calling_code`: el código de llamada lo comparten varios ISO en los metadatos (haya o no ISO devuelto). **Este documento no define resultado de elegibilidad nacional para estos números: decisión pendiente (D9b).**
- `no_result`: no hay ISO derivado. **Tampoco se define resultado aquí: decisión pendiente (D9b).**

Para `shared_calling_code` y `no_result`, el diseño solo fija lo que **no** ocurre: el país declarado por el cliente no decide la elegibilidad, y no se atribuye país derivado. Qué elegibilidad nacional se les asigna, si alguna, es una decisión de producto del Owner que este documento no toma ni sesga.

**Datos persistidos (solo diseño; requiere esquema/migración en un encargo posterior):** `numbering_country` (ISO2 o nulo), `numbering_resolution` (los tres valores anteriores), `numbering_meta_version`; firmados en el `participation_token`. El `country_code` declarado deja de ser autoridad y puede conservarse solo como dato informativo.

**Transición.** Hoy, un número cuyo prefijo no esté mapeado puede declarar un país permitido y pasar: eso es H7. Aplicar R-N1′ a los números `resolved_unshared` cierra esa vía para ellos. El efecto sobre los demás números **depende de D9b y no se afirma aquí**. Con la fuente A, en el conjunto de prueba, el 60,4 % de los países no quedarían mapeados.

**Verificaciones y dispositivos existentes.** No se tocan datos ni adhesiones ya creadas (append-only, sin hashes ni nullifiers). Un dispositivo ya verificado no conserva el número, solo su HMAC; su `numbering_*` no puede recalcularse. Propuesta: pedir reverificación **solo cuando falte procedencia fiable** (dispositivo sin `numbering_resolution`), con mensaje claro; sin envío automático de SMS, gasto ni migración aquí. Los dispositivos con procedencia fiable siguen entrando por `device_secret` sin OTP.

**Expectativas por escenario para una implementación futura (no se invierten las pruebas 3–6 sin más):**

| Escenario | Hoy (esta PR) | Esperado con R-N1′ |
|---|---|---|
| 3. Número FR verificado, declara ES | 201 | 403 `NATIONAL_ONLY` (`derived=FR`, `resolved_unshared`) |
| 4. Mismo número, otro dispositivo | Fila reutilizada, país intacto | La nueva verificación correcta **actualiza la procedencia** (`numbering_*`); la declaración no la sobrescribe |
| 5. Dispositivo heredado vuelve con `device_secret` | 201 con país declarado | Sin procedencia fiable → solicitar reverificación (D9c); con procedencia fiable → entra sin OTP |
| 6. Mismo `device_id`, otro número legítimo | Fila reescrita con la última declaración | Nueva verificación deriva del número nuevo; 201 si coincide, 403 si no (no es automáticamente 403) |
| 7. Sin país declarado | 403 | Irrelevante: el país no se declara |
| 8. `shared_calling_code` o `no_result` | Pasa si declara un país permitido | La declaración no decide; el resultado queda pendiente de D9b |

**Lo que no afirma:** que el país del plan sea nacionalidad, residencia, ubicación o país real de registro de la SIM. Portabilidad, itinerancia, operadores virtuales, eSIM y números VoIP siguen siendo posibles.

## 5. Decisiones del Owner (ninguna adoptada)

| Id | Decisión | Nota |
|---|---|---|
| D9a | ¿Hacer cumplir R-N1′ con valor derivado en el servidor, como corrección de un control previsto, en una PR de implementación aparte? | Sin adoptar |
| D9b | Números con `shared_calling_code` o `no_result`: ¿qué elegibilidad nacional se les asigna, si alguna? | Decisión de producto; este documento no la toma ni propone política |
| D9c | Dispositivos sin procedencia fiable: ¿reverificación solo cuando falte procedencia? | Sin adoptar |
| D9d | Fuente de metadatos de numeración: ¿adoptar un conjunto versionado (dependencia o archivo de datos con licencia compatible) o mantener la tabla actual? | Sin adoptar; el §3 muestra resultados sobre un conjunto de prueba, no una recomendación general |

## 6. Límites

Reproducción sobre un modelo del código con servicios simulados; no es una prueba de explotación ni de producción. No se ha medido el alcance histórico real (solo se guarda el HMAC). La comparación usa ejemplos sintéticos de una biblioteca, no tráfico real, y sus porcentajes describen ese conjunto. Esta versión no se ha contrastado todavía con ChatGPT ni Codex.
