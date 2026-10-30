# Recuperación del relevo existente — 30/10/2026

El circuito ya funcionó en PR #128: Claude produjo `4369d24d`, se solicitó revisión
Codex de ese HEAD y el estado terminó en OWNER_REVIEW. No se reconstruye el agente.

El candidato conserva controlador, máximo de dos correcciones, política de rutas,
verificación sin credenciales, publicador con lease y petición autenticada a Codex.
No habilita merge ni despliegue automáticos, API/SQL ni nuevas credenciales.

Cambios de recuperación:

- La guardia añadida en S16 comparaba un commit completo con una variable de cuenta.
  Ahora `verify-approval.mjs` comprueba la huella de los ocho archivos de control
  contra `sandbox-approval.json`, versionado en la rama de confianza. Un cambio de
  documentación no invalida la aprobación; un cambio de controlador/workflow sí.
- Los checkouts de confianza usan el SHA exacto que ejecuta el workflow. La comprobación
  se ejecuta antes de recoger la tarea o iniciar el paso con credencial del modelo.
- Se limita explícitamente el catálogo de herramientas y se deniega lectura de directorios
  temporales y ubicaciones habituales de credenciales/procesos. La tarea se entrega en
  `.handoff-input`, excluido del artefacto. No hay checkout con credenciales persistentes.
- Un preflight inline de confianza rechaza enlaces simbólicos y la ruta reservada antes
  de descargar la tarea y antes de autenticar el modelo. No ejecuta scripts del PR.

Ensayo privado de la acción fijada: run `41044420980`, success, commit privado
`7c1f7d2fac1163d6d5078f969851794d7175f5e1`. Se comprobaron edición y creación
permitidas, denegación de escritura externa, hooks/MCP/shell no ejecutados y canario
sintético externo no expuesto, incluida la ruta por enlace. No se inspeccionaron
secretos reales. Las pruebas específicas locales de coordinación son 71.

La aprobación es un registro de confianza del repositorio: no una firma externa ni
protección frente a un administrador que cambie main. Se mantiene esa frontera previa;
la protección obligatoria de rama continúa siendo un pendiente distinto de S15.
Las pruebas no garantizan aislamiento absoluto de la red ni de todo el proceso.

La puesta en marcha se declarará recuperada únicamente después de observar una tarea
sintética real con parche publicado, pruebas/build y revisión Codex del nuevo SHA hasta
OWNER_REVIEW. El piloto no se fusionará ni desplegará en producción.

---

## Documentación histórica

# Flujo Claude implementa → Codex audita — propuesta actual

Para tareas nuevas, ChatGPT concreta el objetivo y prepara una PR de soporte desde main
(por ejemplo con criterios de aceptación o pruebas, sin implementar el cambio de producto).
El Owner inicia la tarea con una orden nueva, no editada:

```text
/handoff implement

Objetivo concreto y criterios de aceptación de la tarea autorizada.
```

La primera línea debe coincidir exactamente. El encargo debe tener entre 1 y 8000
caracteres. Solo la identidad exacta del Owner con permiso admin/write y el
interruptor global activo pueden iniciar el trabajo. Una sola implementación por
PR, sin reutilizar estados previos ni reiniciar contadores. Encargos demasiado
amplios o que requieran rutas denegadas deben dividirse o resolverse fuera del agente.

Flujo: IMPLEMENTING (ronda 0) → Claude edita → parche validado → pruebas y build en
job sin secretos → publicador de confianza empuja solo la rama del PR → petición
de revisión Codex del SHA publicado → AWAITING_REVIEW. Solo una revisión auténtica
limpia del HEAD actual permite OWNER_REVIEW. Los hallazgos permiten hasta dos
rondas CORRECTING adicionales, siempre con pruebas, build y nueva revisión.
Sin resultado o con Running sigue pendiente; nunca se sustituye por autorrevisión.
La fusión y el despliegue siguen fuera del workflow y requieren autorización del Owner.

