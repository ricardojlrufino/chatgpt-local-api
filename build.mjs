import { build } from 'esbuild';

// Embute o SDK local (e suas dependências JS) num único arquivo; CommonJS precisa de require.
await build({ entryPoints: ['src/server.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22',
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  outfile: 'dist/server.js' });
