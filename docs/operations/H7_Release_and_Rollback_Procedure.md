# H7 — Procedimiento de publicación y reversión (PROPUESTA, no ejecutar)

**Estado:** borrador revisable · 19 oct 2026 · **preparar este documento no autoriza ejecutar nada.** Cada paso con efecto fuera del repositorio necesita autorización expresa del Owner. I4/D3 siguen en pausa.

## 1. Qué se publica (fijado)

| Elemento | Valor |
|---|---|
| PR | #29 (borrador), rama `local/h7-derive-national-country` |
| Commit de código auditado | `f4533d7084fc399d28d3a53b593565a38875dbf9` (árbol `2ec54b02d82ad65be083f1d50ada812ed6089639`), base `main` = `27e3746` |
| Migración exacta | `supabase/migrations/20261019120000_devices_numbering_provenance.sql`, SHA-256 `9b388c7049cf1787c8221757b5ccf8dc2f15b372b5f0545b3855be35787d45ae` |
| Criterio | R-N2 (`NUMBERING_META_VERSION` = `libphonenumber-js@1.12.10/max;R-N2`) |

**Antes de fusionar (paso 2), comprobar que lo que se fusiona es exactamente lo auditado:**
```bash
gh api repos/cero-absoluto/vozciudadana/pulls/29 --jq '.head.sha'      # debe ser f4533d7084fc399d28d3a53b593565a38875dbf9
gh api repos/cero-absoluto/vozciudadana/branches/main --jq '.commit.sha' # debe ser 27e3746… (la base auditada)
sha256sum supabase/migrations/20261019120000_devices_numbering_provenance.sql   # debe coincidir con la tabla
```
Si el *head* de la PR **o** `main` han cambiado, **parar**: el commit auditado ya no es lo que se fusionaría; hay que volver a fijar este documento y re-auditar (p. ej. tras fusionar #26, ver §2.2).

**Tras el merge**, comprobar contenido exacto, no recuentos: con `M` = commit resultante en `main`, `git diff --exit-code f4533d7 M` debe salir vacío (mismo árbol; vale para merge, squash o rebase siempre que `main` siguiera en `27e3746`). Cualquier diferencia ⇒ no desplegar la API (paso 3) y avisar.

## 2. Decisiones y hechos que el Owner debe confirmar antes

1. **Despliegue automático (no verificable desde el repo).** `deploy.yml` publica la web en GitHub Pages en cada push a `main` que toque `apps/web/**` (o `package.json` raíz): **el merge de la PR #29 publica la web automáticamente.** El backend (`apps/api`, Railway, `railway.json`) puede o no desplegar solo al hacer push a `main`: eso depende del servicio en Railway y debe confirmarlo el Owner. Si lo hace, el merge dispara web y API a la vez.
2. **Conflicto con la PR #26.** Una prueba de fusión local (sin push) de #26 sobre esta rama da conflicto en `apps/api/src/routes/users.js` (`request-otp`). El que se fusione segundo requiere rebase, nueva suite y nueva revisión. Orden a decidir por el Owner; ninguna PR queda autorizada por este documento.
3. **Volumen de SMS.** Todo dispositivo ya verificado carece de procedencia: **la primera vez que una persona se une a una convocatoria nacional tendrá que verificar de nuevo (un SMS).** Hay que decidir si se acepta ese pico (coste Twilio, límites de tasa) o se espera a una ventana de menor actividad. Este documento no tiene autoridad financiera.
4. **Limitación de producto aceptada:** móviles de IT/VA, FI/AX, NO/SJ, AU/CC/CX, MA/EH y Antillas francesas, y +1 gratuitos, no se resuelven (rechazo explicado).
5. **Copia de seguridad:** confirmar que existe punto de restauración de la base (copia/PITR) antes de la migración. No verificable desde el repo.

## 3. Comprobaciones previas (locales, sin producción, sin SMS)

```bash
node --test tests/*.test.mjs                                         # 57/57
node --experimental-test-module-mocks --test tests/national-country-derived.mjs   # 15/15 (Supabase/Twilio simulados)
node --test tests/devices-numbering-migration.mjs                    # 6/6 (PGlite desechable)
npm run build                                                        # web
```
Nota: estas pruebas no se ejecutan en CI (el único workflow es el de Pages). Node ≥ 22 para el *flag* de mocks.

## 4. Secuencia propuesta

El orden evita tanto «API nueva sin columnas» (verify-otp falla) como «API nueva con web antigua» (mensajes genéricos y sin recorrido de reverificación).

| # | Paso | Quién | Comprobación (solo lectura) | Si falla |
|---|---|---|---|---|
| 0 | Confirmar §2; comprobar el pin (§1); crear la referencia `pre-h7-web` (ver 5.2); si Railway despliega solo desde `main`, **pausar el auto-deploy** antes del paso 2 | Owner | Estado del servicio en Railway | No continuar |
| 1 | **Migración** (aditiva, nullable, sin backfill) | Owner / quien él autorice | Ver 4.1 | Ver 5.1 |
| 2 | **Merge de #29** → Pages publica la web | Owner | Workflow «Deploy web» verde; la web carga; la API antigua sigue operativa (los códigos nuevos nunca los emite) | Ver 5.2 |
| 3 | **Despliegue de la API** del commit fusionado (manual o reanudando el auto-deploy) | Owner | `/health` 200; ver 4.2 | Ver 5.3 |
| 4 | Ventana de vigilancia | Owner | Ver 4.3 | Ver 5.4 |

### 4.1 Comprobaciones del paso 1 (SQL de solo lectura)
La API antigua sigue operativa durante la migración y puede registrar adhesiones legítimas, por lo que **no se exige que el recuento total de `adhesions` sea idéntico**. La verificación es específica de la migración:
```sql
-- Columnas y restricción (después)
select column_name from information_schema.columns where table_name='devices' and column_name like 'numbering_%';   -- 3 filas
select pg_get_constraintdef(oid) from pg_constraint where conname='devices_numbering_provenance_coherent';          -- 4 valores
select count(*) filter (where numbering_resolution is null) as sin_procedencia, count(*) as total from devices;       -- sin_procedencia = total
```
Esperado: 3 columnas; restricción con los 4 valores; ninguna fila de `devices` con procedencia todavía (sin backfill). Que la migración no toca adhesiones se comprueba en el propio SQL (solo `alter table devices`/`comment on`, sin `insert/update/delete`; test `tests/devices-numbering-migration.mjs`). Opcional e **informativo**: anotar `t0 = now()` antes y comparar `select count(*), md5(string_agg(id::text, ',' order by id)) from adhesions where created_at < '<t0>'` antes y después; una diferencia no prueba fallo (cierres o anonimizaciones legítimas pueden modificar filas históricas) pero debe investigarse.

### 4.2 Comprobaciones del paso 3 sin SMS ni adhesiones reales
- `GET /health` → 200 (también es el *healthcheck* de Railway).
- **No** ejecutar `verify-otp` ni `join` en producción (gastarían un OTP real o crearían una adhesión real).
- Sonda opcional, solo con OK expreso: `POST /api/users/request-otp` con un número de código no asignado (p. ej. `+99912345678`) y el `protest_id` de una convocatoria nacional → debe responder 403 `NATIONAL_COUNTRY_UNRESOLVED` **antes** de enviar SMS. Requiere token reCAPTCHA válido y deja una fila en el contador de límite de tasa; por eso no es obligatoria.
- La verificación funcional completa (derivación, reverificación, FR→ES, planes compartidos) se hace en local/base desechable con las pruebas de §3, no en producción.

### 4.3 Vigilancia (primeras horas)
Errores 5xx en `verify-otp` y `join`; proporción de 403 `NATIONAL_REVERIFICATION_REQUIRED` (se espera alta al principio) y `NATIONAL_COUNTRY_*`; 429 de `request-otp`; coste y entregas Twilio; `select numbering_resolution, count(*) from devices group by 1`; adhesiones nuevas con el mismo recuento diario de nullifiers únicos (sin duplicados por `(protest_id, nullifier)`).

## 5. Si falla cada paso

**5.1 Migración.** Es transaccional e idempotente: si falla, no queda aplicada a medias; corregir la causa y re-ejecutar. Si hay duda sobre el estado, repetir las consultas de 4.1. **No se borran columnas al revertir** (aditivas, nulas, inocuas para la API antigua) salvo decisión específica del Owner. Si la restricción de coherencia bloquease escrituras legítimas, la opción es corregir hacia delante; relajarla solo por decisión expresa.

**5.2 Web (Pages).** Si el build falla o la web se degrada: revertir los archivos de `apps/web` con un commit de reversión en `main` (ruta principal). Alternativa solo si **antes del merge** se conservó una referencia en el estado anterior (por ejemplo una etiqueta `pre-h7-web` sobre `27e3746`, creada por quien el Owner autorice): `workflow_dispatch` sobre esa etiqueta, porque el *dispatch* acepta rama o etiqueta, no un SHA arbitrario, y sobre `main` reconstruiría la versión degradada; o relanzar una ejecución anterior conocida y correcta del workflow. Con la API antigua no hay impacto funcional. Con la API nueva ya desplegada, una web antigua solo degrada mensajes (genérico) y deja sin salida a los dispositivos que deban reverificar para nacional; global y demás ámbitos siguen funcionando.

**5.3 API.** (a) Si el *healthcheck* falla, Railway no debería promover el despliegue nuevo (confirmar con el comportamiento real del servicio). (b) Si hay 500 en `verify-otp`/`join` por columnas inexistentes → la migración no está aplicada: **aplicarla (autorización del Owner), no revertir**. (c) Si hay un fallo de lógica: corregir hacia delante con PR.

**5.4 Reversión de la API (último recurso).** **Revertir a la API anterior NO conserva el control H7:** recupera el comportamiento vulnerable, en el que el país declarado por el cliente concede elegibilidad nacional. Solo como medida temporal y por decisión expresa del Owner, sabiendo que: las columnas añadidas se quedan (la API antigua las ignora); las adhesiones creadas con la API nueva siguen siendo válidas (E.164, hashes y nullifiers no cambian); y los dispositivos que ya reverificaron conservan su procedencia para cuando se vuelva a desplegar. Alternativas previas a revertir: corregir hacia delante, o suspender temporalmente la convocatoria nacional afectada por una vía operativa distinta del código (decisión del Owner).

## 6. Lo que este procedimiento no cubre
Estado real del auto-deploy de Railway y retención de artefactos anteriores en Pages (no verificables desde el repo); copias de la base de datos; versión de Node que usa Nixpacks en Railway (la dependencia `libphonenumber-js@1.12.10` no requiere Node ≥ 22); coste de SMS; comunicación a usuarios.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01JQ4nAdGcpqcEpPD8PwSrEu
