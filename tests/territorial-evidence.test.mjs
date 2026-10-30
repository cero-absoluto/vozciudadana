import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesDeclaredTerritory,geographicBreakdown} from '../apps/api/src/lib/territorialEvidence.js';
const protest={scope:'local',country:'ES',convocatoria_ciudad_nombre:'Synthetic',convocatoria_osm_id:123};
test('different-country homonym and equal untyped OSM ID cannot confirm locality',()=>{
 assert.equal(matchesDeclaredTerritory(protest,{gps_confirmed:true,ciudad:'Synthetic',pais_code:'FR',adhesion_osm_id:123}),false);
 assert.equal(matchesDeclaredTerritory(protest,{gps_confirmed:true,ciudad:'Elsewhere',pais_code:'ES',adhesion_osm_id:123}),false);
});
test('unknown country remains unknown and five cohorts form an exhaustive partition',()=>{
 const rows=[{gps_confirmed:true,ciudad:'Synthetic',pais_code:'ES'},{gps_confirmed:true,ciudad:'Elsewhere',pais_code:'ES'},{gps_confirmed:false,pais_code:'ES'},{gps_confirmed:true,ciudad:'Synthetic',pais_code:'FR'},{gps_confirmed:false}];
 const result=geographicBreakdown(protest,rows);
 for(const key of ['gps_local','gps_nacional','nacionales_sin_gps','internacionales','sin_pais'])assert.equal(result[key],1,key);
 assert.equal(result.total,5);
});
test('regional comparison uses the region, not the municipality',()=>{
 assert.equal(matchesDeclaredTerritory({...protest,scope:'regional'},{gps_confirmed:true,ciudad:'Synthetic',region:'Elsewhere',pais_code:'ES'}),false);
});

test('missing place names never prove local agreement, even with same country and numeric OSM id',()=>{
 const a={gps_confirmed:true,pais_code:'ES',adhesion_osm_id:123};
 assert.equal(matchesDeclaredTerritory(protest,a),false);
 assert.equal(geographicBreakdown(protest,[a]).gps_nacional,1);
});
for(const code of [null,'','ES\n','es','ESP','ÉS'])test('unusable country stays unknown: '+JSON.stringify(code),()=>{
 const r=geographicBreakdown(protest,[{gps_confirmed:true,ciudad:'Synthetic',pais_code:code}]);assert.equal(r.sin_pais,1);assert.equal(r.gps_local,0);
});
test('country-known rows with an unknown target country are not silently domestic',()=>{
 const r=geographicBreakdown({...protest,country:null},[{gps_confirmed:false,pais_code:'ES'}]);assert.equal(r.sin_pais,1);
});

test('accent, case and repeated whitespace normalization preserves meaningful qualifiers',()=>{
 assert.equal(matchesDeclaredTerritory({...protest,convocatoria_ciudad_nombre:'San José'},{gps_confirmed:true,ciudad:'  SÁN   jose  ',pais_code:'ES'}),true);
 assert.equal(matchesDeclaredTerritory(protest,{gps_confirmed:true,ciudad:'Synthetic, Other Region',pais_code:'ES'}),false);
});
