import { declareCheck } from '../../core/index.mjs';
import {
  AREA_SHARE_TOLERANCE,
  COLOR_POSITION_TOLERANCE,
  areaShareFailures,
  colorMappingFailures,
  expectedColorPosition,
} from './math.mjs';
import { businessStatesEqual } from './state.mjs';

const HARD_GATES = new Set([
  'build-and-test',
  'input-validation',
  'area-weight-fidelity',
  'data-driven-treemap',
  'color-scale-semantics',
  'no-uncaught-runtime-errors',
  'hierarchy-drill-and-back',
  'resize-state-preservation',
]);

const P0_CHECKS = new Set([
  ...HARD_GATES,
  'stock-scope-coverage',
  'market-rule-isolation',
  'null-area-fallback',
  'legend-scale-contract',
  'tooltip-required-fields',
  'instrument-detail-event',
  'search-and-filter',
  'async-ui-states',
  'keyboard-accessibility',
]);

export function createAinvestHeatmapChecks(rubric) {
  const checks = [];
  for (const [category, definition] of Object.entries(rubric.categories)) {
    for (const id of definition.checks || []) {
      const assertion = ASSERTIONS[id.replaceAll('-', '_')];
      if (!assertion) throw new Error(`No deterministic assertion registered for rubric check "${id}".`);
      checks.push(declareCheck({
        id,
        title: id.replaceAll('-', ' '),
        category,
        level: P0_CHECKS.has(id) ? 'p0' : inferLevel(category),
        hard_gate: HARD_GATES.has(id),
        requires_artifacts: ['observation'],
        run(ctx) {
          const observation = ctx.getArtifact('observation');
          return outcome(id, assertion(observation), observation);
        },
      }));
    }
  }
  return checks;
}

