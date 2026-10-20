# Propuesta acotada: permiso para comentar en la PR sintética
Estado: NO ADOPTADA, NO APLICADA. No hay workflows instalados ni ejecución autorizada.

## Evidencia
Run 39389285739: precheck pasó, el único POST devolvió 403 y "Resource not accessible by integration".
El job tenía Issues:write y PullRequests:read.
La respuesta enumera "issues=write; pull_requests=write", con 4997 solicitudes del límite principal restantes.
El punto y coma enumera alternativas; no prueba que hagan falta ambos permisos.
No hay prueba de que el cambio propuesto resuelva el rechazo.

## Cambio concreto a decidir
El parche adjunto solo modifica el job send del candidato:
- contents:read se conserva.
- issues:write baja a issues:read.
- pull-requests:read sube a pull-requests:write.
Precheck, receive y observe conservan solo lectura.
No se añade PAT, GitHub App nueva, clave de Claude, permiso de contenido, secreto ni permiso de cuenta.
Esto ES un cambio de autoridad del token del job; no es equivalente a solo lectura y requiere aprobación explícita.

## Riesgo y límites
Pull-requests:write permite más operaciones de PR que comentar (por ejemplo modificaciones de PR).
El script de confianza solo realiza el POST previsto; no ejecuta código ni texto de la PR.
No afirmar que el scope técnico queda limitado a comentarios o a una sola PR.
El permiso solo existiría en el job send durante el piloto. No habilitarlo globalmente.
La corrección diagnóstica de #44 se conserva.

## Ejecución posterior, todavía NO autorizada
Tras aprobación: aplicar el parche, ajustar PB8/PB13 y PLAN.md a los permisos elegidos y auditar el commit final.
Solo después incorporar las copias de los workflows, crear PR sintética nueva y enviar UNA petición.
Si falla, conservar diagnóstico y detenerse sin otro intento. Si envía, comprobar Codex y la entrega a Actions por separado.
Retirar workflows, variable y PR sintética al terminar. #38, I4/D3, #31 y la aplicación siguen fuera.
No se necesita cambiar la configuración global "Workflow permissions" de GitHub ni dar permisos administrativos.

## Verificación de esta propuesta
Parche de dos líneas, preparado contra main 4b04c3e3d64f460fadbe793641d1c30d7b533065 y candidato blob dea69cc381fb4c65c8be9c3b29f859bacd794809.
No aplicado a ningún workflow ni candidato. Sin Actions, modelos, pruebas contra GitHub ni despliegue.
Fuentes:
https://docs.github.com/en/rest/issues/comments#create-an-issue-comment
https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#resource-not-accessible
