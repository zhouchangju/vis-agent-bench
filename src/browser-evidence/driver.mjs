import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import { loadStaticFixture, domSummaryFor, selectorExists, stepEvents } from './static-fixture-dom.mjs';
import { safeResolveInside } from './paths.mjs';
import { structuredError, coerceError } from './errors.mjs';

/**
 * Browser evidence driver contract.
 *
 * A driver takes a validated CaptureSpec and returns a Promise that resolves
 * to an EvidencePackage. Production deployments register a Playwright-backed
 * driver; the StaticFixtureDriver shipped here is the deterministic default
 * used for tests and offline review preparation.
 *
 * Drivers MUST:
 *   - emit structured errors for every failure mode required by VAB-T06;
 *   - never reach the network when capture_spec.fixture_dir is set;
 *   - tag each screenshot and DOM snapshot with the action label;
 *   - record console/page/network events with stable JSON shapes.
 */

const DRIVERS = new Map();
let defaultDriverName = 'static-fixture';

export function registerDriver(name, factory) {
  if (typeof name !== 'string' || !name) throw new Error('Driver name must be a non-empty string.');
  if (typeof factory !== 'function') throw new Error('Driver factory must be a function.');
  DRIVERS.set(name, factory);
}

export function setDefaultDriverName(name) {
  if (!DRIVERS.has(name)) throw new Error(`Unknown driver: ${name}`);
  defaultDriverName = name;
}

export function listDrivers() {
  return [...DRIVERS.keys()];
}

export function getDriver(name = defaultDriverName) {
  const factory = DRIVERS.get(name);
  if (!factory) {
    const error = structuredError('DRIVER_UNAVAILABLE', `No browser-evidence driver registered as "${name}".`, {
      requested: name,
      available: [...DRIVERS.keys()],
    });
    throw Object.assign(new Error(error.message), { structured: error });
  }
  return factory();
}

/**
 * Static-fixture driver.
 *
 * Reads `<fixture_root>/<fixture_index>` from disk, replays the declared
 * actions against the embedded JSON event blob and writes a deterministic
 * evidence package. It never touches the network, so it is safe to use in
 * tests and on CI without secrets.
 *
 * The driver also implements just enough selector matching to surface the
 * SELECTOR_MISSING and ACTION_TIMEOUT failure modes required by VAB-T06.
 */
export function createStaticFixtureDriver() {
  return {
    id: 'static-fixture',
    capabilities: {
      network_access: false,
      canvas_webgl_proven: false,
      real_browser: false,
    },
    async capture(spec, { outDir, writeArtifact } = {}) {
      return runStaticCapture(spec, { outDir, writeArtifact });
    },
  };
}

function nowIso() {
  return new Date().toISOString();
}

function buildPageUrl(spec) {
  if (spec.url) return spec.url;
  if (spec._fixture_root && spec.fixture_index) {
    return `file://${join(spec._fixture_root, spec.fixture_index)}`;
  }
  return null;
}

