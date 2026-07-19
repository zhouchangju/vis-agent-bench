import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { structuredError } from '../errors.mjs';
import { validateEvidencePackage } from '../evidence-package.mjs';
import { loadPlaywright, resolveChromiumExecutable } from './playwright-loader.mjs';
import { validatePlaywrightSpec } from './playwright-spec.mjs';

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

function isAllowedRuntimeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'file:'
      || (['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '::1'].includes(url.hostname));
  } catch {
    return false;
  }
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
        dimensions: { ...context.viewport },
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
      return runCapture(validation.spec, { ...options, load });
    },
  };
}

async function runCapture(spec, { outDir = null, writeArtifact = artifactWriter, load = loadPlaywright } = {}) {
  const started = Date.now();
  let playwrightInfo;
  let executable;
  let browser;
  try {
    playwrightInfo = load();
    executable = resolveChromiumExecutable(playwrightInfo.playwright.chromium);
    browser = await playwrightInfo.playwright.chromium.launch({
      headless: true,
      ...(executable.executablePath ? { executablePath: executable.executablePath } : {}),
    });
  } catch (error) {
    const environmentFailure = failure('DRIVER_UNAVAILABLE', error.message, 'environment', {
      phase: 'browser-launch',
      attempts: error.attempts ?? undefined,
    });
    const evidence = emptyEvidence(spec, started, [environmentFailure], {
      playwright_source: playwrightInfo?.source ?? null,
      chromium_source: executable?.source ?? null,
    });
    if (outDir) await writeArtifact(outDir, 'browser-evidence.json', Buffer.from(JSON.stringify(evidence, null, 2)));
    return envelope(evidence, outDir);
  }

  let context;
  let page;
  let userAgent = null;
  let browserVersion = null;
  try {
    context = await browser.newContext({ viewport: spec.viewport });
    await context.route('**/*', async route => {
      if (isAllowedRuntimeUrl(route.request().url())) await route.continue();
      else await route.abort('blockedbyclient');
    });
    page = await context.newPage();
    browserVersion = browser.version();
    userAgent = await page.evaluate(() => navigator.userAgent);
  } catch (error) {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
    const environmentFailure = failure('DRIVER_UNAVAILABLE', error.message, 'environment', {
      phase: 'browser-context',
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
  const networkEvents = [];
  const failures = [];
  const actionLog = [];
  const screenshots = [];
  const domSnapshots = [];
  let pageUrl = null;
  let viewport = { ...spec.viewport };

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
        await executeStep(page, step, {
          spec, index, outDir, writeArtifact, screenshots, domSnapshots, viewport, pageUrl,
        });
        if (step.kind === 'resize') viewport = { width: step.width, height: step.height };
        if (step.kind === 'goto') pageUrl = page.url();
        entry.status = 'passed';
      } catch (error) {
        const item = step.kind === 'goto'
          ? failure('LOAD_FAILED', error.message, 'navigation', { step: step.kind, label, url: step.url })
          : error.selectorMissing
            ? failure('SELECTOR_MISSING', error.message, 'product', { step: step.kind, label, selector: step.selector })
          : error.assertion
            ? failure('ASSERT_FAILED', error.message, 'product', { step: step.kind, label, selector: step.selector })
            : classifyInteractionError(error, step, label);
        failures.push(item);
        entry.status = 'failed';
        entry.failure = item;
        if (step.kind === 'goto') break;
      } finally {
        entry.duration_ms = Date.now() - before;
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (pageErrors.length) {
    failures.push(failure('PAGE_ERROR', `Captured ${pageErrors.length} uncaught page error(s).`, 'product', { count: pageErrors.length }));
  }
  if (networkEvents.length) {
    failures.push(failure('NETWORK_FAILURE', `Captured ${networkEvents.length} failed network request(s).`, 'product', { count: networkEvents.length }));
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
    notes: [
      'Captured with a real headless Chromium through Playwright using declarative steps only.',
      'DOM presence, interactions, assertions, screenshots, and collected canvas signatures prove only the declared smoke contract.',
      'Aesthetics, complete visual correctness, pixel-level equivalence, cross-browser behavior, and WebGL correctness require separate review.',
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
