# Fase 3 — Auditoría del recorrido de participación
Fecha: 31 de octubre de 2026. Estado: auditoría inicial contrastada con Codex y Claude; primer bloque UX-01/02/05 publicado y comprobado. La fase completa y su ensayo móvil general siguen abiertos.
Base pública exacta: `b339cb8f41df030e9c1633d5817abeee151b67c4`.

## Objetivo y límites
Conseguir que una persona encuentre una convocatoria, comprenda qué apoya, complete la verificación y conozca el resultado real de su adhesión, especialmente en móvil.
Esta fase no cierra los pendientes de seguridad ni IDV-05/IDV-10. El OTP real sigue aplazado. No se han consultado filas de usuarios, secretos ni proveedores; tampoco se han cambiado producción ni las dos automatizaciones.
La autorización del Owner permite avanzar con correcciones rutinarias, pruebas, revisión y publicación dentro de las reglas acordadas. Las reglas de participación y las acciones destructivas requieren una decisión explícita. El flujo existente de edición por modelos conserva su alcance frontend/tests y no obtiene permisos nuevos de merge/despliegue.

## Hallazgos y trabajos
“Confirmado” significa evidencia del código de esta base; “reproducido” añade ejecución local de handlers con dobles sintéticos. No equivale a prueba visual o a envío real.

| Ref. | Prioridad | Situación y evidencia | Criterio de aceptación |
|---|---|---|---|
| UX-01 | Alta | Reproducido: AuthScreen.vue, control auth-resend-link, solo muestra auth.resendToast (“Código reenviado”); no realiza envío. El span tampoco es un botón de teclado. | Reenvío explícito accesible, con una sola solicitud, cuotas existentes y confirmación únicamente después de resultado acreditado. Sin reenvío automático ante incertidumbre. |
| UX-02 | Alta | Reproducido: VerifyScreen.vue selecciona la primera convocatoria disponible cuando falta vc_last_joined. | Exigir destino seleccionado y válido; no sustituirlo por otro. Probar entrada directa, sesión vacía y convocatoria ausente/cerrada. |
| UX-03 | Alta | Reproducido: tras aceptar joinProtest, VerifyScreen espera loadProtests antes de activar success. services/api.js no acota fetch ni lectura del cuerpo. La actualización secundaria puede retener la confirmación. | Confirmación acreditada independiente de recargas de contadores; operaciones acotadas y estados de resultado incierto. Un timeout del cliente no demuestra que una escritura no ocurrió: nunca repetir adhesión/OTP automáticamente. |
| UX-04 | Media | Reproducido: VerifyInstitucionalScreen.verifyOtp muestra errOtpWrong para 503. También usa ese mensaje al faltar recibo o ante cualquier excepción. | Separar rechazo de código, cuota, indisponibilidad y respuesta incoherente con mensajes fijos traducidos. Conservar contexto y no atribuir al usuario un fallo técnico. |
| UX-05 | Media | Reproducido: dos invocaciones simultáneas de verifyOtp institucional producen dos solicitudes. Los inputs permiten Enter y los handlers sendOtp/verifyOtp no comprueban loading. | Guardas en ambos handlers y pruebas de doble Enter/clic. Una operación pendiente impide otra; desactivar solo el botón es insuficiente. |
| UX-06 | Alta | Reproducido: VerifyScreen muestra éxito incluso con respuesta vacía; services/api.js convierte JSON inválido de un 2xx en {}. Además descarta receipt y no identifica el evento en éxito. La ruta API actual entrega receipt en 201 (protests.js). | Validar respuesta y recibo real antes de confirmar; JSON inválido/respuesta incoherente es resultado no acreditado, sin reenvío automático. Mostrar título y recibo, distinguir verificación de teléfono de adhesión y no inventar recibos. |
| UX-07 | Media | Confirmado: auth.phoneHint en es/en/fr/zh promete un código “indescifrable”. Es una afirmación absoluta impropia para explicar la protección del teléfono. | Texto breve y fiel al tratamiento implementado, sin prometer anonimato absoluto ni irreversibilidad incondicional. Alinear los cuatro idiomas con la metodología vigente y corregir wrongCountry: el handler usa country_name, mientras el store expone countryName. No dar por reauditada toda la documentación pública. |
| UX-08 | Validación | Descubrimiento: Home oculta panel de convocatorias hasta elegir país o ámbito y usa una bienvenida sobre el mapa. Es comportamiento confirmado; su impacto no está medido. | Ensayo de primera visita y enlace compartido: localizar una convocatoria y entender cómo abrirla sin instrucciones externas. Separar vacío, carga y error. No rediseñar por hipótesis. |
| UX-09 | Validación | Comprensión y CTA: Detail combina ámbito, tiempos, requisitos, financiación y adhesión. Falta ensayo de jerarquía y de la explicación del bloqueo sin saldo. | A 360/390 px y escritorio: identificar objeto, destinatario, fechas, requisitos y acción principal; motivo de indisponibilidad visible. Financiación y acciones posteriores no deben confundirse con registro de adhesión. |
| UX-10 | Media / validación | Confirmado: el modal GPS no declara dialog/aria-modal ni gestiona foco/Escape. OTP y formulario móvil necesitan además ensayo de teclado, pegado, foco y errores persistentes. | Teclado y zoom no ocultan acción/error; navegación por teclado, foco coherente, pegado de código, botón Atrás y GPS rechazado sin pérdida del destino. Ensayos sintéticos no acreditan autofill SMS real en iOS/Android. |
| UX-11 | Media | Confirmado: la pantalla institucional no obtiene el evento por ID cuando falta del store; usa el texto traducido “tu institución” como dominio y compara el correo con él. En carga lenta/fallida o evento ausente no hay recuperación propia. El correo se envía sin trim y el placeholder Ej: está fijo en español. | Obtener el evento explícito antes de pedir datos, distinguir ausente/error, conservar destino y explicar expiración/cierre; no bloquear usando un dominio de sustitución. |

