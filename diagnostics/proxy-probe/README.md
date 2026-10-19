# proxy-probe — diagnóstico temporal (NO ejecutado)

Estado: preparado, **sin servicio creado y sin coste**. Ejecutar exige autorización expresa del Owner tras la comprobación de opciones y coste por ChatGPT.

## Qué es
Servicio Node sin dependencias (`server.js`, ~70 líneas). Sin base de datos, variables, secretos, SMS, geolocalización, registro de peticiones ni datos del proyecto. No toca `apps/api` (watchPatterns de la API: `/apps/api/**`, no se dispara su despliegue).

`GET /probe?m=<marcador>` devuelve solo: `peerClass` (loopback/cgnat/private/link_local/public), `xffLength`, `xffFirstIsMarker`, `xffLastIsMarker`, `xffContainsMarker`, `xRealIpPresent`, `xRealIpIsMarker`, `xRailwayEdgePresent`. Nunca IPs ni cabeceras. El marcador debe ser hex/`.`/`:` (se usan IPs de documentación, sin valor real). `GET /health`. Tras 300 peticiones a `/probe` responde 410 (presupuesto fijo).

## Peticiones sintéticas
Por cada dominio autorizado (`$H`): dominio Railway y, solo si se autoriza, una ruta equivalente a la de producción.
```
curl -s "https://$H/probe?m=192.0.2.1"                                   # 1 normal
curl -s -H "X-Forwarded-For: 192.0.2.1" "https://$H/probe?m=192.0.2.1"   # 2 XFF de 1 entrada
curl -s -H "X-Forwarded-For: 192.0.2.1, 198.51.100.7" "https://$H/probe?m=192.0.2.1"  # 3 XFF de 2 entradas
```
Total previsto: ≤ 10 peticiones por dominio (límite duro 300).

## Criterio de éxito
- Petición 1: `peerClass` en {cgnat, private, loopback} (el peer es el proxy; coherente con los 31/31 de CGNAT ya observados) y `xffLength` registrado (0 o 1).
- Peticiones 2 y 3, con `xffFirstIsMarker=false` y `xffContainsMarker=false` → el borde **sobrescribe** XFF: el valor del cliente no llega; `TRUST_PROXY_HOPS=1` queda justificado para esa ruta.
- Si `xffFirstIsMarker=true` en 3 → el borde **añade**: la entrada izquierda es controlable; con 1 salto debe leerse la última, no la primera (revisar #31 antes de fusionar).
- Si `peerClass=public` → el peer no es interno; la función de confianza de #31 no confiaría en XFF (fail-closed) y habría que revisar.
- Resultado válido solo para esas rutas y ese momento; no garantiza otras rutas ni estabilidad futura.

## Recursos
Un servicio Railway en un proyecto aparte (o en uno desechable, a decidir por ChatGPT/Owner), una réplica, sin variables, volumen, base de datos ni proxy TCP; un dominio generado por Railway. Raíz del servicio `diagnostics/proxy-probe`; fuente: esta rama (no `main`). Coste estimado: ChatGPT lo comprueba antes de pedir autorización; yo no lo he consultado ni creado nada.

## Retirada
1. Eliminar el servicio (y el proyecto si era desechable) en Railway.
2. Confirmar que no quedan dominio, variables ni despliegues activos, y que el servicio `@vozciudadana/api` no ha cambiado.
3. Cerrar esta PR sin fusionar y borrar la rama.
