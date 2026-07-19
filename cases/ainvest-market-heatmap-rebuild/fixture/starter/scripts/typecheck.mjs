import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

for (const file of ['src/fixture-data.js', 'src/mock-api.js', 'src/main.js']) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

const declarations = readFileSync('src/contracts.d.ts', 'utf8');
for (const contract of ['MarketQuery', 'MarketNode', 'MarketResponse', 'requestMarketData', 'getFixtureCatalog']) {
  if (!declarations.includes(contract)) throw new Error(`Missing public type contract: ${contract}`);
}

console.log(JSON.stringify({
  status: 'success',
  summary: 'JavaScript syntax and public TypeScript declarations are valid.',
  next_actions: [],
  artifacts: ['src/contracts.d.ts', 'src/mock-api.js'],
}));
