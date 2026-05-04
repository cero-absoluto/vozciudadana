import * as d3 from 'd3';
import * as topojson from 'topojson-client';


// ══════════════════════════════════════════════
//  GEOGRAPHIC REGIONS
// ══════════════════════════════════════════════
const REGIONS = {
  eu:      {name:'Unión Europea',icon:'🇪🇺',members:['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'],prefixes:['+43','+32','+359','+385','+357','+420','+45','+372','+358','+33','+49','+30','+36','+353','+39','+371','+370','+352','+356','+31','+48','+351','+40','+421','+386','+34','+46']},
  mercosur:{name:'MERCOSUR',icon:'🌎',members:['AR','BR','PY','UY','VE','BO'],prefixes:['+54','+55','+595','+598','+58','+591']},
  asean:   {name:'ASEAN',icon:'🌏',members:['BN','KH','ID','LA','MY','MM','PH','SG','TH','VN'],prefixes:['+673','+855','+62','+856','+60','+95','+63','+65','+66','+84']},
  latam:   {name:'América Latina',icon:'🌎',members:['MX','CO','PE','CL','EC','VE','CU','GT','HN','SV','NI','CR','PA','BO','PY','UY','AR','BR'],prefixes:['+52','+57','+51','+56','+593','+58','+53','+502','+504','+503','+505','+506','+507','+591','+595','+598','+54','+55']},
  g20:     {name:'G20',icon:'🌐',members:['AR','AU','BR','CA','CN','FR','DE','IN','ID','IT','JP','KR','MX','RU','SA','ZA','TR','GB','US'],prefixes:['+54','+61','+55','+1','+86','+33','+49','+91','+62','+39','+81','+82','+52','+7','+966','+27','+90','+44','+1']},
};

// ══════════════════════════════════════════════
//  SIMULATED DEVICE (en producción: detectado automáticamente)
// ══════════════════════════════════════════════
const DEVICE = {
  simPrefix:'+34', simCountry:'ES', simName:'España',
  ipCountry:'ES',  ipCity:'Madrid',
  docCountry:null, // se rellena si aporta DNI
  confidence: 75,  // SIM(40%) + IP(35%) = 75% sin documento
};

function calcConf() {
  let s = 40 + 35; // SIM + IP always present
  if (DEVICE.docCountry) s = 100;
  return s;
}

function myRegions() {
  return Object.entries(REGIONS).filter(([k,r])=>r.members.includes(DEVICE.simCountry)).map(([k])=>k);
}

function inRegion(regionKey, country) {
  return REGIONS[regionKey]?.members.includes(country) || false;
}

function scopeBadgeHtml(p) {
  if(p.scope==='national') return `<span class="scope-badge sb-national">🏛️ ${p.countryName}</span>`;
  if(p.scope==='regional') return `<span class="scope-badge sb-regional">🌐 ${REGIONS[p.region]?.name||'Regional'}</span>`;
  return `<span class="scope-badge sb-global">🌍 Global</span>`;
}

// Can this device join this protest?
function canJoin(p) {
  // Already joined
  if(p.joined) return {ok:false, joined:true};

  // DEVICE LOCK: check if already in a protest of same scope-category
  if(p.scope==='national') {
    const active = PROTESTS.find(x=>x.scope==='national'&&x.joined&&x.id!==p.id);
    if(active) return {ok:false, lock:true, msg:`Tu dispositivo ya está adherido a "${active.title}" (${fmtTime(active.timer)} restante). Debes esperar a que finalice.`};
  }
  if(p.scope==='regional') {
    const active = PROTESTS.find(x=>x.scope==='regional'&&x.region===p.region&&x.joined&&x.id!==p.id);
    if(active) return {ok:false, lock:true, msg:`Tu dispositivo ya está adherido a una convocatoria del bloque ${REGIONS[p.region]?.name}.`};
  }
  // Global: only one active global at a time
  if(p.scope==='global') {
    const active = PROTESTS.find(x=>x.scope==='global'&&x.joined&&x.id!==p.id);
    if(active) return {ok:false, lock:true, msg:`Tu dispositivo ya está adherido a una convocatoria global: "${active.title}".`};
  }

  // GEO CHECK
  if(p.scope==='national') {
    if(DEVICE.simCountry !== p.country) return {ok:false, geo:true, msg:`Esta convocatoria es exclusivamente para ciudadanos de ${p.countryName}. Tu SIM e IP apuntan a ${DEVICE.simName}.`};
    const conf = calcConf();
    if(conf < 60) return {ok:false, geo:true, msg:`Confianza geográfica insuficiente (${conf}%). Aporta tu documento de identidad para alcanzar el umbral mínimo del 60%.`};
  }
  if(p.scope==='regional') {
    if(!inRegion(p.region, DEVICE.simCountry)) return {ok:false, geo:true, msg:`Esta convocatoria es para miembros de ${REGIONS[p.region]?.name}. Tu país (${DEVICE.simName}) no pertenece a este bloque.`};
    const conf = calcConf();
    if(conf < 40) return {ok:false, geo:true, msg:`Confianza geográfica insuficiente (${conf}%). Se requiere mínimo 40% para convocatorias regionales.`};
  }
  // Global: no geo restriction
  return {ok:true};
}

// ══════════════════════════════════════════════
//  DATA
// ══════════════════════════════════════════════
// HEAT se calcula dinámicamente SOLO desde convocatorias reales en PROTESTS
// Ningún país tiene color ni punto si no tiene una convocatoria activa
function buildHeatMap(){
  const h={};
  PROTESTS.forEach(p=>{
    if(!p.country||p.scope==='global') return;
    // Convertir alpha-2 a ISO numérico para pintar el mapa
    const numIso=Object.entries(ISO_NUM_TO_A2).find(([k,v])=>v===p.country)?.[0];
    if(numIso) h[numIso]=p.heat;
  });
  return h;
}
// Se recalcula cada vez que se necesita
function getHeat(iso){ return buildHeatMap()[iso]||0; }
const COORDS={'724':[-3.7,40.4],'862':[-66.9,10.5],'364':[53.7,32.4],'250':[2.3,46.2],'484':[-102,23.6],'643':[37.6,55.7],'792':[35.2,38.9],'112':[28,53.7],'276':[10.4,51.2],'380':[12.5,41.9],'840':[-100,38],'076':[-47,-15],'356':[78.9,20.6],'156':[104,35.9],'410':[127.7,35.9],'360':[113.9,-0.8],'566':[8.7,9.1],'710':[25.1,-29],'818':[30.8,26.8],'682':[45.1,23.9]};

