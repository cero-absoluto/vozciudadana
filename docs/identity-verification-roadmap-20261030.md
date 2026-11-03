# Hoja de ruta — identidad y verificación

Actualización: 31/10/2026. La seguridad y la identidad conservan sus pendientes expresos;
el trabajo actual es el punto 3, experiencia de participación. La autorización del Owner cubre completar los pasos rutinarios
sin pedir una aprobación por cambio: implementar, probar, revisar, publicar y comprobar.
Una decisión que cambie las reglas acordadas o una operación destructiva requiere
tratar su alcance antes de ejecutarla. OTP real sigue aplazado.

| Punto | Área | Estado |
|---|---|---|
| 1 | Seguridad contra ataques | Bloques publicados; pendientes expresos conservados. No auditoría integral cerrada. |
| 2 | Identidad y verificación | Bloques IDV-01–12 publicados en su alcance descrito; permanecen residuales de IDV-05/10 y OTP real aplazado. No se declara auditoría integral cerrada. |
| 3 | Experiencia de participación | En curso: UX-01/02/05 publicados y comprobados (PR155); UX-03/04/06/12 publicados y comprobados (PR156); UX-07/11 publicados y comprobados (PR157); UX-13 compartir/copia/aviso opcional publicados y comprobados (PR160), con residuales push conservados; UX-08/10 carga inicial y tarjetas por teclado publicados y comprobados (PR162); UX-09 ficha móvil publicada y comprobada (PR164), con metadatos de censo pendientes; resto de UX-08/10/14 y ensayo móvil general pendientes. Véase [UX-01–14](participation-ux-audit-20261031.md). |
| 4 | Documentación pública | Pendiente de alineación con el comportamiento final. |

| Ref. | Trabajo | Estado |
|---|---|---|
| IDV-01 | Correo obligatorio en ámbito institucional, también sin censo | Publicado y verificado. |
| IDV-02 | Excluir GPS en riesgo alto/crítico e institucional | Publicado y verificado; límites históricos documentados. |
| IDV-03 | Validar respuesta del geocodificador antes de confirmar GPS | Publicado y verificado, PR150. |
| IDV-04 | Separar procedencia GPS/IP y corregir puntuación institucional | Publicado y verificado, PR151; API y SQL, sin recalcular históricos. |
| IDV-05 | Coincidencia territorial contextual, OSM ambiguo y homónimos | Corrección de homónimos entre países y OSM sin tipo publicada; homónimos del mismo país y límites administrativos pendientes. |
| IDV-06 | Cohortes territoriales exhaustivas y denominadores comunes | Publicado y verificado, PR152; cohortes completas y denominadores explícitos, límites de IDV-05 conservados. |
| IDV-07 | Unicidad por identificador y país de numeración en cuatro idiomas | Publicado y verificado, PR153. Sin cambiar admisión ni hashes. |
| IDV-08 | Dominio declarado y alcance institucional | Publicado: distingue control de correo de vínculo oficial, respaldo, rol o pertenencia vigente; sin validación externa nueva. |
| IDV-09 | Censo, fundador, primera ola y avales | Publicado: reglas y límites explícitos; se conservan fundador/primera ola y dos cuentas acreditadas posteriores. |
| IDV-10 | Antigüedad, autenticación y elegibilidad | Parcial: contrato y límites publicados. Pendientes renovación automática, revocación externa y acreditación operativa de retención; no se certifica pertenencia actual. |
| IDV-11 | Métodos realmente registrados y calidad del informe | Publicado: mezclas/desconocidos explícitos, alcance v2 común API/web/PDF, índices completos sin probabilidades inventadas. |
| IDV-12 | Metodología y recorrido actual | Publicado: metodología v1.5, v1.4 archivada, alcance coherente y residuales expresos. DOCX históricos no reauditados en este bloque. |

Publicar una corrección concreta no certifica todo el sistema ni modifica los
registros históricos. Las revisiones independientes son acotadas al código que
reciben; sus límites y pruebas están en las propuestas y evidencias de publicación.
El handoff de GitHub conserva su límite de implementación frontend/tests; esta
coordinación de API y SQL no amplía sus permisos ni las tareas de vigilancia.


## Actualización añadida — 03/11/2026

Esta actualización complementa el inventario histórico anterior; no declara cerrada ninguna auditoría integral.

| Punto | Estado actualizado y pendientes |
|---|---|
| 1 — Seguridad | Se conservan los pendientes expresos; los bloques posteriores no certifican todo el servicio. |
| 2 — Identidad y verificación | IDV-05/10 y OTP real siguen pendientes en el alcance descrito arriba. La revocación de avisos no equivale a revocación externa de una credencial institucional. |
| 3 — Participación | PR166 distingue estados del censo; PR167/169 corrigen consentimiento GPS y resultados tardíos; PR168 corrige reflujo medido; PR170 conserva la suscripción compartida; PR171/172 publican revocación de avisos por convocatoria y recuperación explícita. Permanecen proveedores reales, dispositivos físicos/zoom nativo y purga automática de huérfanas (OFF). |
| 4 — Documentación pública | En curso: se corrige la promesa de borrado de suscripción/zona horaria al cierre y se declara el envío de idioma al activar avisos, en cuatro idiomas. No se declara alineada toda la documentación: las demás promesas de retención y los documentos históricos requieren su propia comprobación. |

Evidencia publicada del bloque de avisos: [PR171, comprobación final](https://github.com/cero-absoluto/vozciudadana/pull/171#issuecomment-6613880629) y [PR172, servidor y migración](https://github.com/cero-absoluto/vozciudadana/pull/172#issuecomment-6613830226). Árbol publicado `500d83aa0d0c11a07ce3b1e406ef074e6e521a95`: 1.268 pruebas correctas, dos omitidas; Chromium800/800 y salud/CSP11/11. Son resultados de esa publicación, no de la corrección documental en curso.