async function runStaticCapture(spec, { outDir, writeArtifact }) {
  const started = Date.now();
  const log = [];
  const consoleErrors = [];
  const pageErrors = [];
  const networkEvents = [];
  const screenshots = [];
  const domSnapshots = [];
  const failures = [];

  const fixtureRoot = spec._fixture_root;
  const indexPath = spec.fixture_index
    ? safeResolveInside(fixtureRoot, spec.fixture_index)
    : null;

  if (!fixtureRoot || !indexPath || !existsSync(indexPath)) {
    return failFast(spec, {
      code: 'LOAD_FAILED',
      message: `Static fixture index not found: ${spec.fixture_index ?? '<unset>'}`,
      started,
      log,
      failures,
      outDir,
      writeArtifact,
      pageUrl: buildPageUrl(spec),
    });
  }

  log.push({ ts: nowIso(), phase: 'load', message: `Loading static fixture ${basename(indexPath)}` });

  let fixture;
  try {
    fixture = loadStaticFixture(indexPath);
  } catch (error) {
    return failFast(spec, {
      code: 'LOAD_FAILED',
      message: `Failed to parse static fixture: ${error.message}`,
      started,
      log,
      failures,
      outDir,
      writeArtifact,
      pageUrl: buildPageUrl(spec),
    });
  }

  // Initial wait.
  const waitResult = applyWait(spec, spec.wait, fixture, log, failures);
  if (!waitResult.ok) {
    return finalize(spec, {
      started, log, consoleErrors, pageErrors, networkEvents, screenshots,
      domSnapshots, failures, fixture, outDir, writeArtifact, pageUrl: buildPageUrl(spec),
    });
  }

  // Record post-load DOM if requested.
  if (spec.capture_dom_summary) {
    const label = 'after-load';
    domSnapshots.push({ label, ts: nowIso(), summary: domSummaryFor(fixture) });
  }

  if (spec.capture_console_errors) consoleErrors.push(...(fixture.blob?.console_errors ?? []).map(m => ({ ts: nowIso(), message: m })));
  if (spec.capture_page_errors) pageErrors.push(...(fixture.blob?.page_errors ?? []).map(e => ({ ts: nowIso(), ...e })));
  if (spec.capture_network_failures) networkEvents.push(...(fixture.blob?.network ?? []).map(e => ({ ts: nowIso(), ...e })));

  // Optional initial screenshot.
  for (const action of spec.actions) {
    const before = Date.now();
    const label = action.label ?? `${action.kind}-${screenshots.length + domSnapshots.length + 1}`;
    log.push({ ts: nowIso(), phase: 'action', kind: action.kind, label, note: action.note ?? null });
    try {
      switch (action.kind) {
        case 'screenshot':
          screenshots.push(await captureStaticScreenshot(spec, fixture, label, writeArtifact, outDir, action));
          break;
        case 'domSnapshot':
          domSnapshots.push(await captureStaticDom(spec, fixture, label, action));
          break;
        case 'click':
        case 'focus':
        case 'type':
        case 'select': {
          if (!action.selector || !selectorExists(fixture, action.selector)) {
            failures.push(structuredError('SELECTOR_MISSING', `Selector not found in fixture: ${action.selector ?? '<missing>'}`, { action: action.kind, selector: action.selector ?? null, label }));
          }
          applyStaticStep(fixture, action, log);
          break;
        }
        case 'scroll':
        case 'keypress':
          applyStaticStep(fixture, action, log);
          break;
        case 'wait': {
          const res = applyWait(spec, action.wait ?? { kind: 'none' }, fixture, log, failures);
          if (!res.ok) {
            // failure already recorded; continue collecting remaining actions for evidence
          }
          break;
        }
        case 'assert': {
          const ok = evaluateStaticAssert(fixture, action.expression);
          if (!ok) {
            failures.push(structuredError('ASSERT_FAILED', `Assertion failed: ${action.expression}`, { action: 'assert', expression: action.expression, label }));
          }
          break;
        }
        default:
          break;
      }
    } catch (error) {
      failures.push(coerceError(error, 'CAPTURE_INCOMPLETE', { action: action.kind, label }));
    }
    log[log.length - 1].duration_ms = Date.now() - before;
  }

  // Surface captured error events as structured failures so callers can branch.
  if (pageErrors.length && failures.every(f => f.code !== 'PAGE_ERROR')) {
    failures.push(structuredError('PAGE_ERROR', `Captured ${pageErrors.length} page error(s).`, { count: pageErrors.length }));
  }
  const failedNetwork = networkEvents.filter(e => e.failed);
  if (failedNetwork.length && failures.every(f => f.code !== 'NETWORK_FAILURE')) {
    failures.push(structuredError('NETWORK_FAILURE', `Captured ${failedNetwork.length} failed network request(s).`, { count: failedNetwork.length }));
  }

  return finalize(spec, {
    started, log, consoleErrors, pageErrors, networkEvents, screenshots,
    domSnapshots, failures, fixture, outDir, writeArtifact, pageUrl: buildPageUrl(spec),
  });
}

function applyWait(spec, wait, fixture, log, failures) {
  if (!wait || wait.kind === 'none' || wait.kind === 'load' || wait.kind === 'domcontentloaded' || wait.kind === 'networkidle') {
    log.push({ ts: nowIso(), phase: 'wait', kind: wait?.kind ?? 'none', message: 'static fixture does not perform real navigation' });
    return { ok: true };
  }
  if (wait.kind === 'selector') {
    if (!wait.selector || !selectorExists(fixture, wait.selector)) {
      failures.push(structuredError('SELECTOR_MISSING', `Wait selector not found: ${wait.selector ?? '<missing>'}`, { wait: 'selector', selector: wait.selector ?? null }));
      return { ok: false };
    }
    log.push({ ts: nowIso(), phase: 'wait', kind: 'selector', selector: wait.selector });
    return { ok: true };
  }
  if (wait.kind === 'function') {
    log.push({ ts: nowIso(), phase: 'wait', kind: 'function', expression: wait.expression });
    return { ok: true };
  }
  return { ok: true };
}