// Mapa ISO numérico (TopoJSON) → código alpha-2 — COMPLETO (195 países)
const ISO_NUM_TO_A2 = {
  '004':'AF','008':'AL','012':'DZ','016':'AS','020':'AD','024':'AO','028':'AG',
  '032':'AR','036':'AU','040':'AT','031':'AZ','044':'BS','048':'BH','050':'BD',
  '052':'BB','112':'BY','056':'BE','084':'BZ','204':'BJ','064':'BT','068':'BO',
  '070':'BA','072':'BW','076':'BR','096':'BN','100':'BG','854':'BF','108':'BI',
  '116':'KH','120':'CM','124':'CA','132':'CV','140':'CF','144':'LK','148':'TD',
  '152':'CL','156':'CN','170':'CO','174':'KM','180':'CD','178':'CG','188':'CR',
  '384':'CI','191':'HR','192':'CU','196':'CY','203':'CZ','208':'DK','262':'DJ',
  '212':'DM','214':'DO','626':'TL','218':'EC','818':'EG','222':'SV','226':'GQ',
  '232':'ER','233':'EE','231':'ET','238':'FK','242':'FJ','246':'FI','250':'FR',
  '266':'GA','270':'GM','268':'GE','276':'DE','288':'GH','300':'GR','308':'GD',
  '320':'GT','324':'GN','624':'GW','328':'GY','332':'HT','340':'HN','348':'HU',
  '356':'IN','360':'ID','364':'IR','368':'IQ','372':'IE','376':'IL','380':'IT',
  '388':'JM','392':'JP','400':'JO','398':'KZ','404':'KE','296':'KI','410':'KR',
  '408':'KP','414':'KW','417':'KG','418':'LA','428':'LV','422':'LB','426':'LS',
  '430':'LR','434':'LY','438':'LI','440':'LT','442':'LU','807':'MK','450':'MG',
  '454':'MW','458':'MY','462':'MV','466':'ML','470':'MT','584':'MH','478':'MR',
  '480':'MU','484':'MX','583':'FM','498':'MD','492':'MC','496':'MN','504':'MA',
  '508':'MZ','516':'NA','520':'NR','524':'NP','528':'NL','554':'NZ','558':'NI',
  '562':'NE','566':'NG','578':'NO','512':'OM','586':'PK','585':'PW','275':'PS',
  '591':'PA','598':'PG','600':'PY','604':'PE','608':'PH','616':'PL','620':'PT',
  '634':'QA','642':'RO','643':'RU','646':'RW','659':'KN','662':'LC','670':'VC',
  '882':'WS','674':'SM','678':'ST','682':'SA','686':'SN','694':'SL','703':'SK',
  '705':'SI','090':'SB','706':'SO','710':'ZA','724':'ES','144':'LK','729':'SD',
  '740':'SR','748':'SZ','752':'SE','756':'CH','760':'SY','762':'TJ','764':'TH',
  '768':'TG','776':'TO','780':'TT','788':'TN','792':'TR','795':'TM','798':'TV',
  '800':'UG','804':'UA','784':'AE','826':'GB','840':'US','858':'UY','860':'UZ',
  '548':'VU','862':'VE','704':'VN','887':'YE','894':'ZM','716':'ZW','191':'HR',
  '076':'BR','036':'AU','031':'AZ','050':'BD','070':'BA',
};

const PROTESTS = [
  {id:1,title:'Contra la corrupción del gobierno',country:'ES',countryName:'España',scope:'national',region:null,count:187432,heat:95,timer:6840,color:'#ff2020',cities:284,desc:'Denunciamos la corrupción sistémica. Exigimos transparencia total y fin de la impunidad.',demands:'Que dimita el presidente · Que se abra una investigación independiente · Que se publiquen todos los contratos públicos · Fin de la impunidad inmediatas en respuesta a esta convocatoria ciudadana.',joined:false},
  {id:2,title:'Reforma del Parlamento Europeo',country:'EU',countryName:'Unión Europea',scope:'regional',region:'eu',count:412000,heat:88,timer:5400,color:'#4A6FFF',cities:890,desc:'Exigimos mayor representación ciudadana y transparencia en las instituciones europeas.',demands:'Que se tomen medidas inmediatas en respuesta a esta convocatoria ciudadana.',joined:false},
  {id:3,title:'Libertad para presos políticos',country:null,countryName:'Global',scope:'global',region:null,count:211000,heat:98,timer:3600,color:'#4CFFA4',cities:521,desc:'Más de 250 personas detenidas arbitrariamente. Exigimos su liberación inmediata.',demands:'Liberación inmediata e incondicional de todos los presos políticos · Sanciones internacionales · Acceso a observadores independientes de DDHH inmediatas en respuesta a esta convocatoria ciudadana.',joined:false},
  {id:4,title:'Por la sanidad pública española',country:'ES',countryName:'España',scope:'national',region:null,count:54000,heat:72,timer:7200,color:'#e8a020',cities:143,desc:'Los recortes deterioran la atención primaria. Exigimos un pacto de estado por la sanidad.',demands:'Que se tomen medidas inmediatas en respuesta a esta convocatoria ciudadana.',joined:false},
  {id:5,title:'Crisis climática — Acuerdo de París',country:null,countryName:'Global',scope:'global',region:null,count:890000,heat:76,timer:86400,color:'#4CFFA4',cities:1240,desc:'Los compromisos del Acuerdo de París no se están cumpliendo. Exigimos acción urgente.',demands:'Que se tomen medidas inmediatas en respuesta a esta convocatoria ciudadana.',joined:false},
  {id:6,title:'Política agraria común de la UE',country:'EU',countryName:'Unión Europea',scope:'regional',region:'eu',count:128000,heat:65,timer:9000,color:'#4A6FFF',cities:340,desc:'La PAC actual no protege a los pequeños agricultores ni a la biodiversidad. Exigimos su reforma.',demands:'Que se tomen medidas inmediatas en respuesta a esta convocatoria ciudadana.',joined:false},
  {id:7,title:'Internet libre en Irán',country:'IR',countryName:'Irán',scope:'national',region:null,count:89234,heat:90,timer:4100,color:'#e84020',cities:198,desc:'El régimen ha bloqueado más de 15.000 sitios. La libertad de información es un derecho humano.',demands:'Que se desbloqueen todas las plataformas · Que cese la vigilancia de comunicaciones · Que se libere a todos los periodistas presos inmediatas en respuesta a esta convocatoria ciudadana.',joined:false},
  {id:8,title:'Transparencia en contratos públicos',country:'MX',countryName:'México',scope:'national',region:null,count:41230,heat:65,timer:7200,color:'#e8a020',cities:97,desc:'Contratos millonarios adjudicados sin concurso público. Exigimos licitaciones abiertas.',demands:'Que se tomen medidas inmediatas en respuesta a esta convocatoria ciudadana.',joined:false},
];

const QUEUE = [
  {id:20,title:'Contra la comercialización de carne',country:'ES',countryName:'España',scope:'national',votes:1240},
  {id:21,title:'Por el transporte público gratuito',country:'FR',countryName:'Francia',scope:'national',votes:8900},
  {id:22,title:'Por el salario mínimo digno',country:'ES',countryName:'España',scope:'national',votes:15600},
  {id:23,title:'Acceso universal a medicamentos',country:null,countryName:'Global',scope:'global',votes:22100},
];

// ══════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════
let ST={
  currentProtest:null, authMethod:null, filter:'all', countryFilter:null, schedChoice:'now',
  worldData:null, wC:null, wX:null, wW:0, wH:0,
  zoom:1, offX:0, offY:0, proj:null, gp:null, hovered:null,
  drag:false, dx:0, dy:0, ox:0, oy:0, wRaf:null,
  dParts:[], dRaf:null, dC:null, dX:null, dW:0, dH:0,
  selectedScope:'national', selectedRegion:null,
};

