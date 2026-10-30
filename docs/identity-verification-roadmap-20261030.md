# Hoja de ruta — identidad y verificación

Actualización: 30/10/2026. La seguridad sigue con sus pendientes expresos; el trabajo
actual es el punto 2. La autorización del Owner cubre completar los pasos rutinarios
sin pedir una aprobación por cambio: implementar, probar, revisar, publicar y comprobar.
Una decisión que cambie las reglas acordadas o una operación destructiva requiere
tratar su alcance antes de ejecutarla. OTP real sigue aplazado.

| Punto | Área | Estado |
|---|---|---|
| 1 | Seguridad contra ataques | Bloques publicados; pendientes expresos conservados. No auditoría integral cerrada. |
| 2 | Identidad y verificación | En curso. IDV-01–04 publicados y verificados; bloque IDV-05/06 publicado, con límites explícitos. |
| 3 | Experiencia de participación | Pendiente como revisión completa, especialmente móvil. |
| 4 | Documentación pública | Pendiente de alineación con el comportamiento final. |

| Ref. | Trabajo | Estado |
|---|---|---|
| IDV-01 | Correo obligatorio en ámbito institucional, también sin censo | Publicado y verificado. |
| IDV-02 | Excluir GPS en riesgo alto/crítico e institucional | Publicado y verificado; límites históricos documentados. |
| IDV-03 | Validar respuesta del geocodificador antes de confirmar GPS | Publicado y verificado, PR150. |
| IDV-04 | Separar procedencia GPS/IP y corregir puntuación institucional | Publicado y verificado, PR151; API y SQL, sin recalcular históricos. |
| IDV-05 | Coincidencia territorial contextual, OSM ambiguo y homónimos | Corrección de homónimos entre países y OSM sin tipo publicada; homónimos del mismo país y límites administrativos pendientes. |
| IDV-06 | Cohortes territoriales exhaustivas y denominadores comunes | Preparación local iniciada; no integrado ni publicado. |
| IDV-07 | Unicidad por identificador y país de numeración en cuatro idiomas | Pendiente. |
| IDV-08 | Alcance del dominio declarado y vínculo institucional | Pendiente. |
| IDV-09 | Reglas públicas de fundador, primera ola y avales del censo | Pendiente; conservar excepción de fundador aprobada. |
| IDV-10 | Antigüedad, renovación y vigencia de credenciales/pertenencia | Pendiente; no confundir retención con elegibilidad. |
| IDV-11 | Informe según métodos/procedencia realmente registrados | Pendiente; incluir históricos y mezcla de métodos. |
| IDV-12 | Metodología coherente con cliente, API, informe, PDF y widget | Pendiente de actualización conjunta. |

Publicar una corrección concreta no certifica todo el sistema ni modifica los
registros históricos. Las revisiones independientes son acotadas al código que
reciben; sus límites y pruebas están en las propuestas y evidencias de publicación.
El handoff de GitHub conserva su límite de implementación frontend/tests; esta
coordinación de API y SQL no amplía sus permisos ni las tareas de vigilancia.
