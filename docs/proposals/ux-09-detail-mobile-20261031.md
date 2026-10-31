# UX-09 — ficha y acción principal en móvil

Base `b58700489124a51a8541eeb843286a376e138aa2`. Autorización vigente del Owner. No API/SQL, reglas de admisión, cobros, cuotas, dependencias, credenciales ni vigilancia.

## Diagnóstico medido

Run privado `41219497229`, fuente `05e263790760029708f485416575a4cb905ac7ff`: 288 comprobaciones previas correctas y64 mediciones de layout, cuatro idiomas,360/390px,alturas640/844,riesgo low/high ysaldo0/10. 38 CTA fuera del área visible de la ficha;55 áreas de contenido menores de100px; mínimo22px,footer hasta441px. Sin overflow horizontal. Datos sintéticos; no se infiere frecuencia de uso real. Geometría conservada en [baseline](../ux-09-detail-baseline-20261031.json).

## Corrección

Título y financiación pasan al contenido desplazable; botón de censo y contador secundarios también conservan su exclusión en cerradas. El footer mantiene CTA/compartir, aviso de riesgo no plegado y explicación de saldo agotado, asociados al botón por aria-describedby. La financiación se presenta como opcional y no equivale a registrar adhesión. Se retiran capacidad calculada con0.05 y promesa20/€, junto a barra sin objetivo verificado; no se modifica ningún coste/cobro real.

onJoin revalida destino, adhesión previa, saldo, cierre absoluto y política actual antes de navegar/escribir contexto. Las etiquetas de censo coinciden con las rutas existentes. Se conserva como residual anterior que censoExiste=false puede significar pendiente/error de carga, no inexistencia acreditada.

Claude implementó template-only `8e04d1c3a51be38c0158275c89e778750d479ced` mediante `41219753070`, todos los jobs correctos; el job review solo pide revisión. Codex completó handlers/tests y ChatGPT integró estilos, traducciones, ensayo y corrección de visibilidad en cerradas. No se ampliaron permisos ni turnos del relevo. El bot GitHub sigue sin dictamen por cuota; revisión independiente alternativa de Codex:62 pruebas pertinentes sin bloqueos nuevos.

Validación local final:989 pruebas,987 correctas,dos omitidas,cero fallos;86 dirigidas,build/CSP5HTML/política de dependencias/diffcheck correctos. Dos archivos nuevos suman53 pruebas:28 handlers y25 SFC con Vue/i18n reales.

Ensayo final previsto:392 comprobaciones,104 layouts;64 comparables al baseline y40 adicionales de email/censo existente/ausente,cerrada/unido. Los adicionales prueban también cifras largas de donaciones. Solo servicios interceptados; sin OTP,donaciones,GPS,push ni otras mutaciones reales. Publicación pendiente hasta cierre del candidato exacto. No se declara terminada la fase UX completa.
