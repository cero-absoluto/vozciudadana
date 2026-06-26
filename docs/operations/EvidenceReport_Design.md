# Despliegue — Evidence Report (Statement of Evidential Scope)

Base: `vozciudadana-main __48__` (ya incluye la migración HMAC). Esta tanda añade el Evidence Report encima.

---

## 1. Archivos de código → al repositorio

### Backend (API → Railway)

| Archivo de salida | Ruta en el repo | Acción |
|---|---|---|
| `evidentialScope.js` | `apps/api/src/lib/evidentialScope.js` | **NUEVO** (crea la carpeta `lib/` si no existe) |
| `protests.js` | `apps/api/src/routes/protests.js` | **REEMPLAZA** (import + integración en `/informe`) |

### Frontend (web → GitHub Pages)

| Archivo de salida | Ruta en el repo | Acción |
|---|---|---|
| `InformeScreen.vue` | `apps/web/src/screens/InformeScreen.vue` | **REEMPLAZA** (bloque de evidencia) |
| `es.json` | `apps/web/src/locales/es.json` | **REEMPLAZA** (namespace `evidence`) |
| `en.json` | `apps/web/src/locales/en.json` | **REEMPLAZA** |
| `fr.json` | `apps/web/src/locales/fr.json` | **REEMPLAZA** |
| `zh.json` | `apps/web/src/locales/zh.json` | **REEMPLAZA** |

### Documentación → al repositorio

| Archivo de salida | Ruta en el repo | Acción |
|---|---|---|
| `3_-VoiceProtest_AuditAlignment_v2_1.docx` | `docs/canonical/3.-VoiceProtest_AuditAlignment_v2_1.docx` | **REEMPLAZA** (renombra `3_-` → `3.-`; añade §21) |
| `EvidenceReport_Design.md` | `docs/operations/EvidenceReport_Design.md` | **NUEVO** (spec de implementación) |

---

## 2. Orden de despliegue

1. **Backend primero** (Railway): sube `evidentialScope.js` + `protests.js`. A partir de aquí `/informe` ya devuelve `evidential_scope`.
2. **Frontend después** (GitHub Pages): sube `InformeScreen.vue` + los 4 locales.

> No es estrictamente obligatorio ese orden: el render lleva `v-if="data.evidential_scope"`, así que si el frontend va primero, el bloque simplemente no aparece hasta que el backend esté arriba — nunca rompe.

3. **Docs**: commit de `canonical/3` y `operations/EvidenceReport_Design.md`.

---

## 3. Lo que NO hace falta para esta tanda

- **Sin migración de base de datos.** El Evidence Report solo *lee* campos que ya existen (`scope`, `dominio_email`, `requiere_censo`, `local_verified`). No toca esquema.
- **Sin variables de entorno nuevas.**
- **`participation_rate` = `null`** siempre, hasta que exista un censo registrado real por convocatoria. No se muestra denominador. No hay ruta a estimaciones.

---

## 4. Verificaciones previas (heredadas de la migración HMAC — confírmalas si no lo hiciste ya)

Estas no son del Evidence Report, pero conviene cerrarlas antes de dar por desplegado el conjunto:

- **Railway — secretos boot-críticos:** `PHONE_HASH_SECRET` y `NULLIFIER_SECRET` configurados. Si faltan, el servidor **no arranca** en producción (fail-fast). Buena señal: si el deploy levanta, están.
- **Supabase — retención 90 días:** verificar que existe el job (`pg_cron`/función programada) que purga adhesiones a 90 días. No está en el repo.
- **Supabase — purga de datos de prueba:** los hashes SHA-256 antiguos no migran a HMAC; si hubo adhesiones de prueba, purgarlas (no migrarlas).
- **Supabase — RLS:** `protests_service_write` solo `service_role`.

---

## 5. Notas

- **Locales reformateados.** Al inyectar el namespace `evidence`, los 4 `locales/*.json` quedaron normalizados a indent de 2 espacios. Es JSON válido, pero verás diff de formato además del contenido nuevo.
- **Chino (zh) pendiente de revisión nativa.** ES/EN/FR son sólidos; el zh lo generé yo y conviene un repaso de hablante nativo antes de producción. No bloquea: las 27 claves resuelven en los 4 idiomas (verificado).
- **Verificado antes de empaquetar:** `node --check` en backend, compilación de `InformeScreen.vue`, JSON válido en los 4 locales, y cobertura completa función→locales (27/27 claves en cada idioma).
