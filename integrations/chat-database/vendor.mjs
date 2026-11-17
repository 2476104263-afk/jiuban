import fs from 'node:fs/promises';
import path from 'node:path';
const root = import.meta.dirname;
const output = path.resolve(root, '../../assets/vendor/chat-database');
await fs.mkdir(output, { recursive: true });
for (const file of ['sql-wasm.js', 'sql-wasm.wasm']) await fs.copyFile(path.join(root, 'node_modules/sql.js/dist', file), path.join(output, file));
await fs.copyFile(path.join(root, 'node_modules/fzstd/esm/index.mjs'), path.join(output, 'fzstd.mjs'));
await fs.writeFile(path.join(output, 'LICENSE.txt'), [
  'sql.js 1.13.0\n', await fs.readFile(path.join(root, 'node_modules/sql.js/LICENSE'), 'utf8'),
  '\nSQLite: public domain\nhttps://sqlite.org/copyright.html\n',
  '\nfzstd 0.1.1\n', await fs.readFile(path.join(root, 'node_modules/fzstd/LICENSE'), 'utf8'),
].join('\n'));
