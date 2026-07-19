import { createUnimplementedAdapter, SCENE_INPUT_CONTRACT } from './scene-adapter.js';

const app = document.querySelector('#app');
const adapter = createUnimplementedAdapter();

app.innerHTML = `
  <section class="starter-shell">
    <header>
      <p class="eyebrow">Greenfield benchmark starter</p>
      <h1>3D Relationship Scene</h1>
      <p>Implement the scene adapter against the supplied synthetic datasets.</p>
    </header>
    <div class="toolbar" aria-label="Runtime inputs">
      <label>Dataset <select data-field="dataset"><option>200</option><option>800</option><option>1481</option></select></label>
      <label>Theme <select data-field="theme">${SCENE_INPUT_CONTRACT.themes.map((item) => `<option>${item}</option>`).join('')}</select></label>
      <label>Language <select data-field="language">${SCENE_INPUT_CONTRACT.languages.map((item) => `<option>${item}</option>`).join('')}</select></label>
      <label>View <select data-field="viewMode">${SCENE_INPUT_CONTRACT.viewModes.map((item) => `<option>${item}</option>`).join('')}</select></label>
    </div>
    <div id="scene-host" role="application" aria-label="Candidate scene mount point">
      <img src="./public/assets/generated-grid.svg" alt="" aria-hidden="true">
      <p>No visualization answer is included. Mount your reusable component here.</p>
    </div>
    <pre id="status" aria-live="polite"></pre>
  </section>
`;

const status = document.querySelector('#status');
status.textContent = JSON.stringify(adapter.mount(document.querySelector('#scene-host'), {
  theme: 'light',
  language: 'zh',
  viewMode: 'sphere-3d',
  visibleOffset: { top: 0, right: 0, bottom: 0, left: 0 },
}), null, 2);

window.macroMapHarness = { adapter, contract: SCENE_INPUT_CONTRACT };
