// Describe recorded provenance; configuration is not evidence of a historical method.
export function summarizeRecordedMethods(rows) {
 const counts={phone_otp:0,institutional_email_otp:0,qr:0,eid:0,unknown:0};
 for(const row of rows){const key=typeof row.verification_method==='string'&&Object.hasOwn(counts,row.verification_method)&&row.verification_method!=='unknown'?row.verification_method:'unknown';counts[key]++;}
 return {total:rows.length,counts,gps:rows.filter(r=>r.gps_confirmed===true).length,
  ip:rows.filter(r=>String(r.senales||'').split(',').map(s=>s.trim()).includes('ip')).length};
}
