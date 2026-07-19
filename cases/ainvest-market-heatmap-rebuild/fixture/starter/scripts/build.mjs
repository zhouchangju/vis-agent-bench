import { cpSync, mkdirSync, rmSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(new URL('../index.html', import.meta.url), new URL('./index.html', dist));
cpSync(new URL('../src/', import.meta.url), new URL('./src/', dist), { recursive: true });
cpSync(new URL('../public/', import.meta.url), new URL('./public/', dist), { recursive: true });

console.log(JSON.stringify({
  status: 'success',
  summary: 'Synthetic market Starter built without network access.',
  next_actions: ['Run npm start to serve dist/.'],
  artifacts: ['dist/index.html'],
}));