Claude no recibe permisos nuevos, shell, red ni el PAT de petición de revisión.
El objetivo viaja como JSON de datos en el artefacto existente, no se interpola en
comandos ni código. Se conservan las listas de rutas, la huella del parche,
la comprobación del HEAD, el lease del push y el job aislado que pide revisión.
El nombre histórico del artefacto `findings` contiene ahora mode/task/findings.

La implementación inicial no consume correcciones. Si falla, no produce cambios,
se rechaza el parche o fallan pruebas/build, queda BLOCKED sin pedir aprobación.
Una parada o interruptor apagado impide empujar. Una implementación inicial fallida
no puede saltarse con `/handoff enable` ni relanzarse por duplicación: hay que
investigar y preparar una nueva PR con autorización explícita. `/handoff enable`,
`/handoff retry` y `/handoff review` conservan su función histórica para los
relevos existentes; `/handoff implement` es la entrada para tareas nuevas.

Esta propuesta tiene pruebas offline de la implementación inicial y del relevo.
No acredita ejecución real de la nueva fase ni resuelve el fallo intermitente de
publicación del conector Codex. Antes de fusionar necesita auditoría independiente;
antes de declarar el nuevo flujo operativo necesita una tarea real observada.

---

# Recuperación explícita y recibos contradictorios — propuesta #55

`/handoff retry` solo permite al Owner reintentar una reseña auténtica ya tratada, con hallazgos en el mismo HEAD, desde STOPPED o BLOCKED. Conserva los identificadores tratados, registra el id de la orden y consume una ronda normal: no reinicia ni amplía el límite. No solicita otra revisión a Codex. Sin hallazgos recuperables, con HEAD distinto, orden duplicada, interruptor apagado o rondas agotadas, no llama a Claude. Un stop posterior sigue impidiendo publicar.

Un recibo limpio no acredita la resolución de hallazgos previos sobre el mismo SHA: se bloquea con `clean_receipt_conflicts_with_findings`. Es conservador incluso ante una posible retractación: hace falta resolver esa contradicción explícitamente. Los hallazgos de un SHA anterior no impiden aceptar la revisión limpia de un nuevo commit.

Validación offline: 46 pruebas dirigidas superadas. La recuperación con esta orden todavía no está demostrada en Actions.

---

# Activación solicitada — 2026-10-22

El Owner autoriza poner en marcha el relevo. Confirma haber guardado `CLAUDE_CODE_OAUTH_TOKEN` en Secrets de Actions (confirmación del Owner, no lectura de su valor ni prueba de autenticación). Esta rama propone instalar el candidato de #38 con las dos correcciones de su última revisión Codex: identidad exacta de cada comentario inline y lease exacto del HEAD remoto al publicar.

La copia instalada es idéntica a `candidate/agent-handoff.yml`. Solo funciona con la variable de repositorio `AGENT_HANDOFF_ENABLED=true` y una orden `/handoff enable` del Owner en cada PR. Sin variable no lanza el modelo. Máximo dos correcciones, sin merge ni despliegue. La instalación y la existencia del secreto NO demuestran coordinación operativa.

Pendiente real: instalar en main, activar variable, revisión Codex del HEAD habilitado, ejecución Claude, publicación del parche y revisión del nuevo SHA. El retorno automático bot→Codex sigue sin acreditarse: si no llega revisión del SHA nuevo, permanece AWAITING_REVIEW. No se sustituye por una API de pago. El paso del modelo consume los límites de la suscripción; timeout y max-turns no son un límite monetario.

Las siguientes secciones son la documentación histórica del candidato, con sus mediciones y límites previos; las afirmaciones de «inerte», «solo deploy.yml» o «sin secretos» describen aquella preparación y no el estado de esta propuesta.

---

# Relevo automático Claude ⇄ Codex — PREPARADO, NO ACTIVADO (#37)

