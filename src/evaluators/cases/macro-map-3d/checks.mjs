import { declareCheck } from '../../core/index.mjs';
import { assertWebGLSemantic } from '../../../browser-evidence/webgl-inspector.mjs';
import { assertPerformance } from '../../../browser-evidence/perf-collector.mjs';
import { compareScreenshots } from '../../../browser-evidence/screenshot-diff.mjs';

const HARD_GATES = new Set([
  'build-and-test',
  'input-validation',
  'scale-ladder-data-completeness',
  'deterministic-layer-layout',
  'relation-data-integrity',
  'browser-runtime-clean',
  'browser-canvas-observable-state',
  'repeated-mount-dispose-cleanup',
]);

const P0_CHECKS = new Set([
  ...HARD_GATES,
  'importance-size-mapping',
  'relation-semantics-mapping',
  'relation-encoding-state',
  'language-label-runtime-state',
  'camera-auto-rotation-state',
  'pointer-camera-controls',
  'drag-click-disambiguation',
  'node-selection-and-clear',
  'relation-selection-and-tooltip',
  'scale-ladder-operability',
  'resize-stability',
  'context-loss-and-degradation',
  'adapter-api-and-runtime-updates',
]);

// ROADMAP M3 quality-enhancement assertions. These are P1 differentiators,
// never hard gates: they enrich the evidence but cannot fail the run on
// their own unless the rubric explicitly turns them into gates.
const M3_QUALITY_CHECKS = new Set([
  'webgl-semantic-correctness',
  'visual-baseline-diff',
  'performance-budget',
]);

const WEBGL_EXPECTATIONS = Object.freeze({
  min_canvas_count: 1,
  require_webgl: true,
  context_lost: false,
  renderer_includes: 'ANGLE',
  min_max_texture_size: 1024,
  min_drawing_buffer_area: 100 * 100,
  min_active_programs: 1,
});

const VISUAL_BASELINE_OPTIONS = Object.freeze({
  threshold: 0.05,
  perceptual: true,
  pixel_threshold: 25,
});

const PERFORMANCE_THRESHOLDS = Object.freeze({
  min_fps: 30,
  max_p95_frame_ms: 50,
  max_heap_mb: 512,
  max_longtask_ms: 100,
  max_longtask_count: 20,
});

const EXPECTED_DATASETS = Object.freeze({
  200: 284,
  800: 1137,
  1481: 2106,
});

const PERFORMANCE_FIELDS = Object.freeze([
  'fps',
  'frame_ms',
  'draw_calls',
  'triangles',
  'textures',
  'visible_objects',
]);

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  'mount',
  'update',
  'selectNode',
  'selectRelation',
  'clearSelection',
  'getPerformanceStats',
  'dispose',
]);

