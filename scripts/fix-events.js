import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, '../extension/adapters');

const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
for (const file of files) {
  const fp = path.join(dir, file);
  let content = fs.readFileSync(fp, 'utf-8');
  content = content.replace(/new Event\(/g, 'new window.Event(');
  fs.writeFileSync(fp, content);
}
console.log('Fixed events in', files.length, 'files');
