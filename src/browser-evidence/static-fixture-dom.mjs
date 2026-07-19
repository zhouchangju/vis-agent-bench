/**
 * Minimal, dependency-free DOM summary simulator for static fixtures.
 *
 * The goal is NOT to be a browser engine. The goal is to make
 * `StaticFixtureDriver` deterministic and inspectable so the harness can be
 * tested end-to-end against local HTML files. Production runs use a real
 * browser driver (Playwright) which is left to a future task.
 *
 * A fixture is a plain HTML file that optionally embeds a JSON blob in
 * `<script type="application/json" data-static-events>`. The blob describes
 * the DOM and console/page events that should be reported. This keeps tests
 * fully hermetic.
 *
 * Event blob shape:
 *   {
 *     "dom": {
 *       "selectors": ["#chart", "button.cta", ...],
 *       "texts": { "#chart h1": "Foo" },
 *       "snapshot_label": "after-load"
 *     },
 *     "console_errors": ["boom"],
 *     "page_errors": [{ "message": "x is undefined" }],
 *     "network": [
 *       { "url": "https://x/api", "status": 0, "failed": true, "method": "GET" }
 *     ]
 *   }
 *
 * The static driver applies the blob on load, and again after each declared
 * action that carries `note: "static-events:<stepId>"` referencing a nested
 * blob under `steps.<stepId>`.
 */

import { readFileSync } from 'node:fs';

const SCRIPT_MARKER = 'data-static-events';
const STATIC_EVENT_TYPE = 'application/json';

function extractEventBlob(html) {
  const open = `<script type="${STATIC_EVENT_TYPE}" ${SCRIPT_MARKER}>`;
  const openAlt = `<script ${SCRIPT_MARKER} type="${STATIC_EVENT_TYPE}">`;
  const start = html.indexOf(open);
  const altStart = html.indexOf(openAlt);
  const begin = start === -1 ? altStart : (altStart === -1 ? start : Math.min(start, altStart));
  if (begin === -1) return { dom: { selectors: [] }, console_errors: [], page_errors: [], network: [], steps: {} };
  const body = html.slice(begin);
  const afterOpen = body.indexOf('>') + 1;
  const close = body.indexOf('</script>', afterOpen);
  if (close === -1) return { dom: { selectors: [] }, console_errors: [], page_errors: [], network: [], steps: {} };
  const raw = body.slice(afterOpen, close).trim();
  if (!raw) return { dom: { selectors: [] }, console_errors: [], page_errors: [], network: [], steps: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      dom: parsed.dom ?? { selectors: [] },
      console_errors: Array.isArray(parsed.console_errors) ? parsed.console_errors : [],
      page_errors: Array.isArray(parsed.page_errors) ? parsed.page_errors : [],
      network: Array.isArray(parsed.network) ? parsed.network : [],
      steps: parsed.steps ?? {},
    };
  } catch (error) {
    throw new Error(`Static fixture event blob is not valid JSON: ${error.message}`);
  }
}

function extractTitle(html) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}

function countNodes(html, tag) {
  const matches = html.match(new RegExp(`<${tag}\\b`, 'gi'));
  return matches ? matches.length : 0;
}

export function loadStaticFixture(absolutePath) {
  const html = readFileSync(absolutePath, 'utf8');
  const blob = extractEventBlob(html);
  return {
    html,
    title: extractTitle(html),
    node_counts: {
      script: countNodes(html, 'script'),
      img: countNodes(html, 'img'),
      svg: countNodes(html, 'svg'),
      canvas: countNodes(html, 'canvas'),
      a: countNodes(html, 'a'),
      table: countNodes(html, 'table'),
    },
    blob,
  };
}

export function domSummaryFor(fixture) {
  const dom = fixture.blob?.dom ?? {};
  const selectors = Array.isArray(dom.selectors) ? dom.selectors : [];
  return {
    title: fixture.title,
    url: dom.url ?? null,
    matched_selectors: selectors,
    texts: dom.texts && typeof dom.texts === 'object' ? dom.texts : {},
    node_counts: fixture.node_counts,
    snapshot_label: dom.snapshot_label ?? null,
    canvas_webgl: dom.canvas_webgl ?? { canvas_count: fixture.node_counts.canvas ?? 0, webgl_supported: null },
  };
}

export function stepEvents(fixture, stepId) {
  const step = fixture.blob?.steps?.[stepId];
  if (!step) return null;
  return {
    dom: step.dom ?? fixture.blob?.dom ?? { selectors: [] },
    console_errors: Array.isArray(step.console_errors) ? step.console_errors : [],
    page_errors: Array.isArray(step.page_errors) ? step.page_errors : [],
    network: Array.isArray(step.network) ? step.network : [],
  };
}

export function selectorExists(fixture, selector) {
  const selectors = fixture.blob?.dom?.selectors ?? [];
  if (selectors.includes(selector)) return true;
  // Treat simple id / class / tag selectors as present if the raw HTML mentions them.
  if (/^#[A-Za-z][-A-Za-z0-9_]*$/.test(selector)) {
    const id = selector.slice(1);
    return new RegExp(`id=["']${id}["']`).test(fixture.html);
  }
  if (/^\.[A-Za-z][-A-Za-z0-9_]*$/.test(selector)) {
    const cls = selector.slice(1);
    return new RegExp(`class=["'][^"']*\\b${cls}\\b[^"']*["']`).test(fixture.html);
  }
  if (/^[a-z][a-z0-9]*$/i.test(selector)) {
    return new RegExp(`<${selector}\\b`, 'i').test(fixture.html);
  }
  return false;
}
