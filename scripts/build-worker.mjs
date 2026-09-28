import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
await rm('dist/worker.js', { force: true });
await rm('dist/_worker.js', { force: true });
await build({
  entryPoints: ['server/worker.ts'],
  outfile: 'artifacts/worker-bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['cloudflare:workers'],
  sourcemap: false,
  minify: true,
  legalComments: 'none',
});
console.log('Cloudflare Worker bundle written to artifacts/worker-bundle.js');
