// Comprobación de entorno de build (Railway, Root Directory = /apps/api; ver #35).
// Falla el build, en vez de seguir con otra resolución, si:
//   • Node es anterior a 22 (Nixpacks usa Node 18 por defecto si no detecta .nvmrc/engines), o
//   • falta package-lock.json en esta carpeta (el lockfile de la raíz del monorepo no está en el contexto).
// Después, `npm ci` instala exactamente lo bloqueado y aborta si package.json y el lock no coinciden.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function checkBuildEnv({ nodeVersion, hasLock }) {
  const problems = [];
  if (!(Number(String(nodeVersion).split('.')[0]) >= 22)) problems.push(`Node ${nodeVersion}: se requiere >=22 (.nvmrc de apps/api)`);
  if (!hasLock) problems.push('falta apps/api/package-lock.json');
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = checkBuildEnv({
    nodeVersion: process.versions.node,
    hasLock: fs.existsSync(new URL('../package-lock.json', import.meta.url)),
  });
  if (problems.length) {
    console.error('check-build-env: ' + problems.join('; '));
    process.exit(1);
  }
  console.log(`check-build-env: Node ${process.versions.node}, package-lock.json presente`);
}