export function createMacroMap3dChecks(rubric) {
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
    const commands = observation.commands || {};
    const failed = ['build', 'typecheck', 'test']
      .filter(name => commands[name]?.exitCode !== 0);
    return result(failed.length === 0, { failed, commands });
  },

  input_validation: observation => {
    const inputs = observation.inputs || {};
    const invalid = inputs.hiddenInvalidCases || [];
    return result(
      inputs.publicValidAccepted === true
        && inputs.boundaryAccepted === true
        && inputs.invalidCausedUncaughtError !== true
        && invalid.length >= 6
        && invalid.every(item => item.rejected === true && nonEmpty(item.diagnostic)),
      inputs,
    );
  },

  scale_ladder_data_completeness: observation => {
    const datasets = observation.datasets || [];
    const failures = Object.entries(EXPECTED_DATASETS).flatMap(([nodeCount, relationCount]) => {
      const item = datasets.find(dataset => dataset.nodes === Number(nodeCount));
      if (!item || item.relations !== relationCount
        || item.renderedNodes !== Number(nodeCount)
        || item.renderedRelations !== relationCount
        || item.truncated === true) {
        return [{ expected: { nodes: Number(nodeCount), relations: relationCount }, observed: item || null }];
      }
      return [];
    });
    return result(failures.length === 0, { failures, datasets });
  },

  deterministic_layer_layout: observation => {
    const layout = observation.layout || {};
    const radii = layout.layerRadii || {};
    return result(
      layout.datasetNodes === 1481
        && layout.finitePositions === 1481
        && layout.mappedNodeIds === 1481
        && layout.repeatSnapshotEqual === true
        && finite(radii.core?.max)
        && finite(radii.peripheral?.min)
        && radii.core.max < radii.peripheral.min,
      layout,
    );
  },

  importance_size_mapping: observation => {
    const mapping = observation.layout?.sizeMapping || {};
    const samples = mapping.samples || [];
    const sorted = [...samples].sort((a, b) => a.importance - b.importance);
    const monotonic = sorted.length >= 3
      && sorted.every((item, index) => index === 0 || item.size >= sorted[index - 1].size);
    return result(
      mapping.extremesClamped === true
        && finite(mapping.minSize)
        && finite(mapping.maxSize)
        && mapping.minSize > 0
        && mapping.maxSize >= mapping.minSize
        && samples.every(item => finite(item.importance) && finite(item.size)
          && item.size >= mapping.minSize && item.size <= mapping.maxSize)
        && monotonic,
      { ...mapping, monotonic },
    );
  },

  relation_semantics_mapping: observation => {
    const semantics = observation.render?.relations || {};
    return result(
      includesAll(Object.keys(semantics), ['positive', 'negative', 'unknown'])
        && Object.values(semantics).every(item => nonEmpty(item.token) && item.directed === true)
        && new Set(Object.values(semantics).map(item => item.token)).size === 3,
      semantics,
    );
  },

  relation_data_integrity: observation => {
    const integrity = observation.layout?.renderedRelationIntegrity || {};
    const orphanEdges = Number(integrity.orphanEdges || 0);
    const duplicateEdges = Number(integrity.duplicateEdges || 0);
    const mismatchedEdges = Number(integrity.mismatchedEdges || 0);
    const totalRendered = Number(integrity.totalRendered ?? -1);
    const totalInput = Number(integrity.totalInput ?? -1);
    return result(
      integrity.endpointIdPairsMatch === true
        && integrity.relationTypeMappingCorrect === true
        && integrity.directionPreserved === true
        && orphanEdges === 0
        && duplicateEdges === 0
        && mismatchedEdges === 0
        && totalRendered === totalInput
        && totalInput > 0,
      integrity,
    );
  },

  browser_canvas_observable_state: observation => {
    const browser = observation.browser || {};
    const canvases = (browser.dom_snapshots || [])
      .flatMap(snapshot => snapshot.summary?.canvases || []);
    const observable = canvases.some(canvas => canvas.width > 0 && canvas.height > 0
      && canvas.css_width > 0 && canvas.css_height > 0
      && canvas.drawing_non_empty === true && canvas.encoded_length > 100);
    return result(
      browser.driver === 'playwright-chromium'
        && observable
        && (browser.screenshots || []).length > 0
        && browser.canvas_webgl_proven === false,
      {
        observable,
        canvasCount: canvases.length,
        screenshotCount: browser.screenshots?.length || 0,
        canvas_webgl_proven: browser.canvas_webgl_proven,
        claim: 'observable non-empty Canvas bytes only; not visual or WebGL correctness',
      },
    );
  },

  spatial_layer_encoding_state: observation => {
    const layers = observation.render?.layers || {};
    return result(
      nonEmpty(layers.core?.token)
        && nonEmpty(layers.peripheral?.token)
        && layers.core.token !== layers.peripheral.token
        && layers.innerSphereVisible === true,
      layers,
    );
  },

  relation_encoding_state: observation => {
    const relations = observation.render?.relations || {};
    return result(
      includesAll(Object.keys(relations), ['positive', 'negative', 'unknown'])
        && Object.values(relations).every(item => nonEmpty(item.token) && item.directed === true),
      relations,
    );
  },

  language_label_runtime_state: observation => {
    const labels = observation.render?.labels || {};
    return result(
      labels.languages?.zh === true
        && labels.languages?.en === true
        && labels.runtimeSwitchPreservedSelection === true
        && labels.longLabelObserved === true
        && labels.missingLabels === 0,
      labels,
    );
  },

  theme_depth_runtime_state: observation => {
    const render = observation.render || {};
    return result(
      render.themes?.light === true
        && render.themes?.dark === true
        && render.themeSwitchPreservedState === true
        && includesAll(render.depthStates || [], ['near', 'far', 'background']),
      render,
    );
  },

  perspective_depth_state: observation => {
    const projection = observation.render?.projection || {};
    const ratio = Number(projection.nearFarSizeRatio ?? -1);
    return result(
      projection.mode === 'perspective'
        && projection.orthographicFallbackDetected === false
        && finite(ratio)
        && ratio > 1,
      projection,
    );
  },

  browser_runtime_clean: observation => {
    const browser = observation.browser || {};
    const failedActions = (browser.action_log || []).filter(item => item.status !== 'passed');
    return result(
      browser.status === 'success'
        && browser.driver === 'playwright-chromium'
        && nonEmpty(browser.environment?.browser_version)
        && (browser.failures || []).length === 0
        && (browser.console_errors || []).length === 0
        && (browser.page_errors || []).length === 0
        && failedActions.length === 0
        && (observation.runtime?.uncaughtErrors || []).length === 0,
      {
        status: browser.status,
        browserVersion: browser.environment?.browser_version,
        failures: browser.failures || [],
        failedActions,
        consoleErrors: browser.console_errors || [],
        pageErrors: browser.page_errors || [],
        runtimeErrors: observation.runtime?.uncaughtErrors || [],
      },
    );
  },

  camera_auto_rotation_state: observation => {
    const camera = observation.camera || {};
    return result(
      camera.defaultAutoRotate === true
        && camera.positionChangedBeforeInteraction === true
        && camera.pausedOnHover === true
        && camera.pausedOnUserInput === true
        && camera.resumedAfterIdle === true,
      camera,
    );
  },

  pointer_camera_controls: observation => {
    const controls = observation.interactions?.controls || {};
    return result(
      controls.mouseRotate === true
        && controls.touchRotate === true
        && controls.wheelZoom === true
        && controls.pinchZoom === true,
      controls,
    );
  },

  drag_click_disambiguation: observation => {
    const drag = observation.interactions?.drag || {};
    return result(
      drag.dragGestures > 0
        && drag.clickEventsAfterDrag === 0
        && drag.transitionHitErrors === 0,
      drag,
    );
  },

  node_selection_and_clear: observation => {
    const node = observation.selection?.node || {};
    return result(
      nonEmpty(node.selectedId)
        && node.centerHighlighted === true
        && node.oneHopNodeIds?.length > 0
        && node.oneHopRelationIds?.length > 0
        && node.unrelatedDimmed === true
        && node.unrelatedClickPreservedSelection === true
        && node.clearReturnedOverview === true,
      node,
    );
  },

  camera_rotation_axis_stability: observation => {
    const axis = observation.camera?.rotationAxisStable || {};
    const deviation = Number(axis.upVectorDeviation ?? Number.POSITIVE_INFINITY);
    return result(
      axis.upVectorAxis === 'world-y'
        && axis.sampledDuringDrag === true
        && axis.offAxisDriftDetected === false
        && finite(deviation)
        && deviation <= 0.05,
      axis,
    );
  },

  label_scoping_state: observation => {
    const scoping = observation.selection?.labelScoping || {};
    const leaked = Number(scoping.unrelatedLabelLeaks || 0);
    return result(
      scoping.observedInLocalState === true
        && scoping.relatedLabelsVisible === true
        && scoping.nonRelatedLabelsHidden === true
        && leaked === 0,
      scoping,
    );
  },

  relation_selection_and_tooltip: observation => {
    const selection = observation.selection || {};
    return result(
      nonEmpty(selection.relation?.selectedId)
        && includesAll(selection.relation?.endpointIds || [], selection.relation?.focusedEndpointIds || [])
        && selection.relation?.onlyInLocalState === true
        && selection.tooltip?.hoverVisible === true
        && selection.tooltip?.nodeId === selection.node?.selectedId
        && selection.tooltip?.relationVisible === true,
      selection,
    );
  },

  view_mode_operation_switch: observation => {
    const view = observation.runtime?.viewModes || {};
    return result(
      view.sphere3d?.operation === 'rotate'
        && view.relation2d?.operation === 'pan'
        && view.transitionCompleted === true
        && view.transitionHitErrors === 0
        && view.terminalStateStable === true,
      view,
    );
  },

  runtime_aggregation_switches: observation => {
    const switches = observation.runtime?.switches || {};
    return result(
      switches.metrics?.length >= 2
        && switches.periods?.length >= 2
        && switches.metricChangedValues === true
        && switches.periodChangedValues === true
        && includesAll(switches.relationStrategies || [], ['always', 'interaction-only', 'primary-emphasis'])
        && switches.staleWrites === 0,
      switches,
    );
  },

  visible_offset_hit_state: observation => {
    const offset = observation.runtime?.visibleOffset || {};
    const expected = offset.expectedCenter || {};
    const actual = offset.actualCenter || {};
    return result(
      finite(expected.x) && finite(expected.y) && finite(actual.x) && finite(actual.y)
        && Math.abs(expected.x - actual.x) <= 1
        && Math.abs(expected.y - actual.y) <= 1
        && offset.hitErrors === 0,
      offset,
    );
  },

  scale_ladder_operability: observation => {
    const scale = observation.performance?.scales || [];
    return result(
      Object.keys(EXPECTED_DATASETS).every(nodes => {
        const item = scale.find(entry => entry.nodes === Number(nodes));
        return item?.interactive === true && item?.terminalState === 'ready';
      }),
      scale,
    );
  },

  performance_budget_and_stats: observation => {
    const samples = observation.performance?.samples || [];
    const failures = samples.filter(sample => {
      const stats = sample.stats || {};
      return !PERFORMANCE_FIELDS.every(field => finite(stats[field]) && stats[field] >= 0)
        || stats.fps < 20
        || sample.p95_frame_ms > 50
        || stats.draw_calls > 100
        || stats.textures > 64;
    });
    return result(samples.length > 0 && failures.length === 0, {
      profile: observation.performance?.profile,
      thresholds: { minFps: 20, maxP95FrameMs: 50, maxDrawCalls: 100, maxTextures: 64 },
      failures,
    });
  },

  resize_stability: observation => {
    const resize = observation.resize || {};
    return result(
      resize.snapshots?.length >= 3
        && resize.snapshots.every(item => item.width > 0 && item.height > 0 && item.canvasMatchesHost === true)
        && resize.hitErrors === 0
        && resize.selectionPreserved === true
        && resize.uncaughtErrors === 0,
      resize,
    );
  },

  context_loss_and_degradation: observation => {
    const fallback = observation.fallback || {};
    return result(
      fallback.contextLostObserved === true
        && fallback.contextRestored === true
        && fallback.postRestoreState === 'ready'
        && fallback.reducedQualityState === 'reduced-quality'
        && fallback.webglUnavailableState === 'webgl-unavailable'
        && fallback.userMessageVisible === true
        && fallback.uncaughtErrors === 0,
      fallback,
    );
  },

  repeated_mount_dispose_cleanup: observation => {
    const lifecycle = observation.lifecycle || {};
    const after = lifecycle.afterDispose || {};
    return result(
      lifecycle.cycles >= 20
        && ['rafs', 'listeners', 'geometries', 'materials', 'textures', 'renderers']
          .every(name => after[name] === 0)
        && lifecycle.callbacksAfterDispose === 0
        && lifecycle.hostChildrenAfterDispose === 0
        && lifecycle.resourceGrowth === 0,
      lifecycle,
    );
  },

  hot_path_resource_bounds: observation => {
    const hotPath = observation.performance?.hotPath || {};
    return result(
      hotPath.fullEdgeTraversalEveryFrame === false
        && hotPath.rebuildAllEdgesEveryFrame === false
        && hotPath.temporaryObjectsPerFrame <= 50
        && hotPath.rendererCount === 1,
      hotPath,
    );
  },

  adapter_api_and_runtime_updates: observation => {
    const engineering = observation.engineering || {};
    return result(
      includesAll(engineering.adapterMethods || [], REQUIRED_ADAPTER_METHODS)
        && includesAll(engineering.runtimeUpdates || [], [
          'data', 'theme', 'language', 'viewMode', 'visibleOffset', 'metric', 'period', 'relationStrategy',
        ])
        && engineering.callbacks?.node === true
        && engineering.callbacks?.relation === true
        && engineering.callbacks?.state === true,
      engineering,
    );
  },

  automated_tests_and_docs: observation => {
    const engineering = observation.engineering || {};
    return result(
      observation.commands?.test?.exitCode === 0
        && engineering.automatedTests === true
        && engineering.readmeDocumentsTradeoffs === true
        && engineering.readmeDocumentsIncomplete === true,
      engineering,
    );
  },

  real_browser_observation_provenance: observation => {
    const browser = observation.browser || {};
    return result(
      browser.driver === 'playwright-chromium'
        && browser.environment?.playwright_source != null
        && browser.environment?.chromium_source != null
        && nonEmpty(browser.environment?.browser_version)
        && browser.wait?.kind === 'declarative-steps'
        && browser.action_log?.length > 0
        && browser.dom_snapshots?.length > 0,
      {
        driver: browser.driver,
        environment: browser.environment,
        wait: browser.wait,
        actionCount: browser.action_log?.length || 0,
        snapshotCount: browser.dom_snapshots?.length || 0,
      },
    );
  },

  automated_human_review_boundary: observation => {
    const boundary = observation.proof_boundary || {};
    return result(
      boundary.browserProvesBehaviorStateOnly === true
        && boundary.canvasSignatureProvesAesthetics === false
        && boundary.canvasSignatureProvesWebglCorrectness === false
        && includesAll(boundary.humanReview || [], [
          'spatial-hierarchy-aesthetics',
          'camera-comfort',
          'animation-feel',
          'label-aesthetics',
        ]),
      boundary,
    );
  },

  // ----------------- ROADMAP M3 quality-enhancement assertions -----------------
  // These three checks consume the optional observation fields
  // `webgl`, `screenshot`, and `performance.browser_sample`. When the
  // observation does not carry the field, the check returns a `pass` with
  // explanatory evidence ("field not collected"). This keeps the rubric
  // scorable for candidates that did not wire the M3 evidence pipeline
  // (an omitted optional field is never a regression). When the field IS
  // present and the assertion fails, the check reports fail.
  // They are P1 differentiators, never hard gates.
  webgl_semantic_correctness: observation => {
    const facts = observation.webgl;
    if (!facts || typeof facts !== 'object') {
      return result(true, {
        collected: false,
        reason: 'webgl observation missing; M3 WebGL facts not collected for this run',
        expectations: WEBGL_EXPECTATIONS,
      });
    }
    const verdict = assertWebGLSemantic(facts, WEBGL_EXPECTATIONS);
    return result(verdict.status === 'pass', {
      collected: true,
      verdict,
      expectations: WEBGL_EXPECTATIONS,
      claim: 'WebGL semantic invariants; not visual/aesthetic judgment.',
    });
  },

  visual_baseline_diff: observation => {
    const screenshot = observation.screenshot;
    if (!screenshot || typeof screenshot !== 'object') {
      return result(true, {
        collected: false,
        reason: 'screenshot observation missing; M3 baseline diff not collected for this run',
      });
    }
    const baseline = screenshot.baseline;
    const actual = screenshot.actual || screenshot.path || screenshot.buffer;
    if (!baseline || !actual) {
      return result(true, {
        collected: false,
        reason: 'screenshot baseline or actual image missing; diff skipped',
        screenshot: { hasBaseline: Boolean(baseline), hasActual: Boolean(actual) },
      });
    }
    const verdict = compareScreenshots(actual, baseline, {
      ...VISUAL_BASELINE_OPTIONS,
      ...(screenshot.options || {}),
    });
    return result(verdict.status === 'match' || verdict.status === 'skip', {
      collected: true,
      verdict,
      options: { ...VISUAL_BASELINE_OPTIONS, ...(screenshot.options || {}) },
      claim: 'Perceptual diff against baseline; not a business-correctness gate.',
    });
  },

  performance_budget: observation => {
    const sample = observation.performance?.browser_sample;
    if (!sample || typeof sample !== 'object') {
      return result(true, {
        collected: false,
        reason: 'performance.browser_sample missing; M3 perf budget not collected for this run',
        thresholds: PERFORMANCE_THRESHOLDS,
      });
    }
    const verdict = assertPerformance(sample, PERFORMANCE_THRESHOLDS);
    return result(verdict.status === 'pass' || verdict.status === 'skip', {
      collected: true,
      verdict,
      thresholds: PERFORMANCE_THRESHOLDS,
      claim: 'Browser perf budget; not a business-correctness gate.',
    });
  },
};

function result(ok, details) {
  return { ok, details };
}

function outcome(id, assertion, observation) {
  const paths = observation.artifact_paths?.[id] || observation.artifact_paths?.default || [];
  const artifacts = Array.isArray(paths) ? paths : [paths];
  return {
    status: assertion.ok ? 'pass' : 'fail',
    reason: assertion.ok ? null : `deterministic assertion failed: ${id}`,
    evidence: { details: assertion.details, artifact_paths: artifacts },
    artifacts,
  };
}

function includesAll(actual = [], expected = []) {
  return expected.every(value => actual.includes(value));
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function inferLevel(category) {
  return ['performance_stability', 'engineering_quality', 'evidence_documentation'].includes(category)
    ? 'p2'
    : 'p1';
}

export function registeredAssertionIds() {
  return Object.keys(ASSERTIONS).map(id => id.replaceAll('_', '-')).sort();
}
