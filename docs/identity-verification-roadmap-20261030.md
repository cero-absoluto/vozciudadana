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
| 3 | Experiencia de participación | En curso: UX-01/02/05 publicados y comprobados (PR155); UX-03/04/06/12 publicados y comprobados (PR156); UX-07/11 publicados y comprobados (PR157); UX-13 compartir/copia/aviso opcional publicados y comprobados (PR160), con residuales push conservados; UX-08/09/10/14 y ensayo móvil completo pendientes. Véase [UX-01–14](participation-ux-audit-20261031.md). |
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