| UX-14 | Validación | Cierre del recorrido y accesibilidad en es/en/fr/zh, éxito, duplicado, cuota, offline y respuesta incierta; acciones de compartir/notificar son opcionales. | Matriz reproducible en Chromium con todas las llamadas interceptadas y cero mutaciones externas; comprobar overflow, estados visibles y CTA. Declarar límites de navegadores y dispositivos, sin llamar a esta prueba auditoría integral de accesibilidad. |

## Evidencia obtenida
- Revisión principal y contraste de un segundo agente Codex en solo lectura.
- Diez archivos de la instantánea para Claude se verificaron contra los blobs de la base pública; no se ha enviado una copia local divergente.
- Seis reproducciones locales sobre expresiones/handlers reales: reenvío sin llamada, selección automática sin destino, 503 institucional presentado como código erróneo, dos comprobaciones simultáneas, adhesión aceptada bloqueada por recarga secundaria y éxito ante respuesta vacía. Comprobación adicional del request real: JSON inválido 2xx se convierte en {} y no se aporta señal de cancelación. Cero solicitudes de red. Son diagnósticos de defectos existentes, no pruebas de una corrección.
- Se ejecutaron 34 pruebas existentes relacionadas con OTP, rechazos, políticas GPS, detalle y filtros: 34 pasan, cero omitidas. No cubren por sí solas los defectos nuevos.
- La batería de 746 pruebas y el ensayo Chromium de 29 comprobaciones corresponden a la publicación IDV anterior. No se reutilizan como validación de esta fase.
- Claude: revisión privada [issue 38](https://github.com/cero-absoluto/voiceprotest-private-review/issues/38), ejecución [41174566643](https://github.com/cero-absoluto/voiceprotest-private-review/actions/runs/41174566643), terminada correctamente; dictamen FINDINGS. Leyó nueve archivos completos y solo algunas claves del español; no revisó CSS, otros idiomas, backend, componentes externos ni runtime. La asociación exacta al código fue verificada por la coordinación y el guard, no ejecutada por el revisor.
- Ajustes al dictamen: loadProtests captura errores, por lo que una recarga rechazada no impide por sí sola el éxito; una recarga sin resolver sí lo bloquea (reproducido). El recibo devuelto por la API se comprobó después en código. No se adoptan como hechos sus hipótesis de desbordamiento visual, cobertura de URLs externas ni éxito/409 garantizado al repetir.

## Orden de ejecución
1. Integridad del recorrido: UX-01/02/04/05. Corregir falsas confirmaciones, destino y concurrencia.
2. Resultado y recuperación: UX-03/06/12; distinguir confirmado, rechazado e incierto y desacoplar recargas.
3. Comprensión y continuidad: UX-07/08/09/11/13, guiados por ensayos y sin alterar reglas de adhesión.
4. Ensayo móvil y regresión UX-10/14, revisión del candidato exacto, publicación y evidencia de API/web según archivos afectados.

La fase 3 permanece abierta hasta completar correcciones y validación. Este documento es el inventario inicial, no una certificación del servicio ni de disponibilidad de los agentes.

## Publicación del primer bloque

[UX-01/02/05 — evidencia](ux-01-02-05-publication-20261031.md), PR155, publicada el 31/10/2026 y comprobada a las 07:18 CET.

| Ref. | Estado actual |
|---|---|
| UX-01 | Publicado: reenvío explícito real, resultado sent:true, contexto estable y cambiar número. No acredita entrega real. |
| UX-02 | Publicado: no se sustituye el destino ausente y se comprueba tras cargas/reCAPTCHA. Las guardas no son cancelación atómica con el servidor; abandono/GPS y respuestas tardías conservan residuales. |
| UX-05 | Publicado: handlers institucionales protegidos contra solapamiento por Enter/clic. Navegación de paso durante una operación sigue en UX-11. |
| UX-03/04/06–14 | Pendientes. El ensayo sintético de este bloque no cierra el recorrido móvil completo. |

La revisión añadió residuales sobre GPS local al abandonar, feedback si cambia el destino con OTP pendiente y contexto device_id de cuotas. Se conservan expresos en la evidencia; no se presentan como corregidos ni se reabre aquí una auditoría integral de seguridad.

## Recuperación y segundo bloque — 31/10/2026

UX-03/04/06/12 se publicaron en PR156, merge `1a3a315f0be50f3d1327d0971f3c7ececd692254`. La interrupción del chat dejó este inventario sin actualizar. Véase [evidencia](ux-03-04-06-12-publication-20261031.md). El árbol integrado coincide con el candidato `6e4baf50e230ca61a375735cc600c462955f5368`.

UX-07/11 pasan a implementación mediante PR157. `countryName`, trim de correo y bloqueo de botones durante loading ya estaban corregidos: no se presentan como cambios nuevos. UX-08/09/10/13/14 y el ensayo móvil general permanecen abiertos.
