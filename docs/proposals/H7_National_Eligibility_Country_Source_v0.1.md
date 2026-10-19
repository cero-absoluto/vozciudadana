# H7 — Origen del país en la elegibilidad nacional (reproducción y diseño mínimo)

**Estado:** PROPUESTA v0.1 · 19 oct 2026 · **no adoptada** · sin cambios de admisión. Separada de la PR #26 (H2) y de la propuesta general (#27, D9).
**Alcance de este documento:** reproducción local con datos sintéticos, regla canónica exacta y diseño mínimo de una fuente fiable del país. **No** implementa ni adopta la corrección; **no** toca la normalización E.164, hashes, nullifiers, claves, datos ni migraciones. Sin producción, SMS ni gastos. I4/D3 siguen pausados.

## 1. Qué demuestra la reproducción (`tests/h7-national-country.mjs`, 8 pruebas)

Ejecución: `node --experimental-test-module-mocks --test tests/h7-national-country.mjs` (sin red, sin Supabase ni Twilio reales). Recorre el código real de `routes/users.js`, `routes/protests.js` y `lib/adhesionService.js` con la base y Twilio simulados.

| # | Prueba | Demuestra | No demuestra |
|---|---|---|---|
| 1 | Número ES, declara ES, convocatoria nacional ES | Camino legítimo: adhesión creada (201) | — |
| 2 | Número FR, declara FR | La comprobación existe: 403 `NATIONAL_ONLY` | — |
| 3 | **Número FR verificado, declara `country_code=ES`** | **`verify-otp` guarda el valor declarado; `/join` lo compara y crea la adhesión (201)** | Que un atacante real lo logre contra producción: es un modelo del código |
| 4 | Segunda verificación del mismo número declarando FR | El valor declarado no se corrige ni se contrasta con el número: «gana el primero» | Cómo lo gestiona la base real |
| 5 | Dispositivo ya verificado vuelve con `device_secret` | `reauth` devuelve el país almacenado y emite token sin OTP: las verificaciones existentes arrastran el valor declarado | — |
| 6 | Mismo `device_id`, otro número | El país sigue a la última declaración (upsert por id) | — |
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

## 3. Propuesta mínima (diseño, no implementada)

**Fuente fiable.** El número E.164 que Twilio Verify aprobó en `POST /verify-otp` (`phone`, ya validado por el esquema), no ningún campo declarado. El país se deriva en el servidor del código de llamada, con una referencia versionada **del lado del servidor**.

1. **Referencia.** Mínima: la tabla existente `country_codes` (66 países; `dial_code` entero) con coincidencia por el prefijo más largo. Alternativa a decidir (D9d): un conjunto de metadatos de numeración fijado y versionado (dependencia nueva). No se adopta ninguna aquí.
2. **Resultado de la derivación:** un conjunto de países candidatos (`∅`, uno, o varios).
3. **Regla en `/join`:** elegible si `protest.country` pertenece al conjunto derivado.
4. **Prefijos compartidos / países ambiguos** (p. ej. `+1`: US, CA, DO en la tabla): el prefijo solo no distingue. Opción mínima A: el valor declarado deja de ser autoridad y pasa a **desempate dentro de los candidatos** (debe pertenecer al conjunto derivado); fuera del conjunto se rechaza. Límite honesto: dentro de un prefijo compartido el país sigue siendo declarado; el informe debería indicarlo. Opción B: rechazar ambiguos (política nueva, no recomendada). Opción C: refinar con el código de zona (NDC) con un conjunto de metadatos de numeración: mejora la precisión, pero exige dependencia y diseño propios.
5. **Valores no mapeados (`∅`):** no pueden cumplir R-N1 de ningún país. No es una exclusión nueva en la práctica: hoy el país declarado debe existir en `country_codes` (FK), así que el usuario tampoco puede elegir un país fuera de la tabla.
6. **Dispositivos y verificaciones existentes.** No se tocan datos ni adhesiones ya creadas (append-only). Para uniones futuras a convocatorias nacionales hay un hecho de fondo: **un dispositivo ya verificado no conserva el número, solo su HMAC; su país derivado no puede recalcularse**.
   - *E2 (recomendada):* los dispositivos sin país derivado deben repetir el OTP una vez en convocatorias nacionales, momento en que se deriva y se guarda. Coste: una reverificación para quien vuelve.
   - *E3:* aceptar el valor heredado con marca de «origen declarado», acotada en el tiempo. Deja la elusión abierta mientras dure, porque un dispositivo con valor falso se puede crear en cualquier momento antes del corte.
   - Persistir el valor derivado requiere esquema/migración y firmarlo en el `participation_token`: **fuera de este encargo**.
7. **Sin cambios** en: informe, hash, nullifier, claves, normalización E.164, `device_secret`.

**Pruebas previstas para una implementación futura** (tras decisión): invertir las pruebas 3–6 de este archivo (esperar 403 o reverificación), más casos de prefijo compartido, no mapeado y dispositivo heredado.

**Lo que no afirma:** que el país del prefijo sea nacionalidad, residencia, ubicación o país real de registro. Portabilidad, itinerancia, operadores virtuales, eSIM y números VoIP de otro país siguen siendo posibles; ya son límites declarados de la Metodología.

## 4. Decisiones imprescindibles del Owner

| Id | Decisión | Inclinación (no vinculante) |
|---|---|---|
| D9a | ¿Se considera corrección de seguridad (hacer cumplir R-N1 con valor del servidor) y se autoriza una PR de implementación aparte? | Sí, tras revisar este diseño |
| D9b | Prefijos compartidos: ¿desempate declarado dentro de candidatos (A), rechazar ambiguos (B) o refinar por zona (C)? | A, con indicación en el informe |
| D9c | Dispositivos existentes: ¿reverificación (E2) o herencia acotada (E3)? | E2 |
| D9d | Referencia de numeración: ¿tabla actual o conjunto de metadatos versionado (dependencia)? | Tabla actual primero |

## 5. Límites

Reproducción sobre un modelo del código con servicios simulados; no es una prueba de explotación ni de producción. No se ha medido el alcance real histórico. Esta propuesta no se ha contrastado todavía con ChatGPT ni Codex.
