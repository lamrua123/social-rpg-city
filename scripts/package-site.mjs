import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(projectRoot, '.openai/hosting.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest.project_id) throw new Error('Create the Site and save its project_id in .openai/hosting.json before packaging.');
if (manifest.static?.directory !== 'dist') throw new Error('The Site manifest must point to the packaged dist/ directory.');

const buildRoot = resolve(projectRoot, 'dist');
const workerBundle = resolve(projectRoot, 'artifacts/worker-bundle.js');
const outputRoot = resolve(projectRoot, 'artifacts/site-package');
const siteRoot = resolve(outputRoot, 'dist');
const archivePath = resolve(projectRoot, 'artifacts/kindred-production.tar.gz');
const rel = relative(projectRoot, outputRoot);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Refusing to package outside the project artifacts directory.');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(siteRoot, { recursive: true });
await cp(buildRoot, siteRoot, { recursive: true });
await cp(workerBundle, resolve(outputRoot, 'worker.js'));
await cp(manifestPath, resolve(outputRoot, '.openai/hosting.json'));
await writeFile(resolve(outputRoot, 'wrangler.jsonc'), `${JSON.stringify({
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "kindred-town",
  "main": "worker.js",
  "compatibility_date": "2026-09-26",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
  },
  "durable_objects": {
    "bindings": [{ "name": "CITY_HUB", "class_name": "CityHub" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["CityHub"] }],
}, null, 2)}\n`, 'utf8');
await mkdir(dirname(archivePath), { recursive: true });
execFileSync('tar', ['-czf', archivePath, '-C', outputRoot, '.'], { stdio: 'inherit' });
console.log(`Production archive prepared at ${archivePath}`);
