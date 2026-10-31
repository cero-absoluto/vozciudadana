# Estado de consulta del censo

Autorización vigente del Owner. Distinguir loading/present/absent/error y permitir iniciar censo solo tras ausencia acreditada; todos los fallos son reintentables sin asumir inexistencia. Mantener admisión, riesgos, saldo, cierres y lectura pública del censo. No API/SQL/dependencias/credenciales/vigilancia.

Microtarea SOLO TEMPLATE apps/web/src/screens/DetailScreen.vue; no script/styles/tests/locales. La coordinación implementará estos bindings: needsCensus booleancomputed, censusStatus stringloading/present/absent/error, censusBlocked boolean, loadCensus() con guardas.
1. Añadir después de .detail-hdr dentro de .d-scroll un párrafo id=detail-census-status v-if="needsCensus && !isClosed": rolealert enerror/status resto, texto traducido segúnestado con claves detail.censusLoading/censusPresent/censusAbsent/censusUnavailable. No rawerrors, no párrafo enfooter que agrande el pie.
2. Botón principal existente: cuando needsCensus&&censusStatus==='error', texto $t('detail.censusRetry'), enabled para consulta pública (aunque no haya saldo o ya unido); handler loadCensus() SOLO. Enresto conserva joinLabel/onJoin ydisabled anterior MÁS censusBlocked. No crear segundoCTA. Un reintento esGETmetadata, nofundación/OTP/adhesión.
3. Añadir detail-census-status a aria-describedby del botón principal cuando needsCensus, conservando riesgo/saldo. No cambiar avisos, jerarquía ni condicionescerradas.
4. No tocar los botonesseecenso secundarios ni rutas, onJoin, censoExiste oestadoScript. Rootpuedecompletarlo. Leerúnicamente esteSFC y editartemplate mínimo; máximo15turnos, sinred/shell/commits.
