# Identificadores de filtros de Archivo

Añadir exclusivamente id="archive-filter-type", id="archive-filter-country" e id="archive-filter-sort" a los tres selectores de ArchivoScreen.vue, respectivamente. Conservar aria-label traducido, v-model, opciones, orden, estilos y comportamiento.

Validación: suite existente y compilación; inspección del diff para comprobar tres atributos únicos. Comprobación posterior en Chrome: los tres selectores dejan de aparecer en el aviso de campos sin id o name. No requiere nuevas pruebas automatizadas para estos atributos estáticos.
