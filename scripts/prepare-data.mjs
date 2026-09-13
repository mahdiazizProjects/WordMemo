// Keep the complete, verified corpus in small transportable repository files.
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const packed = join(root, 'content', 'packed');
const names = ['bible', 'annotations'];
const digest = data => createHash('sha256').update(data).digest('hex');

if (process.argv.includes('--pack')) {
  mkdirSync(packed, { recursive: true });
  const manifest = {};
  for (const name of names) {
    const raw = readFileSync(join(root, 'src', 'data', `${name}.json`));
    JSON.parse(raw.toString('utf8'));
    const encoded = gzipSync(raw, { level: 9 }).toString('base64');
    for (const file of readdirSync(packed)) {
      if (new RegExp(`^${name}\\.\\d{3}\\.b64$`).test(file)) unlinkSync(join(packed, file));
    }
    const parts = [];
    for (let offset = 0; offset < encoded.length; offset += 100000) {
      const file = `${name}.${String(parts.length).padStart(3, '0')}.b64`;
      writeFileSync(join(packed, file), encoded.slice(offset, offset + 100000) + '\n');
      parts.push(file);
    }
    manifest[name] = { sha256: digest(raw), bytes: raw.length, parts };
  }
  writeFileSync(join(packed, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Packed the complete Bible and classifications with SHA-256 checksums.');
} else {
  const manifest = JSON.parse(readFileSync(join(packed, 'manifest.json'), 'utf8'));
  // Validate every payload before writing any generated output.
  const outputs = names.map(name => {
    const entry = manifest[name];
    if (!entry || !Array.isArray(entry.parts) || entry.parts.length > 100) throw new Error('Invalid corpus manifest');
    const encoded = entry.parts.map(file => {
      if (!new RegExp(`^${name}\\.\\d{3}\\.b64$`).test(file)) throw new Error('Invalid corpus part path');
      return readFileSync(join(packed, file), 'utf8').trim();
    }).join('');
    const raw = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: 10000000 });
    if (raw.length !== entry.bytes || digest(raw) !== entry.sha256) throw new Error(`${name} corpus checksum mismatch`);
    JSON.parse(raw.toString('utf8'));
    return { name, raw };
  });
  for (const { name, raw } of outputs) {
    const output = join(root, 'src', 'data', `${name}.json`);
    writeFileSync(output + '.tmp', raw);
    renameSync(output + '.tmp', output);
  }
  console.log('Complete Bible and classifications restored; both checksums verified.');
}
