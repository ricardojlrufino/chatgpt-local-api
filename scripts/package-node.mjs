// Monta dist/node/: server.js (script isolado) + start.bat/start.sh + README, pronto para zipar.
import { chmodSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });
rmSync('dist/node', { recursive: true, force: true });
mkdirSync('dist/node', { recursive: true });
cpSync('dist/server.js', 'dist/node/server.js');
cpSync('README.md', 'dist/node/README.md');
for (const name of ['start.bat', 'login.bat', 'start.sh']) cpSync(`scripts/node-dist/${name}`, `dist/node/${name}`);
chmodSync('dist/node/start.sh', 0o755);
chmodSync('dist/node/server.js', 0o755);
console.log('dist/node pronto');