// ══════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════
const $=id=>document.getElementById(id);
const fmt=n=>Math.round(n).toLocaleString('es-ES');
const fmtTime=s=>{if(s<=0)return'Finalizada';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;return h>0?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m ${String(sc).padStart(2,'0')}s`};
function showToast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}
async function mockHash(s){const c='0123456789abcdef';let h='sha256:';for(let i=0;i<64;i++)h+=c[Math.floor(Math.random()*16)];return h}
function heatColor(iso){const h=getHeat(iso);if(!h)return'#1a3a5c';if(h<40)return'#2d5a8e';if(h<65)return'#e8a020';if(h<85)return'#e84020';return'#ff2020'}
function lighten(hex){const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return`rgb(${Math.min(255,r+55)},${Math.min(255,g+55)},${Math.min(255,b+55)})`}

// ══════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════
const SCREENS=['home','detail','auth','verify','create','about'];
function nav(id){
  SCREENS.forEach(s=>$('s-'+s).classList.toggle('active',s===id));
  ['home','create','about'].forEach(n=>$('nav-'+n)?.classList.toggle('active',n===id));
  if(id==='home'){buildProj();renderActiveTab();renderQueueTab();renderSlotsTab();updateDeviceBar();}
  if(id==='detail'&&ST.currentProtest!==null) setTimeout(initDetailMap,40);
}
function setLang(lang,btn){
  document.querySelectorAll('.lang-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  showToast(`Idioma: ${lang.toUpperCase()} (integración completa en versión final)`);
}

// ══════════════════════════════════════════════
//  DEVICE BAR
// ══════════════════════════════════════════════
function updateDeviceBar(){
  const conf=calcConf();
  const regions=myRegions().map(k=>REGIONS[k].name).join(' · ');
  $('dev-flag').textContent=DEVICE.simCountry==='ES'?'🇪🇸':DEVICE.simCountry==='FR'?'🇫🇷':'🌍';
  $('dev-country').textContent=`${DEVICE.simName}${regions?' · '+regions:''}`;
  $('dev-conf-val').textContent=conf+'%';
  $('dev-conf-val').style.color=conf>=75?'var(--accent2)':conf>=50?'var(--accent4)':'var(--accent3)';
  $('dot-doc').style.background=DEVICE.docCountry?'var(--accent2)':'var(--accent4)';
}

// ══════════════════════════════════════════════
//  WORLD MAP
// ══════════════════════════════════════════════
function initWorldMap(){
  const c=$('world-canvas');ST.wC=c;ST.wX=c.getContext('2d');
  const wrap=c.parentElement;
  ST.wW=c.width=wrap.clientWidth||window.innerWidth;
  ST.wH=c.height=wrap.clientHeight||220;
  buildProj();
  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(data=>{
    ST.worldData=data;worldLoop();
  }).catch(()=>{
    ST.wX.fillStyle='#0d1a2e';ST.wX.fillRect(0,0,ST.wW,ST.wH);
    ST.wX.fillStyle='rgba(255,255,255,.3)';ST.wX.font='11px sans-serif';
    ST.wX.textAlign='center';ST.wX.fillText('Cargando mapa...',ST.wW/2,ST.wH/2);
  });
  setupEvents();
  // Resize on window change
  window.addEventListener('resize',()=>{
    ST.wW=c.width=wrap.clientWidth||window.innerWidth;
    ST.wH=c.height=wrap.clientHeight||220;
    buildProj();
  });
}
function buildProj(){if(!ST.wC)return;ST.proj=d3.geoNaturalEarth1().scale((ST.wW/640)*112*ST.zoom).translate([ST.wW/2+ST.offX,ST.wH/2+ST.offY]);ST.gp=d3.geoPath(ST.proj,ST.wX);}
const REGION_COORDS = {
  'eu':      [ 10.0, 51.0],  // Centro de Europa
  'mercosur':[-58.0,-20.0],  // Centro de Sudamérica
  'asean':   [108.0, 14.0],  // Sudeste Asiático
  'latam':   [-65.0,-10.0],  // América Latina
  'g20':     [ 20.0, 30.0],  // Posición neutral
  'global':  [ -30.0, 25.0], // Atlántico — neutro y visible
};

function worldLoop(){
  if(!ST.worldData)return;
  const{wX:ctx,wW:W,wH:H,proj,gp,filter,worldData,hovered}=ST;
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#0d1a2e';ctx.fillRect(0,0,W,H);
  topojson.feature(worldData,worldData.objects.countries).features.forEach(f=>{
    const iso=f.id?String(f.id).padStart(3,'0'):null;
    ctx.beginPath();gp(f);
    ctx.fillStyle=iso===hovered?lighten(heatColor(iso)):heatColor(iso);
    ctx.fill();ctx.strokeStyle='rgba(255,255,255,0.07)';ctx.lineWidth=0.4;ctx.stroke();
  });
  const t=Date.now();
  const vis=filter==='all'?PROTESTS:PROTESTS.filter(p=>p.scope===filter);
  vis.forEach(p=>{
    // Elegir coordenadas según el tipo de convocatoria
    let co;
    if(p.scope==='national'){
      const numIso=Object.entries(ISO_NUM_TO_A2).find(([k,v])=>v===p.country)?.[0];
      co=numIso?COORDS[numIso]:null;
    } else if(p.scope==='regional'){
      co=REGION_COORDS[p.region]||null;
    } else {
      co=REGION_COORDS['global'];
    }
    if(!co)return;
    const[x,y]=proj(co);if(x<-10||x>W+10||y<-10||y>H+10)return;
    const pulse=0.4+Math.sin(t/500+p.id)*0.3;const r=3+(p.heat/100)*5;
    ctx.beginPath();ctx.arc(x,y,r*2.5,0,Math.PI*2);ctx.fillStyle=`rgba(255,80,80,${pulse*0.2})`;ctx.fill();
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=p.color;ctx.fill();
    ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fillStyle='white';ctx.fill();
  });
  ST.wRaf=requestAnimationFrame(worldLoop);
}
function setupEvents(){
  const c=ST.wC;

  // Convierte coordenadas CSS del ratón a coordenadas geográficas [lng, lat]
  function cssToGeo(e){
    const rect=c.getBoundingClientRect();
    const cx=e.clientX-rect.left;
    const cy=e.clientY-rect.top;
    // Invertir la proyección: píxeles CSS → coordenadas geográficas
    return ST.proj.invert([cx, cy]);
  }

  // Encuentra el feature del país bajo el cursor usando d3.geoContains
  // Esto es 100% fiable independientemente del tamaño del canvas en pantalla
  function countryAtEvent(e){
    if(!ST.worldData) return null;
    const geo = cssToGeo(e);
    if(!geo) return null;
    const feats = topojson.feature(ST.worldData, ST.worldData.objects.countries).features;
    return feats.find(f => d3.geoContains(f, geo)) || null;
  }

  c.addEventListener('mousemove',e=>{
    if(!ST.worldData) return;
    // Drag
    if(ST._mousedown){
      const dist=Math.sqrt((e.clientX-ST._dragStartX)**2+(e.clientY-ST._dragStartY)**2);
      if(dist>4) ST.drag=true;
      if(ST.drag){
        ST.offX=ST.ox+(e.clientX-ST._dragStartX);
        ST.offY=ST.oy+(e.clientY-ST._dragStartY);
        buildProj(); return;
      }
    }
    // Hover tooltip
    const rect=c.getBoundingClientRect();
    const ttx=(e.clientX-rect.left)>rect.width*.6?(e.clientX-rect.left)-188:(e.clientX-rect.left)+10;
    const tty=(e.clientY-rect.top)-6;
    const found=countryAtEvent(e);
    const tt=$('mtt');
    if(found){
      const iso=found.id?String(found.id).padStart(3,'0'):null;
      ST.hovered=iso;
      const heat=getHeat(iso), a2=ISO_NUM_TO_A2[iso]||iso, prot=PROTESTS.find(p=>p.country===a2);
      if(heat>0||prot){
        tt.style.display='block';tt.style.left=ttx+'px';tt.style.top=tty+'px';
        const cj=prot?canJoin(prot):{ok:true};
        tt.innerHTML=`<div class="mt-title">${found.properties?.name||'—'}</div>`+
          (prot?`<div class="mt-row"><span>${prot.title.substring(0,28)}...</span></div>
            <div class="mt-row"><span>Alcance</span><span>${prot.scope==='national'?'🏛️ Nacional':prot.scope==='regional'?'🌐 '+REGIONS[prot.region]?.name:'🌍 Global'}</span></div>
            <div class="mt-row"><span>Adheridos</span><span class="mt-ct">${fmt(prot.count)}</span></div>
            <div class="mt-row"><span>Tu acceso</span><span style="color:${cj.ok?'#4CFFA4':cj.joined?'#4CFFA4':'#FF6B6B'}">${cj.ok?'✓ Disponible':cj.joined?'✓ Adherido':'✗ Bloqueado'}</span></div>`
          :`<div class="mt-row"><span>🌡️</span><span class="mt-hot">${heat}°</span></div>`);
      } else { tt.style.display='none'; ST.hovered=null; }
    } else { tt.style.display='none'; ST.hovered=null; }
  });

  c.addEventListener('mousedown',e=>{
    ST._dragStartX=e.clientX; ST._dragStartY=e.clientY;
    ST.ox=ST.offX; ST.oy=ST.offY;
    ST._mousedown=true; ST.drag=false;
  });
  c.addEventListener('mouseup',()=>{ ST._mousedown=false; setTimeout(()=>ST.drag=false,50); });
  c.addEventListener('mouseleave',()=>{ ST._mousedown=false; ST.drag=false; $('mtt').style.display='none'; ST.hovered=null; });

  c.addEventListener('click',e=>{
    if(!ST.worldData||ST.drag) return;
    const geo=cssToGeo(e);
    if(!geo) return;
    const feats=topojson.feature(ST.worldData,ST.worldData.objects.countries).features;
    const found=feats.find(f=>d3.geoContains(f,geo));
    if(!found) return;
    const iso=found.id?String(found.id).padStart(3,'0'):null;
    const name=found.properties?.name||iso;
    // Clic en país → filtrar lista derecha por ese país
    // Sin mover el mapa, sin zoom automático
    filterByCountry(iso, name);
  });

  c.addEventListener('wheel',e=>{
    e.preventDefault();
    ST.zoom=Math.min(10,Math.max(0.7,ST.zoom*(e.deltaY>0?0.82:1.2)));
    buildProj();
  },{passive:false});
}
function filterByCountry(iso, name){
  // Convertir ISO numérico (724) a alpha-2 (ES) para comparar con PROTESTS
  const a2 = ISO_NUM_TO_A2[iso] || iso;
  ST.countryFilter = a2;
  ST.countryFilterName = name;
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
  document.querySelector('.ptab').classList.add('active');
  ['queue','slots'].forEach(t=>$('tab-'+t).style.display='none');
  $('tab-active').style.display='block';
  $('map-hint').innerHTML=`📍 ${name} — convocatorias activas <span style="margin-left:6px;cursor:pointer;color:var(--accent);font-size:8px;text-decoration:underline" onclick="clearCountryFilter()">✕ Ver todas</span>`;
  renderActiveTab();
}

function clearCountryFilter(){
  ST.countryFilter = null;
  $('map-hint').textContent = 'Clic en un país para filtrar · rueda para zoom';
  renderActiveTab();
}

function zoomToPoint(lng,lat,z){const b=d3.geoNaturalEarth1().scale((ST.wW/640)*112).translate([ST.wW/2,ST.wH/2]);const[px,py]=b([lng,lat]);ST.zoom=z;ST.offX=ST.wW/2-px*z;ST.offY=ST.wH/2-py*z;buildProj();}
function zoomIn(){ST.zoom=Math.min(10,ST.zoom*1.3);buildProj();}
function zoomOut(){ST.zoom=Math.max(0.7,ST.zoom/1.3);buildProj();}
function resetView(){ST.zoom=1;ST.offX=0;ST.offY=0;buildProj();}

// ══════════════════════════════════════════════
//  PANEL TABS
// ══════════════════════════════════════════════
function homeTab(tab,btn){
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');
  ['active','queue','slots'].forEach(t=>$('tab-'+t).style.display=t===tab?'block':'none');
}
function setFilter(f,btn){
  ST.filter=f;
  ST.countryFilter=null; // limpiar filtro de país al cambiar scope
  $('map-hint').textContent='Clic en un país para filtrar · rueda para zoom';
  document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  renderActiveTab();
}

function renderActiveTab(){
  let list=ST.filter==='all'?PROTESTS:PROTESTS.filter(p=>p.scope===ST.filter);
  if(ST.countryFilter){
    const byCountry=list.filter(p=>p.country===ST.countryFilter);
    if(byCountry.length>0){ list=byCountry; }
    else{
      $('tab-active').innerHTML=`<div style="padding:20px 14px;text-align:center">
        <div style="font-size:22px;margin-bottom:8px">🌍</div>
        <div style="font-size:12px;font-weight:500;color:var(--text);margin-bottom:4px">Sin convocatorias activas</div>
        <div style="font-size:10px;color:var(--text3);line-height:1.6">No hay convocatorias en este país ahora mismo.</div>
        <button onclick="nav('create')" style="margin-top:10px;padding:7px 14px;background:var(--accent);border:none;border-radius:var(--r);color:white;font-size:10px;cursor:pointer">+ Crear convocatoria</button>
      </div>`;
      return;
    }
  }
  const sorted=[...list].sort((a,b)=>b.heat-a.heat);
  $('tab-active').innerHTML=sorted.map(p=>{
    const cj=canJoin(p);
    const blocked=!cj.ok&&!cj.joined;
    let extra='';
    if(cj.joined) extra=`<div class="joined-strip">✓ Adherido · ${fmtTime(p.timer)} restante</div>`;
    else if(cj.lock) extra=`<div class="lock-strip">🔒 ${cj.msg}</div>`;
    else if(cj.geo) extra=`<div class="geo-strip">🌍 ${cj.msg}</div>`;
    return `<div>
      <div class="p-item${blocked&&!cj.joined?' locked':''}${cj.joined?' joined-item':''}" onclick="handleItemClick(${p.id})">
        <div class="pi-heat" style="background:${p.color}18;color:${p.color}">${p.heat}°</div>
        <div class="pi-info">
          <div class="pi-title">${p.title}</div>
          <div class="pi-meta">${scopeBadgeHtml(p)}<span>${p.countryName}</span><span>${fmtTime(p.timer)}</span></div>
          <div class="pi-bar" style="width:${p.heat}%;background:${p.color}"></div>
        </div>
        <div class="pi-right"><div class="pi-count">${fmt(p.count)}</div><div class="pi-timer">${fmtTime(p.timer)}</div></div>
        ${blocked&&!cj.joined?'<div class="pi-lock">🔒</div>':''}
      </div>
      ${extra}
    </div>`;
  }).join('');
}

function handleItemClick(id){
  const p=PROTESTS.find(x=>x.id===id);if(!p)return;
  const cj=canJoin(p);
  if(cj.joined||cj.ok) openDetail(PROTESTS.indexOf(p));
  else if(cj.lock) showToast('🔒 Dispositivo bloqueado hasta que finalice la convocatoria activa');
  else if(cj.geo) showToast('🌍 No puedes participar: fuera del alcance geográfico');
}

function renderQueueTab(){
  const sorted=[...QUEUE].sort((a,b)=>b.votes-a.votes);
  $('tab-queue').innerHTML=`<div class="panel-info">La ciudadanía impulsa convocatorias en espera. La más impulsada sube cuando hay slot libre en su país. Una convocatoria sobre carne (1.240 impulsos) nunca superará a una sobre corrupción (15.600 impulsos).</div>`+
    sorted.map((q,i)=>`<div class="q-item">
      <div class="q-rank">#${i+1}</div>
      <div class="pi-info"><div class="pi-title">${q.title}</div><div class="pi-meta">${scopeBadgeHtml(q)}<span>${q.countryName}</span></div></div>
      <div class="q-votes">${fmt(q.votes)}</div>
      <button class="q-boost" id="qb-${q.id}" onclick="boost(${q.id})">+ Impulsar</button>
    </div>`).join('');
}

function renderSlotsTab(){
  const countries=[...new Set([...PROTESTS.filter(p=>p.scope==='national').map(p=>p.countryName),...QUEUE.filter(q=>q.scope==='national').map(q=>q.countryName)])];
  $('tab-slots').innerHTML=`<div class="panel-info">Cada país tiene 1 slot activo (nacional). Los bloques regionales tienen su propio slot. Las convocatorias globales no compiten con las nacionales.</div>`+
    countries.map(c=>{
      const act=PROTESTS.find(p=>p.scope==='national'&&p.countryName===c);
      const inq=QUEUE.filter(q=>q.scope==='national'&&q.countryName===c).length;
      const pct=act?Math.min(100,Math.round((act.timer/7200)*100)):0;
      return`<div class="slot-item">
        <div class="pi-info">
          <div class="pi-title" style="font-size:11px">${c}</div>
          <div class="pi-meta">${act?`Slot ocupado: "${act.title.substring(0,30)}..."`:inq?`Slot libre · ${inq} en cola`:'Slot libre'}</div>
          ${act?`<div class="slot-bar"><div class="slot-fill" style="width:${pct}%"></div></div>`:''}
        </div>
        <div class="pi-right"><div style="font-size:10px;color:${act?'var(--accent3)':'var(--accent2)'}">${act?'🔴':'🟢'}</div>${act?`<div class="pi-timer">${fmtTime(act.timer)}</div>`:''}</div>
      </div>`;
    }).join('')+
    // Regional slots
    `<div class="panel-info" style="margin-top:4px">Slots regionales activos:</div>`+
    Object.entries(REGIONS).map(([key,r])=>{
      const act=PROTESTS.find(p=>p.scope==='regional'&&p.region===key);
      return act?`<div class="slot-item">
        <div class="pi-info"><div class="pi-title" style="font-size:11px">${r.icon} ${r.name}</div><div class="pi-meta">Slot ocupado: "${act.title.substring(0,28)}..."</div><div class="slot-bar"><div class="slot-fill" style="width:${Math.min(100,Math.round((act.timer/7200)*100))}%"></div></div></div>
        <div class="pi-right"><div style="font-size:10px;color:var(--accent3)">🔴</div><div class="pi-timer">${fmtTime(act.timer)}</div></div>
      </div>`:'';
    }).join('');
}

function boost(id){
  const q=QUEUE.find(q=>q.id===id);if(!q)return;q.votes+=1;
  const btn=$(`qb-${id}`);btn.textContent='✓ Impulsado';btn.disabled=true;btn.style.background='var(--accent)';btn.style.color='white';
  setTimeout(renderQueueTab,300);
}

// ══════════════════════════════════════════════
//  DETAIL
// ══════════════════════════════════════════════
function openDetail(i){
  ST.currentProtest=i;const p=PROTESTS[i];
  $('d-title').textContent=p.title;
  $('d-loc').innerHTML=scopeBadgeHtml(p)+` <span style="font-size:9px;color:var(--text2)">📍 ${p.countryName}</span>`;
  $('d-desc').textContent=p.desc;
  // Bloque de exigencias
  if(p.demands){
    $('d-demands').textContent=p.demands;
    $('d-demands-block').style.display='block';
  } else {
    $('d-demands-block').style.display='none';
  }
  updateDetailStats();
  updateDetailGeo(p);
  updateJoinBtn(p);
  if(!p.viralCount) p.viralCount = Math.floor(p.count * 0.022);
  $('viral-count').textContent = fmt(p.viralCount);
  $('scs-count').textContent = fmt(p.viralCount);
  $('share-counter-strip').style.display = p.viralCount > 0 ? 'flex' : 'none';
  nav('detail');
}

function updateDetailGeo(p){
  const conf=calcConf();
  const cj=canJoin(p);
  // Geo box - only show for non-global
  $('geo-validation').style.display=p.scope==='global'?'none':'block';
  if(p.scope!=='global'){
    const simOk=p.scope==='national'?DEVICE.simCountry===p.country:inRegion(p.region,DEVICE.simCountry);
    $('gv-sim').textContent=simOk?'✓ '+DEVICE.simPrefix+' ('+DEVICE.simName+')':'✗ Diferente país';
    $('gv-sim').className='gv-val '+(simOk?'gv-ok':'gv-no');
    $('gv-dot-sim').style.background=simOk?'var(--accent2)':'var(--accent3)';
    $('gv-ip').textContent=simOk?'✓ '+DEVICE.ipCity:'✗ Diferente país';
    $('gv-ip').className='gv-val '+(simOk?'gv-ok':'gv-no');
    $('gv-dot-ip').style.background=simOk?'var(--accent2)':'var(--accent3)';
    $('gv-doc').textContent=DEVICE.docCountry?'✓ Verificado':'No aportado (+25%)';
    $('gv-doc').className='gv-val '+(DEVICE.docCountry?'gv-ok':'gv-warn');
    $('gv-dot-doc').style.background=DEVICE.docCountry?'var(--accent2)':'var(--accent4)';
    $('gv-conf-fill').style.width=conf+'%';
    $('gv-conf-fill').style.background=conf>=75?'var(--accent2)':conf>=50?'var(--accent4)':'var(--accent3)';
    $('gv-conf-pct').textContent=conf+'%';
    $('gv-conf-pct').style.color=conf>=75?'var(--accent2)':conf>=50?'var(--accent4)':'var(--accent3)';
  }
  // Lock/geo messages
  const lmd=$('lock-msg-detail');
  if(!cj.ok&&!cj.joined){
    if(cj.lock) lmd.innerHTML=`<div class="lock-detail">🔒 <strong>Dispositivo bloqueado:</strong> ${cj.msg}</div>`;
    else if(cj.geo) lmd.innerHTML=`<div class="geo-detail">🌍 <strong>Fuera de alcance geográfico:</strong> ${cj.msg}</div>`;
    else lmd.innerHTML='';
  } else lmd.innerHTML='';
}

function updateDetailStats(){
  if(ST.currentProtest===null)return;
  const p=PROTESTS[ST.currentProtest];
  $('d-total').textContent=fmt(p.count);$('d-cities').textContent=p.cities;
  $('d-timer').textContent=fmtTime(p.timer);$('hud-ct').textContent=fmt(p.count);
}

function updateJoinBtn(p){
  const btn=$('btn-join');
  if(!p) return;
  const cj=canJoin(p);
  if(cj.joined){btn.textContent='✓ Adherido de forma anónima';btn.className='btn-primary sj';btn.disabled=true;}
  else if(!cj.ok){btn.textContent=cj.lock?'🔒 Dispositivo bloqueado':'🌍 Fuera de alcance geográfico';btn.className='btn-primary';btn.disabled=true;btn.style.background='var(--bg4)';btn.style.color='var(--text3)';}
  else{btn.textContent='Adherirme de forma anónima';btn.className='btn-primary';btn.disabled=false;btn.style.background='';btn.style.color='';}
}

// ── DEVICE LOCK ───────────────────────────────
// Recuerda qué convocatorias ha apoyado este dispositivo
// Persiste en localStorage — sobrevive a cerrar el navegador
function getDeviceLocks() {
  try { return JSON.parse(localStorage.getItem('vc_locks')||'{}'); }
  catch { return {}; }
}
function setDeviceLock(protestId) {
  const locks = getDeviceLocks();
  locks[protestId] = Date.now();
  localStorage.setItem('vc_locks', JSON.stringify(locks));
}
function isDeviceLocked(protestId) {
  const locks = getDeviceLocks();
  return !!locks[protestId];
}
function getDeviceId() {
  let id = localStorage.getItem('vc_device_id');
  if(!id){
    const arr = crypto.getRandomValues(new Uint8Array(16));
    id = Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('vc_device_id', id);
  }
  return id;
}

// ── RECAPTCHA v3 ──────────────────────────────
const RECAPTCHA_KEY = '6LdFl9MsAAAAAISibM9CLohSkQLj1HfN5kH7Hw9Q';

async function getRecaptchaToken(action) {
  return new Promise((resolve, reject) => {
    if(typeof grecaptcha === 'undefined') {
      // Si reCAPTCHA no cargó (sin internet), continuar en modo degradado
      resolve('demo_token');
      return;
    }
    grecaptcha.ready(()=>{
      grecaptcha.execute(RECAPTCHA_KEY, {action})
        .then(token => resolve(token))
        .catch(() => resolve('demo_token'));
    });
  });
}

// ── JOIN FLOW CON VERIFICACIÓN COMPLETA ───────
async function joinFlow() {
  const p = PROTESTS[ST.currentProtest];
  if(!p) return;
  const cj = canJoin(p);
  if(!cj.ok) {
    showToast(cj.lock ? '🔒 Dispositivo bloqueado' : '🌍 Fuera de alcance geográfico');
    return;
  }
  if(isDeviceLocked(p.id)) {
    showToast('🔒 Ya te adheriste desde este dispositivo');
    p.joined = true; updateJoinBtn(p); return;
  }

  // Reset form state
  $('phone-in').value='';
  $('hash-prev').textContent='Escribe tu número...';
  $('btn-sms').disabled=true;
  $('step-otp').style.display='none';
  $('adv-panel').style.display='none';
  $('adv-arrow').textContent='▼';

  // Show captcha checking
  const status=$('captcha-status');
  status.style.display='flex';
  status.className='verif-strip verif-loading';
  $('captcha-ico').textContent='⏳';
  $('captcha-txt').textContent='Verificando comportamiento humano...';

  nav('auth');

  // Run reCAPTCHA silently
  try {
    const token = await getRecaptchaToken('join_protest');
    status.className='verif-strip verif-ok';
    $('captcha-ico').textContent='✓';
    $('captcha-txt').textContent = token && token!=='demo_token'
      ? 'Verificado — eres humano. Introduce tu número.'
      : 'Modo demo — introduce tu número.';
  } catch {
    status.className='verif-strip verif-ok';
    $('captcha-ico').textContent='✓';
    $('captcha-txt').textContent='Introduce tu número para continuar.';
  }
}

// DETAIL MAP
function initDetailMap(){
  const c=$('map-canvas');ST.dC=c;ST.dX=c.getContext('2d');
  ST.dW=c.width=c.parentElement.clientWidth;ST.dH=c.height=155;
  ST.dParts=[];const n=Math.min(PROTESTS[ST.currentProtest]?.count||200,260);
  for(let i=0;i<n;i++) ST.dParts.push(mkP(false));
  if(PROTESTS[ST.currentProtest]?.joined) ST.dParts.push(mkP(true));
  if(ST.dRaf) cancelAnimationFrame(ST.dRaf);drawDMap();
}
function mkP(isMe){const rings=[32,54,78,102,124];const r=rings[Math.floor(Math.random()*rings.length)];return{r:r+(isMe?0:(Math.random()-.5)*11),angle:Math.random()*Math.PI*2,speed:(Math.random()*.0004+.0001)*(Math.random()<.5?1:-1),size:isMe?6:(Math.random()*2+1.3),op:isMe?1:(Math.random()*.55+.45),isMe};}
function drawDMap(){
  const{dX:ctx,dW:W,dH:H,dParts}=ST,cx=W/2,cy=H/2;
  ctx.clearRect(0,0,W,H);ctx.fillStyle='#0d1117';ctx.fillRect(0,0,W,H);
  for(let x=0;x<W;x+=24){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.strokeStyle='rgba(124,111,255,.025)';ctx.lineWidth=1;ctx.stroke();}
  for(let y=0;y<H;y+=24){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.strokeStyle='rgba(124,111,255,.025)';ctx.lineWidth=1;ctx.stroke();}
  [32,54,78,102,124].forEach((r,i)=>{ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=`rgba(124,111,255,${.018-i*.002})`;ctx.fill();ctx.strokeStyle=`rgba(124,111,255,${.09-i*.014})`;ctx.lineWidth=.5;ctx.stroke();});
  dParts.forEach(p=>{p.angle+=p.speed;const x=cx+Math.cos(p.angle)*p.r,y=cy+Math.sin(p.angle)*p.r;if(p.isMe){ctx.beginPath();ctx.arc(x,y,p.size+4,0,Math.PI*2);ctx.fillStyle='rgba(255,107,107,.12)';ctx.fill();ctx.beginPath();ctx.arc(x,y,p.size,0,Math.PI*2);ctx.fillStyle='#FF6B6B';ctx.fill();}else{ctx.beginPath();ctx.arc(x,y,p.size,0,Math.PI*2);ctx.fillStyle=`rgba(76,255,164,${p.op})`;ctx.fill();}});
  ctx.beginPath();ctx.arc(cx,cy,16,0,Math.PI*2);ctx.fillStyle='rgba(124,111,255,.18)';ctx.fill();
  ctx.beginPath();ctx.arc(cx,cy,9,0,Math.PI*2);ctx.fillStyle='#7C6FFF';ctx.fill();
  ctx.fillStyle='white';ctx.font='bold 8px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('⚑',cx,cy);
  ST.dRaf=requestAnimationFrame(drawDMap);
}

// ══════════════════════════════════════════════
//  AUTH & VERIFY
// ══════════════════════════════════════════════
function toggleAdvanced(){
  const panel=$('adv-panel');
  const visible=panel.style.display==='block';
  panel.style.display=visible?'none':'block';
  $('adv-arrow').textContent=visible?'▼':'▲';
}

function startVerify(method){
  ST.authMethod=method;
  if(method==='worldid'||method==='zk'){
    nav('verify');
    $('v-main').style.display='none';
    $('spin').classList.add('on');
    const msgs=method==='zk'
      ?['Inicializando Tor...','Generando ZK-proof...','Registrando adhesión...']
      :['Conectando World ID...','Verificando prueba...','Registrando adhesión...'];
    let i=0;$('spin-txt').textContent=msgs[0];
    const iv=setInterval(()=>{i++;if(i<msgs.length)$('spin-txt').textContent=msgs[i];else{clearInterval(iv);completeJoin();}},1000);
  }
}

// function sendSMS(){
//   $('btn-sms').disabled=true;
//   $('btn-sms').textContent='Enviando...';
//   setTimeout(()=>{
//     $('btn-sms').style.display='none';
//     const row=$('otp-row');row.innerHTML='';
//     const demoCode='123456';
//     for(let i=0;i<6;i++){
//       const inp=document.createElement('input');
//       inp.className='otp-box';inp.maxLength=1;inp.type='tel';
//       inp.value=demoCode[i];
//       inp.style.color='var(--accent2)';
//       inp.addEventListener('input',e=>{if(e.target.value&&inp.nextSibling)inp.nextSibling.focus();});
//       row.appendChild(inp);
//     }
//     const hint=document.createElement('div');
//     hint.style.cssText='font-size:9px;color:var(--accent4);background:rgba(255,179,71,.08);border:.5px solid rgba(255,179,71,.2);border-radius:6px;padding:6px 9px;margin-bottom:8px;text-align:center;width:100%';
//     hint.textContent='DEMO · Código prellenado · Pulsa Verificar';
//     row.parentNode.insertBefore(hint,row);
//     $('step-otp').style.display='block';
//   },1200);
// }
async function onPhoneInput(){
  const v=$('phone-in').value.replace(/\D/g,'');
  $('btn-sms').disabled=v.length<6;
  if(v.length>=4){const h=await mockHash($('cc').value+v);$('hash-prev').textContent=h;}
  else $('hash-prev').textContent='Escribe tu número...';
}
async function onDniInput(){
  const v=$('dni-in').value.trim();
  if(v.length>=4){const h=await mockHash('DOC:'+v);$('hash-prev').textContent='📱+🪪 '+h.substring(0,50)+'...';}
}
function sendSMS(){
  $('step-phone').style.display='none';
  $('spin').classList.add('on');
  $('spin-txt').textContent='Enviando código...';
  setTimeout(()=>{
    $('spin').classList.remove('on');
    const row=$('otp-row');row.innerHTML='';
    // MODO DEMO: rellenar el código automáticamente con 123456
    const demoCode='123456';
    for(let i=0;i<6;i++){
      const inp=document.createElement('input');
      inp.className='otp-box';inp.maxLength=1;inp.type='tel';
      inp.value=demoCode[i]; // prerelleno
      inp.style.color='var(--accent2)';
      inp.addEventListener('input',e=>{if(e.target.value&&inp.nextSibling)inp.nextSibling.focus();});
      row.appendChild(inp);
    }
    $('step-otp').style.display='block';
    // Mostrar aviso de demo
    const hint=document.createElement('div');
    hint.style.cssText='font-size:9px;color:var(--accent4);background:rgba(255,179,71,.08);border:.5px solid rgba(255,179,71,.2);border-radius:6px;padding:6px 9px;margin-bottom:8px;text-align:center';
    hint.textContent='DEMO · Código prellenado automáticamente · Pulsa Verificar';
    row.parentNode.insertBefore(hint, row);
  },1200);
}
function verifyOTP(){
  if([...$('otp-row').querySelectorAll('.otp-box')].map(b=>b.value).join('').length<6){showToast('Introduce los 6 dígitos');return;}
  $('step-otp').style.display='none';
  // Show spinner on verify screen
  nav('verify');
  $('v-main').style.display='none';
  $('suc-scr').classList.remove('on');
  $('spin').classList.add('on');
  const msgs=['Verificando código...','Registrando en blockchain...','Generando comprobante anónimo...'];
  let i=0;$('spin-txt').textContent=msgs[0];
  const iv=setInterval(()=>{i++;if(i<msgs.length)$('spin-txt').textContent=msgs[i];else{clearInterval(iv);completeJoin();}},850);
}
async function completeJoin(){
  $('spin').classList.remove('on');
  const p=PROTESTS[ST.currentProtest];if(!p)return;
  p.joined=true;p.count+=1;
  // BLOQUEAR DISPOSITIVO — persiste aunque se cierre el navegador
  setDeviceLock(p.id);
  const h=await mockHash('receipt'+Date.now()+getDeviceId());
  $('receipt-hash').textContent=h;
  $('suc-scr').classList.add('on');updateDetailStats();
  updateJoinBtn(p);updateDeviceBar();
  ST.dParts.push(mkP(true));
  const el=$('d-total');el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');
  showToast('✓ Adhesión anónima registrada');
  setTimeout(showInstallBanner, 1500);
}

// ══════════════════════════════════════════════
//  SHARE MODAL
// ══════════════════════════════════════════════
//function openShareModal(){$('share-modal').classList.add('open');}
//function closeShareModal(){$('share-modal').classList.remove('open');}

function buildPuebloMsg(){
  const p=ST.currentProtest!==null?PROTESTS[ST.currentProtest]:null;
  const count=p?fmt(p.count):'miles de';
  const url=`https://cero-absoluto.github.io/vozciudadana`;
  return `EL PUEBLO MANDA.\n${count} voces. Sin violencia. Sin miedo.\nSolo ciudadanos recordándoles quién tiene el poder real.\nSúmate: ${url}\n#VozCiudadana #ElPuebloManda`;
}
function openShareModal(){
  const msg=buildPuebloMsg();
  const preview=msg.replace(/https?:\/\/\S+/g,'').replace('#VozCiudadana #ElPuebloManda','').trim();
  $('modal-msg-preview').textContent=preview;
  $('share-modal').classList.add('open');
}
function closeShareModal(){$('share-modal').classList.remove('open');}
function incrementViralCount(){
  if(ST.currentProtest===null)return;
  const p=PROTESTS[ST.currentProtest];
  if(!p.viralCount)p.viralCount=0;
  p.viralCount++;
  $('viral-count').textContent=fmt(p.viralCount);
  $('scs-count').textContent=fmt(p.viralCount);
  $('share-counter-strip').style.display='flex';
}
function shareWA(){
  const msg=encodeURIComponent(buildPuebloMsg());
  window.open(`https://wa.me/?text=${msg}`,'_blank');
  incrementViralCount();closeShareModal();
  showToast('🔥 ¡El pueblo manda! Compartido por WhatsApp');
}
function shareTG(){
  const p=ST.currentProtest!==null?PROTESTS[ST.currentProtest]:null;
  const url=encodeURIComponent(`https://cero-absoluto.github.io/vozciudadana`);
  const msg=encodeURIComponent(buildPuebloMsg());
  window.open(`https://t.me/share/url?url=${url}&text=${msg}`,'_blank');
  incrementViralCount();closeShareModal();
  showToast('🔥 ¡El pueblo manda! Compartido por Telegram');
}
function copyLink(){
  const msg=buildPuebloMsg();
  navigator.clipboard?.writeText(msg).catch(()=>{});
  incrementViralCount();closeShareModal();
  showToast('📋 ¡Copiado! Pégalo en TikTok, Instagram o donde quieras');
}
$('share-modal').addEventListener('click',e=>{if(e.target===$('share-modal'))closeShareModal();});

