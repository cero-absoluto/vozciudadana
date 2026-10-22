# Propuesta de diseño — Integridad de la participación (v0.2)

**Estado:** PROPUESTA v0.2 · 19 oct 2026 · sin implementar, sin adoptar · sustituye a la v0.1 tras la revisión del auditor (ChatGPT).
**Autor:** Claude (desarrollo). **Alcance:** diseño. No cambia reglas de participación, financiación ni privacidad, ni producción, SMS, base de datos. I4/D3 siguen pausados y no se tocan.
**Base:** `docs/canonical/6.-Participation_Verification_Methodology.md` v1.3, Alineación §13–14 y 20–21, auditoría de seguridad VP-SEC-001–008, y `apps/api/src/{lib/adhesionService,lib/participationToken,lib/locationEvidenceService,lib/recaptcha,routes/users,routes/protests,server}.js` y migraciones de OTP, RPC de adhesión y retención de dispositivos. Lectura de código y pruebas sintéticas locales; nada contra producción.

## 0. Cambios respecto a la v0.1 (objeciones del auditor, aceptadas)

1. «Una persona/número/dispositivo cuenta una vez» se separa en garantías distintas (§1).
2. «Local/regional/global sin restricción» deja de llamarse hueco: es una decisión del modelo abierto (§3, H4).
3. El QR rotatorio ya no se presenta como más fuerte que el GPS (§5, C2).
4. VoIP: no se propone penalizar sin evidencia; primero medir (§5, A3).
5. «Sello de anomalía» pasa a «patrones observados», descriptivos, sin sospecha automática (§5, capa D).
6. Se eliminan adjetivos generales («fuerte») sobre anonimato y hash (§2).
7. Fase 1 se reduce a una corrección con prueba; el resto son estudios o decisiones (§7). D6 deja de figurar como cambio sin decisión.
8. La corrección del nullifier previo al SMS se ha comprobado frente al riesgo de revelar participación (§3, H2): corregirla tal cual lo introduciría.

## 1. Objetivo y qué se garantiza (y qué no)

Que Voice Protest sirva para convocatorias globales, nacionales, regionales, locales e institucionales conservando el máximo anonimato razonable, y que dispositivos ajenos o duplicados distorsionen lo menos posible el informe. Son garantías distintas y el sistema no debe afirmar más de las que comprueba:

| Garantía | Qué se comprueba hoy | Qué NO se demuestra |
|---|---|---|
| Un número verificado cuenta una vez por convocatoria | OTP por SMS + nullifier HMAC + índice único `(protest_id, nullifier)` | Que sea una persona única (una persona puede tener varias SIM; una SIM puede ser de otra persona) |
| Un email institucional cuenta una vez por convocatoria | OTP por email del dominio + nullifier + índice único de miembro | Rol, ni que sea una sola persona por cuenta |
| Una sesión de dispositivo cuenta una vez | Índice único `(protest_id, device_id)` con `device_id` elegido por el cliente | Que sea un dispositivo único: se borra con limpiar el almacenamiento (H1) |
| Pertenencia a un territorio | Nacional: el país del dispositivo, **declarado por el cliente** al verificar el OTP y comparado en `/join` (no se deriva del número verificado, ver H7). Local/regional: GPS opcional (falsificable) | Que el número sea de ese país, residencia o presencia física |

Restricciones heredadas: el sistema nunca afirma más de lo que puede mostrar; la señal geográfica informa y no excluye (Metodología §8, Alineación §20.7); se busca encarecer, hacer visible y auditable la manipulación, no imposibilitarla (§13.3). Excluir participantes cambia esas reglas y exige decisión expresa del Owner.

## 2. Estado actual (verificado leyendo el código)

