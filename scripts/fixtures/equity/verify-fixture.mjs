#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const fixture = resolve(root, 'cases/narrative-equity-relationship/fixture');
const starter = resolve(fixture, 'starter');
const visible = JSON.parse(readFileSync(resolve(starter, 'data/public/valid-input.json'), 'utf8'));
const hidden = resolve(fixture, 'control/invalid-input.json');

assert.equal(visible.overview.nodes.length, 24, 'overview must contain 20–30 nodes');
assert.equal(visible.chapters.length, 4, 'fixture must contain four chapters');
assert.ok(visible.chapters.every(chapter => chapter.timeline.length >= 3 && chapter.timeline.length <= 5));
assert.deepEqual(new Set(visible.overview.nodes.map(node => node.kind)), new Set(['organization', 'person', 'metric']));
assert.deepEqual(new Set(visible.overview.edges.map(edge => edge.direction)), new Set(['forward', 'bidirectional', 'mutual']));
const animations = new Set(visible.chapters.flatMap(chapter => chapter.timeline.flatMap(step => step.animations.map(animation => animation.type))));
for (const type of ['fade', 'scale', 'opacity', 'grow', 'move', 'replace', 'group', 'group_grow', 'ungroup']) assert.ok(animations.has(type), `missing ${type}`);
assert.ok(existsSync(hidden), 'control invalid sample must be kept separate from the starter');
for (const asset of ['organization.svg', 'person.svg', 'metric.svg', 'generated-card.svg']) assert.ok(existsSync(resolve(starter, 'public/assets', asset)));
console.log(JSON.stringify({ status: 'success', summary: 'Synthetic fixture contract verified.', next_actions: [], artifacts: [starter, hidden] }));
