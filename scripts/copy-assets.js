import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dest = path.resolve(__dirname, '../extension/assets');

if (!fs.existsSync(dest)) {
  fs.mkdirSync(dest, { recursive: true });
}

// 1. pdfjs-dist worker
const pdfWorkerSrc = path.resolve(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
if (fs.existsSync(pdfWorkerSrc)) {
  fs.copyFileSync(pdfWorkerSrc, path.join(dest, 'pdf.worker.min.mjs'));
} else {
  console.log("Could not find pdf.worker.min.mjs");
}

// 2. Tesseract
const tesseractWorkerSrc = path.resolve(__dirname, '../node_modules/tesseract.js/dist/worker.min.js');
const tesseractCoreWasmSrc = path.resolve(__dirname, '../node_modules/tesseract.js-core/tesseract-core.wasm.js');

if (fs.existsSync(tesseractWorkerSrc)) fs.copyFileSync(tesseractWorkerSrc, path.join(dest, 'tesseract-worker.min.js'));
if (fs.existsSync(tesseractCoreWasmSrc)) fs.copyFileSync(tesseractCoreWasmSrc, path.join(dest, 'tesseract-core.wasm.js'));

// Download eng.traineddata
const trainedDataPath = path.join(dest, 'eng.traineddata.gz');
if (!fs.existsSync(trainedDataPath)) {
  console.log('Downloading eng.traineddata.gz...');
  https.get('https://github.com/naptha/tessdata/raw/gh-pages/4.0.0_fast/eng.traineddata.gz', (res) => {
    const file = fs.createWriteStream(trainedDataPath);
    res.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log('[Synapse v3] Extraction assets copied successfully.');
    });
  });
} else {
  console.log('[Synapse v3] Extraction assets copied successfully.');
}
