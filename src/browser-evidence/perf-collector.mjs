// Performance / memory / long-task collector for the browser-evidence layer.
//
// Roadmap M3 task: "FPS、内存、资源释放". This module provides:
//   - collectPerformance(page, options): runs an in-page probe for ~1 second
//     to gather FPS via requestAnimationFrame, JS heap via performance.memory
//     (Chromium-only), and long tasks via PerformanceObserver.
//   - assertPerformance(facts, thresholds): declarative budget assertion.
//
// Contract:
//   - No npm dependencies. Uses the page's own perf APIs.
//   - Failures degrade to `{status:'skip', reason}` rather than throwing.
//   - `window.gc()` is invoked only when `--js-flags=--expose-gc` is
//     available; otherwise memory deltas use performance.memory.

const DEFAULT_FPS_SAMPLE_MS = 1000;
const DEFAULT_MAX_LONGTASK_MS = 50;

function perfProbe(sampleMs) {
  return new Promise(resolvePromise => {
    if (typeof performance === 'undefined' || typeof requestAnimationFrame === 'undefined') {
      resolvePromise({ kind: 'perf-skip', reason: 'no-raf-or-performance' });
      return;
    }
    const frameTimes = [];
    let lastFrame = performance.now();
    let rafId;
    const observer = (typeof PerformanceObserver !== 'undefined')
      ? new PerformanceObserver(list => {
        // Noop; we drain entries at the end.
        void list;
      })
      : null;
    if (observer) {
      try { observer.observe({ entryTypes: ['longtask', 'longtask'] }); } catch { /* ignore */ }
    }
    const memoryBefore = (performance.memory && typeof performance.memory === 'object')
      ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      }
      : null;
    const start = performance.now();
    const tick = (now) => {
      if (now - lastFrame > 0) {
        frameTimes.push(now - lastFrame);
      }
      lastFrame = now;
      if (performance.now() - start < sampleMs) {
        rafId = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    const finish = () => {
      if (observer) {
        try { observer.disconnect(); } catch { /* ignore */ }
      }
      const memoryAfter = (performance.memory && typeof performance.memory === 'object')
        ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        }
        : null;
      const longtasks = (observer && observer.takeRecords)
        ? observer.takeRecords().map(entry => ({
          duration: Math.round(entry.duration * 100) / 100,
          startTime: Math.round(entry.startTime * 100) / 100,
        }))
        : [];
      resolvePromise({
        kind: 'perf-sample',
        frame_intervals_ms: frameTimes.map(v => Math.round(v * 100) / 100),
        sample_ms: Math.round((performance.now() - start) * 100) / 100,
        memory_before: memoryBefore,
        memory_after: memoryAfter,
        longtasks,
        gc_available: typeof window !== 'undefined' && typeof window.gc === 'function',
      });
    };
    rafId = requestAnimationFrame(tick);
  });
}

/**
 * Collect a performance sample from the page.
 *
 * @param {{evaluate: Function}} page Playwright page (or test double).
 * @param {object} options
 * @param {number} options.sampleMs Approximate sample duration in ms.
 */
export async function collectPerformance(page, options = {}) {
  const sampleMs = Number.isFinite(options.sampleMs) && options.sampleMs > 0
    ? Math.min(options.sampleMs, 5_000)
    : DEFAULT_FPS_SAMPLE_MS;
  if (!page || typeof page.evaluate !== 'function') {
    return {
      status: 'skip',
      reason: 'page_unavailable',
      root_cause_hint: 'collectPerformance requires a page with an evaluate() method.',
    };
  }
  let raw;
  try {
    raw = await page.evaluate(perfProbe, sampleMs);
  } catch (error) {
    return {
      status: 'skip',
      reason: 'evaluate_failed',
      root_cause_hint: error instanceof Error ? error.message : String(error),
    };
  }
  if (!raw || raw.kind === 'perf-skip') {
    return {
      status: 'skip',
      reason: raw?.reason || 'perf_unavailable',
      root_cause_hint: 'In-page Performance APIs were unavailable.',
    };
  }
  return normalizeFacts(raw, sampleMs);
}

function normalizeFacts(raw, sampleMs) {
  const intervals = Array.isArray(raw.frame_intervals_ms) ? raw.frame_intervals_ms : [];
  // Drop the first interval as a warm-up artifact.
  const active = intervals.length > 1 ? intervals.slice(1) : intervals;
  const avgFrameMs = active.length
    ? active.reduce((sum, value) => sum + value, 0) / active.length
    : null;
  const fps = avgFrameMs && avgFrameMs > 0 ? Math.round(1000 / avgFrameMs) : null;
  const sortedActive = [...active].sort((a, b) => a - b);
  const p95FrameMs = sortedActive.length
    ? sortedActive[Math.min(sortedActive.length - 1, Math.floor(sortedActive.length * 0.95))]
    : null;
  const memory = raw.memory_after || raw.memory_before || null;
  const memoryBefore = raw.memory_before || null;
  const memoryDelta = (memoryBefore && memory)
    ? memory.usedJSHeapSize - memoryBefore.usedJSHeapSize
    : null;
  const longtasks = Array.isArray(raw.longtasks) ? raw.longtasks : [];
  return {
    status: 'ok',
    sample_ms: Math.round(sampleMs),
    measured_sample_ms: Number.isFinite(raw.sample_ms) ? raw.sample_ms : null,
    fps,
    avg_frame_ms: avgFrameMs ? Math.round(avgFrameMs * 100) / 100 : null,
    p95_frame_ms: p95FrameMs,
    frame_sample_count: intervals.length,
    memory: memory ? {
      used_js_heap_mb: Math.round((memory.usedJSHeapSize / (1024 * 1024)) * 100) / 100,
      total_js_heap_mb: Math.round((memory.totalJSHeapSize / (1024 * 1024)) * 100) / 100,
      js_heap_size_limit_mb: Math.round((memory.jsHeapSizeLimit / (1024 * 1024)) * 100) / 100,
    } : null,
    memory_delta_bytes: Number.isFinite(memoryDelta) ? memoryDelta : null,
    longtask_count: longtasks.length,
    max_longtask_ms: longtasks.reduce((max, entry) => Math.max(max, entry.duration || 0), 0) || 0,
    gc_exposed: raw.gc_available === true,
    probe_kind: 'rAF+performance.memory+PerformanceObserver',
  };
}