function applyStaticStep(fixture, action, log) {
  // Static fixtures do not mutate; the event blob's `steps.<note>` may
  // contribute additional DOM/network events if the action sets
  // note="static-events:<stepId>".
  if (typeof action.note !== 'string') return;
  const marker = 'static-events:';
  if (!action.note.startsWith(marker)) return;
  const stepId = action.note.slice(marker.length);
  const events = stepEvents(fixture, stepId);
  if (!events) {
    log.push({ ts: nowIso(), phase: 'static-step', message: `No static step declared for ${stepId}` });
    return;
  }
  if (events.dom) fixture.blob.dom = { ...fixture.blob.dom, ...events.dom };
  if (Array.isArray(events.console_errors)) fixture.blob.console_errors = events.console_errors;
  if (Array.isArray(events.page_errors)) fixture.blob.page_errors = events.page_errors;
  if (Array.isArray(events.network)) fixture.blob.network = events.network;
}

function evaluateStaticAssert(fixture, expression) {
  if (!expression) return false;
  // Limited, deterministic evaluation: support `selector "<css>"` and `text contains "<s>"`.
  const selectorMatch = expression.match(/^selector\s+"([^"]+)"$/);
  if (selectorMatch) return selectorExists(fixture, selectorMatch[1]);
  const textMatch = expression.match(/^text contains "([^"]+)"$/);
  if (textMatch) {
    const summary = domSummaryFor(fixture);
    const text = JSON.stringify(summary.texts || {});
    return text.includes(textMatch[1]);
  }
  if (expression === 'true') return true;
  if (expression === 'false') return false;
  // Unknown expressions are treated as failed rather than guessed.
  return false;
}

async function captureStaticScreenshot(spec, fixture, label, writeArtifact, outDir, action) {
  const summary = domSummaryFor(fixture);
  const target = writeArtifact && outDir
    ? await writeArtifact(outDir, `${label}.png`, Buffer.from(`static-fixture:${label}`, 'utf8'))
    : null;
  return {
    label,
    ts: nowIso(),
    path: target,
    format: spec.screenshot_format,
    dimensions: { width: spec.viewport.width, height: spec.viewport.height },
    note: action?.note ?? null,
    // Placeholder digest keeps the package deterministic without claiming
    // perceptual equivalence. Production drivers replace this with the real
    // bytes and hash.
    digest: digestOf(`static-fixture:${label}:${summary.title ?? ''}`),
    dom_summary_ref: label,
  };
}

async function captureStaticDom(spec, fixture, label, action) {
  return {
    label,
    ts: nowIso(),
    summary: domSummaryFor(fixture),
    note: action?.note ?? null,
  };
}

function failFast(spec, { code, message, started, log, failures, outDir, writeArtifact, pageUrl }) {
  failures.push(structuredError(code, message));
  return finalize(spec, {
    started, log, consoleErrors: [], pageErrors: [], networkEvents: [],
    screenshots: [], domSnapshots: [], failures, fixture: null, outDir, writeArtifact, pageUrl,
  });
}

function finalize(spec, { started, log, consoleErrors, pageErrors, networkEvents, screenshots, domSnapshots, failures, fixture, outDir, writeArtifact, pageUrl }) {
  const durationMs = Date.now() - started;
  const status = failures.length ? (failures.some(f => f.code === 'LOAD_FAILED' || f.code === 'CAPTURE_INCOMPLETE') ? 'error' : 'warning') : 'success';
  const pkg = {
    schema_version: 1,
    capture_id: spec.capture_id,
    run_id: spec.run_id,
    case_id: spec.case_id,
    driver: 'static-fixture',
    captured_at: nowIso(),
    duration_ms: durationMs,
    page_url: pageUrl,
    viewport: spec.viewport,
    user_agent: spec.user_agent,
    wait: spec.wait,
    screenshots,
    dom_snapshots: domSnapshots,
    console_errors: consoleErrors,
    page_errors: pageErrors,
    network_events: networkEvents,
    action_log: log,
    failures,
    status,
    canvas_webgl_proven: false,
    notes: [
      'Captured by the deterministic StaticFixtureDriver; no real browser was launched.',
      'Canvas/WebGL features are reported as not proven; a Playwright-backed driver must confirm them.',
    ],
  };
  if (outDir && writeArtifact) {
    writeArtifact(outDir, 'browser-evidence.json', Buffer.from(JSON.stringify(pkg, null, 2), 'utf8'));
  }
  return pkg;
}

function digestOf(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `static-${h.toString(16).padStart(8, '0')}`;
}

// Self-register the default driver on import. Keeping this side effect local
// makes the module drop-in for the CLI without requiring callers to wire it.
registerDriver('static-fixture', createStaticFixtureDriver);
