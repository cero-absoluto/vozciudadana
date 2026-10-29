// Preserve the 31 August midnight boundary, but always choose a future UTC year.
export function nextInstitutionalExpiry(now=Date.now()) {
 const instant=new Date(now);
 if(!Number.isFinite(instant.getTime()))throw new TypeError('Invalid institutional clock');
 const year=instant.getUTCFullYear();
 const boundary=Date.UTC(year,7,31);
 return new Date(instant.getTime()<boundary?boundary:Date.UTC(year+1,7,31)).toISOString();
}
