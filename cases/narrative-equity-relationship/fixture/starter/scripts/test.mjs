import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(new URL('../data/public/valid-input.json', import.meta.url), 'utf8'));
assert.equal(input.overview.nodes.length, 24);
assert.equal(input.chapters.length, 4);
assert.ok(input.chapters.every(chapter => chapter.timeline.length >= 3 && chapter.timeline.length <= 5));
assert.equal(typeof input.overview.nodes.find(node => node.id === 'org-atlas').name, 'string');
console.log(JSON.stringify({ status: 'success', summary: 'Public fixture shape is readable.', next_actions: [], artifacts: ['data/public/valid-input.json'] }));
