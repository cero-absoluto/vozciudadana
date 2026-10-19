# Propuesta de diseño — Integridad de la participación (anti-duplicidad, pertinencia y anonimato)

**Estado:** PROPUESTA v0.1 · 19 oct 2026 · sin implementar · requiere decisión del Owner y auditoría de ChatGPT/Codex.
**Autor:** Claude (desarrollo). **Alcance:** diseño. No cambia código, base de datos, producción, SMS ni reglas de participación, financiación o privacidad hasta que el Owner decida. I4/D3 siguen pausados y esta propuesta no los toca.
**Base leída:** `docs/canonical/6.-Participation_Verification_Methodology.md` (v1.3), `3.-VoiceProtest_AuditAlignment` (§13–14, 20–21), `docs/governance/5.-Security_Audit…` (VP-SEC-001–008), `apps/api/src/{lib/adhesionService,lib/participationToken,lib/locationEvidenceService,lib/recaptcha,routes/users,routes/protests,server}.js` y migraciones `20260609_otp_protection`, `20260723_adhesion_service_rpc`, `20260630_device_retention_270d`. Lectura de código solamente: nada se ha ejecutado contra producción.

## 1. Objetivo y restricciones

Que Voice Protest sea la aplicación de referencia para protestas globales, nacionales, regionales, locales e institucionales, con tres propiedades a la vez:

1. **Anonimato máximo:** seudonimia por convocatoria, sin datos en claro, sin huellas de dispositivo, sin vínculos entre convocatorias.
2. **Pertinencia:** que los dispositivos ajenos a la protesta no desvirtúen el informe.
3. **Unicidad:** una persona/número/dispositivo cuenta una vez.

Restricciones heredadas de los documentos canónicos: *el sistema nunca afirma más de lo que puede mostrar*; la señal geográfica es informativa, **no excluyente** (Metodología §8, Alineación §20.7); no se pretende imposibilitar la manipulación sino encarecerla, hacerla visible y auditable (§13.3). Cualquier propuesta que excluya participantes cambia esas reglas y exige decisión expresa del Owner.

## 2. Estado actual (verificado en el código)

| Capa | Hoy | Fuerza |
|---|---|---|
| Identidad | SMS OTP (Twilio Verify) o email institucional; teléfono → HMAC | Media: una SIM = una identidad |
| Unicidad por convocatoria | Nullifier HMAC(v1:método:hash:protesta) + índices únicos parciales `(protest_id, nullifier)` y `(protest_id, device_id)` | Fuerte para el mismo número |
| Dispositivo | `device_id` aleatorio generado por el cliente; `devices.phone_hash` es UNIQUE; `device_secret` evita usar un id ajeno; retención 270 d | **Débil** (ver H1) |
| Anti-bot | reCAPTCHA v3 (umbral 0,5, con acción y hostname); límites por teléfono (3/24 h), dispositivo (3/h), IP (10/h), dispositivo+protesta (2/h); enfriamiento progresivo | Media |
| Pertinencia | Nacional: prefijo SIM = país. Institucional: dominio de email. **Local, regional y global: sin restricción** (GPS/IP solo suben la fiabilidad 60–95 %) | **Hueco principal** |
| Integridad del informe | Hash v2 verificable, anonimización a 90 d | Fuerte |

## 3. Hallazgos de la lectura (a confirmar con pruebas antes de actuar)

- **H1 — «Un dispositivo por convocatoria» es en la práctica «una SIM».** El `device_id` lo elige el cliente y se borra con limpiar el almacenamiento; `devices.phone_hash` es UNIQUE, y en `verify-otp` un segundo teléfono desde el mismo `device_id` sobrescribe el `phone_hash` de esa fila. El freno real es el coste de conseguir otra SIM, no el dispositivo. El PDF dice «One device per protest scope»: conviene precisar el texto (ver D6).
- **H2 — La comprobación previa al SMS está rota.** `users.js` (request-otp) calcula `HMAC(phone_hash + protest_id)`, mientras `computeNullifier` usa `HMAC('v1:phone_otp:' + phone_hash + ':' + protest_id)`. Nunca coinciden: se envía (y se paga) un SMS a quien ya se adhirió. La adhesión duplicada sí se rechaza después, por el índice único. Impacto: coste y ruido, no integridad.
- **H3 — IP de cliente posiblemente incorrecta.** No hay `trustProxy` en Fastify. Tras el proxy de Railway, `req.ip` podría ser la dirección del proxy (límites por IP compartidos por todos) y `x-forwarded-for[0]` es controlable por el cliente (límites y geolocalización eludibles). **Hipótesis: no verificada**; se comprueba con una prueba de solo lectura en entorno desechable.
- **H4 — Pertinencia local/regional/global no se aplica ni se segmenta.** Un número de cualquier país puede sumar a una protesta local. El informe lo muestra (GPS vs «nacionales sin GPS»), pero el titular suma todo.
- **H5 — Sin señales agregadas de campaña.** No hay detección de ráfagas (picos de adhesiones, bloques de numeración contiguos, mismo prefijo/operador, mismo IP-hash) ni indicador visible en el informe.
- **H6 — Privacidad residual.** `devices` vincula `phone_hash` con el `device_id` 270 días entre convocatorias (el nullifier es no enlazable, pero esa tabla sí enlaza). Celdas geográficas pequeñas en el informe (p. ej. una ciudad con 1 participante) pueden reidentificar en convocatorias locales.

