# IDV-01 / IDV-02 — publicación y evidencia

Publicado y verificado el 30/10/2026; cierre de comprobaciones a las 11:18 CET.
El Owner autorizó aplicar el SQL y publicar API/web después de revisar el candidato.

## Resultado

- IDV-01: admisión institucional mediante correo obligatoria, incluso sin censo; rechazo de la solicitud SMS antes de reservar cuota/enviar; mensaje fijo traducido.
- IDV-02: GPS excluido de convocatorias de riesgo alto/crítico y del flujo institucional, en cliente, API y trigger de base. Tokens anteriores de refuerzo no permiten eludir la política.
- Se conservan las reglas de aval/fundador y los permisos existentes. No se reescribieron adhesiones históricas.

## Identidad de la publicación

| Componente | Referencia | Resultado |
|---|---|---|
| PR | https://github.com/cero-absoluto/vozciudadana/pull/147 | Fusionada |
| Candidato remoto | `3a46acebf85677dab4b4bcbb23ad2432b330e6ae` | Árbol idéntico al candidato local validado |
| Árbol de código | `bc7f2d7bfae2a08204e51f290d19e6c9e4f58170` | Coincidencia exacta |
| Fusión | `4b22da8a589e095018f04fbdc3c1b5c4859f10e3` | Publicada |
| Railway API | `6e2ded04-c6d5-4640-8e13-1a842914bb72` | SUCCESS, commit de fusión correcto |
| Construcción/publicación web | https://github.com/cero-absoluto/vozciudadana/actions/runs/41037829011 | success |
| Pages | https://github.com/cero-absoluto/vozciudadana/actions/runs/41037898074 | success |
| Commit Pages | `43d7708b7eb303b6f3225d6fd1a3f0439cc92ae0` | Archivos públicos contrastados |

## Base de datos

Supabase: función existente `public.enforce_census_admission()` y trigger
`census_admission_guard`. Se ejecutó el SQL aprobado de
`docs/proposals/idv-01-02-admission.sql` mediante `execute_sql`, en su transacción
explícita y con comprobaciones de deriva. El intento previo de `apply_migration`
falló con `Invalid or expired requestState`; una lectura posterior confirmó que
la referencia seguía intacta antes de usar la vía alternativa. No se declara una
entrada de historial de migración creada por ese intento fallido.

Lectura posterior a la aplicación, 10:17:55Z:

- MD5 de función esperada y observada: `8874ca11a460facae29f110228872e91`.
- SECURITY INVOKER; ACL sin cambios: propietario y service_role; sin EXECUTE público.
- Trigger ampliado a GPS y columnas heredadas `gps_accuracy`, `gps_lat`, `gps_lng`.
- Verificador efectivo de permisos/RLS, 10:18:06Z: **cero desviaciones**.

La comprobación posterior de producción fue de metadatos, sin consultar filas de
usuarios ni introducir adhesiones de ensayo. La semántica de denegación, fundador,
concurrencia y reversión se ensayó previamente con PostgreSQL 17.6 sintético.

## Comprobaciones

- 644 pruebas generales correctas; dos omitidas.
- 19 pruebas de rutas correctas, con Supabase/Twilio simulados.
- Nueve grupos de comprobación PostgreSQL, incluida conservación de ACL/propietario,
  bootstrap del fundador, campos heredados, anonimización y SHARE paralelo.
- Compilación web y CSP en cinco HTML correctas; política de dependencias CI correcta.
- Salud/CSP públicas a las 10:17:55Z: **11/11 correctas**.
- Siete archivos servidos coinciden byte a byte con el árbol Pages: index,
  bundle JS principal, service worker y cuatro páginas auxiliares.

SHA256 del bundle principal servido `assets/index-DGcHyLya.js`:
`c9f76571afc61079ce95514d3e10ba56f657d15a60598fa324b1370a30e6af20`.

## Límites y siguiente trabajo

La comprobación OTP real sigue aplazada. No hubo SMS/correo/push/GPS/pagos reales,
lecturas de secretos o registros de usuarios, ni cambios de automatizaciones.
No se presenta el ensayo del handler de Vue como un ensayo Chromium real.

Esta publicación cierra las correcciones concretas de IDV-01 e IDV-02 aquí descritas;
no cierra la auditoría integral de identidad ni los pendientes IDV-03–12. La relación
oficial dominio/institución, roles, vigencia y el tratamiento histórico quedan fuera.
Una recepción HTTP de coordenadas desde un cliente modificado no puede impedirse:
se excluyen del procesamiento geográfico y persistencia de estas rutas restringidas.

Reversión SQL revisada: `docs/proposals/idv-01-02-admission-rollback.sql`, con guardia
de deriva. No se ha ejecutado en producción. La reversión de API/web requiere
seleccionar explícitamente el artefacto anterior; no revertir por automatismo.
