# Marcadores globales del mapa de inicio

Diámetro sólido global entre 20 y 24 píxeles CSS, según heat entre 0 y 100; halo existente proporcional (factor radio 2.5, diámetro 50–60 px). El marcador de actividad inicial será aproximadamente 20 px. Conservar centro, color y pulso. Los marcadores national/regional/local y el punto blanco central conservan su tamaño.

Cambio exclusivamente visual en apps/web/src/components/map/WorldMap.vue, sin API, datos, coordenadas ni interacción. No cambiar DetailMap. Suite y build existentes; no se requieren pruebas automatizadas nuevas para este ajuste visual. Revisar visualmente después de publicar a 320/390 y escritorio, filtros All/Global, zoom y varias actividades. La revisión de código no reemplaza esa comprobación visual.
