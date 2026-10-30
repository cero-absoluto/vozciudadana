# IDV-04 — publicación y comprobación

Publicado y verificado el 30/10/2026 a las 14:55 CET. El Owner autorizó completar
los pasos rutinarios sin nuevas aprobaciones individuales. OTP real sigue aplazado.

## Resultado

GPS no fabrica corroboración IP. Los errores HTTP/JSON y países mal formados no
añaden la señal IP. El servicio institucional transmite país a la RPC solamente
cuando existe evidencia IP confirmada. La función SQL institucional registra 85 y
email_otp,ip con país IP válido; sin él, 75 y email_otp. Son índices internos, no
probabilidades calibradas. Se conservan OTP, reglas de admisión/censo y fundador.
No se reescriben históricos ni se añaden consultas IP cuando GPS ya ha resuelto.

| Componente | Referencia | Comprobación |
|---|---|---|
| PR | https://github.com/cero-absoluto/vozciudadana/pull/151 | Fusionada |
| Candidato final | `55fef20bb380c1e3e147dd3355b02efc3860b0e6` | Árbol `bc418adca0246ddcfc37702df21364760b0fb6a7`, igual al validado localmente |
| Codex | Revisión terminada 13:53:16Z sobre ese SHA | Sin hallazgos ni pendientes |
| Fusión | `26e59944aba29090aba64169f48458f53a95eeb1` | Commit publicado |
| API Railway | `bc9e0c1c-d737-4cd7-8c1e-1d1a99d2bde0` | SUCCESS 13:54:19Z, commit de fusión coincidente |
| SQL | Migración `idv04_institutional_evidence_score` | Aplicación correcta y lectura posterior coincidente |

Función existente `verify_institutional_challenge_and_create_adhesion`, misma firma:
MD5 anterior `51bc6c14aa8d5127a7467681b3bd844d`; observado tras aplicar
`d8e31ef25d9fba467752dc9f9ae911e4`. Propietario postgres; SECURITY INVOKER;
ACL `{postgres=X/postgres,service_role=X/postgres}`, sin cambios. La reversión
está versionada y ensayada, pero no se ejecutó en producción.

## Evidencia

- 683 pruebas generales correctas; dos omitidas. Incluyen ocho casos del contrato
  institucional/fundador; 20 pruebas adicionales de rutas/servicio correctas.
- Política estática de dependencias correcta; check CI dependency-policy correcto.
- PostgreSQL16.2 desechable privado, run41066568545:13 grupos correctos: matriz de
  país, permisos, OTP/reintentos/replay, rollback ante rechazo, censo, fundador,
  acreditado, controles negativos de deriva y reversión/reaplicación.
- Un ensayo previo falló por generación incorrecta del candidato SQL. Se corrigió
  antes de producción; runs41065795613 y41066568545 terminaron correctamente.
- Revisión privada Claude run41066038598: sin críticos/altos ni regresiones concretas.
  Se atendieron las observaciones de contrato, pruebas de deriva, reversión y
  documentación; Codex revisó después el SHA final sin hallazgos. Claude no ejecutó
  pruebas ni comparó íntegramente las definiciones JSON cuya lectura quedó truncada.
- Verificador de permisos/RLS a las13:54:08Z: cero desviaciones, metadatos solamente.
- Salud/CSP pública a las13:55:04Z:11/11. Railway: una réplica online, cero fallos
  recientes y sin cambios pendientes.

## Límites

Cambio de API/SQL, sin cambios del código web, sin pruebas OTP/proveedores reales,
lectura de filas personales, secretos o modificación de vigilancias. La base
sintética mínima no reproduce toda la configuración real ni certifica RLS global.
Las comprobaciones de producción fueron de metadatos y endpoints públicos.

IDV-04 queda corregido para nuevas operaciones de estas rutas. Históricos,
calibración/afirmaciones públicas del índice, refuerzo basado en señales antiguas
y agregados por métodos siguen explícitos en la fase IDV-07/11/12. Los llamadores
SQL privilegiados mantienen la responsabilidad de aportar procedencia válida.
