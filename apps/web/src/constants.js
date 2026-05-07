// ── Shared constants ────────────────────────────────────────────────────────
export const REGIONS = {
  eu:      {name:'Unión Europea',   icon:'🇪🇺', members:['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']},
  mercosur:{name:'MERCOSUR',        icon:'🌎', members:['AR','BR','PY','UY','VE','BO']},
  asean:   {name:'ASEAN',           icon:'🌏', members:['BN','KH','ID','LA','MY','MM','PH','SG','TH','VN']},
  latam:   {name:'América Latina',  icon:'🌎', members:['MX','CO','PE','CL','EC','VE','CU','GT','HN','SV','NI','CR','PA','BO','PY','UY','AR','BR']},
  g20:     {name:'G20',             icon:'🌐', members:['AR','AU','BR','CA','CN','FR','DE','IN','ID','IT','JP','KR','MX','RU','SA','ZA','TR','GB','US']},
};

export const ISO_NUM_TO_A2 = {
  '004':'AF','008':'AL','012':'DZ','020':'AD','024':'AO','028':'AG','032':'AR','036':'AU','040':'AT','031':'AZ',
  '044':'BS','048':'BH','050':'BD','052':'BB','112':'BY','056':'BE','084':'BZ','204':'BJ','064':'BT','068':'BO',
  '070':'BA','072':'BW','076':'BR','096':'BN','100':'BG','854':'BF','108':'BI','116':'KH','120':'CM','124':'CA',
  '140':'CF','148':'TD','152':'CL','156':'CN','170':'CO','174':'KM','180':'CD','178':'CG','188':'CR','384':'CI',
  '191':'HR','192':'CU','196':'CY','203':'CZ','208':'DK','262':'DJ','212':'DM','214':'DO','218':'EC','818':'EG',
  '222':'SV','226':'GQ','232':'ER','233':'EE','231':'ET','242':'FJ','246':'FI','250':'FR','266':'GA','270':'GM',
  '268':'GE','276':'DE','288':'GH','300':'GR','308':'GD','320':'GT','324':'GN','328':'GY','332':'HT','340':'HN',
  '348':'HU','356':'IN','360':'ID','364':'IR','368':'IQ','372':'IE','376':'IL','380':'IT','388':'JM','392':'JP',
  '400':'JO','398':'KZ','404':'KE','410':'KR','408':'KP','414':'KW','417':'KG','418':'LA','428':'LV','422':'LB',
  '426':'LS','430':'LR','434':'LY','440':'LT','442':'LU','807':'MK','450':'MG','454':'MW','458':'MY','462':'MV',
  '466':'ML','470':'MT','478':'MR','480':'MU','484':'MX','498':'MD','496':'MN','504':'MA','508':'MZ','516':'NA',
  '524':'NP','528':'NL','554':'NZ','558':'NI','562':'NE','566':'NG','578':'NO','512':'OM','586':'PK','591':'PA',
  '598':'PG','600':'PY','604':'PE','608':'PH','616':'PL','620':'PT','634':'QA','642':'RO','643':'RU','646':'RW',
  '682':'SA','686':'SN','694':'SL','703':'SK','705':'SI','090':'SB','710':'ZA','724':'ES','729':'SD','740':'SR',
  '748':'SZ','752':'SE','756':'CH','760':'SY','764':'TH','768':'TG','776':'TO','780':'TT','788':'TN','792':'TR',
  '800':'UG','804':'UA','784':'AE','826':'GB','840':'US','858':'UY','704':'VN','887':'YE','894':'ZM','716':'ZW',
};

export const COORDS = {
  '470':[14.5,35.9],'724':[-3.7,40.4],'862':[-66.9,10.5],'364':[53.7,32.4],'250':[2.3,46.2],
  '484':[-102,23.6],'643':[37.6,55.7],'792':[35.2,38.9],'112':[28,53.7],
  '276':[10.4,51.2],'380':[12.5,41.9],'840':[-100,38],'076':[-47,-15],
  '356':[78.9,20.6],'156':[104,35.9],'410':[127.7,35.9],'360':[113.9,-0.8],
  '566':[8.7,9.1],'710':[25.1,-29],'818':[30.8,26.8],'682':[45.1,23.9],
};

export const REGION_COORDS = {
  eu:       [ 10.0, 51.0],
  mercosur: [-58.0,-20.0],
  asean:    [108.0, 14.0],
  latam:    [-65.0,-10.0],
  g20:      [ 20.0, 30.0],
  global:   [-30.0, 25.0],
};

// ── Helpers ─────────────────────────────────────────────────────────────────
export const fmt = n => Math.round(n).toLocaleString('es-ES');
export const fmtTime = s => {
  if (s <= 0) return 'Finalizada';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${m}m ${String(sc).padStart(2,'0')}s`;
};
export const heatColor = h => {
  if (!h) return '#1a3a5c';
  if (h < 40) return '#2d5a8e';
  if (h < 65) return '#e8a020';
  if (h < 85) return '#e84020';
  return '#ff2020';
};
export const lighten = hex => {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgb(${Math.min(255,r+55)},${Math.min(255,g+55)},${Math.min(255,b+55)})`;
};
export const inRegion = (regionKey, country) => REGIONS[regionKey]?.members.includes(country) || false;