| Capa | Hoy | Qué aporta / límites |
|---|---|---|
| Identidad | SMS OTP o email institucional; teléfono → HMAC con secreto del servidor | Evidencia de control de un número o dominio en el momento; no de persona |
| Unicidad | Nullifier por convocatoria + índices únicos parciales | Impide repetir el mismo número/email en la misma convocatoria |
| Dispositivo | `device_id` generado por el cliente; `devices.phone_hash` UNIQUE; `device_secret`; retención 270 d | Sesión y reautenticación; no es unicidad de dispositivo |
| Anti-bot | reCAPTCHA v3 (umbral 0,5), límites por teléfono, dispositivo, IP y dispositivo+protesta, enfriamiento | Encarece la automatización; falsos positivos posibles en redes compartidas |
| Pertinencia | Nacional: `country_code` aportado por el cliente en `verify-otp`, guardado en el dispositivo y comparado con el país de la convocatoria (H7). Institucional: dominio. Local/regional/global: abiertas; GPS/IP solo modulan la fiabilidad 60–95 % | Nacional: la metodología describe «país de registro de la SIM», pero el código no lo deriva del número verificado |
| Integridad del informe | Hash v2 recalculable por cualquiera; anonimización a 90 d | Sirve para detectar alteración posterior; no prueba por sí solo que los datos de origen sean auténticos |
| Anonimato | HMAC con secreto; GPS descartado tras geocodificar; nullifier no enlazable entre convocatorias | Seudonimia; el HMAC no elimina vínculos internos (p. ej. `devices` enlaza `phone_hash` y `device_id` 270 d) |

## 3. Hallazgos

- **H1 — «Un dispositivo por convocatoria» es en la práctica «una SIM».** `device_id` lo elige el cliente; `devices.phone_hash` es UNIQUE; en `verify-otp` un segundo teléfono desde el mismo `device_id` sobrescribe el `phone_hash` de la fila. El freno real es el coste de otra SIM. El texto «One device per protest scope» del PDF y la metodología debería describir lo comprobado (número, y email institucional donde aplique). *Pendiente de decisión D6.*
- **H2 — La comprobación previa al SMS no coincidía con el nullifier real, y arreglarla tal cual es peligroso.** `request-otp` calculaba `HMAC(phone_hash + protest_id)`; `/join` guarda `HMAC('v1:phone_otp:' + phone_hash + ':' + protest_id)`. Nunca coincidían (código muerto). Si se hiciera coincidir, la respuesta `{sent:false}` frente a `{sent:true}` (el front la usa: `AuthScreen.vue`) revelaría a cualquiera con un número y un id de convocatoria (ambos aportados por el cliente) si ese número participó. **Resolución propuesta y ya preparada en rama local:** eliminar la consulta; misma respuesta y mismo SMS para todos; el rechazo de duplicados sigue en `/join`. Coste: un número ya adherido desde otro dispositivo recibe un SMS. Prueba sintética sin red: antes de la corrección falla (consulta de participación presente); después pasa (respuesta idéntica, sin consulta, SMS en ambos casos). **Límites:** no he medido canales temporales; la prueba cubre estado y cuerpo de la respuesta, no latencia.
- **H3 — IP de cliente posiblemente incorrecta (hipótesis no verificada).** No hay `trustProxy`; tras el proxy de la plataforma, `req.ip` podría ser el del proxy y `x-forwarded-for[0]` es controlable por el cliente. Primero probar en entorno desechable qué cabeceras llegan realmente; no aplicar `trustProxy` indiscriminadamente (depende de qué intermediarios son fiables).
- **H7 — La elegibilidad nacional no se deriva del número verificado.** `POST /verify-otp` acepta `country_code` en el cuerpo y lo guarda en `devices`; `/join` compara ese valor guardado con el país de la convocatoria (`NationalCountryMismatchError`). Un cliente directo de la API con un número extranjero válido podría declarar el país objetivo y superar la comprobación. La Metodología (§2, §4) describe esta señal como país de registro de la SIM: hoy no es una garantía comprobada. *Hallazgo de la revisión de Codex en la PR #27; verificado leyendo `users.js` y `protests.js`; no probado contra la API real. Cualquier corrección (derivar el país del prefijo E.164 del número verificado) cambia una regla de admisión y requiere decisión del Owner (D9).*
- **H4 — Local, regional y global son abiertas por diseño.** No es un defecto por sí mismo; en global la apertura es lo esperado. La pregunta abierta es si el titular del informe debe separar presencia territorial verificada de apoyo sin ella (§5, C1). Hoy el informe ya muestra GPS vs «sin GPS».
- **H5 — Sin indicadores agregados de patrones de adhesión** (picos, concentración de prefijos o IP-hash).
- **H6 — Privacidad residual.** `devices` vincula `phone_hash` y `device_id` 270 días entre convocatorias; celdas geográficas pequeñas (p. ej. 1 participante) pueden reidentificar en convocatorias locales.

