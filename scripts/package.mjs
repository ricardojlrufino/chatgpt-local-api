// Gera os binários únicos (Bun) de todas as plataformas em dist/.
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const targets = [
  ['bun-linux-x64', 'linux-x64'],
  ['bun-linux-arm64', 'linux-arm64'],
  ['bun-darwin-x64', 'darwin-x64'],
  ['bun-darwin-arm64', 'darwin-arm64'],
  ['bun-windows-x64', 'windows-x64.exe'],
];

mkdirSync('dist', { recursive: true });
let failed = false;
for (const [target, suffix] of targets) {
  const outfile = `dist/chatgpt-local-api-${suffix}`;
  console.log(`> ${outfile}`);
  const { status } = spawnSync('bun', ['build', '--compile', '--minify', `--target=${target}`, 'src/server.ts', '--outfile', outfile], { stdio: 'inherit' });
  if (status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log('binários prontos em dist/');
