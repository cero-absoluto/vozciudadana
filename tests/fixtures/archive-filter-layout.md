# Comprobación visual de filtros de Archivo

Defecto observado: a 320 × 740, las etiquetas «Todos los tipos» y «Todos los países» se recortan en dos selectores contiguos.

Cambio acordado:
- Hasta 520 px inclusive: tres selectores apilados, anchura completa.
- Por encima de 520 px: fila flexible, con salto de línea cuando no haya espacio suficiente; no comprimir hasta el mínimo anterior de 120 px.
- Mantener orden, accesibilidad, opciones, valores seleccionados y lógica de filtrado.

Revisar 320, 360, 390, 520, 521, 768 y 1280 px, con especial atención a ES/EN/FR/ZH. Comprobar etiquetas iniciales legibles, ausencia de desbordamiento horizontal y que la lista sigue desplazándose. No crear ni modificar convocatorias. Una imagen generada de la propuesta no cuenta como prueba del cambio.