// ══════════════════════════════════════════════
//  CREATE FORM
// ══════════════════════════════════════════════
function selectScope(scope){
  ST.selectedScope=scope;
  ['national','regional','global'].forEach(s=>{$('so-'+s).classList.toggle('sel',s===scope);$('sr-'+s).classList.toggle('on',s===scope);});
  $('region-picker').style.display=scope==='regional'?'block':'none';
}
function renderRegionChips(){
  $('rchips').innerHTML=Object.entries(REGIONS).map(([key,r])=>
    `<div class="rchip${ST.selectedRegion===key?' on':''}" onclick="selectRegion('${key}',this)">${r.icon} ${r.name}</div>`
  ).join('');
}
function selectRegion(key,el){
  ST.selectedRegion=key;document.querySelectorAll('.rchip').forEach(c=>c.classList.remove('on'));el.classList.add('on');
}
$('f-title').addEventListener('input',()=>$('cc-t').textContent=$('f-title').value.length+'/120');
$('f-desc').addEventListener('input',()=>$('cc-d').textContent=$('f-desc').value.length+'/500');
$('f-demands').addEventListener('input',()=>$('cc-dem').textContent=$('f-demands').value.length+'/300');
const today=new Date();$('f-date').value=today.toISOString().split('T')[0];
function checkRisk(){const v=$('f-risk').value;$('risk-warn').style.display=(v==='high'||v==='critical')?'flex':'none';}
function submitCreate(){
  if(!$('f-title').value.trim()){showToast('El título es obligatorio');return;}
  if(!$('f-desc').value.trim()){showToast('La descripción es obligatoria');return;}
  if(!$('f-demands').value.trim()){showToast('Indica qué exigís');return;}
  if(!$('f-loc').value.trim()){showToast('El punto focal es obligatorio');return;}
  if(ST.selectedScope==='regional'&&!ST.selectedRegion){showToast('Selecciona el bloque regional');return;}

  const scope   = ST.selectedScope;
  const region  = ST.selectedRegion||null;
  const dur     = parseInt($('f-dur').value)||2;
  const demands = $('f-demands').value.trim();

  // País según scope
  let country=null, countryName='Global', color='#4CFFA4';
  if(scope==='national'){
    country = DEVICE.simCountry;   // alpha-2 ya correcto — 'ES'
    countryName = DEVICE.simName;
    color = '#7C6FFF';
  } else if(scope==='regional'){
    country = 'EU'; // placeholder — en producción sería el region key
    countryName = REGIONS[region]?.name||'Regional';
    color = '#FFB347';
  }

  const newProtest = {
    id: Date.now(),
    title:       $('f-title').value.trim(),
    country, countryName, scope, region,
    count:   0,
    heat:    5,
    timer:   dur * 3600,
    color,
    cities:  1,
    desc:    $('f-desc').value.trim(),
    demands,
    joined:  false,
    viralCount: 0,
    isDemo:  true,
  };

  PROTESTS.push(newProtest);

  // Limpiar formulario
  $('f-title').value='';$('f-desc').value='';$('f-demands').value='';$('f-loc').value='';
  $('cc-t').textContent='0/120';$('cc-d').textContent='0/500';$('cc-dem').textContent='0/300';

  // Ir al mapa — resetear filtro para que aparezca
  ST.countryFilter=null;
  ST.filter='all';
  document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
  document.querySelector('.pill').classList.add('active');

  nav('home');
  showToast('✓ Convocatoria creada — ya aparece en el mapa');
}

