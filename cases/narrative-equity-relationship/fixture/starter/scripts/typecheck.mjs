import { readFileSync } from 'node:fs';
const files = ['src/main.ts', 'src/narrative-shell.ts', 'src/types.d.ts'];
const required = ['createNarrativeGraph', 'NarrativeInput', 'NarrativeGraphApi'];
const source = files.map(file => readFileSync(file, 'utf8')).join('\n');
const missing = required.filter(name => !source.includes(name));
if (missing.length) throw new Error(`Missing public starter contracts: ${missing.join(', ')}`);
if (source.includes('TODO: solution')) throw new Error('Starter must not contain a hidden solution.');
console.log(JSON.stringify({ status: 'success', summary: 'TypeScript starter contracts are present.', next_actions: [], artifacts: files }));
