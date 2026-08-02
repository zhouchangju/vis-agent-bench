import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const entry of ['index.html', 'src', 'public']) {
  cpSync(resolve(root, entry), resolve(dist, entry), { recursive: true });
}

console.log(JSON.stringify({
  status: 'success',
  summary: 'Synthetic two-way tree Starter built without network access.',
  next_actions: ['Run npm start to serve dist/.'],
  artifacts: ['dist/index.html'],
}));