## 4. Principios

1. Segmentar y etiquetar antes que excluir. Excluir solo con decisión expresa.
2. Sin huella digital del dispositivo (canvas, fuentes, etc.).
3. Identificadores derivados por convocatoria; claves versionadas.
4. Señales antifraude agregadas o con caducidad corta, anonimizadas con el resto (90 d).
5. Cada señal declara qué prueba y qué no, también en el informe.
6. Reglas deterministas, versionadas, probadas y auditables; ninguna rechaza en silencio.
7. Describir patrones observados, no atribuir intención.

## 5. Opciones por capa (no adoptadas)

**A — Identidad.** *A1 (H2): hecho en rama local, ver §7.* *A2 E.164:* estudiar compatibilidad antes de tocar nada: cambiar la normalización previa al hash puede cambiar identidades existentes y la detección de duplicados; el estudio compara cómo llegan los números hoy (validación `^\+[1-9]\d{7,14}$` en el esquema) y si existen variantes que hoy generen hashes distintos. *A3 tipo de línea (VoIP/prepago):* no penalizar sin evidencia; podría excluir de facto a participantes legítimos y no demuestra manipulación. Primero **medir** la proporción por convocatoria sobre datos agregados, con decisión previa de coste y privacidad. *A4 bombeo de SMS:* protección financiera; solo diseño, sin autoridad financiera.

**B — Dispositivo.** *B1:* ver H3, probar antes. *B2:* dejar de presentar `device_id` como control de unicidad en textos y documentación. *B3 (opcional):* prueba de dispositivo real sin identidad (atestación de plataforma en app nativa, token anónimo de humanidad, credencial local de dispositivo como factor de sesión), siempre sin enlazar convocatorias; requiere diseño y proveedor propios.

**C — Pertinencia.** Institucional: sin cambio. Nacional: etiquetar incoherencias IP/zona horaria, no bloquear; la elegibilidad por país depende hoy de un valor declarado por el cliente (H7). Global: desglose por país visible; abierta por diseño.
- *C1 Recuento por convocatoria* (lo elegiría quien crea, visible en el detalle y el PDF): *Abierto* (hoy) o *Territorial* (el titular cuenta las adhesiones con señal territorial y el resto aparece como «apoyo sin verificación territorial»). Nadie queda excluido. Cambia el cálculo del titular y posiblemente el hash.
- *C2 Señal de presencia con QR rotatorio (local):* **no está demostrado que sea más fuerte que el GPS**. Un QR puede fotografiarse y retransmitirse; acredita acceso al código en un momento, no presencia física. Su interés es otro: falla de forma distinta que el GPS (no recoge ubicación) y podría combinarse. Requiere un diseño propio con su modelo de amenazas antes de proponerlo.
- *C3 Modo restringido (excluyente):* se desaconseja; cambia las reglas de participación y penaliza a quien no puede compartir ubicación (riesgo de represalia).

**D — Patrones observados.** Indicadores agregados por convocatoria, no por persona (adhesiones por minuto u hora, concentración de prefijos, concentración por IP-hash, proporción sin GPS en lo local). Una movilización legítima también produce picos: el informe describiría lo observado («se registró un pico entre X e Y») sin etiqueta de sospecha ni efecto sobre el recuento. Definir qué se publica, umbrales y retención exige decisión previa.

