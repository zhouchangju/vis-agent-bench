// Sample factories for the StandardChart two-way-tree evaluator tests.
//
// We use functions instead of static JSON so the synthetic bidirectional
// graph stays consistent with the deterministic helpers exported from
// src/evaluators/cases/standard-chart-two-way-tree/math.mjs. Both samples
// emit `provenance.boolean_facts` via the test-double helper in run.mjs.
//
// Edge semantics:
//   - upstream edge `{from: supplier, to: consumer, direction: "upstream"}`
//     means `from` is an upstream input of `to`. Traversing upstream hops
//     consumer -> supplier (keyed by edge.to).
//   - downstream edge `{from: producer, to: consumer, direction: "downstream"}`
//     means `to` is a downstream consumer of `from`. Traversing downstream
//     hops producer -> consumer (keyed by edge.from).
//
// Sample chain rooted at n0:
//   upstream side:    n3 -> n2 -> n1 -> n0 (focus)
//   downstream side:  n0 (focus) -> n4 -> n5 -> n6
//
// So expected upstream ids of n0 = {n1, n2, n3} and expected downstream
// ids of n0 = {n4, n5, n6}.

export function createMinimalCompliantObservation() {
  const declaredEdges = [
    { from: 'n1', to: 'n0', direction: 'upstream' },
    { from: 'n2', to: 'n1', direction: 'upstream' },
    { from: 'n3', to: 'n2', direction: 'upstream' },
    { from: 'n0', to: 'n4', direction: 'downstream' },
    { from: 'n4', to: 'n5', direction: 'downstream' },
    { from: 'n5', to: 'n6', direction: 'downstream' },
  ];

  return {
    commands: {
      build: { exitCode: 0 },
      typecheck: { exitCode: 0 },
      test: { exitCode: 0 },
    },
    input: {
      validAccepted: [
        { kind: 'symmetric', rendered: true },
        { kind: 'long-name', rendered: true },
      ],
      invalidRejected: true,
      hiddenCases: [
        { kind: 'upstream-empty', handled: true, uncaughtErrors: [] },
        { kind: 'downstream-empty', handled: true, uncaughtErrors: [] },
        { kind: 'asymmetric-depth', handled: true, uncaughtErrors: [] },
        { kind: 'duplicate-name', handled: true, uncaughtErrors: [] },
        { kind: 'null-change', handled: true, uncaughtErrors: [] },
        { kind: 'zero-change', handled: true, uncaughtErrors: [] },
        { kind: 'extreme-positive', handled: true, uncaughtErrors: [] },
        { kind: 'extreme-negative', handled: true, uncaughtErrors: [] },
      ],
      asymmetryCases: [
        { kind: 'upstream-empty', rendered: true, errors: [] },
        { kind: 'downstream-empty', rendered: true, errors: [] },
        { kind: 'asymmetric-depth', rendered: true, errors: [] },
      ],
    },
    tree_structure: {
      focusId: 'n0',
      declaredEdges,
      actualUpstreamIds: ['n1', 'n2', 'n3'],
      actualDownstreamIds: ['n4', 'n5', 'n6'],
      deepTree: {
        depth: 4,
        renderedUpstreamDepth: 4,
        renderedDownstreamDepth: 4,
        errors: [],
      },
      duplicateNameHandling: {
        keyedById: true,
        duplicateNameRenderedSeparately: true,
      },
      boundaryNodes: {
        nullChangeHandled: true,
        zeroChangeHandled: true,
        extremePositiveHandled: true,
        extremeNegativeHandled: true,
      },
    },
    bidirectional_traversal: {
      declaredEdges,
      upstreamDirectionObserved: true,
      downstreamDirectionObserved: true,
      upstreamPath: ['n0', 'n1', 'n2', 'n3'],
      downstreamPath: ['n0', 'n4', 'n5', 'n6'],
      traversalCases: [
        { nodeId: 'n0', actualUpstream: ['n1', 'n2', 'n3'], actualDownstream: ['n4', 'n5', 'n6'] },
        { nodeId: 'n1', actualUpstream: ['n2', 'n3'], actualDownstream: [] },
        { nodeId: 'n5', actualUpstream: [], actualDownstream: ['n6'] },
      ],
      pathHighlight: {
        observedInBrowser: true,
        selectedId: 'n2',
        upstreamHighlightIds: ['n0', 'n1', 'n2'],
        downstreamHighlightIds: [],
        nonPathIdsDimmed: true,
      },
      renderedEdges: declaredEdges,
    },
    node_selection: {
      selectedId: 'n2',
      toggle: {
        firstClickSelected: true,
        secondClickDeselected: true,
        selectedId: 'n2',
        errors: [],
      },
      blankClick: {
        observedInBrowser: true,
        beforeSelectedId: 'n2',
        afterSelectedId: null,
        errors: [],
      },
      events: [
        { type: 'node-click', payload: { nodeId: 'n2' } },
        { type: 'select', payload: { nodeId: 'n2' } },
        { type: 'deselect', payload: { nodeId: 'n2' } },
        { type: 'expand', payload: { nodeId: 'n1' } },
        { type: 'collapse', payload: { nodeId: 'n1' } },
      ],
    },
    layout: {
      source: 'data',
      hardcodedCoordinates: false,
      rasterFallback: false,
      nodeCount: 7,
      nodeBoxes: [
        { id: 'n0', direction: 'root', x: 100, y: 100, width: 60, height: 30 },
        { id: 'n1', direction: 'upstream', x: 0, y: 100, width: 60, height: 30 },
        { id: 'n2', direction: 'upstream', x: 0, y: 60, width: 60, height: 30 },
        { id: 'n3', direction: 'upstream', x: 0, y: 20, width: 60, height: 30 },
        { id: 'n4', direction: 'downstream', x: 200, y: 100, width: 60, height: 30 },
        { id: 'n5', direction: 'downstream', x: 200, y: 140, width: 60, height: 30 },
        { id: 'n6', direction: 'downstream', x: 200, y: 180, width: 60, height: 30 },
      ],
      edgeNodeCrossings: 0,
      expandCollapseStability: {
        observedInBrowser: true,
        focusCentroidDrift: 0,
        before: { focusId: 'n0', selectedId: null, expandedUpstream: [], expandedDownstream: [] },
        after: { focusId: 'n0', selectedId: null, expandedUpstream: [], expandedDownstream: [] },
        errors: [],
      },
      longLabel: {
        totalLength: 80,
        overflowCount: 0,
        tooltipAvailable: true,
        adaptiveLevels: ['full', 'symbol-only', 'hidden'],
      },
    },
    performance: {
      largeTree: {
        nodeCount: 220,
        fps: 32,
        p95FrameMs: 45,
        errors: [],
      },
      lifecycle: {
        afterDestroy: { timers: 0, rafs: 0, resizeObservers: 0, listeners: 0, subscriptions: 0 },
        callbacksAfterDestroy: 0,
        duplicateBindings: 0,
      },
    },
    browserEvidence: {
      driver: 'playwright-chromium',
      status: 'success',
      page_errors: [],
      console_errors: [],
      failures: [],
      canvas_webgl_proven: false,
      notes: ['Behavior and state only; aesthetics require human review.'],
    },
    responsive: {
      viewports: [
        { kind: 'wide', observedInBrowser: true, horizontalOverflow: false, controlsReachable: true },
        { kind: 'narrow', observedInBrowser: true, horizontalOverflow: false, controlsReachable: true },
      ],
      resize: {
        observedInBrowser: true,
        focusVisibleAfter: true,
        horizontalOverflow: false,
        before: { focusId: 'n0', selectedId: 'n2', visibleIds: ['n0', 'n1', 'n2'] },
        after: { focusId: 'n0', selectedId: 'n2', visibleIds: ['n0', 'n1', 'n2'] },
        errors: [],
      },
    },
    accessibility: {
      keyboard: {
        observedInBrowser: true,
        focusVisible: true,
        controls: [
          { id: 'focus', role: 'button', tabbable: true, activationKeys: ['Enter'], activated: true },
          { id: 'upstream', role: 'button', tabbable: true, activationKeys: ['Enter'], activated: true },
          { id: 'downstream', role: 'button', tabbable: true, activationKeys: ['Enter'], activated: true },
          { id: 'node', role: 'button', tabbable: true, activationKeys: ['Enter', 'Space'], activated: true },
          { id: 'expand', role: 'button', tabbable: true, activationKeys: ['Enter'], activated: true },
          { id: 'collapse', role: 'button', tabbable: true, activationKeys: ['Enter'], activated: true },
        ],
      },
    },
    engineering: {
      tests: { exitCode: 0, transform: 2, interaction: 4, visualRegression: 1 },
      themeAndGroup: {
        lightThemeApplied: true,
        darkThemeApplied: true,
        groupStyleApplied: true,
        errors: [],
      },
      notes: {
        dataMapping: 'Maps fixture nodes/edges without production identifiers.',
        bidirectionalTraversal: 'Symmetric upstream/downstream traversal derived from declared edges.',
        layout: 'Data-driven placement; no hardcoded coordinates.',
        standardChartIntegration: 'Uses the StandardChart extension lifecycle and option API.',
        unfinished: 'Cross-browser visual parity remains for human review.',
      },
    },
    artifact_paths: {
      default: ['artifacts/browser-evidence.json', 'artifacts/two-way-tree-observation.json'],
    },
  };
}

