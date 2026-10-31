export function summarizeStoredIndex(rows) {
 const counts={alta:0,media:0,base:0,baja:0,sin_dato:0};
 for(const {fiabilidad:value} of rows){
  if(!Number.isInteger(value)||value<0||value>100)counts.sin_dato++;
  else if(value>=85)counts.alta++;
  else if(value>=75)counts.media++;
  else if(value>=60)counts.base++;
  else counts.baja++;
 }
 return counts;
}
