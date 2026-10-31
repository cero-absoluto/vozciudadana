# UX-08/10 — carga inicial y tarjetas por teclado

31 de octubre de 2026. PR162: https://github.com/cero-absoluto/vozciudadana/pull/162

Candidato `9856bca611c398e9dc3e4bbfeef399954cd9d435`; integración `c199bff0f87b436b0deb1d4f5ecdde523250e1ec`. Ambos árboles: `ac173cca9ce3b4296afa60163de42af5c7154eff`.

## Resultado

La primera carga muestra texto de carga traducido y role=status, incluso sin filtro seleccionado. No ofrece vacío/crear hasta recibir y procesar correctamente una respuesta vigente del listado. El indicador hasLoaded no se activa por consultas directas, caché o respuestas antiguas. El error y su reintento manual no se confunden con ausencia de convocatorias; las filas existentes se conservan durante actualización y fallo, y el botón mantiene su guarda contra solicitudes simultáneas.

Las tarjetas son article sin click padre ni semántica de control. Un botón nativo abre el detalle con las guardas canJoin existentes; otro abre el informe incluso si la participación está bloqueada. Nombres accesibles combinan título/acción traducidos, con foco visible y orden de Tab. No se añadieron handlers Enter/Espacio que duplicaran la activación nativa. El cursor no promete una acción fuera de los botones.

## Trabajo coordinado y revisión

Claude implementó la microtarea de marcado y publicó `311130174caf42b660fd9cc57034aaaf0139fede`. Run `41218106801`: decide,claude,patch,verify,publish,review SUCCESS. El job review acredita solicitud, no dictamen. El relevo quedó AWAITING_REVIEW; la revisión GitHub automática no pudo emitir dictamen por cuota. No se reiniciaron contadores ni ampliaron permisos.

Codex completó el estado de carga y las pruebas; ChatGPT integró el estado vacío, foco y ensayo. Una revisión independiente de Codex ejecutó33 pruebas pertinentes y no encontró bloqueos nuevos en fuente/handlers/estado. No ejecutó navegador ni proveedores. La coordinación comprobó el candidato por bytes; el reporte Chromium corresponde al SHA exacto. La revisión ausente del bot no se presenta como aprobación.

SHA256 de los archivos revisados:
- Store: `414b4f26dac0ffa6f4026d08b2e800ebc638886383712c8dbf24ae4d1ae890c5`.
- Home: `d1cd4962b63a758ab3da93bf837baad2d6b61d52ad451662af413f448e73641b`.
- ActiveTab: `7222c9e26441b35827474e73bfadbf3c6d7ebb35ab0c9b0692af720f82435a3f`.
- Ensayo final: `f339f7566241bfa81a46ed34df287dea43c7a8fa40bae6ab189e850c9af328e1`. Su último ajuste compara URL.hash para conservar la comprobación del destino también bajo query de prueba.

## Validación

- 936 pruebas totales: 934 correctas, dos omitidas y cero fallos. 28 dirigidas durante implementación y 33 en revisión independiente.
- Dos nuevos archivos con24 pruebas ejecutan store con Vue/Pinia reales y Home/ActiveTab como SFC compilados; estados inicial/error/reintento/éxito, respuestas antiguas, lookup directo, bloqueos, informe y nombres accesibles en cuatro idiomas.
- Build con origen API revisado y clave sintética, CSP de cinco HTML, política de dependencias y diffcheck correctos. Una invocación sin entorno fue rechazada por el gate de origen; no se contó como build válido y se corrigió el entorno antes de validar.
- Chromium privado `41218630402`:SUCCESS y reportePASS,288 comprobaciones,1120 peticiones interceptadas,cero inesperadas/errores/mutaciones externas. Fuente exacta9856bca6, cuatro idiomas y360/390px. Reproduce carga lenta, vacío solo tras éxito,503/reintento único, Enter/Espacio a detalle/informe sin solicitudes OTP/adhesión, orden de foco/contorno y ausencia de overflow.

## Publicación

Build/publicación web `41218785593`:SUCCESS. gh-pages `6dcdb98bd3d21c1031a5b79d7b214cb07760e69f`; Pages `41218834261`: SUCCESS. A las 17:16–17:17 CET, index, JavaScript principal y cuatro páginas informativas servidas coinciden byte a byte con gh-pages.

SHA256 index `d6900b0fd5bf7030fffcc6475c26f86889349b775a9e13a845eb12a0bb6e15eb`; assets/index-D1kjwdB6.js `19a90c2cbeed6acf33e904f1a838432dd23f1851b5c915fb61495be81d66b012`.

Salud/CSP11/11 a16:16:03Z (17:16CET), con los mismos validadores y transporte curl: seis GET API y cincoHTML públicos. Sin datos reales ni rutas de negocio.

## Límites y pendientes

Este es el cierre de carga inicial y acciones de tarjetas, no de todo UX-08/10 ni de una auditoría integral de accesibilidad. El ensayo no certifica teclado/autofill/zoom en dispositivos físicos. Conserva UX-09, recorrido general UX-14, diálogo/consentimiento GPS, push compartido/revocación/orfandad e IDV. No se modificaron API, SQL, cuotas, admisión, dependencias, credenciales ni vigilancias; OTP real continúa aplazado.