const ASSERTIONS = {
  build_and_test: observation => {
    const failed = ['build', 'typecheck', 'test'].filter(name => observation.commands?.[name]?.exitCode !== 0);
    return result(failed.length === 0, { failed, commands: observation.commands });
  },
  input_validation: observation => {
    const input = observation.input || {};
    return result(input.validAccepted === true
      && input.invalidRejected === true
      && input.hiddenInvalidUsed === true
      && (input.invalidUncaughtErrors || []).length === 0, input);
  },
  stock_scope_coverage: observation => {
    const expected = ['sp500', 'nasdaq100', 'nasdaq-composite', 'nyse', 'all-stocks', 'dow-jones'];
    const actual = observation.input?.supportedStockScopes || [];
    return result(expected.every(scope => actual.includes(scope)), { expected, actual });
  },
  market_rule_isolation: observation => {
    const rules = observation.input?.marketRules || {};
    const cases = observation.input?.marketRuleCases || {};
    const ok = includesAll(rules.stock?.areaMetrics, ['market_cap', 'equal'])
      && includesAll(rules.stock?.groupings, ['sector', 'none'])
      && includesAll(rules.etf?.areaMetrics, ['aum', 'equal'])
      && includesAll(rules.etf?.groupings, ['asset_class', 'none'])
      && includesAll(rules.crypto?.areaMetrics, ['market_cap', 'equal'])
      && sameMembers(rules.crypto?.groupings, ['none'])
      && cases.stock?.usedAreaField === 'market_cap'
      && cases.etf?.usedAreaField === 'aum'
      && cases.crypto?.usedAreaField === 'market_cap'
      && cases.crypto?.btcPresentWhenIncluded === true
      && cases.crypto?.btcPresentWhenExcluded === false;
    return result(ok, { rules, cases });
  },
  area_weight_fidelity: observation => {
    const cases = observation.area?.cases || [];
    const metrics = new Set(cases.map(item => item.metric));
    const failures = areaShareFailures(cases);
    return result(cases.length >= 2 && metrics.has('market_cap') && metrics.has('equal') && failures.length === 0, {
      failures,
      tolerance: AREA_SHARE_TOLERANCE,
    });
  },
  null_area_fallback: observation => {
    const fallback = observation.area?.nullFallback || {};
    return result(fallback.documented === true
      && ['minimum-positive', 'equal'].includes(fallback.strategy)
      && Number.isFinite(fallback.renderedArea)
      && fallback.renderedArea > 0, fallback);
  },
  data_driven_treemap: observation => {
    const layout = observation.layout || {};
    return result(layout.source === 'data'
      && layout.hardcodedCoordinates === false
      && layout.rasterFallback === false
      && layout.nodeCount > 0, layout);
  },
  color_scale_semantics: observation => {
    const color = observation.color || {};
    const values = (color.samples || []).map(sample => sample.value);
    const coverage = values.some(value => value < 0)
      && values.some(value => value > 0)
      && values.includes(0)
      && values.includes(null)
      && values.some(value => value < color.domain?.softMin)
      && values.some(value => value > color.domain?.softMax);
    const validDomain = color.domain?.softMin < color.domain?.neutral
      && color.domain?.neutral < color.domain?.softMax
      && color.domain?.clamp === true;
    const failures = colorMappingFailures(color);
    return result(validDomain && coverage && failures.length === 0, {
      validDomain,
      coverage,
      failures,
      tolerance: COLOR_POSITION_TOLERANCE,
    });
  },
  legend_scale_contract: observation => {
    const domain = observation.color?.domain || {};
    const legend = observation.legend || {};
    const ticks = legend.ticks || [];
    const monotonic = ticks.every((tick, index) => index === 0 || tick.value > ticks[index - 1].value);
    const positionsMatch = ticks.every(tick => (
      Math.abs(tick.position - expectedColorPosition(tick.value, domain)) <= COLOR_POSITION_TOLERANCE
    ));
    return result(legend.softMin === domain.softMin
      && legend.neutral === domain.neutral
      && legend.softMax === domain.softMax
      && legend.clamp === domain.clamp
      && monotonic
      && positionsMatch
      && ticks.some(tick => tick.value === domain.neutral)
      && legend.noDataLabel?.length > 0, { domain, legend, monotonic, positionsMatch });
  },
  tooltip_required_fields: observation => {
    const required = ['name', 'symbol', 'price', 'marketCap', 'colorMetric', 'colorValue'];
    const tooltips = observation.tooltip?.records || [];
    const missing = tooltips.flatMap((tooltip, index) => (
      required.filter(field => !(field in tooltip)).map(field => ({ index, field }))
    ));
    return result(tooltips.length > 0 && missing.length === 0, { count: tooltips.length, missing });
  },
  high_density_label_degradation: observation => {
    const dense = observation.labels?.dense || {};
    return result(dense.total >= 40
      && dense.visibleTextCount <= dense.total
      && dense.overflowCount === 0
      && dense.occludedCount === 0
      && dense.tooltipAvailableCount === dense.total
      && includesAll(dense.adaptiveLevels, ['full', 'symbol-only', 'hidden']), dense);
  },
  no_uncaught_runtime_errors: observation => {
    const browser = observation.browserEvidence || {};
    const failures = browser.failures || [];
    const runtimeFailures = failures.filter(item => item.code === 'PAGE_ERROR');
    return result(browser.driver === 'playwright-chromium'
      && ['success', 'warning'].includes(browser.status)
      && (browser.page_errors || []).length === 0
      && (browser.console_errors || []).length === 0
      && runtimeFailures.length === 0, {
      driver: browser.driver,
      status: browser.status,
      pageErrors: browser.page_errors || [],
      consoleErrors: browser.console_errors || [],
      runtimeFailures,
    });
  },
  hierarchy_drill_and_back: observation => {
    const drill = observation.interactions?.drill || {};
    return result(drill.groupClickObserved === true
      && drill.backClickObserved === true
      && Array.isArray(drill.afterGroupClick?.drillPath)
      && drill.afterGroupClick.drillPath.length === 1
      && businessStatesEqual(drill.before, drill.afterBack), drill);
  },
  instrument_detail_event: observation => {
    const events = observation.interactions?.detailEvents || [];
    return result(events.length > 0 && events.every(event => (
      event.type === 'instrument-detail'
      && typeof event.id === 'string'
      && typeof event.symbol === 'string'
      && ['stock', 'etf', 'crypto'].includes(event.market)
    )), { events });
  },
  search_and_filter: observation => {
    const search = observation.interactions?.search || {};
    const filter = observation.interactions?.filter || {};
    return result(search.query?.length > 0
      && search.allResultsMatch === true
      && (search.resultIds || []).length > 0
      && filter.requestQueryMatches === true
      && sameMembers(filter.visibleIds, filter.expectedIds), { search, filter });
  },
  async_ui_states: observation => {
    const states = observation.interactions?.uiStates || {};
    return result(states.loading?.visible === true
      && states.empty?.visible === true
      && states.error?.visible === true
      && states.error?.retryAvailable === true
      && states.retry?.recovered === true, states);
  },
  filter_state_restoration: observation => {
    const restoration = observation.state?.restoration || {};
    const required = ['market', 'dataSource', 'areaMetric', 'colorMetric', 'groupBy'];
    return result(includesAll(restoration.encodedKeys, required)
      && businessStatesEqual(restoration.expected, restoration.restored), restoration);
  },
  resize_state_preservation: observation => {
    const resize = observation.state?.resize || {};
    return result(resize.observedInBrowser === true
      && businessStatesEqual(resize.before, resize.after)
      && resize.layoutGenerationAfter > resize.layoutGenerationBefore
      && resize.nodesWithinViewport === true, resize);
  },
  keyboard_accessibility: observation => {
    const keyboard = observation.accessibility?.keyboard || {};
    const required = ['market', 'area', 'color', 'group', 'search', 'tile', 'back', 'retry'];
    const byId = new Map((keyboard.controls || []).map(control => [control.id, control]));
    const failures = required.filter(id => {
      const control = byId.get(id);
      return !control
        || control.tabbable !== true
        || control.activated !== true
        || !['button', 'combobox', 'searchbox', 'link'].includes(control.role)
        || !includesAny(control.activationKeys, ['Enter', 'Space']);
    });
    return result(keyboard.observedInBrowser === true && keyboard.focusVisible === true && failures.length === 0, {
      failures,
      focusVisible: keyboard.focusVisible,
    });
  },
  responsive_viewports: observation => {
    const viewports = observation.responsive?.viewports || [];
    const required = ['wide', 'narrow', 'fullscreen'];
    return result(required.every(kind => viewports.some(viewport => (
      viewport.kind === kind
      && viewport.observedInBrowser === true
      && viewport.horizontalOverflow === false
      && viewport.controlsReachable === true
    ))), { viewports });
  },
  stale_request_suppression: observation => {
    const requests = observation.performance?.requests || {};
    return result(requests.latestRequestId === requests.committedRequestId
      && requests.staleCommitCount === 0, requests);
  },
  lifecycle_cleanup: observation => {
    const lifecycle = observation.performance?.lifecycle || {};
    const pending = ['timers', 'rafs', 'resizeObservers', 'listeners', 'subscriptions']
      .reduce((total, key) => total + (lifecycle.afterDestroy?.[key] || 0), 0);
    return result(pending === 0
      && lifecycle.callbacksAfterDestroy === 0
      && lifecycle.duplicateBindings === 0, lifecycle);
  },
  automated_test_evidence: observation => {
    const tests = observation.engineering?.tests || {};
    return result(tests.exitCode === 0
      && tests.transform >= 1
      && tests.interaction >= 1
      && tests.visualRegression >= 1, tests);
  },
  implementation_notes: observation => {
    const notes = observation.engineering?.notes || {};
    const required = ['dataMapping', 'treemap', 'colorScale', 'responsive', 'unfinished'];
    const missing = required.filter(field => typeof notes[field] !== 'string' || notes[field].trim().length === 0);
    return result(missing.length === 0, { missing });
  },
};

function outcome(id, assertion, observation) {
  const paths = observation.artifact_paths?.[id] || observation.artifact_paths?.default || [];
  const artifacts = Array.isArray(paths) ? paths : [paths];
  return {
    status: assertion.ok ? 'pass' : 'fail',
    reason: assertion.ok ? null : `deterministic assertion failed: ${id}`,
    evidence: {
      details: assertion.details,
      artifact_paths: artifacts,
      proof_boundary: 'Behavior/state only; visual aesthetics are not machine-proven.',
    },
    artifacts,
  };
}

function result(ok, details) {
  return { ok: Boolean(ok), details };
}

function includesAll(actual = [], expected = []) {
  return expected.every(value => actual.includes(value));
}

function includesAny(actual = [], expected = []) {
  return expected.some(value => actual.includes(value));
}

function sameMembers(actual = [], expected = []) {
  return actual.length === expected.length && includesAll(actual, expected);
}

function inferLevel(category) {
  return ['performance_stability', 'engineering_evidence'].includes(category) ? 'p2' : 'p1';
}

export function registeredAssertionIds() {
  return Object.keys(ASSERTIONS).map(id => id.replaceAll('_', '-')).sort();
}
