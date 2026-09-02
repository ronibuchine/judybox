import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Workspace packages are bundled in (they ship as TypeScript source); real
 * npm dependencies stay external and load from node_modules at runtime.
 */
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@judybox/'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external,
  sourcemap: true,
  logLevel: 'info',
});