## 4. Principios de diseño

1. **Segmentar antes que excluir.** Pertinencia = el informe separa y etiqueta, no oculta. Excluir es opcional por convocatoria y requiere decisión.
2. **Sin huella digital del dispositivo** (canvas, fuentes, etc.): incompatible con el anonimato. Solo señales que el usuario controla o que el sistema operativo certifica sin identificar.
3. **Seudonimia por convocatoria:** todo identificador derivado lleva la convocatoria en la derivación y claves rotables.
4. **Agregar y caducar:** las señales antifraude se guardan como contadores o con TTL corto y se anonimizan con el resto (90 d).
5. **Honestidad evidencial:** cada señal nueva dice qué prueba y qué no; el informe lo declara.
6. **Todo regla nueva es determinista, versionada, probada y auditable**; ninguna rechaza en silencio.

## 5. Propuesta por capas

### Capa A — Identidad (unicidad fuerte, bajo coste de privacidad)
- **A1** Reparar H2 (usar `computeNullifier` en request-otp). Bajo riesgo, ahorra SMS.
- **A2** Normalizar E.164 en un único punto antes de hashear (evita duplicados por formato).
- **A3** Clasificar el tipo de línea (móvil/fijo/VoIP/prepago) con el proveedor de verificación y tratar VoIP como señal de menor fiabilidad o rechazo, según D3. Coste por consulta: dato para el Owner; no se activa sin decisión.
- **A4** Protección contra bombeo de SMS del proveedor (tarifas por país, límites por prefijo). Es protección financiera: solo diseño, sin autoridad financiera.

### Capa B — Dispositivo (sin huellas)
- **B1** Reparar H3 (`trustProxy` con la configuración real de Railway, `x-forwarded-for` solo de saltos de confianza). Prueba previa en entorno desechable.
- **B2** Dejar de presentar `device_id` como control de unicidad (H1); mantenerlo solo como sesión.
- **B3 (opcional, mayor valor)** Prueba de dispositivo real sin identidad: atestación de plataforma si hay app nativa (Play Integrity / App Attest) y, en web, un *token anónimo de humanidad* tipo Private Access Tokens / Turnstile, o una credencial WebAuthn local al dispositivo como segundo factor de sesión (no como identificador). Ninguna debe enlazar convocatorias.

### Capa C — Pertinencia por ámbito
| Ámbito | Elegibilidad | Señal de pertinencia | Propuesta |
|---|---|---|---|
| Institucional | Dominio de email (+ censo) | — | Ya fuerte. Sin cambio. |
| Nacional | Prefijo SIM = país | IP/zona horaria como coherencia | Etiquetar incoherencias, no bloquear. |
| Regional/local | Hoy abierta | GPS en territorio; **presencia en el acto** | Segmentar el titular (C1) y añadir presencia verificable (C2). |
| Global | Cualquier teléfono | País | Desglose por país obligatorio y visible. |

- **C1 Modo de recuento por convocatoria** (lo elige quien crea, visible en el detalle y en el PDF): *Abierto* (hoy) o *Territorial* (el titular cuenta solo adhesiones con señal territorial; el resto se muestra como «apoyo sin verificación territorial»). Nadie queda excluido y el informe no afirma más de lo que prueba. Modifica el cálculo del titular y el hash (D1, D5).
- **C2 Presencia en el acto (QR rotatorio)** para convocatorias locales: código que cambia cada pocos minutos en el lugar; sustituye al GPS (falsificable) sin recoger ubicación. Es privacidad-positiva y la señal más fuerte para lo local. `qr` ya está previsto como método en el servicio de adhesión.
- **C3 Exclusión opcional** (modo *Restringido*): solo con decisión expresa y justificación pública. Se desaconseja por defecto: cambia las reglas de participación y penaliza a quien no puede compartir ubicación (riesgo de represalia en convocatorias sensibles; hoy se desactiva GPS en riesgo alto/crítico).

