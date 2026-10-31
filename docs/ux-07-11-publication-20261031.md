# UX-07/11 — publicación verificada

31/10/2026. PR157: https://github.com/cero-absoluto/vozciudadana/pull/157
Candidato `7d10659609dea32c86abf8e950d72c937c9c4ede`; integración `30ac3a6f7b74e74b32c3ba8ba8227fd17b5ec222`. Ambos árboles: `81e891a4ff22cd3d0f5dfefab3a6cfd8866d230a`.

## Comportamiento

Entrada institucional directa resuelta por ID, con carga, error y reintento manual, ausente, dominio no institucional y cierre diferenciados. Nunca se usa una traducción como dominio. Se muestran título/dominio reales y placeholder traducido. El texto del teléfono explica pseudonimidad sin prometer anonimato absoluto.

Un recibo o resultado pending/uncertain guardado tiene prioridad sobre carga, cierre o cambio posterior de dominio, y no dispara solicitudes nuevas. El intento fija correo, OTP, título y contexto del diario antes de las esperas. Cierre/cambio de dominio/desmontaje previos al dispatch impiden envíos; una respuesta válida ya recibida conserva confirmación aunque llegue después del cierre. Las guardas temporales son imperativas: un computed de Vue con Date.now no bastaba.

## Coordinación y revisiones

El relevo Claude run `41215262684` se detuvo por max-turns15 y quedó BLOCKED, sin publicar parche ni ejecutar verify. Se recuperó worktree artifact `13047574628`, SHA256 `db5b2095bcad0850ba5fffe09ea47904d2dda88cf02afeaa79f4f8d6d301b660`, y solo se aplicaron rutas de frontend/tests permitidas. Codex completó guardas y pruebas; ChatGPT corrigió interpolación de @ en vue-i18n y amplió el ensayo. No se reinició el relevo, no se ampliaron turnos ni permisos.

La revisión automática de GitHub siguió sin dictamen por cuota; no se presenta como aprobada. Una revisión independiente de agente Codex detectó y verificó la corrección del computed temporal y del recuento Chromium; ejecutó91 pruebas pertinentes y cerró sin bloqueos nuevos. Revisión acotada a pantalla, traducciones, tests y ensayo, sin backend/proveedores/dispositivos.

Hashes SHA256 revisados y cotejados con bytes del commit publicado:
- Pantalla: `2d9588ffa5576e5c1476f50c9692026376034444afdb653f8bb9fca3288b7dd3`.
- Test nuevo: `d6d999ad6b86f68ddeb6ef05a06da579f38473bb3e7ac73481252fb31c6bf0d6`.
- Harness: `12c71a2eec66b6cbfe4d2a4ecab63fd8bbef0721d71f742d9fbecd3746c87b59`.
- Ensayo: `c44dbca0a1d67e7d07e90519589c050a548e0625bda00cb74adb2aecd1a80077`.

## Validación

- Batería completa:868 total,866 correctas,dos omitidas,cero fallos.114 dirigidas durante implementación.
- Compilación, CSP5HTML, política de dependencias y diffcheck correctos.31 pruebas nuevas iniciales, cuatro usan createI18n real; otras tres reproducen la caché temporal con ref/computed/reactive reales.
- Chromium privado `41216052342`:SUCCESS y reportePASS,160 comprobaciones,cuatro idiomas,360/390px,904 peticiones interceptadas,cero inesperadas/errores/mutaciones externas. Fuente exacta7d106596; límites teclado/autofill/dispositivo real conservados.
- El Chromium local no pudo ejecutarse por restricciones de socket y no cuenta como validación. Se usó el runner privado existente sin cambiar su workflow. El script ampliado devuelve exit nozero si el informe no esPASS.

## Publicación

- Build/publicación web `41216206009`:SUCCESS.
- gh-pages `c4b0a1cbe3f6c6334809139e3ab1104e36544329`, mensaje deploy del merge exacto.
- Pages `41216249062`:SUCCESS.
- A las16:44–16:45CET se comprobaron bytes de index, JavaScript y cuatro páginas informativas servidas: todos idénticos al artefacto. Antes de terminar Pages el JS nuevo devolvía404; no se declaró publicado hasta repetir trasSUCCESS.
- SHA256 index `ae90891ddbb26211e961a65747483cfce7833c839cd6ce04954d15c822b452fe`; assets/index-DXubbd0E.js `e462c27d5b8cfa7a74e4a5fa9b3640d378ef947e8e1d8a3709a296b29e40d16c`.
- Salud/CSP11/11 a15:44:00Z. Se reutilizaron las mismas validaciones del helper con transporte curl para esta red; seis GET API y cincoHTML. Sin datos reales ni rutas de negocio.

## Pendientes preservados

No se modifican API,SQL,admisión,cuotas,credenciales ni vigilancias. OTP real sigue aplazado. Sin recuperación remota ni idempotencia entre dispositivos. UX-08/09/10/13/14 y límites GPS/push/IDV continúan abiertos. Los hallazgos de compartir/copia/notificaciones y carga inicial están registrados en el inventario para el siguiente bloque. No se declara cerrada la fase completa ni auditoría integral.
