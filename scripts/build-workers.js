import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function build() {
  await esbuild.build({
    entryPoints: [
      path.resolve(__dirname, '../src/workers/pdf.worker.js'),
      path.resolve(__dirname, '../src/workers/ocr.worker.js'),
      path.resolve(__dirname, '../src/workers/attachment.worker.js'),
      path.resolve(__dirname, '../src/workers/compression.worker.js')
    ],
    bundle: true,
    format: 'esm',
    outdir: path.resolve(__dirname, '../extension/workers'),
    minify: process.env.NODE_ENV === 'production',
    sourcemap: true
  });
  console.log('[Synapse v3] Workers bundled successfully.');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
