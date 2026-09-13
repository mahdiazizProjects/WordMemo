// Requires sharp: npm install --no-save sharp. The SVG is the editable source.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'sharp') : 'sharp');
const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets/wordmemo-mark.svg'), 'utf8');
async function main() {
  const webIcons = path.join(root, 'public/icons');
  fs.mkdirSync(webIcons, { recursive: true });
  for (const size of [192, 512]) {
    await sharp(Buffer.from(svg)).resize(size).png().toFile(path.join(webIcons, `icon-${size}.png`));
  }
  await sharp(Buffer.from(svg)).resize(180).png().toFile(path.join(webIcons, 'apple-touch-icon.png'));
  await sharp(Buffer.from(svg)).png().toFile(path.join(root, 'assets/icon.png'));
  await sharp(Buffer.from(svg)).resize(64).png().toFile(path.join(root, 'assets/favicon.png'));
  const foreground = svg.replace('<rect width="1024" height="1024" fill="#294C3C"/>', '');
  await sharp(Buffer.from(foreground)).png().toFile(path.join(root, 'assets/android-icon-foreground.png'));
  await sharp(Buffer.from(foreground.replaceAll('#E5C58D', '#FFFFFF'))).png().toFile(path.join(root, 'assets/android-icon-monochrome.png'));
  console.log('Rendered app icons from the editable SVG.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
