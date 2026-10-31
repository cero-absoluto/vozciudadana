# UX-10 — tarjetas por teclado (subtarea mínima)
Modifica SOLO apps/web/src/components/home/ActiveTab.vue.
- Sustituir los dos div de acción UNIRSE e informe por button nativos type=button; conservar texto, estilos, click.stop y los handlers actuales.
- El contenedor .p-item debe ser article no interactivo sin @click, con nombre público p.title. No botones dentro de otro control ni tabindex/handlers manuales que dupliquen Enter/Espacio.
- Cada botón debe tener nombre accesible con p.title y texto de acción traducido existente.
- Mantener guardas canJoin, toasts por bloqueo y acceso al informe; no cambiar reglas de participación.
- No cambiar estado de carga ni traducciones ni tests: los completará el coordinador con Codex. No leer todo el repositorio, solo ActiveTab.vue; esta subtarea es deliberadamente pequeña para mantener15turnos.
No otros archivos, no shell/red, no commits/push, no dependencias/API/SQL/permisos.