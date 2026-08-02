// StandardChart industry-chain two-way tree starter.
//
// This is intentionally a placeholder skeleton: it renders a three-column
// shell with a centered root, an "Upstream" column on the left, and a
// "Downstream" column on the right. It does NOT implement:
//   - a real bidirectional tree layout,
//   - edge routing that avoids nodes,
//   - stable positions when sibling branches expand/collapse,
//   - the StandardChart extension lifecycle, theme mechanism, or option API.
//
// The candidate is expected to keep the public DOM contract
// (`#two-way-tree-root`, `data-node-id`, `data-direction`, the event bus
// emitted on `window.__TWO_WAY_TREE__`) while filling in the gaps.

import { loadIndustryChain, listNeighbours, TWO_WAY_DIRECTIONS } from './data-loader.js';

const root = document.querySelector('#root');
const chain = loadIndustryChain();

root.innerHTML = `
  <header class="starter-header">
    <p class="eyebrow">Synthetic fixture</p>
    <h1>StandardChart two-way industry chain</h1>
    <p>Replace the placeholder with a data-driven bidirectional tree. No layout answer is included.</p>
  </header>
  <section id="two-way-tree-root" class="implementation-surface" aria-label="Two-way industry chain implementation surface">
    <div class="column" data-direction="upstream">
      <h2>Upstream</h2>
      <ul id="upstream-list" class="node-list"></ul>
    </div>
    <div class="column" data-direction="root">
      <h2>Focus</h2>
      <ul id="root-list" class="node-list"></ul>
    </div>
    <div class="column" data-direction="downstream">
      <h2>Downstream</h2>
      <ul id="downstream-list" class="node-list"></ul>
    </div>
  </section>
  <output id="event-stream" role="status" aria-live="polite"></output>
`;

function renderNode(node, direction) {
  const li = document.createElement('li');
  li.className = 'node';
  li.dataset.nodeId = node.id;
  li.dataset.direction = direction;
  li.tabIndex = 0;
  const changeText = node.changePct == null ? '—' : `${node.changePct > 0 ? '+' : ''}${node.changePct.toFixed(2)}%`;
  li.innerHTML = `
    <span class="node-name">${node.name}</span>
    <span class="node-change">${changeText}</span>
  `;
  li.addEventListener('click', () => emit('node-click', { nodeId: node.id, direction }));
  li.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      emit('node-click', { nodeId: node.id, direction });
    }
  });
  return li;
}

const rootList = document.querySelector('#root-list');
const upstreamList = document.querySelector('#upstream-list');
const downstreamList = document.querySelector('#downstream-list');

const rootNode = chain.nodes.find(node => node.id === chain.root_id);
if (rootNode) rootList.appendChild(renderNode(rootNode, 'root'));

// Naive first-level neighbours only. The candidate must extend this into a
// recursive bidirectional tree, support asymmetric depth on each side, and
// keep layout stable across expand/collapse.
for (const direction of TWO_WAY_DIRECTIONS) {
  const list = direction === 'upstream' ? upstreamList : downstreamList;
  for (const id of listNeighbours(chain, chain.root_id, direction)) {
    const node = chain.nodes.find(item => item.id === id);
    if (node) list.appendChild(renderNode(node, direction));
  }
}

root.setAttribute('aria-busy', 'false');

window.__TWO_WAY_TREE__ = {
  chain,
  emit,
  // Intentionally missing: expand/collapse API, setOption, theme wiring,
  // dispose, and StandardChart lifecycle hooks. The candidate must add them.
};

function emit(type, payload) {
  const stream = document.querySelector('#event-stream');
  const line = `[${type}] ${JSON.stringify(payload)}`;
  if (stream) stream.textContent = `${stream.textContent}\n${line}`.trim();
  window.dispatchEvent(new CustomEvent('two-way-tree:event', { detail: { type, payload } }));
}
