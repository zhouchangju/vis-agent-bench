#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const fixture = resolve(root, 'cases/macro-map-3d-greenfield/fixture');
const publicData = resolve(fixture, 'starter/data/public');
const control = resolve(fixture, 'control');
mkdirSync(publicData, { recursive: true });
mkdirSync(control, { recursive: true });

const categories = ['systems', 'resources', 'exchange', 'demand', 'capacity', 'sentiment'];
const metrics = ['level', 'momentum', 'stress'];
const periods = ['t0', 't1', 't2', 't3'];
const relationTypes = ['positive', 'negative', 'unknown'];
const targets = new Map([[200, 284], [800, 1137], [1481, 2106]]);

function nodeId(index) {
  return `factor-${String(index + 1).padStart(4, '0')}`;
}

function makeNodes(count) {
  return Array.from({ length: count }, (_, index) => {
    const values = {};
    for (let metricIndex = 0; metricIndex < metrics.length; metricIndex += 1) {
      values[metrics[metricIndex]] = {};
      for (let periodIndex = 0; periodIndex < periods.length; periodIndex += 1) {
        const raw = ((index + 3) * (metricIndex + 5) * 17 + periodIndex * 29) % 201;
        values[metrics[metricIndex]][periods[periodIndex]] = Number(((raw - 100) / 100).toFixed(2));
      }
    }
    const longLabel = index === 17
      ? 'A deliberately long synthetic factor label used to exercise wrapping and overlap without revealing a domain term'
      : `Synthetic Factor ${String(index + 1).padStart(4, '0')}`;
    return {
      id: nodeId(index),
      labels: {
        zh: index === 17 ? '用于验证中英文长标签换行、遮挡与可读性的合成长因子名称' : `合成因子 ${String(index + 1).padStart(4, '0')}`,
        en: longLabel,
      },
      category: categories[index % categories.length],
      layer: index < Math.max(12, Math.round(count * 0.12)) ? 'core' : 'peripheral',
      importance: Number((((index * 37) % 101) / 100).toFixed(2)),
      values,
    };
  });
}

function makeRelations(count, targetCount) {
  const relations = [];
  const seen = new Set();
  let cursor = 0;
  while (relations.length < targetCount) {
    let sourceIndex = cursor % count;
    let targetIndex;
    if (cursor % 5 < 2) {
      sourceIndex = 0;
      targetIndex = 1 + ((cursor * 19 + 7) % (count - 1));
    } else {
      targetIndex = (sourceIndex + 1 + ((cursor * 31 + 11) % (count - 1))) % count;
    }
    if (sourceIndex === targetIndex) targetIndex = (targetIndex + 1) % count;
    const key = `${sourceIndex}:${targetIndex}`;
    cursor += 1;
    if (seen.has(key)) continue;
    seen.add(key);
    const index = relations.length;
    relations.push({
      id: `relation-${String(index + 1).padStart(5, '0')}`,
      source: nodeId(sourceIndex),
      target: nodeId(targetIndex),
      type: relationTypes[index % relationTypes.length],
      primary: index % 7 === 0,
      strength: Number((((index * 43) % 91) / 100 + 0.1).toFixed(2)),
    });
  }
  return relations;
}

function makeGraph(count) {
  return {
    meta: {
      schema_version: 1,
      dataset_id: `synthetic-${count}`,
      metrics,
      periods,
      initial_camera: { target: [0, 0, 0], distance: 96, polar: 1.15, azimuth: 0.65 },
      supported_runtime_inputs: {
        themes: ['light', 'dark'],
        languages: ['zh', 'en'],
        view_modes: ['sphere-3d', 'relation-2d'],
        relation_strategies: ['always', 'interaction-only', 'primary-emphasis'],
      },
    },
    nodes: makeNodes(count),
    relations: makeRelations(count, targets.get(count)),
  };
}

for (const count of targets.keys()) {
  writeFileSync(resolve(publicData, `graph-${count}.json`), `${JSON.stringify(makeGraph(count))}\n`);
}

const boundary = makeGraph(8);
boundary.meta.dataset_id = 'synthetic-boundary-valid';
boundary.relations = makeRelations(8, 10);
boundary.nodes[0].importance = -4;
boundary.nodes[1].importance = 25;
boundary.nodes[2].labels.en = 'A valid synthetic label that is intentionally much longer than a conventional label to test readability, truncation, overlap management, and runtime language switching';
boundary.nodes[7].labels.zh = '无连接节点';
boundary.relations = boundary.relations.slice(0, 7).filter((relation) => relation.source !== nodeId(7) && relation.target !== nodeId(7));
boundary.relations[0].type = 'unknown';
writeFileSync(resolve(publicData, 'boundary-valid.json'), `${JSON.stringify(boundary, null, 2)}\n`);

const invalidInputs = {
  visibility: 'control-only',
  cases: [
    { id: 'duplicate-node-id', expected_error: '$.nodes[1].id duplicate', patch: { path: '$.nodes[1].id', value_from: '$.nodes[0].id' } },
    { id: 'dangling-relation', expected_error: '$.relations[0].target', patch: { path: '$.relations[0].target', value: 'missing-node' } },
    { id: 'invalid-relation-type', expected_error: '$.relations[0].type', patch: { path: '$.relations[0].type', value: 'ambiguous' } },
    { id: 'malformed-importance', expected_error: '$.nodes[0].importance', patch: { path: '$.nodes[0].importance', value: 'not-a-number' } },
    { id: 'answer-bearing-coordinate', expected_error: '$.nodes[0].x is answer-bearing', patch: { path: '$.nodes[0].x', value: 0 } },
    { id: 'invalid-view-mode', expected_error: '$.runtime.viewMode', runtime: { viewMode: 'volume-4d' } },
  ],
};
writeFileSync(resolve(control, 'invalid-inputs.json'), `${JSON.stringify(invalidInputs, null, 2)}\n`);
execFileSync(process.execPath, [resolve(fixture, 'starter/scripts/generate-assets.mjs')], { stdio: 'inherit' });
console.log(JSON.stringify({
  status: 'success',
  summary: 'Deterministic synthetic datasets, control cases, and local assets generated.',
  next_actions: ['Run scripts/fixtures/macro-map-3d/verify-fixture.mjs.'],
  artifacts: [publicData, control],
}));
