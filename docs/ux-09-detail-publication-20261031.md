# UX-09 — ficha móvil: publicación verificada

31 de octubre de 2026. [PR164](https://github.com/cero-absoluto/vozciudadana/pull/164).

Candidato `8e4b45a107e4d03e1c795139b605b9fb81edbe81`; integración `4300317122208eecc1ea5761de8fec761cb4d059`. Ambos árboles Git: `a99b073351e5ee763d34b6247eff86b0df10c85a`.

## Resultado medido

El diagnóstico se ejecutó antes de cambiar la aplicación: fuente `05e263790760029708f485416575a4cb905ac7ff`, run `41219497229`, SUCCESS. En 64 escenarios sintéticos —cuatro idiomas, 360/390px, alturas640/844, riesgo bajo/alto y saldo0/10— el CTA quedaba fuera del área visible de la ficha en38; el contenido tenía menos de100px en55. Mínimo22px y footer máximo441,19px. No hubo overflow horizontal.

El candidato pasó104 escenarios: los mismos64 globales y40 adicionales de correo/censo existente/censo ausente/cerrada/ya unido, con cifras largas de donaciones en los adicionales. Ningún CTA fuera del área visible, ningún contenido menor de100px y ningún overflow horizontal. Mínimo133px de contenido y footer máximo238,39px; los64 casos comparables tienen los mismos extremos. Son geometrías de fixtures, no frecuencia observada en usuarios reales.

Datos conservados: [baseline](ux-09-detail-baseline-20261031.json) y [resultado final](ux-09-detail-final-20261031.json).

## Comportamiento

Título y financiación se desplazan con el contenido. El botón secundario de censo y el contador viral también salen del footer, conservando su exclusión en cerradas. CTA y compartir permanecen en el pie; riesgo visible, no plegado, y saldo agotado se explican junto al botón y se asocian por aria-describedby. Financiación opcional separada de adhesión; se retiran la capacidad calculada con coste fijo y la promesa20/€, además de una barra sin objetivo acreditado. No cambia ningún coste ni cobro.

onJoin revalida existencia, participación previa, saldo, cierre absoluto y política actual antes de escribir contexto o navegar. No depende del computed ni de un tick tras suspensión. Las etiquetas iniciar/unirse al censo coinciden con sus rutas existentes. Cerrada conserva acceso al informe y no muestra financiación ni secundarios anteriormente ocultos.

## Equipo y revisión

Claude implementó la plantilla `8e04d1c3a51be38c0158275c89e778750d479ced`, run `41219753070`: todos los jobs SUCCESS. El job review acredita petición, no dictamen. Codex completó handlers y pruebas; ChatGPT integró estilos, traducciones y ensayo. La revisión encontró y se corrigió una regresión: al mover censo/contador debían conservar !isClosed. No se ampliaron turnos ni permisos del agente.

La revisión automática GitHub sigue sin dictamen por cuota. Una revisión independiente alternativa de Codex ejecutó62 pruebas pertinentes y cerró sin bloqueos nuevos. No ejecutó navegador ni proveedores. Fuente y pruebas revisadas se cotejaron por bytes con el candidato.

SHA256:
- Detail: `150158682c5354d47188237fa36ea2b46abbc057f2935b7212a84428344f323c`.
- Ensayo: `698fa841f52e24bc105b52b5f36d322416c91469743633dbe5ac4f2739993bc6`.
- Tests handlers: `47c37e0e04e5d240bd28eef6a2cd3d91a9b898bdd51572206d11d6cbaeba0e3b`.
- Tests layout: `cec716b9d4556af29b7d5c10cc627a110e122d4c673f8cc3bd3ed4bfd1721b49`.

## Validación

- 989 pruebas totales:987 correctas,dos omitidas,cero fallos.86 dirigidas durante implementación y62 en revisión independiente.53 nuevas:28 handlers y25 SFC con Vue/i18n reales.
- Build con API revisada y clave sintética, CSP de cincoHTML, política de dependencias y diffcheck correctos.
- Chromium final `41220557563`:SUCCESS,392 comprobaciones,2176 peticiones interceptadas,cero inesperadas/errores/mutaciones externas. Fuente exacta8e4b45a1. Comprueba geometría, scroll hasta final, CTA, riesgo/saldo, financiación, cerrado/unido y etiquetas de censo. No se ejecutaron OTP, pagos, GPS o push reales.

## Publicación

Web `41220768802`:SUCCESS. gh-pages `f3e4e897d8ffa8179e1c5ff8972c964f055022e3`; Pages `41220817837`:SUCCESS. A las 17:41–17:42 CET, index, JavaScript principal y cuatro páginas informativas servidas coincidían byte a byte con el artefacto.

SHA256 index `0a7ce5d7b37023bd7e46f54eb479290fb0108c7de58b4986c603d1e6f5076fef`; assets/index-CLx9XDdn.js `406a1ff4290216f69bb9bd931d46d9bb6a4ed0fafa323d506576ca4565812eba`.

Salud/CSP11/11 a16:40:46Z (17:40CET), mismos validadores con transporte curl: seis GET API y cincoHTML públicos. Comprobación puntual sin datos reales ni rutas de negocio.

## Pendientes

censoExiste=false sigue mezclando carga pendiente/error con inexistencia; las etiquetas corregidas no acreditan que no exista un censo. Separar esos estados con recuperación explícita es trabajo pendiente, sin cambiar reglas de censo. Permanecen recorrido general UX-14, zoom/dispositivos físicos, GPS/consentimiento, push compartido y residuales IDV. No se declara cerrada la fase completa ni auditoría integral. No se modificaron API, SQL, admisión, cuotas, dependencias, credenciales ni vigilancias; OTP real continúa aplazado.