// ══════════════════════════════════════════════
//  LIVE COUNTERS
// ══════════════════════════════════════════════
function updateGlobal(){$('g-count').textContent=fmt(PROTESTS.reduce((s,p)=>s+p.count,0));}
setInterval(()=>{
  PROTESTS.forEach(p=>{if(p.timer>0){p.timer--;if(Math.random()<.4)p.count+=Math.floor(Math.random()*4+1);}});
  updateGlobal();
  if($('s-home').classList.contains('active')) renderActiveTab();
  if($('s-detail').classList.contains('active')) updateDetailStats();
},1000);

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
updateGlobal();updateDeviceBar();renderActiveTab();renderQueueTab();renderSlotsTab();renderRegionChips();initWorldMap();

// Restaurar adhesiones previas desde localStorage
const savedLocks = getDeviceLocks();
PROTESTS.forEach(p=>{
  if(savedLocks[p.id]) p.joined = true;
});

// ── PWA: REGISTRO DEL SERVICE WORKER ─────────
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js')
      .then(reg=>console.log('[PWA] Service worker registrado:', reg.scope))
      .catch(err=>console.warn('[PWA] Error al registrar SW:', err));
  });
}

// ── PWA: BANNER DE INSTALACIÓN ────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault();
  deferredPrompt = e;
});

