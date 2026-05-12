#!/usr/bin/env node
/**
 * Build script for real bundled upup-agent
 * Bundles the actual upup-agent with esbuild to create a standalone JS file
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = '/Users/louloulin/Documents/linchong/touzhi/dexter';

console.log('Building upup-agent from:', rootDir);

// Check if source exists
import * as fs from 'fs';
const cliPath = join(rootDir, 'upup-agent/src/cli.ts');
const serverPath = join(rootDir, 'upup-agent/src/server.ts');
const agentWrapperPath = join(rootDir, 'upup-agent/src/agent-wrapper.ts');

if (!fs.existsSync(cliPath)) {
  console.error('❌ upup-agent source not found at:', cliPath);
  console.error('   Please ensure the touzhi/dexter workspace is available');
  process.exit(1);
}

try {
  await build({
    entryPoints: [cliPath],
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
    loader: {
      '.ts': 'ts',
    },
    logLevel: 'info',
    minify: false,
    sourcemap: false,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  console.log('✅ Bundled upup-agent created successfully');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
