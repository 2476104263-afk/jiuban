import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const sections = [await fs.readFile(path.join(root, 'LICENSE'), 'utf8')];
const seen = new Set();
async function include(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const directory = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const licenses = (await fs.readdir(directory)).filter((file) => /^(licen[sc]e|notice|copyright)(\.|$)/i.test(file));
  if (!licenses.length) {
    sections.push(await fs.readFile(path.join(root, 'licenses', `${name.replaceAll('/', '-')}.txt`), 'utf8'));
  }
  sections.push(`\n\n===== ${name}@${pkg.version} (${pkg.license || 'see license'}) =====\n`);
  for (const file of licenses) sections.push(await fs.readFile(path.join(directory, file), 'utf8'));
  for (const dependency of Object.keys(pkg.dependencies || {})) await include(dependency);
}
for (const name of Object.keys(metadata.dependencies)) await include(name);
await fs.mkdir(path.join(root, 'public'), { recursive: true });
await fs.writeFile(path.join(root, 'public', 'THIRD-PARTY-NOTICES.txt'), sections.join('\n'));
await fs.copyFile(path.join(root, 'LICENSE'), path.join(root, 'public', 'LICENSE.txt'));
