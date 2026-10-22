# proxy-probe — diagnóstico temporal (NO ejecutado)

Estado: preparado, **sin servicio creado, sin pruebas contra Railway y sin coste**. Ejecutar exige autorización expresa del Owner de: creación, uso acotado, coste y retirada del recurso temporal.

## Qué es
Servicio Node sin dependencias (`server.js`). Sin base de datos, variables, secretos, SMS, geolocalización, registro de peticiones por la aplicación ni datos del proyecto. No toca `apps/api` ni #31 (watchPatterns de la API: `/apps/api/**`).

`GET /probe?m=<marcador>` + cabecera opcional `X-Probe-Ref: <IP de salida del cliente de prueba>`. Devuelve solo: `peerClass`, `xffLength`, `xffFirstIsMarker`, `xffLastIsMarker`, `xffContainsMarker`, `refPresent`, `xffLastIsClientRef`, `classification`, `oneHopJustified`, `xRealIpPresent`, `xRealIpIsMarker`, `xRailwayEdgePresent`. Nunca IPs ni cabeceras; la referencia solo produce un booleano y no se devuelve ni se registra. Marcador y referencia: solo hex/`.`/`:`. `GET /health`.

## Peticiones sintéticas
Por dominio autorizado (`$H`); `$MI_IP` es la IP de salida de quien prueba, conocida por él. **Nunca poner `$MI_IP` en `X-Forwarded-For`** (solo marcadores de documentación), o un borde que no toque la cabecera daría una justificación falsa.
```
curl -s -H "X-Probe-Ref: $MI_IP" "https://$H/probe?m=192.0.2.1"                                   # 1 normal
curl -s -H "X-Probe-Ref: $MI_IP" -H "X-Forwarded-For: 192.0.2.1" "https://$H/probe?m=192.0.2.1"   # 2 una entrada
curl -s -H "X-Probe-Ref: $MI_IP" -H "X-Forwarded-For: 192.0.2.1, 198.51.100.7" "https://$H/probe?m=192.0.2.1"  # 3 dos entradas
```
Previstas ≤ 10 peticiones por dominio.

## Criterio de éxito (conclusión limitada)
Un salto queda **justificado para esa ruta y ese momento** solo si `oneHopJustified=true`: peer interno, `xffLength=1` y esa única entrada coincide con la IP de salida conocida (`xffLastIsClientRef`), en las peticiones 1, 2 y 3. Que desaparezca el marcador no basta.

| `classification` | Lectura |
|---|---|
| `header_absent_or_removed` (0 entradas) | **No es éxito.** Con un salto la API identificaría al proxy como cliente. |
| `single_entry_matches_client` | Compatible con un salto. |
| `single_entry_not_client` | Una entrada que no es el cliente (valor reemplazado, otro proxy, sin tocar con marcador): no justifica. |
| `chain_observed` (≥ 2 entradas) | Se informa la cadena (`xffLength`, `xffFirstIsMarker`, `xffLastIsMarker`, `xffLastIsClientRef`); no se da un salto por justificado. Un borde que añade la IP del cliente al final puede ser compatible con #31 (lee la última entrada), pero no es fallo automático ni éxito automático: lo decide una persona. |
| `reference_missing` | Sin referencia no se concluye nada. |

Si `peerClass=public` no se justifica nada (#31 no confiaría en la cabecera, fail-closed). No garantiza otras rutas ni estabilidad futura; no distingue un borde que sobrescribe de un único proxy transparente que ya recibió la IP correcta: solo prueba que la entrada que usaría #31 es la del cliente.

## Controles locales (`npm test`, 14 pruebas)
Bordes sintéticos con direcciones de origen distintas por salto: sobrescribe, añade, elimina, reemplaza por otro valor, passthrough, dos proxies con marcador eliminado y dos proxies que sustituyen. Todos deben dar `oneHopJustified=false` salvo el único salto que sobrescribe con la IP real; la respuesta no contiene IPs. Una prueba documenta el límite del uso indebido de la referencia en XFF.

## Recursos, tiempo y facturación
Un servicio Railway aparte (o proyecto desechable), una réplica, sin variables, volumen, base de datos ni proxy TCP; dominio generado por Railway. Raíz del servicio `diagnostics/proxy-probe`; fuente: esta rama.

**El tope de 300 peticiones a `/probe` (responde 410) no detiene el proceso ni su facturación**: el servicio sigue en marcha y facturando hasta que se elimine. No es un límite monetario. El límite real es operativo: tiempo máximo acordado y retirada ejecutada y comprobada. Coste orientativo (ChatGPT, docs.railway.com/pricing/plans): cómputo y egress por uso; no es cotización de factura ni garantiza gasto adicional cero; no se cambia plan ni límites del workspace.

## Registros
La aplicación no genera registros de peticiones ni los escribe en disco. Eso no excluye registros que genere Railway (logs HTTP, métricas, logs de despliegue y de build, incluida la URL de las peticiones): no se promete ausencia de registros de plataforma. Por eso la referencia va en cabecera y no en la URL.

## Retirada (a comprobar expresamente, no presumir)
1. Eliminar el servicio (y el proyecto si era desechable).
2. Comprobar en Railway y anotar: servicio y despliegues inexistentes o detenidos, dominio generado liberado, sin variables ni volúmenes, y que `@vozciudadana/api` no cambió ni redesplegó.
3. Comprobar que no hay uso facturable posterior en el panel de uso.
4. Cerrar esta PR sin fusionar y borrar la rama.
