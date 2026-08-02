import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile() && path.endsWith('.mjs')) files.push(path);
  }
};
walk(resolve(root, 'src'));
walk(resolve(root, 'scripts'));
for (const file of files.sort()) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

console.log(JSON.stringify({
  status: 'success',
  summary: `${files.length} JavaScript modules passed syntax checking.`,
  next_actions: [],
  artifacts: files,
}));