**E — Privacidad.** *E1* umbral mínimo de celda en desgloses pequeños (afecta al informe y al hash). *E2* revisar el vínculo `phone_hash`↔`device_id` de 270 d (cambia reglas de privacidad). *E3* rotación de claves o de prefijo del nullifier: **cambiar `v1`→`v2` por sí solo rompe la unicidad**, porque la misma identidad y convocatoria producen otro valor y el índice único solo compara `(protest_id, nullifier)`; una identidad adherida con `v1` podría adherirse de nuevo con `v2` mientras la convocatoria siga abierta. Antes de proponer rotación hace falta una estrategia explícita: consulta o restricción entre versiones (guardar ambos valores durante la transición), o rotar solo entre convocatorias, nunca dentro de una abierta. Sin diseño ni prueba, no se afirma que rotar preserve la unicidad.

## 6. Decisiones del Owner (ninguna adoptada)

| Id | Decisión | Mi inclinación (no vinculante) |
|---|---|---|
| D1 | ¿Segmentar el titular por presencia territorial (C1) o un solo recuento? | Segmentar, modo Abierto por defecto, tras diseño concreto |
| D2 | ¿Modo restringido (C3)? | No |
| D3 | ¿Medir VoIP/prepago (A3)? ¿Con qué coste y privacidad? | Medir antes de decidir nada |
| D4 | ¿Financiar consultas de tipo de línea y protección contra bombeo? | Tuya |
| D5 | ¿Aceptar un hash/informe v3 si C1 o E1 cambian lo que cubre? | Solo con migración documentada |
| D6 | ¿Cambiar el texto «One device per protest scope» en PDF y metodología por lo comprobado (número / email institucional)? | Sí, pero es un cambio de texto canónico: no entra en Fase 1 sin tu aprobación |
| D7 | ¿Derivar o acortar el vínculo teléfono-dispositivo (E2)? | Estudiar primero |
| D8 | ¿Diseñar el QR de presencia (C2)? | Solo como diseño propio con modelo de amenazas |
| D9 | ¿Derivar el país de elegibilidad nacional del prefijo E.164 del número verificado, en lugar del `country_code` del cliente (H7)? | Estudiar compatibilidad primero (portabilidad, roaming, prefijos compartidos); cambia una regla de admisión |

## 7. Plan

- **Fase 1 (única propuesta de implementación inmediata): H2.** Rama local `local/fix-prechecks-otp-nullifier`, commit `cb9ad69`, sin push. Elimina la consulta de participación previa al SMS; prueba sintética sin red (3 pruebas); suite del repo 43/43 sin regresiones. No cambia reglas de participación, ni base de datos, ni envía SMS.
- **Estudios, sin cambiar código:** (a) compatibilidad E.164 (A2); (b) prueba de cabeceras de proxy en entorno desechable (H3).
- **Después de decisiones y diseños concretos:** C1/E1 (D1, D5), medición de línea (D3/D4), QR (D8), vínculos y claves (D7/E3, con estrategia entre versiones), textos (D6), elegibilidad nacional (D9/H7).

Cada fase: Metodología actualizada en el mismo cambio, registro de auditoría, PR en borrador, revisión de Codex. Máximo dos rondas de corrección.

## 8. Límites

- Ninguna combinación impide la manipulación con muchas SIM reales.
- GPS, zona horaria e IP son señales falsificables o aproximadas, nunca prueba.
- Las señales de proveedores externos (línea, atestación) tienen coste y privacidad propios.
- Segmentar cambia lo que el titular comunica y puede reducir el número mostrado en protestas legítimas dispersas.
- H3 es hipótesis. H1 y H2 salen del código; H2 está cubierto por prueba sintética, no por prueba contra producción.
- Esta v0.2 no se ha contrastado todavía con ChatGPT ni Codex.
