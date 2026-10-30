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
