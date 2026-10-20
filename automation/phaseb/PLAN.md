# Fase B (#41): prueba mínima bot → Codex → evento — plan de activación

**Estado: PREPARADO, INACTIVO.** Los workflows están en `automation/phaseb/candidate/` (fuera de `.github/workflows`). Nada de esto usa token ni modelo de Claude, ni inferencia; la prueba, cuando el Owner la autorice, consumiría **cuota de Codex (una revisión)** y **minutos de Actions**.

## Qué se mide (dos preguntas distintas)
- **A. ¿Atiende Codex un `@codex review` publicado por `github-actions[bot]`?** Se ve por API (recibo, review o reacción de Codex con el commit exacto).
- **B. ¿Llega a Actions, como evento, la respuesta de Codex?** Solo si el receptor registra un `RECEIVED_OK`.
Se pueden dar por separado: A sin B, B sin A (imposible sin respuesta), ni A ni B. Una reacción de Codex (👍) **no genera evento** de Actions.

## Qué se sabe y qué NO (no medido: solo puede medirse en vivo)
- Evidencia ya observada en este repo: Codex (usuario Bot id 199175422, App 1144995) publica el recibo como `issue_comment` (marcador `codex-review-receipt:v1`, «Reviewed commit»), reviews (`pull_request_review`, `commit_id`) y una reacción; su App está suscrita a `issue_comment` y `pull_request_review`. En lo observado, siempre respondió a comentarios de usuarios, **nunca a uno de un bot**.
- Documentado por GitHub (no verificado aquí): los eventos creados con `GITHUB_TOKEN` no inician workflows (salvo dispatch). Eso afecta a la entrega *hacia Actions* solo si el autor fuese `GITHUB_TOKEN`; los eventos de Codex los crea una App.
- **No medido:** (1) si Codex atiende menciones de un bot; (2) si sus eventos disparan el receptor; (3) si `issues: write` basta para comentar en una PR con el token automático. No se afirma entrega ni coordinación operativa antes del resultado.

## Mecanismo (`automation/phaseb/phaseb.mjs`)
- **plan/send** (`phase-b-send.yml`, manual, solo `main`): la PR debe ser del Owner, abierta, rama `phaseb/*`, mismo repo, base `main`, cabeza = `expected_head_sha` y **un único fichero añadido** `automation/phaseb-synthetic/probe.txt`; sin comentarios previos de Codex, sin `@codex` previo ni petición previa; sin re-ejecuciones. `send` revalida y publica **una** petición con marcador `phaseb-request:v1 sha=… run=…`. **Sin reintentos**: ante 4xx/5xx/red no repite (el 5xx queda «desconocido» para comprobar a mano). Registra id, hora y autor real del comentario.
- **receive** (`phase-b-receive.yml`, eventos `issue_comment` created/edited y `pull_request_review` submitted): filtro temprano en el `if:` (repo, `vars.PHASEB_PR`, es PR, autor Bot id 199175422) y repetido en el script. Solo lectura; el evento es **dato** (`GITHUB_EVENT_PATH`), nada se interpola en `run:`; checkout de `main`, nunca de la PR. Correlaciona: petición válida única de `github-actions[bot]`, cabeza sin cambios, recibo/review **posterior** a la petición (≤ 30 min), commit exacto, y **primer** evento correlacionado (deduplicación). Registra `event_id`, `request_comment_id`, SHA y `run_id`. No comenta ni lanza modelos.
- **observe** (`workflow_dispatch`, solo Owner): lectura independiente por API de comentarios, reviews, inline y reacciones de Codex tras la petición.
- Resultados del receptor: `RECEIVED_OK`, `RECEIVED_EDIT`, `DUPLICATE`, `UNCORRELATED` (con causa), `IGNORED`. Recibos o eventos anteriores, de otro commit o de otra PR **nunca** cuentan como éxito.

## PR sintética propuesta (una sola; NO creada)
Rama `phaseb/synthetic-probe` desde `main`, PR borrador del Owner, un fichero `automation/phaseb-synthetic/probe.txt` con una línea inocua, head exacto fijado en `expected_head_sha`, **sin merge**; se cierra al terminar.

## Permisos
Global `permissions: {}`. `precheck` y `receive`/`observe`: `contents`, `issues`, `pull-requests` = read. `send`: `contents: read` + **`issues: write`** (único job que escribe). Sin `contents: write`, secretos, `id-token`, credencial de Claude ni `pull_request_target`. Tiempo máximo 5 min por job. Limitación: en `pull_request_review` GitHub toma el fichero del workflow de la PR; por eso la PR solo puede contener el fichero inocuo (el emisor lo exige y el receptor lo reverifica).

## Activación (cada paso requiere autorización expresa del Owner)
1. Incorporar a `.github/workflows/` copias idénticas de los dos candidatos (PR del auditor). 2. Crear la PR sintética y fijar su head. 3. Definir la variable `PHASEB_PR` con su número. 4. Disparar `phase-b-send` (`main`, `pr_number`, `expected_head_sha`). 5. Esperar hasta 30 min sin repetir. 6. Disparar `phase-b-receive` en modo observe. 7. El auditor lee los registros y concluye con la matriz A/B.
**Consumo estimado:** 1 revisión de Codex; Actions ≈ 2 jobs de envío + 1 job por evento recibido + 1 observe (≈ 5–8 minutos facturados).

## Retirada / parada
Borrar `PHASEB_PR` (el receptor deja de coincidir al instante) → deshabilitar o borrar ambos workflows → cerrar sin fusionar la PR sintética y borrar su rama. Los artefactos caducan a los 7 y 14 días. Si falla algo: parar, sin repetir.
