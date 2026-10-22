// Atualiza vendor/siwc-local a partir do repositório oficial do devkit:
// https://github.com/openai/sign-in-with-chatgpt-devkit  (pacote packages/local)
//
// Uso:
//   npm run sync-siwc                     baixa a branch main, compila e copia para vendor/siwc-local
//   npm run sync-siwc -- --check          só informa se há versão nova (sai com código 10 se houver)
//   npm run sync-siwc -- --ref <tag|sha>  usa outro ref em vez da main
//   npm run sync-siwc -- --force          reaplica mesmo sem mudança de commit
//   SIWC_LOCAL_DIR=<devkit>/packages/local npm run sync-siwc   usa um checkout local já compilado
//
// O upstream aceita só mensagens de texto; este projeto precisa também de ferramentas, imagens,
// `reasoning` e `promptCacheKey`. Essas extensões vivem em patches/siwc-local-extensions.patch,
// aplicado sobre o código-fonte do upstream antes do build. Se o upstream mudar as mesmas linhas
// e o patch não aplicar, o script para sem alterar nada: o patch precisa ser portado à mão.
// O commit usado fica em vendor/siwc-local/UPSTREAM.json. Nada é atualizado em tempo de execução:
// o código vendorizado só muda por este script, e a mudança passa por revisão (ver o workflow update-siwc).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = 'https://github.com/openai/sign-in-with-chatgpt-devkit.git';
const PACKAGE = 'packages/local';
const patchFile = resolve('patches/siwc-local-extensions.patch');
const target = resolve(process.env.SIWC_TARGET_DIR ?? 'vendor/siwc-local');
const metaFile = join(target, 'UPSTREAM.json');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const refIndex = args.indexOf('--ref');
const ref = refIndex >= 0 ? args[refIndex + 1] : undefined;
if (refIndex >= 0 && !ref) throw new Error('--ref precisa de um valor (tag, branch ou sha).');
// No Windows o npm é um .cmd.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' && command === npm, ...options });

function recorded() {
  try { return JSON.parse(readFileSync(metaFile, 'utf8')); } catch { return undefined; }
}

function prune(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) prune(path); else if (path.endsWith('.map')) unlinkSync(path);
  }
}

function install(source, meta) {
  rmSync(target, { recursive: true, force: true });
  for (const name of ['dist', 'package.json', 'LICENSE']) cpSync(join(source, name), join(target, name), { recursive: true });
  prune(target);
  writeFileSync(metaFile, `${JSON.stringify({ ...meta, syncedAt: new Date().toISOString() }, null, 2)}\n`);
}

if (process.env.SIWC_LOCAL_DIR) {
  install(resolve(process.env.SIWC_LOCAL_DIR), { repo: 'local-checkout', commit: 'local' });
  console.log(`siwc-local atualizado de ${process.env.SIWC_LOCAL_DIR}`);
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'siwc-devkit-'));
try {
  const checkout = join(work, 'repo');
  if (ref) {
    run('git', ['init', '-q', checkout]);
    run('git', ['-C', checkout, 'fetch', '-q', '--depth', '1', REPO, ref]);
    run('git', ['-C', checkout, 'checkout', '-q', 'FETCH_HEAD']);
  } else {
    run('git', ['clone', '-q', '--depth', '1', REPO, checkout]);
  }
  const commit = run('git', ['-C', checkout, 'rev-parse', 'HEAD']).trim();
  const date = run('git', ['-C', checkout, 'log', '-1', '--format=%cI']).trim();
  const subject = run('git', ['-C', checkout, 'log', '-1', '--format=%s']).trim();
  const current = recorded();

  if (current?.commit === commit && !flag('--force')) {
    console.log(`siwc-local já está no commit mais recente (${commit.slice(0, 7)}).`);
    process.exit(0);
  }
  console.log(`Upstream: ${commit.slice(0, 7)} (${date.slice(0, 10)}) ${subject}`);
  console.log(`Vendorizado: ${current ? current.commit.slice(0, 7) : 'desconhecido (sem UPSTREAM.json)'}`);
  if (flag('--check')) process.exit(10);

  if (existsSync(patchFile)) {
    try { run('git', ['-C', checkout, 'apply', '--check', patchFile]); }
    catch { throw new Error(`O patch ${patchFile} não aplica no upstream ${commit.slice(0, 7)}: porte as extensões para o código novo e regenere o patch.`); }
    run('git', ['-C', checkout, 'apply', patchFile]);
    console.log('Extensões locais aplicadas (patches/siwc-local-extensions.patch).');
  }
  // --ignore-scripts: o build só precisa do tsc; scripts de instalação de terceiros não rodam.
  run(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: checkout });
  run(npm, ['run', 'build', '-w', '@siwc/local'], { cwd: checkout });
  const source = join(checkout, PACKAGE);
  if (!existsSync(join(source, 'dist', 'index.js'))) throw new Error('Build do devkit não gerou dist/index.js.');
  install(source, { repo: REPO.replace(/\.git$/, ''), commit, commitDate: date, subject, patched: existsSync(patchFile) });
  console.log(`siwc-local atualizado para ${commit.slice(0, 7)}. Apague bun.lock e rode "bun install" (as dependências do SDK podem ter mudado), depois typecheck e testes.`);
} catch (error) {
  console.error(`Falha ao atualizar siwc-local: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
