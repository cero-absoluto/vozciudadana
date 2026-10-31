# UX-13 — compartir y acciones opcionales

31 de octubre de 2026. PR160: https://github.com/cero-absoluto/vozciudadana/pull/160

Candidato `452150e57675b07344c8bffcdb74bf0b54a797b5`; merge `7a9ebfa666232a26865770279a2a0b5b583215bb`. Ambos árboles Git son `00782b792c0e026bb9ff17165379ea985c623010`.

## Resultado

- Los tres puntos de entrada pasan destino explícito: detalle, recibo SMS y recibo institucional. Los recibos restaurados conservan su título/id aunque el listado esté vacío o cambie la sesión. UUID permanece string.
- El diálogo conserva solo metadatos públicos id/título por apertura. Una apertura existente rechaza reemplazos; una secuencia distingue cierres y reaperturas inmediatas.
- La copia anuncia éxito, cierra y cuenta solo después de resolver writeText. Rechazo o API ausente deja el texto completo seleccionable, con etiqueta traducida y aviso; no cuenta éxito. Las respuestas tardías tras cerrar/reabrir/desmontar no afectan la nueva apertura.
- Durante la copia se bloquean copia y otros canales. Escape, foco y Tab incluyen el fallback manual.
- La explicación de notificaciones opcionales aparece antes de pedir permiso y está vinculada al botón mediante aria-describedby. El recibo y la salida no dependen de activarlas.
- Mensajes compartidos neutrales en cuatro idiomas: compartir desde Detail no afirma una adhesión. WhatsApp/Telegram anuncian apertura del canal; no acreditan entrega. El contador local no demuestra recepción por terceros.

## Equipo y límites de revisión

Claude implementó copia y pruebas en run `41216816128`, pero la acción rechazó su resultado por16 turnos frente al máximo15. El relevo permanece BLOCKED, sin reinicio ni ampliación. Se recuperó worktree `13047922325`, SHA256 `80e08c3b3fcd40f6646c2563875632d598371dfca74740ecede47e16d16abe0e`, aplicando solo modal y sus pruebas. Codex preparó contexto/callers y completó tests; ChatGPT integró el modal, traducciones y ensayo. Los cambios de automation son de coordinación y no amplían el alcance del agente.

La revisión GitHub automática no emitió dictamen por cuota. Se hizo revisión independiente alternativa de Codex sobre fuente, handlers, ciclo de apertura, traducciones y ensayo; ejecutó54 pruebas específicas sin bloqueos nuevos. No revisó backend ni ejecutó proveedores reales. El fallo del relevo y la revisión ausente no se presentan como aprobación.

Hashes SHA256 revisados y cotejados con el candidato:
- Modal: `04e9ff6896c439e8ce795f4e64885758508e6168fdcc3be2569c9480ae712790`.
- UI store: `1177af34dd3907199e8aeddb51dff9a2559cc946b6b43ee216611b9affff3694`.
- Ensayo: `1f05ed0c9cd4f8bfab980586a17861b2876642b9e52d45f40aa06630603636a0`.
- Test copia: `c33ada1a17de25f6e64227f0b7e0dbcf37c97d4ecfc6324bc3fe6341ddfe6ceb`.

## Validación

Batería completa:912 pruebas,910 correctas,dos omitidas,cero fallos.54 dirigidas de modal/contexto/foco. Compilación, CSP de cinco HTML, política de dependencias y diffcheck correctos. Vue-i18n real compila mensajes nuevos/cambiados en los cuatro idiomas.

Chromium privado `41217353735`:SUCCESS y reportePASS,216 comprobaciones,904 peticiones interceptadas,cero inesperadas/errores/mutaciones externas. Fuente exacta452150e5, idiomas es/en/fr/zh y anchos360/390px. El portapapeles, ventanas, OTP y notificaciones fueron sintéticos; no se afirma prueba de entrega, permisos OS ni dispositivos reales.

## Publicación

Build/publicación web `41217493041`:SUCCESS. gh-pages `8a7e41fcd68062fd604d0823182912bfad5ee269`. Pages `41217540308`:SUCCESS. A las17:01CET, index, JavaScript principal y cuatro páginas informativas servidas coinciden byte a byte con gh-pages.

SHA256 index `4d3ac3d6299b29a76c95bead5b405eefc39d22157b6b6ae8dd13b9b58cda8d20`; assets/index-D2kQymPn.js `57a3c5997160f0518983fc39471c4cf2e7a2b4be798bbff66a859a99b4917774`.

Salud/CSP11/11 a16:00:31Z (17:00 CET), usando los mismos validadores y transporte curl para esta red: seis GET API y cinco HTML. Lectura pública acotada, sin datos reales ni rutas de negocio.

## Pendientes conservados

No se modifican API, SQL, cuotas, admisión, dependencias, credenciales ni vigilancias. No se cierra todo UX-13: push compartido, orfandad y revocación siguen pendientes. UX-08/09/10/14 y límites GPS/IDV conservados. Próximo bloque: carga inicial diferenciada de vacío y acciones de tarjetas por teclado con ensayo móvil.
