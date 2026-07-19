import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(new URL('../public/', import.meta.url), new URL('./public/', dist), { recursive: true });
cpSync(new URL('../src/', import.meta.url), new URL('./src/', dist), {
  recursive: true,
  filter: source => !source.endsWith('.d.ts'),
});
cpSync(new URL('../data/public/', import.meta.url), new URL('./data/', dist), { recursive: true });
const html = await (await import('node:fs/promises')).readFile(new URL('../index.html', import.meta.url), 'utf8');
await (await import('node:fs/promises')).writeFile(join(dist.pathname, 'index.html'), html.replaceAll('.ts', '.js'));
for (const name of ['main', 'narrative-shell']) {
  const file = join(dist.pathname, 'src', `${name}.ts`);
  const output = join(dist.pathname, 'src', `${name}.js`);
  const text = await (await import('node:fs/promises')).readFile(file, 'utf8');
  await (await import('node:fs/promises')).writeFile(output, text.replaceAll('.ts', '.js'));
}
console.log(JSON.stringify({ status: 'success', summary: 'Browser starter built.', next_actions: ['Run npm start to serve dist/.'], artifacts: ['dist/index.html'] }));
