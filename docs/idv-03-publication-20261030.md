# IDV-03 — publicación verificada

30/10/2026, 14:33 CET. El Owner autorizó completar publicación y siguientes
pasos sin nuevas aprobaciones rutinarias; se mantienen OTP real aplazado y las
reglas de producto acordadas. El agente comprueba revisión, pruebas, commit y
estado terminal antes de dar por publicado cada bloque.

PR150: https://github.com/cero-absoluto/vozciudadana/pull/150
Candidato: `671b27593d4333dd25c0506be04e89b308beedf2`.
Codex terminó a las 12:54:56Z sobre ese SHA sin hallazgos. La política de
dependencias pasó. Validación local: 667 pruebas correctas, dos omitidas; 37
comprobaciones dirigidas; compilación web y CSP de cinco HTML correctas.

Fusión: `cc6ec7ef8f5485fb575a9a2a7efd340ef9fa7b8c`.
Railway API: `724f6f0a-1d40-4f25-9127-753743746ef7`, SUCCESS a las
13:32:52Z, commit de fusión coincidente. Una réplica activa, cero fallos recientes,
sin cambios pendientes en production.

Salud/CSP: 11/11 a las 13:33:40Z. La primera pasada de cinco segundos obtuvo
9/11 por timeout en los dos endpoints del dominio técnico Railway; la segunda
pasada con límite de doce segundos terminó 11/11. No se oculta el fallo inicial.

Cambio de API, sin cambios del código web ni SQL. No hubo OTP/proveedores reales,
lectura de filas personales o secretos ni modificación de tareas de vigilancia.
La publicación corrige confirmaciones GPS ante errores del geocodificador; no
certifica presencia física ni cierra IDV-04–12.
