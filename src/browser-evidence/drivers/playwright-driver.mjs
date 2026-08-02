import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { structuredError } from '../errors.mjs';
import { validateEvidencePackage } from '../evidence-package.mjs';
import { loadPlaywright, resolveChromiumExecutable } from './playwright-loader.mjs';
import {
  checkPolicyUrl,
  normalizePlaywrightPolicy,
  validateSpecUrlsAgainstPolicy,
} from './playwright-policy.mjs';
import { validatePlaywrightSpec } from './playwright-spec.mjs';
import { extractWebGLFacts } from '../webgl-inspector.mjs';
import { collectPerformance } from '../perf-collector.mjs';

function nowIso() {
  return new Date().toISOString();
}

function failure(code, message, failureClass, details = {}) {
  return structuredError(code, message, { failure_class: failureClass, ...details });
}

function artifactWriter(outDir, name, bytes) {
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, name);
  writeFileSync(target, bytes);
  return target;
}

function pngDimensions(bytes) {
  if (bytes.length < 24
    || bytes.toString('ascii', 1, 4) !== 'PNG'
    || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Chromium screenshot did not return a valid PNG IHDR.');
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

class CaptureDeadlineError extends Error {
  constructor(limitMs) {
    super(`Capture exceeded its ${limitMs}ms total deadline.`);
    this.name = 'CaptureDeadlineError';
    this.deadline = true;
    this.limitMs = limitMs;
  }
}

function createDeadline(limitMs, onExpire) {
  let expired = false;
  let rejectDeadline;
  const deadlinePromise = new Promise((resolvePromise, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    expired = true;
    try {
      onExpire();
    } finally {
      rejectDeadline(new CaptureDeadlineError(limitMs));
    }
  }, limitMs);
  return {
    get expired() {
      return expired;
    },
    race(operation) {
      return Promise.race([operation, deadlinePromise]);
    },
    clear() {
      clearTimeout(timer);
    },
  };
}

async function closeWithin(operation, timeoutMs = 1_000) {
  if (!operation) return;
  let timer;
  await Promise.race([
    operation.catch(() => {}),
    new Promise(resolvePromise => {
      timer = setTimeout(resolvePromise, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
}

function emptyEvidence(spec, started, failures, environment = {}) {
  return {
    schema_version: 1,
    capture_id: spec.capture_id,
    run_id: spec.run_id,
    case_id: spec.case_id,
    driver: 'playwright-chromium',
    captured_at: nowIso(),
    duration_ms: Date.now() - started,
    page_url: null,
    viewport: spec.viewport,
    user_agent: null,
    wait: { kind: 'declarative-steps' },
    screenshots: [],
    dom_snapshots: [],
    console_errors: [],
    page_errors: [],
    network_events: [],
    action_log: [],
    failures,
    status: 'error',
    canvas_webgl_proven: false,
    webgl_facts: [],
    perf_facts: [],
    environment,
    notes: [
      'Browser startup did not complete; no product behavior was evaluated.',
      'A browser smoke does not prove aesthetics or complete visual correctness.',
    ],
  };
}

async function collectState(page, selectors, label) {
  const state = await page.evaluate(requestedSelectors => {
    function hash(value) {
      let current = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        current ^= value.charCodeAt(index);
        current = Math.imul(current, 16777619);
      }
      return (current >>> 0).toString(16).padStart(8, '0');
    }
    const selectorState = requestedSelectors.map(selector => {
      const nodes = [...document.querySelectorAll(selector)];
      return {
        selector,
        count: nodes.length,
        visible_count: nodes.filter(node => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        }).length,
        text: nodes[0]?.textContent?.trim().slice(0, 2_000) ?? null,
        tag_names: [...new Set(nodes.map(node => node.tagName.toLowerCase()))],
      };
    });
    const canvases = [...document.querySelectorAll('canvas')].map((canvas, index) => {
      let dataUrl = null;
      let blankDataUrl = null;
      let readError = null;
      try {
        dataUrl = canvas.toDataURL('image/png');
        const blank = document.createElement('canvas');
        blank.width = canvas.width;
        blank.height = canvas.height;
        blankDataUrl = blank.toDataURL('image/png');
      } catch (error) {
        readError = error.message;
      }
      return {
        index,
        width: canvas.width,
        height: canvas.height,
        css_width: canvas.getBoundingClientRect().width,
        css_height: canvas.getBoundingClientRect().height,
        pixel_signature: dataUrl ? hash(dataUrl) : null,
        encoded_length: dataUrl?.length ?? 0,
        drawing_non_empty: dataUrl != null && blankDataUrl != null ? dataUrl !== blankDataUrl : null,
        read_error: readError,
      };
    });
    return {
      title: document.title,
      url: location.href,
      ready_state: document.readyState,
      selectors: selectorState,
      node_counts: {
        total: document.querySelectorAll('*').length,
        canvas: canvases.length,
        svg: document.querySelectorAll('svg').length,
        img: document.querySelectorAll('img').length,
      },
      canvases,
    };
  }, selectors);
  return { label, ts: nowIso(), summary: state };
}

function classifyInteractionError(error, step, label) {
  const message = error instanceof Error ? error.message : String(error);
  const details = { step: step.kind, label, selector: step.selector ?? null };
  if (step.selector && /waiting for locator|resolved to|strict mode violation|not visible|not attached/i.test(message)) {
    return failure('SELECTOR_MISSING', message, 'product', details);
  }
  if (/timeout/i.test(message)) {
    return failure('ACTION_TIMEOUT', message, 'product', details);
  }
  return failure('CAPTURE_INCOMPLETE', message, 'product', details);
}

async function executeStep(page, step, context) {
  const timeout = step.timeout_ms ?? context.spec.default_timeout_ms;
  const label = step.label ?? `step-${context.index + 1}-${step.kind}`;
  switch (step.kind) {
    case 'goto':
      await page.goto(step.url, { waitUntil: step.wait_until ?? 'load', timeout });
      context.pageUrl = page.url();
      if (context.spec.capture_dom_summary) {
        context.domSnapshots.push(await collectState(page, ['body'], `${label}-state`));
      }
      break;
    case 'wait':
      if (step.selector) {
        await page.locator(step.selector).waitFor({ state: step.state ?? 'visible', timeout });
      } else {
        await page.waitForTimeout(step.duration_ms);
      }
      break;
    case 'click':
      await page.locator(step.selector).click({ timeout });
      break;
    case 'hover':
      await page.locator(step.selector).hover({ timeout });
      break;
    case 'keyboard':
      if (step.selector) await page.locator(step.selector).press(step.key, { timeout });
      else await page.keyboard.press(step.key);
      break;
    case 'resize':
      await page.setViewportSize({ width: step.width, height: step.height });
      context.viewport = { width: step.width, height: step.height };
      break;
    case 'screenshot': {
      const bytes = await page.screenshot({ fullPage: step.full_page ?? false, type: 'png' });
      const path = context.outDir
        ? await context.writeArtifact(context.outDir, `${label}.png`, bytes)
        : null;
      context.screenshots.push({
        label,
        ts: nowIso(),
        path,
        format: 'png',
        dimensions: pngDimensions(bytes),
        digest: `sha256-${createHash('sha256').update(bytes).digest('hex')}`,
      });
      break;
    }
    case 'assert-visible': {
      const locator = page.locator(step.selector);
      const count = await locator.count();
      if (!count) throw Object.assign(new Error(`Selector not found: ${step.selector}`), { selectorMissing: true });
      const visible = count > 0 && await locator.first().isVisible();
      if (!visible) throw Object.assign(new Error(`Expected visible selector: ${step.selector}`), { assertion: true });
      break;
    }
    case 'assert-text': {
      const locator = page.locator(step.selector);
      const count = await locator.count();
      if (!count) throw Object.assign(new Error(`Selector not found: ${step.selector}`), { selectorMissing: true });
      const actual = count ? (await locator.first().textContent()) ?? '' : '';
      const ok = step.match === 'exact' ? actual.trim() === step.text : actual.includes(step.text);
      if (!ok) {
        throw Object.assign(new Error(`Expected ${step.selector} text to ${step.match ?? 'contain'} ${JSON.stringify(step.text)}; received ${JSON.stringify(actual.trim())}.`), { assertion: true });
      }
      break;
    }
    case 'collect-state':
      context.domSnapshots.push(await collectState(page, step.selectors, label));
      break;
    case 'webgl-inspect': {
      const facts = await extractWebGLFacts(page, step);
      context.webglFacts.push({ label, ts: nowIso(), facts });
      break;
    }
    case 'perf-measure': {
      const facts = await collectPerformance(page, step);
      context.perfFacts.push({ label, ts: nowIso(), facts });
      break;
    }
    default:
      throw new Error(`Unsupported step: ${step.kind}`);
  }
  return label;
}

export function createPlaywrightDriver({ load = loadPlaywright } = {}) {
  return {
    id: 'playwright-chromium',
    capabilities: {
      network_access: true,
      local_urls_only: true,
      real_browser: true,
      arbitrary_code_execution: false,
      canvas_state_collection: true,
      proves_aesthetics: false,
    },
    async capture(input, options = {}) {
      const validation = validatePlaywrightSpec(input);
      if (!validation.valid) {
        return {
          status: 'error',
          summary: `Playwright smoke spec is invalid: ${validation.errors.length} issue(s).`,
          next_actions: ['Fix the declarative spec; arbitrary JavaScript is not accepted.'],
          artifacts: [],
          errors: validation.errors,
          evidence: null,
        };
      }
      const policyValidation = normalizePlaywrightPolicy(options.policy);
      if (!policyValidation.valid) {
        return {
          status: 'error',
          summary: `Playwright control-plane policy is invalid: ${policyValidation.errors.length} issue(s).`,
          next_actions: ['Supply exact loopback origins and existing fixture roots from the trusted control plane.'],
          artifacts: [],
          errors: policyValidation.errors,
          evidence: null,
        };
      }
      const policyErrors = validateSpecUrlsAgainstPolicy(validation.spec, policyValidation.policy);
      if (policyErrors.length) {
        return {
          status: 'error',
          summary: `Playwright smoke spec violates the control-plane policy: ${policyErrors.length} issue(s).`,
          next_actions: ['Declare only the exact fixture origin or real fixture root required by this capture.'],
          artifacts: [],
          errors: policyErrors,
          evidence: null,
        };
      }
      return runCapture(validation.spec, { ...options, policy: policyValidation.policy, load });
    },
  };
}

async function runCapture(spec, {
  outDir = null,
  writeArtifact = artifactWriter,
  load = loadPlaywright,
  policy,
} = {}) {
  const started = Date.now();
  let playwrightInfo;
  let executable;
  let browser;
  let context;
  const policyNetworkEvents = [];
  const deadline = createDeadline(spec.capture_deadline_ms, () => {
    void context?.close().catch(() => {});
    void browser?.close().catch(() => {});
  });
  try {
    playwrightInfo = load();
    executable = resolveChromiumExecutable(playwrightInfo.playwright.chromium);
    const launch = playwrightInfo.playwright.chromium.launch({
      headless: true,
      timeout: spec.capture_deadline_ms,
      ...(executable.executablePath ? { executablePath: executable.executablePath } : {}),
    });
    launch.then(lateBrowser => {
      if (deadline.expired) void lateBrowser.close().catch(() => {});
    }).catch(() => {});
    browser = await deadline.race(launch);
  } catch (error) {
    deadline.clear();
    const environmentFailure = failure('DRIVER_UNAVAILABLE', error.message, 'environment', {
      phase: 'browser-launch',
      deadline_exceeded: error.deadline === true ? true : undefined,
      capture_deadline_ms: error.deadline === true ? spec.capture_deadline_ms : undefined,
      attempts: error.attempts ?? undefined,
    });
    const evidence = emptyEvidence(spec, started, [environmentFailure], {
      playwright_source: playwrightInfo?.source ?? null,
      chromium_source: executable?.source ?? null,
    });
    if (outDir) await writeArtifact(outDir, 'browser-evidence.json', Buffer.from(JSON.stringify(evidence, null, 2)));
    return envelope(evidence, outDir);
  }

  let page;
  let userAgent = null;
  let browserVersion = null;
  try {
    context = await deadline.race(browser.newContext({
      viewport: spec.viewport,
      serviceWorkers: 'block',
    }));
    await deadline.race(context.addInitScript(() => {
      const blockedRegister = () => Promise.reject(new DOMException(
        'Service Worker registration is blocked by browser evidence policy.',
        'SecurityError',
      ));
      if (globalThis.ServiceWorkerContainer) {
        Object.defineProperty(globalThis.ServiceWorkerContainer.prototype, 'register', {
          configurable: false,
          writable: false,
          value: blockedRegister,
        });
      }
      if (globalThis.navigator?.serviceWorker) {
        Object.defineProperty(globalThis.navigator.serviceWorker, 'register', {
          configurable: false,
          writable: false,
          value: blockedRegister,
        });
      }
    }));
    await context.route('**/*', async route => {
      const request = route.request();
      const decision = checkPolicyUrl(request.url(), policy);
      if (decision.allowed) {
        await route.continue();
        return;
      }
      policyNetworkEvents.push({
        ts: nowIso(),
        url: request.url(),
        method: request.method(),
        resource_type: request.resourceType(),
        failed: true,
        blocked_by_policy: true,
        error_text: decision.reason,
      });
      await route.abort('blockedbyclient');
    });
    if (typeof context.routeWebSocket !== 'function') {
      throw new Error('Installed Playwright lacks routeWebSocket; WebSocket isolation cannot be enforced.');
    }
    await deadline.race(context.routeWebSocket('**/*', async websocket => {
      policyNetworkEvents.push({
        ts: nowIso(),
        url: websocket.url(),
        method: 'GET',
        resource_type: 'websocket',
        failed: true,
        blocked_by_policy: true,
        expected_policy_boundary: true,
        error_text: 'WebSocket connections are forbidden during browser evidence capture.',
      });
      await websocket.close({ code: 1008, reason: 'Blocked by browser evidence policy' });
    }));
    page = await deadline.race(context.newPage());
    browserVersion = browser.version();
    userAgent = await deadline.race(page.evaluate(() => navigator.userAgent));
  } catch (error) {
    await closeWithin(context?.close());
    await closeWithin(browser.close());
    deadline.clear();
    const environmentFailure = failure('DRIVER_UNAVAILABLE', error.message, 'environment', {
      phase: 'browser-context',
      deadline_exceeded: error.deadline === true ? true : undefined,
      capture_deadline_ms: error.deadline === true ? spec.capture_deadline_ms : undefined,
    });
    const evidence = emptyEvidence(spec, started, [environmentFailure], {
      playwright_source: playwrightInfo.source,
      chromium_source: executable.source,
    });
    if (outDir) await writeArtifact(outDir, 'browser-evidence.json', Buffer.from(JSON.stringify(evidence, null, 2)));
    return envelope(evidence, outDir);
  }
  const consoleMessages = [];
  const consoleErrors = [];
  const pageErrors = [];
  const networkEvents = policyNetworkEvents;
  const failures = [];
  const actionLog = [];
  const screenshots = [];
  const domSnapshots = [];
  const webglFacts = [];
  const perfFacts = [];
  let pageUrl = null;
  let viewport = { ...spec.viewport };
  let pageLoaded = false;
  let deadlineFailureRecorded = false;

  page.on('console', message => {
    const entry = { ts: nowIso(), type: message.type(), message: message.text() };
    consoleMessages.push(entry);
    if (spec.capture_console_errors && message.type() === 'error') consoleErrors.push(entry);
  });
  page.on('pageerror', error => {
    if (spec.capture_page_errors) pageErrors.push({ ts: nowIso(), message: error.message, name: error.name });
  });
  page.on('requestfailed', request => {
    if (spec.capture_network_failures) {
      networkEvents.push({
        ts: nowIso(),
        url: request.url(),
        method: request.method(),
        failed: true,
        error_text: request.failure()?.errorText ?? null,
      });
    }
  });
  page.on('response', response => {
    if (spec.capture_network_failures && response.status() >= 400) {
      networkEvents.push({
        ts: nowIso(),
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        failed: true,
      });
    }
  });

  try {
    for (let index = 0; index < spec.steps.length; index += 1) {
      const step = spec.steps[index];
      const label = step.label ?? `step-${index + 1}-${step.kind}`;
      const before = Date.now();
      const entry = { ts: nowIso(), phase: 'step', index, kind: step.kind, label, status: 'running' };
      actionLog.push(entry);
      try {
        await deadline.race(executeStep(page, step, {
          spec, index, outDir, writeArtifact, screenshots, domSnapshots, viewport, pageUrl,
          webglFacts, perfFacts,
        }));
        if (step.kind === 'resize') viewport = { width: step.width, height: step.height };
        if (step.kind === 'goto') {
          pageUrl = page.url();
          pageLoaded = true;
        }
        entry.status = 'passed';
      } catch (error) {
        const item = error.deadline
          ? pageLoaded
            ? failure('CAPTURE_INCOMPLETE', error.message, 'product', {
              phase: 'capture-deadline',
              step: step.kind,
              label,
              deadline_exceeded: true,
              capture_deadline_ms: spec.capture_deadline_ms,
            })
            : failure('DRIVER_UNAVAILABLE', error.message, 'environment', {
              phase: 'capture-deadline',
              step: step.kind,
              label,
              deadline_exceeded: true,
              capture_deadline_ms: spec.capture_deadline_ms,
            })
          : step.kind === 'goto'
          ? failure('LOAD_FAILED', error.message, 'navigation', { step: step.kind, label, url: step.url })
          : error.selectorMissing
            ? failure('SELECTOR_MISSING', error.message, 'product', { step: step.kind, label, selector: step.selector })
          : error.assertion
            ? failure('ASSERT_FAILED', error.message, 'product', { step: step.kind, label, selector: step.selector })
            : classifyInteractionError(error, step, label);
        failures.push(item);
        if (error.deadline) deadlineFailureRecorded = true;
        entry.status = 'failed';
        entry.failure = item;
        if (step.kind === 'goto' || error.deadline) break;
      } finally {
        entry.duration_ms = Date.now() - before;
      }
    }
    if (!deadline.expired) pageUrl = page.url();
  } finally {
    await closeWithin(context.close());
    await closeWithin(browser.close());
    if (deadline.expired && !deadlineFailureRecorded) {
      failures.push(failure('CAPTURE_INCOMPLETE', `Capture exceeded its ${spec.capture_deadline_ms}ms total deadline.`, 'product', {
        phase: 'capture-finalization',
        deadline_exceeded: true,
        capture_deadline_ms: spec.capture_deadline_ms,
      }));
    }
    deadline.clear();
  }

  if (pageErrors.length) {
    failures.push(failure('PAGE_ERROR', `Captured ${pageErrors.length} uncaught page error(s).`, 'product', { count: pageErrors.length }));
  }
  const reportableNetworkEvents = networkEvents.filter(event => !event.expected_policy_boundary);
  if (reportableNetworkEvents.length) {
    failures.push(failure('NETWORK_FAILURE', `Captured ${reportableNetworkEvents.length} failed network request(s).`, 'product', {
      count: reportableNetworkEvents.length,
    }));
  }

  const evidence = {
    schema_version: 1,
    capture_id: spec.capture_id,
    run_id: spec.run_id,
    case_id: spec.case_id,
    driver: 'playwright-chromium',
    captured_at: nowIso(),
    duration_ms: Date.now() - started,
    page_url: pageUrl,
    viewport,
    user_agent: userAgent,
    wait: { kind: 'declarative-steps' },
    screenshots,
    dom_snapshots: domSnapshots,
    console_errors: consoleErrors,
    console_messages: consoleMessages,
    page_errors: pageErrors,
    network_events: networkEvents,
    action_log: actionLog,
    failures,
    status: failures.length ? (failures.some(item => ['environment', 'navigation'].includes(item.failure_class)) ? 'error' : 'warning') : 'success',
    canvas_webgl_proven: false,
    environment: {
      playwright_source: playwrightInfo.source,
      chromium_source: executable.source,
      browser_version: browserVersion,
    },
    webgl_facts: webglFacts,
    perf_facts: perfFacts,
    notes: [
      'Captured with a real headless Chromium through Playwright using declarative steps only.',
      'DOM presence, interactions, assertions, screenshots, and collected canvas signatures prove only the declared smoke contract.',
      'Aesthetics, complete visual correctness, pixel-level equivalence, cross-browser behavior, and WebGL correctness require separate review.',
      'webgl_facts and perf_facts are observations only; their assertions are quality-enhancement signals, not business-correctness gates.',
    ],
  };
  const contract = validateEvidencePackage(evidence);
  if (!contract.valid) throw new Error(`Internal evidence contract violation: ${JSON.stringify(contract.errors)}`);
  if (outDir) await writeArtifact(outDir, 'browser-evidence.json', Buffer.from(JSON.stringify(evidence, null, 2)));
  return envelope(evidence, outDir);
}

function envelope(evidence, outDir) {
  return {
    status: evidence.status,
    summary: evidence.status === 'success'
      ? `Captured real Chromium evidence for ${evidence.case_id}.`
      : `Captured real Chromium evidence with ${evidence.failures.length} structured failure(s).`,
    next_actions: evidence.status === 'success'
      ? ['Complete human visual review; this smoke does not prove aesthetics.']
      : evidence.failures.map(item => `${item.failure_class}: ${item.code}: ${item.message}`),
    artifacts: outDir ? [join(outDir, 'browser-evidence.json'), ...evidence.screenshots.map(item => item.path).filter(Boolean)] : [],
    errors: evidence.failures,
    evidence,
  };
}
