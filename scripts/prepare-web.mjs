import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.argv[2] || 'dist-web');
const html = await readFile(path.join(output, 'index.html'), 'utf8');
if (!html.includes('manifest.webmanifest') || !html.includes('<script')) {
  throw new Error('Export the web app with its public/index.html template first.');
}
async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}
const files = (await walk(output)).filter(file => !['sw.js', 'metadata.json', 'customHttp.yml'].includes(file) && !file.endsWith('.map')).sort();
for (const required of ['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']) {
  if (!files.includes(required)) throw new Error(`Missing required web asset: ${required}`);
}
const template = await readFile(path.join(root, 'scripts/service-worker.js'), 'utf8');
const hash = createHash('sha256').update(template);
let bytes = 0;
for (const file of files) {
  const contents = await readFile(path.join(output, file));
  hash.update(file).update('\0').update(contents);
  bytes += contents.length;
}
const version = hash.digest('hex').slice(0, 16);
const worker = template.replace('__BUILD_VERSION__', version).replace('__PRECACHE_URLS__', JSON.stringify(files.map(file => '/' + file)));
await writeFile(path.join(output, 'sw.js'), worker);
console.log(`WordMemo web release ${version}: ${files.length} offline assets, ${(bytes / 1024 / 1024).toFixed(2)} MiB uncompressed.`);