export function createIntentionalFailure() {
  // Overlay that breaks: build, bidirectional expansion (wrong actual set),
  // symmetric traversal (invented node in actual), path highlight (no dimming),
  // selection toggle (no deselect on second click), data-driven layout
  // (hardcoded), no-edge-node-overlap (boxes overlap), expand-collapse
  // stability (focus drifts), large-tree budget (fps < 20), keyboard,
  // implementation notes.
  return {
    overrides: {
      commands: {
        build: { exitCode: 1 },
      },
      tree_structure: {
        focusId: 'n0',
        actualUpstreamIds: ['n1', 'n2', 'n9'], // invented node
        actualDownstreamIds: ['n4'],            // incomplete
        deepTree: { depth: 4, renderedUpstreamDepth: 2, renderedDownstreamDepth: 2, errors: ['overflow'] },
        duplicateNameHandling: { keyedById: false, duplicateNameRenderedSeparately: false },
        boundaryNodes: { nullChangeHandled: false, zeroChangeHandled: true, extremePositiveHandled: true, extremeNegativeHandled: true },
      },
      bidirectional_traversal: {
        upstreamDirectionObserved: true,
        downstreamDirectionObserved: false,
        upstreamPath: ['n0', 'n1'],
        downstreamPath: [],
        traversalCases: [
          { nodeId: 'n0', actualUpstream: ['n1', 'n2', 'n9'], actualDownstream: ['n4'] },
        ],
        pathHighlight: {
          observedInBrowser: true,
          selectedId: 'n2',
          upstreamHighlightIds: [],
          downstreamHighlightIds: [],
          nonPathIdsDimmed: false,
        },
        renderedEdges: [],
      },
      node_selection: {
        selectedId: 'n2',
        toggle: { firstClickSelected: true, secondClickDeselected: false, selectedId: 'n2', errors: ['stuck'] },
        blankClick: { observedInBrowser: true, beforeSelectedId: 'n2', afterSelectedId: 'n2', errors: ['no-deselect'] },
        events: [
          { type: 'node-click', payload: { nodeId: 'n2' } },
          { type: 'unknown-type', payload: { nodeId: 42 } },
        ],
      },
      layout: {
        source: 'hardcoded',
        hardcodedCoordinates: true,
        rasterFallback: false,
        nodeCount: 7,
        nodeBoxes: [
          { id: 'n1', direction: 'upstream', x: 0, y: 0, width: 60, height: 30 },
          { id: 'n2', direction: 'upstream', x: 10, y: 5, width: 60, height: 30 },
        ],
        edgeNodeCrossings: 3,
        expandCollapseStability: {
          observedInBrowser: true,
          focusCentroidDrift: 24,
          before: { focusId: 'n0', selectedId: 'n2' },
          after: { focusId: 'n0', selectedId: null },
          errors: ['jumped'],
        },
        longLabel: { totalLength: 80, overflowCount: 2, tooltipAvailable: false, adaptiveLevels: [] },
      },
      performance: {
        largeTree: { nodeCount: 220, fps: 12, p95FrameMs: 120, errors: ['jank'] },
        lifecycle: {
          afterDestroy: { timers: 1, rafs: 0, resizeObservers: 0, listeners: 2, subscriptions: 0 },
          callbacksAfterDestroy: 1,
          duplicateBindings: 1,
        },
      },
      accessibility: {
        keyboard: { observedInBrowser: true, focusVisible: false, controls: [] },
      },
      engineering: {
        themeAndGroup: { lightThemeApplied: true, darkThemeApplied: false, groupStyleApplied: false, errors: ['missing-dark'] },
        notes: { dataMapping: '', bidirectionalTraversal: '', layout: '', standardChartIntegration: '', unfinished: '' },
      },
    },
  };
}
