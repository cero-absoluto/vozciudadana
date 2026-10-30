import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {parseGpsGeocoderResponse} from '../apps/api/src/lib/gpsGeocoder.js';
import {resolveLocationEvidence} from '../apps/api/src/lib/locationEvidenceService.js';
const valid={osm_id:123,address:{city:'Synthetic',country_code:'es'}};
for(const body of [null,[],{}, {error:'Unavailable'}, {address:[]}, {address:{city:'Synthetic'}}, {address:{country_code:'es'}}, {address:{country_code:'es',city:{bad:true}}}, {address:{country_code:'esp',city:'Synthetic'}}]) test('reject malformed geographic response '+JSON.stringify(body),async()=>{
 await assert.rejects(parseGpsGeocoderResponse({ok:true,json:async()=>body},'local'));
});
test('HTTP error cannot confirm GPS despite a plausible body',async()=>{
 await assert.rejects(parseGpsGeocoderResponse({ok:false,json:async()=>valid},'local'));
});
test('valid locality and region responses; malformed OSM is not accepted',async()=>{
 assert.equal((await parseGpsGeocoderResponse({ok:true,json:async()=>valid},'local')).pais_code,'ES');
 const result=await parseGpsGeocoderResponse({ok:true,json:async()=>({osm_id:'123bad',address:{state:'Synthetic',country_code:'es'}})},'regional');
 assert.equal(result.region,'Synthetic');assert.equal(result.adhesion_osm_id,null);
});
test('initial admission degrades to no GPS after provider error',async()=>{
 const f=mock.method(globalThis,'fetch',async()=>({ok:false,json:async()=>valid}));
 try {const result=await resolveLocationEvidence({latitude:40,longitude:-3,ip:null,scope:'local'});assert.equal(result.gps_confirmed,false);assert.equal(result.adhesion_osm_id,null);assert.equal(result.pais_code,null);}finally{f.mock.restore();}
});
test('initial admission falls back to IP without confirming GPS',async()=>{
 const f=mock.method(globalThis,'fetch',async url=>String(url).includes('nominatim')?{ok:true,json:async()=>({error:'Unavailable'})}:{ok:true,json:async()=>({city:'Synthetic IP',country_code:'es'})});
 try {const result=await resolveLocationEvidence({latitude:40,longitude:-3,ip:'8.8.8.8',scope:'local'});assert.equal(result.gps_confirmed,false);assert.equal(result.ciudad,'Synthetic IP');assert.equal(result.pais_code,'ES');assert.equal(f.mock.callCount(),2);}finally{f.mock.restore();}
});

test('IDV-04 valid GPS does not manufacture IP corroboration',async()=>{
 const f=mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>valid}));
 try {const result=await resolveLocationEvidence({latitude:40,longitude:-3,ip:'8.8.8.8',scope:'local'});assert.equal(result.gps_confirmed,true);assert.equal(result.ip_country_confirmed,false);assert.equal(f.mock.callCount(),1);}finally{f.mock.restore();}
});
for(const response of [{ok:false,json:async()=>({country_code:'ES'})},{ok:true,json:async()=>({error:true,country_code:'ES'})},{ok:true,json:async()=>({country_code:123})},{ok:true,json:async()=>({country_code:'ESP'})}]) test('IDV-04 unusable IP response does not add IP evidence',async()=>{
 const f=mock.method(globalThis,'fetch',async()=>response);
 try {const result=await resolveLocationEvidence({ip:'8.8.8.8',scope:'global'});assert.equal(result.ip_country_confirmed,false);}finally{f.mock.restore();}
});
test('IDV-04 successful IP country is marked with its real provenance',async()=>{
 const f=mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({country_code:'ES'})}));
 try {const result=await resolveLocationEvidence({ip:'8.8.8.8',scope:'global'});assert.equal(result.gps_confirmed,false);assert.equal(result.ip_country_confirmed,true);}finally{f.mock.restore();}
});
