// Genera/verifica apps/api/package-lock.json a partir del package-lock.json RAÍZ (sin red).
//
// Por qué existe: en Railway el servicio de la API tiene Root Directory = /apps/api, así que el
// build solo ve esa carpeta; el lockfile de la raíz del monorepo NO está en el contexto y Nixpacks
// ejecutaba `npm i` (resolviendo versiones nuevas, ver #35). Este fichero deriva, de las versiones
// ya probadas en el lockfile raíz, el cierre de dependencias de la API (mismas versiones, resolved
// e integrity) para que `npm ci` dentro de /apps/api sea reproducible.
//
// Uso:  node scripts/sync-api-lock.mjs          -> reescribe apps/api/package-lock.json
//       node scripts/sync-api-lock.mjs --check  -> sale con código 1 si no coincide
// Tras cambiar dependencias de la API: `npm install` en la raíz y luego este script.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(repo, p), 'utf8'));

export function deriveApiLock(rootLock, apiPkg) {
  const P = rootLock.packages;
  const resolve = (from, name) => {
    let base = from;
    for (;;) {
      const cand = `${base ? base + '/' : ''}node_modules/${name}`;
      if (cand in P) return cand;
      if (!base) return null;
      const i = base.lastIndexOf('/node_modules/');
      base = i < 0 ? '' : base.slice(0, i);
    }
  };
  const keep = {};
  const walk = (from, deps) => {
    for (const name of Object.keys(deps)) {
      const r = resolve(from, name);
      if (r === null || r in keep) continue; // dependencia opcional/de plataforma ausente del lock
      keep[r] = P[r];
      walk(r, { ...P[r].dependencies, ...P[r].optionalDependencies, ...P[r].peerDependencies });
    }
  };
  walk('', apiPkg.dependencies);
  const packages = {
    '': { name: apiPkg.name, version: apiPkg.version, dependencies: apiPkg.dependencies, ...(apiPkg.engines && { engines: apiPkg.engines }) },
  };
  for (const k of Object.keys(keep).sort((a, b) => a.localeCompare(b, 'en'))) packages[k] = keep[k];
  return { name: apiPkg.name, version: apiPkg.version, lockfileVersion: rootLock.lockfileVersion, requires: true, packages };
}

const render = (lock) => JSON.stringify(lock, null, 2) + '\n';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wanted = render(deriveApiLock(readJson('package-lock.json'), readJson('apps/api/package.json')));
  const target = path.join(repo, 'apps/api/package-lock.json');
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (have !== wanted) { console.error('apps/api/package-lock.json no coincide con el lockfile raíz: ejecuta `node scripts/sync-api-lock.mjs`'); process.exit(1); }
    console.log('apps/api/package-lock.json coincide con el lockfile raíz');
  } else {
    fs.writeFileSync(target, wanted);
    console.log('escrito apps/api/package-lock.json');
  }
}