Estado: candidato inerte. **No hay workflow activo** (`.github/workflows/` solo contiene `deploy.yml`), ni secretos, ni gasto. Tampoco se afirma coordinación operativa: falta una demostración *live* sin transporte de mensajes.
Base: `main` = `7b888ed01683a52c2ae9beb0dbc3b5e5ba071ae8`. Reutiliza de #23 (sin fusionarla): revisión obsoleta rechazada, máximo dos correcciones, parada en OWNER_REVIEW, sin merge. Añade identidad real, SHA de HEAD, deduplicación y estado persistente. #23 sigue siendo borrador; su `protocol.py` no se incorpora (el controlador está en JS para correr en el runner sin dependencias).

## Qué hace
1. El Owner habilita **un PR** comentando `/handoff enable` (solo él; ver contrato).
2. Codex revisa el HEAD (reseña con hallazgos, o recibo "Didn't find any major issues").
3. Hallazgos en el HEAD actual → job `claude` corrige (sin permisos de escritura) → el publicador de confianza valida el parche, lo aplica y empuja **solo la rama del PR** → se pide revisión del SHA nuevo.
4. Sin hallazgos → `OWNER_REVIEW`. Dos rondas con hallazgos pendientes, error, parche rechazado, push rechazado o cualquier anomalía → `BLOCKED` con razón. Nunca merge ni despliegue.

Piezas: `controller.mjs` (decisión pura), `gather.mjs` (hechos de la API + estado; job `decide`), `publish.mjs` (validación/aplicación/push; job `publish`), `policy.json` (identidades y límites), `candidate/agent-handoff.yml` (workflow inerte).

## Contrato de disparo y cómo se cumple
| Requisito | Mecanismo (código) |
|---|---|
| Solo PR habilitados por el Owner; validar quién habilita | Orden exacta `/handoff enable` en la primera línea; actor con **id, login, tipo `User` y permiso admin/write** (API de colaboradores); una etiqueta no habilita nada |
| Solo ramas del repositorio; sin forks/ambiguas/cerradas | `precheck`: repo, `head.repo == base.repo == policy.repository`, base = rama por defecto, PR abierto y no fusionado, SHA de 40 hex, `headRef` seguro (sin `..`, `-` inicial, espacios) |
| Auditor real | Autor con id `199175422`, tipo `Bot`, login `chatgpt-codex-connector[bot]`; recibos además con `performed_via_github_app.id == 1144995`. Texto de otro usuario o un emoji (👍/👀) **no** son revisión |
| SHA de revisión = HEAD | Reseña: `commit_id == head`. Recibo: prefijo de `**Reviewed commit:**` ⊂ head. Además el estado exige `state.head == head` |
| Acción de Claude: control de bot **y** de acceso | Verificado en el código de la acción (v1.0.242; la validación es idéntica en v1.0.253): (1) *actor humano*: un actor no `User` debe estar en `allowed_bots` (nombre exacto, sin `[bot]`, minúsculas); aquí `chatgpt-codex-connector`, nunca `'*'`; (2) *acceso de escritura*: la acción da por válido cualquier actor con sufijo `[bot]` — **no filtra bots**; el filtro real es `decide` (id, tipo, app, PR habilitado). Sin `allowed_non_write_users` |
| Eventos de GitHub App vs `GITHUB_TOKEN` | Los eventos creados con `GITHUB_TOKEN` no inician workflows; los de una GitHub App sí. Codex es una App (observado: comentarios con `performed_via_github_app`, creados **y editados**): se escucha `issue_comment [created, edited]`. Los push del publicador (con `GITHUB_TOKEN`) no lanzan workflows, y no hace falta |
| Rondas máximo 2, contador persistente, deduplicación | Estado en un comentario del PR escrito por `github-actions[bot]` (autor verificado; los comentarios de otros con el marcador se ignoran); `rounds` sube al lanzar; ids de reseña/recibo ya tratados se guardan; el controlador recalcula desde la API: eventos duplicados/antiguos/perdidos no consumen rondas |
| Concurrencia 1 por PR, timeout, parada | `concurrency` por PR sin cancelar; `timeout-minutes` por job; `/handoff stop` (Owner) y variable `AGENT_HANDOFF_ENABLED` (ausente = apagado). **Parada con carrera acotada:** una orden `stop` publicada mientras corre la ronda queda en cola (la concurrencia no cancela), pero `publish` relee todos los comentarios y, si la última orden del Owner (identidad exacta de la política) es `stop`, **no empuja**, marca `STOPPED` y avisa. Interruptor: `publish` **siempre corre** tras una ronda lanzada y recibe el valor de `vars` al arrancar su propio job (según la documentación el contexto se resuelve por job, **no verificado en vivo**; no hay consulta a la API de variables). Si está apagado, vacío o ausente, no empuja, persiste `STOPPED` (la ronda gastada se conserva) y avisa; `/handoff enable` del Owner lo reanuda y una reseña nueva con hallazgos lanza la ronda siguiente (SW1). Ya no queda `CORRECTING` colgado. **Lectura completa:** la paginación sigue todas las páginas (100 por página) y, si hubiera más de 10 000 elementos, **lanza error en lugar de truncar**: `publish` falla cerrado (sin push; el estado puede quedar en `CORRECTING` hasta que lo resuelva el Owner a mano) y se evita decidir con una orden `stop` fuera de la lista (PG1/PG2). **Carrera residual:** una orden publicada tras la lectura de `publish` y antes del `git push` (segundos) no se ve; la parada no es instantánea. El modelo y las pruebas ya consumidos no se cancelan |
| Sin hallazgos no se inventa defecto | → `OWNER_REVIEW` (prueba F2) |

