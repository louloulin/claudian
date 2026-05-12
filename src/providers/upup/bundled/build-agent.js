#!/usr/bin/env node
/**
 * Build script for bundled upup-agent
 * Creates a standalone JS file that can be run with node
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../../../../../touzhi/dexter');

await build({
  entryPoints: [join(rootDir, 'upup-agent/src/cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: join(__dirname, 'upup-agent-bundled.js'),
  external: [
    'fsevents',
    'chokidar',
    '@memvid/sdk',
    '@duckdb/duckdb-wasm',
    'playwright',
    'playwright-core',
  ],
  logLevel: 'info',
  minify: false,
  sourcemap: false,
});

console.log('✅ Bundled upup-agent created: upup-agent-bundled.js');
