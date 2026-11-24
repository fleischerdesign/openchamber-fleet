import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extensions/openchamber');

await fs.rm(path.join(extension, 'plugin/dist'), { recursive: true, force: true });
await fs.rm(path.join(extension, 'panel/main.js'), { force: true });
await fs.rm(path.join(extension, 'service/main.js'), { force: true });

await build({
  entryPoints: [path.join(extension, 'src/panel.ts')],
  outfile: path.join(extension, 'panel/main.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
});

await build({
  entryPoints: [path.join(extension, 'src/service.ts')],
  outfile: path.join(extension, 'service/main.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  minify: true,
  legalComments: 'none',
});

await fs.mkdir(path.join(extension, 'plugin'), { recursive: true });
await fs.cp(path.join(root, 'dist'), path.join(extension, 'plugin/dist'), {
  recursive: true,
  filter: (source) => !source.endsWith('.d.ts') && !source.endsWith('.d.ts.map') && !source.endsWith('.js.map'),
});

console.log('built OpenChamber extension at extensions/openchamber');