## Nueva revisión tras el push: NO verificado
No se asume que un comentario de un bot despierte a Codex. Evidencia: aquí `@codex review` publicado por el usuario del Owner (vía la App de Claude) sí lo activó, también sobre PR en borrador (#31, #32). Nada prueba lo mismo para `github-actions[bot]`/`claude[bot]`. El publicador pide la revisión con ese comentario y el estado queda en `AWAITING_REVIEW`; si Codex no responde, **no hay bucle ni consumo** y el estado es visible. Alternativas a decidir en el piloto live: la opción *Automatic review* de Codex (ajuste de cuenta; la documentación no aclara si actúa en borrador ni en cada push) o un comentario manual del Owner (en ese caso el piloto no cumple "sin copiar mensajes").

## Aislamiento de credenciales (las instrucciones del prompt no bastan)
| Job | Código que ejecuta | Credenciales | Permisos |
|---|---|---|---|
| `decide` | rama por defecto (de confianza); nunca el PR | solo `GITHUB_TOKEN` | contents read, issues write, pull-requests read |
| `claude` | el modelo sobre el checkout del SHA verificado, **sin shell, sin git, sin red** (`Bash`, `WebFetch`, `WebSearch`, `Task` denegados; `Edit`/`Write` solo en `apps/web/src/**` y `tests/**`) | token del modelo **solo en el paso de la acción**; `github_token` de solo lectura | contents/pull-requests/issues **read**; sin `id-token` |
| `patch` | solo código de confianza (`build-patch`); no ejecuta nada del PR | ninguna | contents read |
| `verify` | `npm ci --ignore-scripts` y `node --test` sobre el PR + parche; **sin subida de artefactos** | **ninguna** (sin secretos; el checkout no deja credenciales en `.git`) | contents read |
| `publish` | rama por defecto + parche validado; no ejecuta código del PR | `GITHUB_TOKEN` con contents write (sin modelo) | contents write, issues write, pull-requests read |

Flujo del parche: el modelo no ejecuta nada ni deja un `git diff`; su copia de trabajo sale como **datos** (artefacto, sin `.git`). El job `patch` (solo código de confianza) la copia sobre un checkout limpio del HEAD (`buildPatchFromTree`: sin symlinks, `git add -A` con configuración neutra, `--no-ext-diff --no-textconv --no-renames`): **los ficheros nuevos permitidos entran**; los fuera de lista, `.github/`, `automation/`, dependencias, binarios, symlinks, bits ejecutables o borrados protegidos se rechazan (`validatePatch`: permitido `apps/web/src/`, `tests/`; ≤200 kB). Sube el parche **y publica su huella sha256 como salida del job**. `verify` (código del PR, sin credenciales ni subida) descarga el parche, comprueba la huella (`check-patch`), instala dependencias, lo aplica y ejecuta las pruebas. `publish` descarga el parche otra vez y **exige la misma huella** (`patch_integrity` → BLOCKED, sin push), el resultado de `verify` (`success`) y el estado de `patch`; faltar cualquiera falla cerrado. Las pruebas del PR pueden alterar su copia local, no la huella (salida de otro job) ni el artefacto (`verify` no sube nada); si una copia alterada llegase a `publish`, la huella no casa (prueba I5: sustituir por un segundo cambio permitido y válido → no se publica). `issue_comment` toma el workflow de la rama por defecto; no se usa `pull_request_target` ni `pull_request_review`. Acciones fijadas a SHA completo (checkout v6.0.3, setup-node v4.4.0, upload-artifact v7.0.2, download-artifact v8.0.2, claude-code-action v1.0.242).

**Validación estricta del parche (hallazgo P1 de Codex, descubierto en #39 sobre este mismo código).** La versión anterior de `validatePatch` buscaba cabeceras con una expresión regular: un parche con `diff --git a/apps/web/src/a.js …` permitido y `--- "a/.github/workflows/evil.yml"` / `+++ "b/.github/workflows/evil.yml"` (entrecomillado) pasaba, y `git apply` real (2.43) **modificaba el workflow denegado** (reproducido en la prueba Q1). Ahora `validatePatch` es un analizador estricto: sigue la longitud de cada hunk como git, **rechaza toda línea fuera de un hunk que no sea una cabecera conocida** (git ignora la basura), exige que las rutas de `diff --git`, `---` y `+++` coincidan, y solo admite rutas de caracteres seguros (sin comillas, escapes C, espacios ni no ASCII); sin modos distintos de 100644, renombrados, binarios ni cambios de modo. Segunda capa independiente: `applyPatchAndPush` exige política y, tras aplicar en el índice, comprueba con `checkPaths` las rutas **que git modificó de verdad**; si alguna incumple, deshace (`reset --hard`, `clean`) y no confirma ni empuja (Q4). Los parches reales de `git diff` (nuevos, borrados, modificados) siguen pasando (Q3); no se admiten ficheros nuevos vacíos (git los emite sin hunks). Nada de esto se ha ejecutado en Actions.

**Ejecutabilidad de `verify` (medida).** En un clon limpio de la rama (sin `node_modules`), `node --experimental-test-module-mocks --test` falla 4 ficheros (`vite`, `vue-i18n`, `libphonenumber-js` ausentes). Con `npm ci --ignore-scripts --no-audit --no-fund` (lockfile congelado, sin scripts de ciclo de vida, sin credenciales; Node 22 por `setup-node` porque `mock.module` no existe en Node 20) pasan todas las pruebas. Eso es lo que hace el job; lo que se mide aquí es un clon limpio, no el árbol local con `node_modules`, y **no un runner de Actions**. El parche no puede cambiar los ficheros de dependencias (denegados), pero el lockfile es el del propio PR (misma confianza que su código).

**Prueba del paso del modelo sin credencial del repositorio** (`verify-model-sandbox.sh`, manual, consume 3 llamadas cortas de modelo `haiku` con la autenticación del entorno de pruebas; CLI 2.1.303). Observado en un repo desechable: (1) con flags por defecto, `.claude/settings.json` (hooks `SessionStart`/`UserPromptSubmit`) y `.mcp.json` **ejecutaron código** (marcadores creados); con `--setting-sources user --strict-mcp-config --disable-slash-commands`, ninguno. (2) Con `--allowedTools "Read,Glob,Grep,Edit(apps/web/src/**),Edit(tests/**)"` y `--disallowedTools Bash,…` solo se escribieron `apps/web/src/` y `tests/`; `README.md`, `.github/**`, `.claude/**`, `../fuera` y un fichero nuevo en la raíz se rechazaron, y `Bash` no se ejecutó. El CLI avisó de que las reglas `Write(ruta)` **no se evalúan** (solo `Edit(ruta)`, que cubre Write): el workflow usa solo `Edit(ruta)`. Además la acción restaura `.claude/`, `.mcp.json`, `CLAUDE.md` desde la rama base en PR (solo verificado leyendo su código; en `issue_comment` puede usar la rama equivocada). Límites: el CLI que empaqueta `claude-code-action` v1.0.242 puede diferir (repetir el script en el piloto); lo medido es el modelo `haiku`, con prompt cooperativo (no adversario); **denegar Bash no aísla la red del proceso**.

**Qué aísla y qué no (sin sobreprometer).** El código del PR **ya no se ejecuta** en el paso con la credencial del modelo: eso era el hallazgo P1. Lo que queda: el proceso del modelo conserva su token y sus herramientas permitidas (leer, y editar solo rutas permitidas). Mitigaciones: sin Bash/red declaradas, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, el único paso posterior es la subida del artefacto (acción fijada, sin secretos en su entorno), y el token de escritura vive en otro job. **No se garantiza** que la ausencia de Bash impida toda exfiltración o manipulación por otras vías de la herramienta o del runner ). Pendiente de **verificar en el piloto live** con el CLI de la acción: `Bash` denegado, rutas de `Edit` y no carga de config del PR (el script lo repite), y qué hay en el entorno/disco del paso. Opción para aislar la red del proceso del modelo: un runner con filtro de salida (`ubuntu-24.04-firewall`, el que usa el propio repositorio de la acción; depende del plan/cuenta, no verificado ni disponible aquí); sin ella, la salida de red del proceso no está restringida. Si no puede aislarse razonablemente la credencial con esta integración, el estado debe ser `BLOCKED` **antes** de pedirla; no se solicita hasta ese resultado.

## Autenticación y coste (nada creado ni leído)
- Placeholders: `CLAUDE_CODE_OAUTH_TOKEN` (suscripción; se genera con `claude setup-token` y queda atado a la suscripción de quien lo ejecuta) o `ANTHROPIC_API_KEY` (facturación por API; línea alternativa comentada en el workflow). La App de Claude instalada **no prueba** que haya credencial disponible en Actions.
- Consumo: minutos de Actions (repositorio público; se espera runner estándar sin coste según la documentación de GitHub, **no verificado**) y uso del modelo (suscripción: límites del plan; API: tokens). Cota técnica por PR: ≤2 ejecuciones del modelo (rondas) × 20 min × `--max-turns 15`, más `patch` (5 min), `verify` (10 min) y `publish` (10 min) por ronda, y ≤1 job `decide` de 5 min por comentario relevante.
- `timeout-minutes` y `--max-turns` **no son un límite monetario**. No se ha impuesto ni se afirma ningún tope en euros ni coste cero. Un límite de gasto del lado del proveedor (consola de API / límites del plan) debe comprobarse en la cuenta; si no existe, hay que decirlo antes de activar.

## Pasos de cuenta para activar (los hace el Owner tras auditar; yo no genero tokens ni cambio permisos)
1. Elegir autenticación y crear el secreto en *Settings → Secrets and variables → Actions* (`CLAUDE_CODE_OAUTH_TOKEN` o `ANTHROPIC_API_KEY`); en el workflow, usar la línea correspondiente.
2. Comprobar *Settings → Actions → General*: permisos de workflow por defecto = solo lectura; "Allow GitHub Actions to create and approve pull requests" desactivado.
3. Proteger `main` (sin push directo, revisión obligatoria): el código solo empuja la rama verificada del PR, pero `contents: write` no lo impide por sí solo.
4. Confirmar en Codex el ajuste de revisión (*Automatic review* / disparador) y el usuario/App esperados (`chatgpt-codex-connector`, id del bot y de la App en `policy.json`).
5. Autorizar copiar `candidate/agent-handoff.yml` a `.github/workflows/agent-handoff.yml` (PR aparte), crear la variable `AGENT_HANDOFF_ENABLED=true` solo cuando se quiera ejecutar.
6. Piloto live con un PR **sintético** habilitado con `/handoff enable`; criterio de aceptación: reseña con hallazgo → corrección empujada → nueva reseña → OWNER_REVIEW, sin copiar mensajes.

## Lo que NO se puede probar aquí
Ejecución real del workflow en Actions; entrega de eventos de Codex y su edición; que Codex responda a un comentario de bot; el id de `github-actions[bot]` (41898282, de memoria); `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`; `push` desde un checkout superficial; disponibilidad/cuota de credenciales y minutos; formato futuro del recibo de Codex (el controlador depende de `codex-review-receipt:v1`, `codex-code-review-finding:v1` y de "Didn't find any major issues"; si cambian, falla cerrado: sin acción).

## Pruebas offline
```sh
node --experimental-test-module-mocks --test tests/agent-handoff.test.mjs   # 40 pruebas; también entran en `node --test`
```
Cubren (además): paginación completa con un `stop` tras >1000 comentarios, techo sin truncado silencioso, interruptor apagado tras empezar la ronda (STOPPED, sin push, reanudable); huella del parche (sustituirlo por otro cambio permitido → no se publica; sin huella → no se publica), job `verify` sin subida, `npm ci --ignore-scripts`, flags de configuración del modelo; parche con ficheros nuevos permitidos que llegan al commit final, nuevos/borrados/symlinks fuera de lista rechazados, `.git`/`.gitattributes` del modelo inertes, `stop` publicado con la ronda en curso o interruptor apagado → sin push, `verify` fallido/omitido → `BLOCKED`, y el workflow sin shell en el job del modelo. Antes: hallazgo → corrección (push real a un remoto git local) → nueva revisión → OWNER_REVIEW; sin hallazgos; SHA antiguo, HEAD ajeno, emoji y eventos irrelevantes (cero llamadas a la API); impostores (login parecido, id/tipo/app distintos, estado falsificado/corrupto); fork, PR cerrada, base y referencias ambiguas; duplicados e idempotencia; dos rondas/errores/parche rechazado/push rechazado → BLOCKED; parada e interruptor; validación de parches; análisis estático del workflow (acciones fijadas, permisos, un solo secreto en el paso del modelo, sin `pull_request_target`/`allowed_bots: '*'`). No invocan modelos ni la red. Mutaciones comprobadas: quitar el SHA de HEAD, el límite de rondas, el permiso del Owner, el id del auditor, la deduplicación, el rechazo de forks o la lista de rutas denegadas hace fallar al menos una prueba; igual con ignorar `verify`, ignorar `stop` o no hacer `git add -A`. Las defensas de `.git` (omitirlo, `core.fsmonitor`, `--no-textconv`) son redundantes: solo quitarlas todas a la vez hace fallar B3.

Fuentes leídas: code.claude.com/docs/en/github-actions; código y `docs/security.md` de anthropics/claude-code-action (SHA 6c69018 y 5eb090f); learn.chatgpt.com/docs/third-party/github.

### Identidad de la petición de revisión

El job aislado `review` usa `CODEX_REVIEW_GITHUB_TOKEN` (PAT de un Owner de
`policy.json`, restringido a este repositorio, permiso Pull requests: read/write).
Se configura como secreto de Actions; nunca se coloca en el PR ni en los jobs
Claude, patch, verify o publish. El PAT solo identifica la cuenta y publica la
petición; las lecturas de estado usan el GITHUB_TOKEN de solo lectura del job.
No hay fallback a una petición con la identidad github-actions[bot].

Después de publicar, `publish` entrega el SHA al job `review`, que vuelve a
comprobar el HEAD, estado auténtico AWAITING_REVIEW, interruptor y órdenes stop.
Un Owner puede recuperar exclusivamente esa petición con `/handoff review`:
no modifica el parche, no ejecuta Claude ni consume otra ronda. La petición se
deduplica por PR, SHA e identidad del Owner. El límite de dos correcciones y la
parada en OWNER_REVIEW se mantienen. Si el secreto falta, caduca o su cuenta no
coincide, el job falla y el estado sigue pendiente; se renueva el secreto y se
repite la orden. Una solicitud aceptada no demuestra una revisión completada:
se requiere evidencia auténtica de Codex sobre ese mismo SHA.