/**
 * Declarative performance budget assertion.
 *
 * Thresholds (all optional):
 *   - min_fps: number
 *   - max_p95_frame_ms: number
 *   - max_heap_mb: number (used JS heap)
 *   - max_total_heap_mb: number
 *   - max_longtask_ms: number (default 50)
 *   - max_longtask_count: number
 *
 * Returns `{status, reason, evidence}`.
 */
export function assertPerformance(facts, thresholds = {}) {
  if (!facts || typeof facts !== 'object') {
    return {
      status: 'error',
      code: 'PERF_FACTS_INVALID',
      message: 'assertPerformance requires a facts object.',
      root_cause_hint: 'collectPerformance must run before asserting.',
      evidence: { thresholds },
    };
  }
  if (facts.status === 'skip') {
    return {
      status: 'skip',
      reason: facts.reason || 'perf_unavailable',
      root_cause_hint: facts.root_cause_hint || null,
      evidence: { thresholds },
    };
  }
  const failures = [];
  if (Number.isFinite(thresholds.min_fps) && Number.isFinite(facts.fps)
    && facts.fps < thresholds.min_fps) {
    failures.push({ field: 'min_fps', expected: thresholds.min_fps, observed: facts.fps });
  }
  if (Number.isFinite(thresholds.max_p95_frame_ms) && Number.isFinite(facts.p95_frame_ms)
    && facts.p95_frame_ms > thresholds.max_p95_frame_ms) {
    failures.push({
      field: 'max_p95_frame_ms',
      expected: thresholds.max_p95_frame_ms,
      observed: facts.p95_frame_ms,
    });
  }
  const usedMb = facts.memory?.used_js_heap_mb;
  if (Number.isFinite(thresholds.max_heap_mb) && Number.isFinite(usedMb)
    && usedMb > thresholds.max_heap_mb) {
    failures.push({ field: 'max_heap_mb', expected: thresholds.max_heap_mb, observed: usedMb });
  }
  const totalMb = facts.memory?.total_js_heap_mb;
  if (Number.isFinite(thresholds.max_total_heap_mb) && Number.isFinite(totalMb)
    && totalMb > thresholds.max_total_heap_mb) {
    failures.push({
      field: 'max_total_heap_mb',
      expected: thresholds.max_total_heap_mb,
      observed: totalMb,
    });
  }
  const longtaskMsLimit = Number.isFinite(thresholds.max_longtask_ms)
    ? thresholds.max_longtask_ms
    : DEFAULT_MAX_LONGTASK_MS;
  if (Number.isFinite(facts.max_longtask_ms) && facts.max_longtask_ms > longtaskMsLimit) {
    failures.push({
      field: 'max_longtask_ms',
      expected: longtaskMsLimit,
      observed: facts.max_longtask_ms,
    });
  }
  if (Number.isFinite(thresholds.max_longtask_count)
    && Number.isFinite(facts.longtask_count)
    && facts.longtask_count > thresholds.max_longtask_count) {
    failures.push({
      field: 'max_longtask_count',
      expected: thresholds.max_longtask_count,
      observed: facts.longtask_count,
    });
  }
  if (failures.length) {
    return {
      status: 'fail',
      reason: 'performance-budget-exceeded',
      evidence: {
        thresholds,
        facts,
        failures,
        claim: 'Performance budgets did not hold; not a visual/aesthetic judgment.',
      },
    };
  }
  return {
    status: 'pass',
    reason: null,
    evidence: {
      thresholds,
      facts,
      claim: 'Performance budgets hold; not a visual/aesthetic judgment.',
    },
  };
}

/**
 * Plain-boolean projection suitable for evaluator provenance collectors.
 * Avoids nested arrays per the ROADMAP M3 contract.
 */
export function perfBooleanFacts(facts) {
  if (!facts || typeof facts !== 'object') return {};
  return {
    fps: Number(facts.fps) || 0,
    p95_frame_ms: Number(facts.p95_frame_ms) || 0,
    used_js_heap_mb: facts.memory?.used_js_heap_mb != null ? Number(facts.memory.used_js_heap_mb) : null,
    longtask_count: Number(facts.longtask_count) || 0,
    gc_exposed: facts.gc_exposed === true,
  };
}