function showInstallBanner(){
  if(!deferredPrompt) return;
  if(window.navigator.standalone) return;
  if(window.matchMedia('(display-mode: standalone)').matches) return;
  const banner = document.getElementById('install-banner');
  if(banner) banner.style.display = 'flex';
}

function installPWA(){
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(choice=>{
    if(choice.outcome === 'accepted'){
      showToast('✓ Voz Ciudadana instalada. ¡El pueblo manda!');
    }
    deferredPrompt = null;
    const banner = document.getElementById('install-banner');
    if(banner) banner.style.display = 'none';
  });
}

function dismissInstall(){
  const banner = document.getElementById('install-banner');
  if(banner) banner.style.display = 'none';
  deferredPrompt = null;
}

// iOS: detectar si ya está instalada
if(window.navigator.standalone){
  console.log('[PWA] Ejecutando como app instalada en iOS');
}


// ── Expose functions referenced by inline HTML event handlers ──────────────
Object.assign(window, {
  setLang, setFilter, nav, zoomIn, zoomOut, resetView, clearCountryFilter,
  homeTab, boost, handleItemClick, joinFlow, filterByCountry,
  openShareModal, closeShareModal, shareWA, shareTG, copyLink,
  selectScope, selectRegion, renderRegionChips, checkRisk, submitCreate,
  sendSMS, verifyOTP, onPhoneInput, onDniInput, toggleAdvanced, startVerify,
  installPWA, dismissInstall,
});
