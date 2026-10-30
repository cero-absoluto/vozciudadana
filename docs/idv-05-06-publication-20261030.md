# IDV-05/06 — publicación verificada

30/10/2026,23:00 CET. PR152 publicada con autorización vigente del Owner.
Candidato revisado por Codex:1338883abbeb3e5d9ab2ccc232a4894bf8be8d77, revisión final completed sin hallazgos ni pendientes. Fusión:acf8db84ba63d96bb12f40bc97b3768cb589f108.

724 pruebas generales correctas,2 omitidas;22 adicionales de rutas correctas. Compilación/CSP5HTML y política de dependencias correctas. Revisión privada Claude issue36 detectó problemas de denominadores/cobertura/referencia inglesa; se corrigieron y Codex revisó el candidato final. Las hipótesis sobre alias y contrato SQL se mantienen como límites, no como certificación integral. No se ejecutó una nueva prueba SQL.

Chromium151 run41134791276:25 comprobaciones correctas, cuatro idiomas,95 solicitudes interceptadas, cero inesperadas/mutaciones. Incluye contador20 frente a5 registros, calidad60/40%,cohortes20% cada una, aviso de discrepancia, PDF y tamaño móvil. PDF final ES/ZH revisado visualmente.

Railway b8afb170-5ec0-4a93-9142-36e218a09e28 SUCCESS22:00:10Z, commit de fusión correcto. Web41135026621 success; Pages41135098755 success, artefacto35b03c365de6b5dcc66de58a49c410af89f9d836.

Se corrigen coincidencia por país/nombre, cinco cohortes, país desconocido, cobertura y denominadores. Lectura con recuento exacto, orden estable, detección de duplicados/cambios, máximo20.000 registros/80consultas/6segundos:503 ante lectura incierta, sin200 parcial. No equivale a snapshot transaccional ni reconcilia el contador almacenado.

IDV-05 conserva pendientes de homónimos del mismo país, alias, validación del territorio declarado y límites con identificadores tipados. local_verified significa coincidencia de nombre/país geocodificados, no presencia certificada. No hay SQL, OTP/proveedores reales, reescritura histórica o cambios de vigilancias. Siguiente trabajo:IDV-07, sin cerrar los residuales expresos.