### Capa D — Detección de campañas (visible y auditable)
- **M1** Indicadores agregados por convocatoria (no por persona): ráfagas por minuto/hora, concentración de prefijos y bloques de numeración, concentración por IP-hash, proporción VoIP, proporción sin GPS en lo local.
- **M2** Reglas deterministas y versionadas que producen un **sello de anomalía** («picos atípicos: sí/no» con umbrales publicados), sin borrar adhesiones ni rechazar en silencio. El informe muestra el sello y qué se midió.
- **M3** Datos con TTL: contadores agregados y anonimización a 90 d como el resto.

### Capa E — Privacidad
- **E1** Umbral mínimo de celda (k) en desgloses geográficos de convocatorias pequeñas: bajo k se agrupa en «otros». Afecta al informe y al hash (D5).
- **E2** Revisar el vínculo `phone_hash ↔ device_id` de 270 d (H6): reemplazar por una derivación por convocatoria o acortar retención. Cambia reglas de privacidad: decisión del Owner.
- **E3** Rotación de claves HMAC con versionado del prefijo del nullifier (`v1` → `v2`) para poder renovar sin romper unicidad vigente.

## 6. Decisiones que necesito del Owner (no adopto ninguna)

| Id | Decisión | Mi recomendación |
|---|---|---|
| D1 | ¿Segmentar el titular por pertinencia (C1) o mantener un solo recuento? | Segmentar, modo Abierto por defecto |
| D2 | ¿Se permite el modo Restringido (C3)? | No por ahora |
| D3 | ¿VoIP/línea virtual: rechazar, bajar fiabilidad o ignorar? | Bajar fiabilidad, y revisar con datos |
| D4 | ¿Se financia la consulta de tipo de línea y la protección contra bombeo (A3/A4)? | Decisión tuya; coste a presupuestar |
| D5 | ¿Se acepta un hash/informe v3 si C1 o E1 cambian lo que cubre el hash? | Solo con migración documentada, sin tocar históricos |
| D6 | ¿Se corrige el texto «One device per protest scope» del PDF y la metodología (H1)? | Sí: «un número verificado por convocatoria» |
| D7 | ¿Se acorta o deriva el vínculo teléfono-dispositivo (E2)? | Sí, derivación por convocatoria |
| D8 | ¿QR de presencia (C2) para convocatorias locales? | Sí, como fase posterior |

## 7. Plan de implementación (tras decisiones; cada fase en su rama, PR en borrador, pruebas sintéticas, sin producción)

- **Fase 1 — Correcciones sin cambio de reglas** (no requieren D1–D8): H2 (A1), A2, H3 con prueba en entorno desechable, precisión de textos (D6). Pruebas dirigidas: nullifier previo = nullifier real; E.164; IP desde cabeceras simuladas.
- **Fase 2 — Indicadores y sello de anomalía** (M1–M3 de la capa D; sin efecto en admisión): cálculo sobre datos sintéticos, documentación en la Metodología.
- **Fase 3 — Segmentación (C1) y umbral k (E1)**: solo con D1/D5. Cambia informe y PDF; se prueba con los cuatro idiomas.
- **Fase 4 — Señales de dispositivo y línea (A3, B3)**: solo con D3/D4; requieren proveedor y coste.
- **Fase 5 — QR de presencia (C2) y derivación de vínculos (E2/E3)**: diseño propio y auditoría aparte.

Cada fase: actualización de la Metodología en el mismo cambio, entrada en el registro de auditoría, y revisión de Codex en GitHub. Máximo dos rondas de corrección por ciclo.

## 8. Límites y riesgos

- Ninguna combinación impide la manipulación con muchas SIM reales; sube el coste y la visibilidad (§13.3).
- GPS y zona horaria son falsificables: ninguna capa los trata como prueba.
- Las señales de línea/VoIP y de atestación dependen de proveedores externos (privacidad y coste).
- Segmentar cambia lo que el titular comunica: puede reducir el número mostrado en protestas legítimas con participantes dispersos. Debe explicarse en el informe.
- H3 es hipótesis hasta probarla; H1 y H2 salen de leer el código y deben cubrirse con pruebas antes de corregir.
- Esta propuesta no se ha contrastado con ChatGPT ni con Codex.
