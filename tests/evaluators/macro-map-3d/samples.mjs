export function createMinimalCompliantObservation(browser) {
  return {
    commands: {
      build: { exitCode: 0 },
      typecheck: { exitCode: 0 },
      test: { exitCode: 0 },
    },
    inputs: {
      publicValidAccepted: true,
      boundaryAccepted: true,
      invalidCausedUncaughtError: false,
      hiddenInvalidCases: [
        'duplicate-node-id',
        'dangling-relation',
        'invalid-relation-type',
        'malformed-importance',
        'answer-bearing-coordinate',
        'invalid-view-mode',
      ].map(id => ({ id, rejected: true, diagnostic: `rejected:${id}` })),
    },
    datasets: [
      { nodes: 200, relations: 284, renderedNodes: 200, renderedRelations: 284, truncated: false },
      { nodes: 800, relations: 1137, renderedNodes: 800, renderedRelations: 1137, truncated: false },
      { nodes: 1481, relations: 2106, renderedNodes: 1481, renderedRelations: 2106, truncated: false },
    ],
    layout: {
      datasetNodes: 1481,
      finitePositions: 1481,
      mappedNodeIds: 1481,
      repeatSnapshotEqual: true,
      layerRadii: { core: { min: 120, max: 168 }, peripheral: { min: 260, max: 340 } },
      sizeMapping: {
        minSize: 4,
        maxSize: 12,
        extremesClamped: true,
        samples: [
          { importance: -10, size: 4 },
          { importance: 0.5, size: 8 },
          { importance: 20, size: 12 },
        ],
      },
      renderedRelationIntegrity: {
        totalInput: 2106,
        totalRendered: 2106,
        endpointIdPairsMatch: true,
        relationTypeMappingCorrect: true,
        directionPreserved: true,
        orphanEdges: 0,
        duplicateEdges: 0,
        mismatchedEdges: 0,
      },
    },
    render: {
      relations: {
        positive: { token: 'positive-solid', directed: true },
        negative: { token: 'negative-dashed', directed: true },
        unknown: { token: 'unknown-muted', directed: true },
      },
      layers: {
        core: { token: 'core-layer' },
        peripheral: { token: 'peripheral-layer' },
        innerSphereVisible: true,
      },
      labels: {
        languages: { zh: true, en: true },
        runtimeSwitchPreservedSelection: true,
        longLabelObserved: true,
        missingLabels: 0,
      },
      themes: { light: true, dark: true },
      themeSwitchPreservedState: true,
      depthStates: ['near', 'far', 'background'],
      projection: {
        mode: 'perspective',
        orthographicFallbackDetected: false,
        nearFarSizeRatio: 1.8,
      },
    },
    browser,
    camera: {
      defaultAutoRotate: true,
      positionChangedBeforeInteraction: true,
      pausedOnHover: true,
      pausedOnUserInput: true,
      resumedAfterIdle: true,
      rotationAxisStable: {
        upVectorAxis: 'world-y',
        sampledDuringDrag: true,
        offAxisDriftDetected: false,
        upVectorDeviation: 0.01,
      },
    },
    interactions: {
      controls: {
        mouseRotate: true,
        touchRotate: true,
        wheelZoom: true,
        pinchZoom: true,
      },
      drag: {
        dragGestures: 2,
        clickEventsAfterDrag: 0,
        transitionHitErrors: 0,
      },
    },
    selection: {
      node: {
        selectedId: 'factor-core-001',
        centerHighlighted: true,
        oneHopNodeIds: ['factor-peripheral-002'],
        oneHopRelationIds: ['relation-001'],
        unrelatedDimmed: true,
        unrelatedClickPreservedSelection: true,
        clearReturnedOverview: true,
      },
      relation: {
        selectedId: 'relation-001',
        endpointIds: ['factor-core-001', 'factor-peripheral-002'],
        focusedEndpointIds: ['factor-peripheral-002'],
        onlyInLocalState: true,
      },
      tooltip: {
        hoverVisible: true,
        nodeId: 'factor-core-001',
        relationVisible: true,
      },
      labelScoping: {
        observedInLocalState: true,
        relatedLabelsVisible: true,
        nonRelatedLabelsHidden: true,
        unrelatedLabelLeaks: 0,
      },
    },
    runtime: {
      uncaughtErrors: [],
      viewModes: {
        sphere3d: { operation: 'rotate' },
        relation2d: { operation: 'pan' },
        transitionCompleted: true,
        transitionHitErrors: 0,
        terminalStateStable: true,
      },
      switches: {
        metrics: ['importance', 'momentum'],
        periods: ['2025-Q4', '2026-Q1'],
        metricChangedValues: true,
        periodChangedValues: true,
        relationStrategies: ['always', 'interaction-only', 'primary-emphasis'],
        staleWrites: 0,
      },
      visibleOffset: {
        expectedCenter: { x: 440, y: 300 },
        actualCenter: { x: 440.5, y: 299.5 },
        hitErrors: 0,
      },
    },
    resize: {
      snapshots: [
        { width: 1280, height: 800, canvasMatchesHost: true },
        { width: 800, height: 600, canvasMatchesHost: true },
        { width: 390, height: 844, canvasMatchesHost: true },
      ],
      hitErrors: 0,
      selectionPreserved: true,
      uncaughtErrors: 0,
    },
    fallback: {
      contextLostObserved: true,
      contextRestored: true,
      postRestoreState: 'ready',
      reducedQualityState: 'reduced-quality',
      webglUnavailableState: 'webgl-unavailable',
      userMessageVisible: true,
      uncaughtErrors: 0,
    },
    performance: {
      profile: 'unified-headless-chromium',
      scales: [
        { nodes: 200, interactive: true, terminalState: 'ready' },
        { nodes: 800, interactive: true, terminalState: 'ready' },
        { nodes: 1481, interactive: true, terminalState: 'ready' },
      ],
      samples: [{
        nodes: 1481,
        p95_frame_ms: 38,
        stats: {
          fps: 31,
          frame_ms: 32,
          draw_calls: 24,
          triangles: 125000,
          textures: 18,
          visible_objects: 3587,
        },
      }],
      hotPath: {
        fullEdgeTraversalEveryFrame: false,
        rebuildAllEdgesEveryFrame: false,
        temporaryObjectsPerFrame: 12,
        rendererCount: 1,
      },
    },
    lifecycle: {
      cycles: 20,
      afterDispose: {
        rafs: 0,
        listeners: 0,
        geometries: 0,
        materials: 0,
        textures: 0,
        renderers: 0,
      },
      callbacksAfterDispose: 0,
      hostChildrenAfterDispose: 0,
      resourceGrowth: 0,
    },
    engineering: {
      adapterMethods: [
        'mount', 'update', 'selectNode', 'selectRelation',
        'clearSelection', 'getPerformanceStats', 'dispose',
      ],
      runtimeUpdates: [
        'data', 'theme', 'language', 'viewMode', 'visibleOffset',
        'metric', 'period', 'relationStrategy',
      ],
      callbacks: { node: true, relation: true, state: true },
      automatedTests: true,
      readmeDocumentsTradeoffs: true,
      readmeDocumentsIncomplete: true,
    },
    proof_boundary: {
      browserProvesBehaviorStateOnly: true,
      canvasSignatureProvesAesthetics: false,
      canvasSignatureProvesWebglCorrectness: false,
      humanReview: [
        'spatial-hierarchy-aesthetics',
        'camera-comfort',
        'animation-feel',
        'label-aesthetics',
      ],
    },
    artifact_paths: {
      default: ['artifacts/macro-map-browser-evidence.json', 'artifacts/macro-map-final.png'],
    },
  };
}

