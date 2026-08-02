import { declareCheck } from '../../core/index.mjs';
import {
  bidirectionalReachable,
  overlapFailures,
  FOCUS_DRIFT_TOLERANCE,
  LARGE_TREE_NODE_BUDGET,
} from './math.mjs';
import { treeStatesEqual } from './state.mjs';

const HARD_GATES = new Set([
  'build-and-test',
  'input-validation',
  'bidirectional-tree-expansion',
  'symmetric-traversal',
  'data-driven-layout',
  'no-uncaught-runtime-errors',
  'selection-and-toggle',
  'resize-state-preservation',
]);

const P0_CHECKS = new Set([
  ...HARD_GATES,
  'asymmetric-and-empty-sides',
  'deep-tree-render',
  'upstream-and-downstream-direction',
  'path-highlight-on-select',
  'parent-child-edge-fidelity',
  'expand-collapse-stability',
]);

export function createStandardChartChecks(rubric) {
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
    const hiddenCases = input.hiddenCases || [];
    const boundaryAccepted = (input.validAccepted || []).length > 0;
    const hiddenInvalidHandled = hiddenCases.length > 0 && hiddenCases.every(item => item.handled === true && (item.uncaughtErrors || []).length === 0);
    return result(
      boundaryAccepted && input.invalidRejected === true && hiddenInvalidHandled === true,
      { input },
    );
  },

  bidirectional_tree_expansion: observation => {
    const structure = observation.tree_structure || {};
    const expected = bidirectionalReachable(structure.declaredEdges || [], structure.focusId);
    const actualUpstream = structure.actualUpstreamIds || [];
    const actualDownstream = structure.actualDownstreamIds || [];
    const upstreamMatch = sameMembers(expected.upstream, actualUpstream);
    const downstreamMatch = sameMembers(expected.downstream, actualDownstream);
    return result(
      structure.focusId
        && upstreamMatch
        && downstreamMatch,
      { focusId: structure.focusId, expected, actualUpstream, actualDownstream },
    );
  },

  symmetric_traversal: observation => {
    const traversal = observation.bidirectional_traversal || {};
    const edges = traversal.declaredEdges || observation.tree_structure?.declaredEdges || [];
    const cases = traversal.traversalCases || [];
    if (cases.length === 0) {
      return result(false, { reason: 'no traversal cases declared' });
    }
    const failures = [];
    for (const testCase of cases) {
      const expected = bidirectionalReachable(edges, testCase.nodeId);
      const actualUp = [...(testCase.actualUpstream || [])].sort();
      const actualDown = [...(testCase.actualDownstream || [])].sort();
      const expectedUp = [...expected.upstream].sort();
      const expectedDown = [...expected.downstream].sort();
      if (!sameMembers(expectedUp, actualUp) || !sameMembers(expectedDown, actualDown)) {
        failures.push({
          nodeId: testCase.nodeId,
          expectedUpstream: expectedUp,
          actualUpstream: actualUp,
          expectedDownstream: expectedDown,
          actualDownstream: actualDown,
        });
      }
    }
    return result(failures.length === 0, { caseCount: cases.length, failures });
  },

  asymmetric_and_empty_sides: observation => {
    const cases = observation.input?.asymmetryCases || [];
    const requiredKinds = ['upstream-empty', 'downstream-empty', 'asymmetric-depth'];
    const seen = new Set(cases.map(item => item.kind));
    const ok = requiredKinds.every(kind => seen.has(kind))
      && cases.length >= requiredKinds.length
      && cases.every(item => item.rendered === true && (item.errors || []).length === 0);
    return result(ok, { cases });
  },

  deep_tree_render: observation => {
    const structure = observation.tree_structure || {};
    const deep = structure.deepTree || {};
    return result(
      deep.depth >= 4
        && deep.renderedUpstreamDepth === deep.depth
        && deep.renderedDownstreamDepth === deep.depth
        && (deep.errors || []).length === 0,
      deep,
    );
  },

  upstream_and_downstream_direction: observation => {
    const traversal = observation.bidirectional_traversal || {};
    return result(
      traversal.upstreamDirectionObserved === true
        && traversal.downstreamDirectionObserved === true
        && Array.isArray(traversal.upstreamPath)
        && Array.isArray(traversal.downstreamPath)
        && traversal.upstreamPath.length > 0
        && traversal.downstreamPath.length > 0,
      traversal,
    );
  },

  path_highlight_on_select: observation => {
    const traversal = observation.bidirectional_traversal || {};
    const highlight = traversal.pathHighlight || {};
    return result(
      highlight.observedInBrowser === true
        && highlight.selectedId
        && Array.isArray(highlight.upstreamHighlightIds)
        && Array.isArray(highlight.downstreamHighlightIds)
        && (highlight.upstreamHighlightIds.length > 0 || highlight.downstreamHighlightIds.length > 0)
        && highlight.nonPathIdsDimmed === true,
      highlight,
    );
  },

  parent_child_edge_fidelity: observation => {
    const traversal = observation.bidirectional_traversal || {};
    const edges = traversal.renderedEdges || [];
    const declared = traversal.declaredEdges || observation.tree_structure?.declaredEdges || [];
    const declaredSet = new Set(declared.map(edge => `${edge.from}\u0001${edge.to}\u0001${edge.direction}`));
    const missing = declared.filter(edge => !edges.some(rendered => rendered.from === edge.from && rendered.to === edge.to && rendered.direction === edge.direction));
    const invented = edges.filter(edge => !declaredSet.has(`${edge.from}\u0001${edge.to}\u0001${edge.direction}`));
    return result(edges.length > 0 && missing.length === 0 && invented.length === 0, { declared: declared.length, rendered: edges.length, missing, invented });
  },

  duplicate_and_boundary_nodes: observation => {
    const structure = observation.tree_structure || {};
    const duplicate = structure.duplicateNameHandling || {};
    const boundary = structure.boundaryNodes || {};
    return result(
      duplicate.keyedById === true
        && duplicate.duplicateNameRenderedSeparately === true
        && boundary.nullChangeHandled === true
        && boundary.zeroChangeHandled === true
        && boundary.extremePositiveHandled === true
        && boundary.extremeNegativeHandled === true,
      { duplicate, boundary },
    );
  },

  selection_and_toggle: observation => {
    const selection = observation.node_selection || {};
    const toggle = selection.toggle || {};
    return result(
      toggle.firstClickSelected === true
        && toggle.secondClickDeselected === true
        && selection.selectedId === toggle.selectedId
        && (toggle.errors || []).length === 0,
      { selection, toggle },
    );
  },

  blank_click_deselect: observation => {
    const selection = observation.node_selection || {};
    const blank = selection.blankClick || {};
    return result(
      blank.observedInBrowser === true
        && blank.beforeSelectedId
        && blank.afterSelectedId === null
        && (blank.errors || []).length === 0,
      blank,
    );
  },

  event_contract: observation => {
    const selection = observation.node_selection || {};
    const events = selection.events || [];
    return result(
      events.length > 0
        && events.every(event => (
          ['node-click', 'select', 'deselect', 'expand', 'collapse'].includes(event.type)
          && typeof event.payload === 'object'
          && typeof event.payload.nodeId === 'string'
        )),
      { events },
    );
  },

  expand_collapse_stability: observation => {
    const layout = observation.layout || {};
    const stability = layout.expandCollapseStability || {};
    return result(
      stability.observedInBrowser === true
        && Math.abs(stability.focusCentroidDrift || 0) <= FOCUS_DRIFT_TOLERANCE
        && treeStatesEqual(stability.before, stability.after)
        && (stability.errors || []).length === 0,
      stability,
    );
  },

  data_driven_layout: observation => {
    const layout = observation.layout || {};
    return result(
      layout.source === 'data'
        && layout.hardcodedCoordinates === false
        && layout.rasterFallback === false
        && layout.nodeCount > 0,
      layout,
    );
  },

  no_edge_node_overlap: observation => {
    const layout = observation.layout || {};
    const boxes = layout.nodeBoxes || [];
    const edgeCrossings = layout.edgeNodeCrossings || 0;
    const failures = overlapFailures(boxes);
    return result(
      boxes.length > 0
        && failures.length === 0
        && edgeCrossings === 0,
      { failures, edgeCrossings },
    );
  },

  long_label_degradation: observation => {
    const layout = observation.layout || {};
    const longLabel = layout.longLabel || {};
    return result(
      longLabel.totalLength > 40
        && longLabel.overflowCount === 0
        && longLabel.tooltipAvailable === true
        && (longLabel.adaptiveLevels || []).length > 0,
      longLabel,
    );
  },

  large_tree_interaction_budget: observation => {
    const performance = observation.performance || {};
    const large = performance.largeTree || {};
    return result(
      large.nodeCount >= LARGE_TREE_NODE_BUDGET
        && large.fps >= 20
        && large.p95FrameMs <= 80
        && (large.errors || []).length === 0,
      large,
    );
  },

  lifecycle_cleanup: observation => {
    const performance = observation.performance || {};
    const lifecycle = performance.lifecycle || {};
    const pending = ['timers', 'rafs', 'resizeObservers', 'listeners', 'subscriptions']
      .reduce((total, key) => total + (lifecycle.afterDestroy?.[key] || 0), 0);
    return result(pending === 0 && lifecycle.callbacksAfterDestroy === 0 && lifecycle.duplicateBindings === 0, lifecycle);
  },

  no_uncaught_runtime_errors: observation => {
    const browser = observation.browserEvidence || {};
    const failures = browser.failures || [];
    const runtimeFailures = failures.filter(item => item.code === 'PAGE_ERROR');
    return result(
      browser.driver === 'playwright-chromium'
        && ['success', 'warning'].includes(browser.status)
        && (browser.page_errors || []).length === 0
        && (browser.console_errors || []).length === 0
        && runtimeFailures.length === 0,
      {
        driver: browser.driver,
        status: browser.status,
        pageErrors: browser.page_errors || [],
        consoleErrors: browser.console_errors || [],
        runtimeFailures,
      },
    );
  },

  resize_state_preservation: observation => {
    const responsive = observation.responsive || {};
    const resize = responsive.resize || {};
    return result(
      resize.observedInBrowser === true
        && treeStatesEqual(resize.before, resize.after)
        && resize.focusVisibleAfter === true
        && resize.horizontalOverflow === false
        && (resize.errors || []).length === 0,
      resize,
    );
  },

  keyboard_accessibility: observation => {
    const keyboard = observation.accessibility?.keyboard || {};
    const required = ['focus', 'upstream', 'downstream', 'node', 'expand', 'collapse'];
    const byId = new Map((keyboard.controls || []).map(control => [control.id, control]));
    const failures = required.filter(id => {
      const control = byId.get(id);
      return !control
        || control.tabbable !== true
        || control.activated !== true
        || !includesAny(control.activationKeys, ['Enter', 'Space']);
    });
    return result(
      keyboard.observedInBrowser === true
        && keyboard.focusVisible === true
        && failures.length === 0,
      { failures, focusVisible: keyboard.focusVisible },
    );
  },

  theme_and_group_style: observation => {
    const engineering = observation.engineering || {};
    const theme = engineering.themeAndGroup || {};
    return result(
      theme.lightThemeApplied === true
        && theme.darkThemeApplied === true
        && theme.groupStyleApplied === true
        && (theme.errors || []).length === 0,
      theme,
    );
  },

  implementation_notes: observation => {
    const notes = observation.engineering?.notes || {};
    const required = ['dataMapping', 'bidirectionalTraversal', 'layout', 'standardChartIntegration', 'unfinished'];
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

function includesAny(actual = [], expected = []) {
  return expected.some(value => actual.includes(value));
}

function sameMembers(actual = [], expected = []) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return sortedActual.every((value, index) => value === sortedExpected[index]);
}

function inferLevel(category) {
  return ['performance', 'engineering_integrity'].includes(category) ? 'p2' : 'p1';
}

export function registeredAssertionIds() {
  return Object.keys(ASSERTIONS).map(id => id.replaceAll('_', '-')).sort();
}
