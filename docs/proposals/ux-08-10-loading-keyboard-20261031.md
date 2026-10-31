# UX-08/10 — carga inicial y tarjetas por teclado

Base `bc4d27aa42a928d11b28663ab71c62b402eaadc9`. Autorización vigente del Owner. Sin API, SQL, dependencias, reglas de admisión, cuotas, credenciales ni cambios de vigilancia.

La lista no puede anunciar vacío antes de recibir una respuesta correcta del listado. store.hasLoaded solo pasa a true tras normalizar una respuesta vigente; consultas directas/caché y respuestas antiguas no lo habilitan. Durante recarga se conservan filas y la protección latestLoad; el error permanece durante reintento manual, sin solicitudes duplicadas ni mensajes técnicos sin filtrar. Home expone carga mediante role=status y traducción existente, incluso antes de elegir filtro; ActiveTab exige hasLoaded, sin loading ni error, para ofrecer vacío/crear.

Las tarjetas son article no interactivo con nombre público. Las dos acciones son botones nativos type=button, con título y acción traducida; no hay controles anidados ni handlers manuales que dupliquen Enter/Espacio. Se conservan handleClick/canJoin y sus toasts de bloqueo, además de acceso al informe. El foco visible tiene contorno y el cursor no promete una acción en todo el article.

Claude implementó la microtarea de marcado en `311130174caf42b660fd9cc57034aaaf0139fede`, mediante run `41218106801`: decide/claude/patch/verify/publish/review success. El último job acredita petición de revisión, no dictamen de Codex. El relevo quedó AWAITING_REVIEW; la revisión GitHub automática sigue sin dictamen por cuota. No se reiniciaron contadores ni cambiaron permisos. Codex completó ciclo de carga y pruebas; ChatGPT integró el estado vacío, foco y ensayo. Otro Codex revisó independientemente el candidato completo.

Validación local:936 pruebas,934 correctas,dos omitidas,cero fallos.28 dirigidas durante implementación;33 pertinentes en revisión independiente, sin bloqueos nuevos. Dos archivos nuevos cubren Home/ActiveTab mediante SFC compilados y Vue/Pinia/i18n reales. Compilación con API revisada y clave sintética, CSP de cincoHTML, política de dependencias y diffcheck correctos.

Ensayo y publicación final: [evidencia](../ux-08-10-publication-20261031.md). No es auditoría integral de accesibilidad ni prueba de teclado/autofill en dispositivos reales. UX-09, GPS/OTP, UX-13 push y ensayo general UX-14 siguen abiertos; UX-08/10 solo se cierran en este alcance concreto.