export function createIntentionalFailure(browser) {
  const observation = createMinimalCompliantObservation(browser);
  observation.commands.build.exitCode = 1;
  observation.inputs.hiddenInvalidCases[0].rejected = false;
  observation.datasets[2].renderedNodes = 800;
  observation.layout.repeatSnapshotEqual = false;
  observation.layout.layerRadii.core.max = 300;
  observation.layout.renderedRelationIntegrity.endpointIdPairsMatch = false;
  observation.layout.renderedRelationIntegrity.duplicateEdges = 3;
  observation.layout.renderedRelationIntegrity.totalRendered = 2109;
  observation.render.projection.mode = 'orthographic';
  observation.render.projection.nearFarSizeRatio = 1;
  observation.camera.rotationAxisStable.offAxisDriftDetected = true;
  observation.camera.rotationAxisStable.upVectorDeviation = 0.2;
  observation.selection.labelScoping.unrelatedLabelLeaks = 4;
  observation.selection.labelScoping.nonRelatedLabelsHidden = false;
  observation.browser = {
    ...browser,
    status: 'warning',
    page_errors: [{ name: 'Error', message: 'intentional candidate error' }],
    failures: [{
      code: 'PAGE_ERROR',
      message: 'intentional candidate error',
      failure_class: 'product',
    }],
  };
  observation.selection.node.clearReturnedOverview = false;
  observation.performance.samples[0].stats.fps = 12;
  observation.fallback.contextRestored = false;
  observation.lifecycle.afterDispose.textures = 7;
  observation.lifecycle.resourceGrowth = 7;
  return observation;
}
