# Estado de consulta del censo

Base `666d83981e3490e252add728a1cb416c077fc8ee`, PR166. Autorización vigente del Owner. Solo frontend, pruebas y evidencia; sin cambios API/SQL/admisión/cuotas/dependencias/credenciales/vigilancia.

## Contrato

Distinguir loading, present, absent y error. Solo404 de la consulta confirma ausencia;200 requiere group_id UUID válido. Fallos de red, timeout,401/429/503 y respuestas200 incoherentes no habilitan creación. onJoin comprueba el estado y contexto actuales antes de escribir o navegar.

La lectura pública puede cargar aun con saldo0, unido o cerrado. En error, el únicoCTA de la ficha abierta ofrece reintentar la consultaGET, sin OTP, adhesión ni fundación. Los demás estados conservan restricciones de saldo/cierre/política y bloquean navegación mientras la consulta no se resuelva. La ficha cerrada mantiene su acción de informe.

Cada consulta se vincula a id/dominio/ámbito/requisito y epoch. Cambiar contexto o desmontar invalida respuestas anteriores, inclusoABA; no hay autorreintento. Un refresh con metadatos iguales conserva resultados y solicitudes pendientes. Reintento explícito singleflight. El informe secundario no determina existencia del censo. El párrafo de estado está en el scroll, descrito por el botón y traducido en cuatro idiomas, sin agrandar el footer.

## Coordinación y validación local

Claude completó la plantilla en run `41221907518`, pero verify falló16 pruebas al ejecutarla sin los bindings del script que coordinaba Codex. No se publicó ese parche por el relevo ni se cuenta como aprobación. Recuperado artifactpatch `13050287447`, SHA256 `1d87ac0a60d2be5c32e77a4f760165a0f02c296e77709b5124b39914c2eaa6da`, integrado con script/tests del coordinador sin reiniciar ni ampliar permisos/turnos.

Candidato integrado local:1040 pruebas,1038 correctas,dos omitidas,cero fallos;109 pertinentes en revisión independiente sin bloqueos nuevos. Build/CSP5HTML/política de dependencias/diffcheck correctos.51 pruebas nuevas:39 de estado/carreras con Vue real y12 SFC; fixtures previas migradas a respuestaUUID real y ausencia explícita, sin omitir tests. La revisión automática GitHub sigue sin dictamen por cuota.

Ensayo previsto del SHA exacto:488 comprobaciones,136 layouts, casos de carga/404/503/red/respuesta incoherente/reintento único/respuesta tardía/lectura con saldo0 y unido; conserva392 comprobaciones anteriores y añade64 de flujo y32 layouts de censo en carga/error, riesgo alto y saldo0/10. Sin proveedores ni mutaciones reales. Publicación pendiente de cerrar ese ensayo y comprobar bytes servidos; no se declara terminada la fase UX integral.
