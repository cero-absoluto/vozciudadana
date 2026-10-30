# Relevo Claude → Codex recuperado — 30/10/2026

Resultado observado a las 12:09 CET: la PR sintética #149 terminó en OWNER_REVIEW,
con revisión auténtica limpia de Codex sobre el commit que produjo Claude.
No se fusionó ni desplegó la PR del piloto. No se modificó producción.

## No se reconstruyó el sistema

El ciclo anterior ya estaba demostrado en PR #128, commit `4369d24d`, el 27/10.
S16 añadió una guardia de aprobación contra el commit completo del workflow, sin
registrar esa aprobación. Se conservaron controlador, publicador, autenticación,
límites de corrección, listas de rutas, tests/build y petición de revisión existentes.

Recuperación: PR #148, HEAD revisado `dfd9e0b78683ef8cc0d37ba87397a66671877ad4`,
fusión `6f024f7d91f21e1ccbc95b2a04478d902429bb73`.
Codex señaló una importación Python desde el árbol de la PR; se corrigió con `-I`
y un caso negativo reproducible antes de fusionar. Nueva revisión del HEAD: sin hallazgos.

La aprobación ahora usa la huella de los ocho archivos de control y se comprueba
antes de iniciar el modelo. Los checkouts de confianza fijan el commit real del
workflow. Cambiar documentación no invalida la aprobación; cambiar control/modelo sí.
Se añadieron límites de lectura, catálogo explícito de herramientas y rechazo de
symlinks/ruta reservada antes de entregar datos o autenticar el modelo.

## Evidencia del ciclo real

| Paso | Evidencia |
|---|---|
| Encargo autorizado | PR #149, comentario `6521158047`, `/handoff implement` |
| Base del piloto | `fc10115231217b00a9586b5f09df9d0fafc5ba62`, solo aceptación |
| Claude implementa | `tests/fixtures/handoff-recovery/add.mjs`, archivo que faltaba |
| Parche publicado por relevo | `5e6862e35e5d74f4111df10dac146cd2456c9e39` |
| Workflow completo | run `41045624656`, decide/claude/patch/verify/publish/review: success |
| Petición automática Codex | comentario autenticado Owner, marcador handoff-review-request del mismo SHA |
| Revisión Codex | completada sin hallazgos, SHA `5e6862e35e5d74f4111df10dac146cd2456c9e39` |
| Cierre del controlador | comentario de estado `6521161552`, OWNER_REVIEW a las 11:09:28Z |
| Correcciones utilizadas | 0 de un máximo de 2 |

El operador preparó la aceptación y autorizó el encargo. No escribió el módulo que
faltaba, no modificó el test para hacerlo pasar y no transportó manualmente la revisión
entre modelos. El diff final del piloto contiene únicamente aceptación y módulo sintético.

Validación adicional: 72 comprobaciones locales de coordinación/aprobación; batería
local 650 correctas y dos omitidas; piloto privado de acción fijada `41044420980`
correcto. Ese ensayo no utilizó secretos reales como canarios.

## Alcance

El relevo automático está operativo para tareas autorizadas dentro de su política
existente: `apps/web/src/` y `tests/`, implementación inicial y hasta dos correcciones.
Termina en OWNER_REVIEW o BLOCKED. El Owner conserva la decisión de fusión/publicación.
No se habilitaron API, SQL, dependencias, infraestructura o despliegues autónomos.
No se cambiaron automatizaciones horarias de ChatGPT ni credenciales de cuenta.

La aprobación es un registro versionado de confianza, no una firma externa ni una
barrera frente al administrador del repositorio. La protección obligatoria de rama
sigue siendo un pendiente de S15. Las pruebas no acreditan aislamiento absoluto de
red o proceso ni garantizan disponibilidad futura. El modelo consume la suscripción;
turnos y timeout no son un límite monetario.

Referencias:
- https://github.com/cero-absoluto/vozciudadana/pull/128
- https://github.com/cero-absoluto/vozciudadana/pull/148
- https://github.com/cero-absoluto/vozciudadana/pull/149
- https://github.com/cero-absoluto/vozciudadana/actions/runs/41045624656
