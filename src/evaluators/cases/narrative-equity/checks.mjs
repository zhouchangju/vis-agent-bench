import { declareCheck } from '../../core/index.mjs';
import {
  GEOMETRY_TOLERANCE,
  edgeNodeIntersections,
  endpointBoundaryFailures,
  maximumLayerSpread,
  positionDrift,
  severeNodeOverlaps,
} from './geometry.mjs';
import { statesEqual } from './state.mjs';

const HARD_GATES = new Set([
  'build-and-typecheck',
  'valid-overview-render',
  'deterministic-chapter-navigation',
  'no-critical-layout-overlap',
  'lifecycle-cleanup',
]);

const P0_CHECKS = new Set([
  ...HARD_GATES,
  'dsl-validation-and-compatibility',
  'event-payload-correctness',
  'node-node-overlap',
  'edge-node-overlap',
  'edge-endpoint-boundary',
  'basic-animation-semantics',
  'persistent-opacity-and-dim',
  'arbitrary-chapter-start',
  'previous-next-and-pause-resume',
  'resize-and-stale-transition-control',
]);

export function createNarrativeEquityChecks(rubric) {
  const checks = [];
  for (const [category, definition] of Object.entries(rubric.categories)) {
    for (const id of definition.checks || []) {
      const assertion = ASSERTIONS[id.replaceAll('-', '_')];
      if (!assertion) throw new Error(`No deterministic assertion registered for rubric check "${id}".`);
      checks.push(declareCheck({
        id,
        title: id.replaceAll('-', ' '),
        category,
        level: P0_CHECKS.has(id) ? 'p0' : inferLevel(category, id),
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
  build_and_typecheck: observation => {
    const failed = ['build', 'typecheck', 'test'].filter(name => observation.commands?.[name]?.exitCode !== 0);
    return result(failed.length === 0, { failed, commands: observation.commands });
  },
  valid_overview_render: observation => {
    const overview = observation.overview || {};
    return result(
      overview.status === 'ready'
        && overview.nodes?.length > 0
        && overview.edges?.length > 0
        && (overview.uncaughtErrors || []).length === 0,
      { status: overview.status, nodeCount: overview.nodes?.length || 0, edgeCount: overview.edges?.length || 0, errors: overview.uncaughtErrors || [] },
    );
  },
  dsl_validation_and_compatibility: observation => {
    const dsl = observation.dsl || {};
    return result(dsl.validAccepted === true && dsl.invalidRejected === true
      && dsl.hiddenInvalidSampleUsed === true && dsl.optionalAudioAccepted === true
      && dsl.invalidCausedUncaughtError !== true, dsl);
  },
  node_edge_semantics: observation => {
    const semantics = observation.overview?.semantics || {};
    return result(
      includesAll(semantics.nodeKinds, ['organization', 'person', 'metric'])
      && includesAll(semantics.edgeDirections, ['forward', 'bidirectional', 'mutual'])
      && includesAll(semantics.edgeStyles, ['solid', 'dashed'])
      && semantics.missingAssetFallbacks >= 1
      && semantics.orphanEdgesRendered === 0,
      semantics,
    );
  },
  overview_chapter_to_show_contract: observation => booleanFact(observation, 'overview_chapter_to_show_contract'),
  event_payload_correctness: observation => {
    const events = observation.events || {};
    return result(events.requiredTypesPresent === true && events.invalidPayloads === 0 && events.duplicateDispatches === 0, events);
  },
  no_critical_layout_overlap: observation => {
    const overview = observation.overview || {};
    const node = severeNodeOverlaps(overview.nodes);
    const edge = edgeNodeIntersections(overview.edges, overview.nodes || []);
    return result(node.length === 0 && edge.length === 0, { nodeOverlaps: node, edgeNodeIntersections: edge });
  },
  fit_and_title_offset: observation => {
    const { viewport, graphBounds, titleBounds } = observation.overview || {};
    const fits = viewport && graphBounds
      && graphBounds.x >= 0 && graphBounds.y >= 0
      && graphBounds.x + graphBounds.width <= viewport.width
      && graphBounds.y + graphBounds.height <= viewport.height;
    const titleClear = !titleBounds || !graphBounds || titleBounds.y + titleBounds.height <= graphBounds.y;
    return result(Boolean(fits && titleClear), { viewport, graphBounds, titleBounds });
  },
  label_aware_node_spacing: observation => booleanFact(observation, 'label_aware_node_spacing'),
  node_node_overlap: observation => {
    const failures = severeNodeOverlaps(observation.overview?.nodes);
    return result(failures.length === 0, { failures, threshold: GEOMETRY_TOLERANCE.severeOverlapRatio });
  },
  edge_node_overlap: observation => {
    const overview = observation.overview || {};
    const failures = edgeNodeIntersections(overview.edges, overview.nodes || []);
    return result(failures.length === 0, { failures, insetPx: GEOMETRY_TOLERANCE.edgeNodeInsetPx });
  },
  edge_endpoint_boundary: observation => {
    const overview = observation.overview || {};
    const failures = endpointBoundaryFailures(overview.edges, overview.nodes || []);
    return result(failures.length === 0, { failures, tolerancePx: GEOMETRY_TOLERANCE.endpointBoundaryPx });
  },
  edge_label_wrapping_and_collision: observation => {
    const labels = observation.overview?.edgeLabels || {};
    return result(labels.collisions === 0 && labels.protectedTokensBroken === 0
      && labels.overflowCount === 0 && labels.opaqueBackground === true, labels);
  },
  horizontal_layer_alignment: observation => {
    const nodes = observation.overview?.nodes || [];
    const spread = maximumLayerSpread(nodes);
    return result(nodes.length > 0 && nodes.every(node => node.layer != null)
      && spread <= GEOMETRY_TOLERANCE.layerAlignmentPx,
    { spread, tolerancePx: GEOMETRY_TOLERANCE.layerAlignmentPx });
  },
  overview_chapter_position_stability: observation => comparePositionSnapshots(observation, 'overview', 'chapterShared'),
  node_type_status_focus_encoding: observation => booleanFact(observation, 'node_type_status_focus_encoding'),
  edge_style_direction_encoding: observation => booleanFact(observation, 'edge_style_direction_encoding'),
  label_and_tag_readability: observation => booleanFact(observation, 'label_and_tag_readability'),
  subtitle_panel_and_popup_layering: observation => booleanFact(observation, 'subtitle_panel_and_popup_layering'),
  small_container_degradation: observation => booleanFact(observation, 'small_container_degradation'),
  basic_animation_semantics: observation => booleanFact(observation, 'basic_animation_semantics'),
  grow_and_move_sequence: observation => booleanFact(observation, 'grow_and_move_sequence'),
  replace_without_flash: observation => booleanFact(observation, 'replace_without_flash'),
  group_group_grow_ungroup: observation => booleanFact(observation, 'group_group_grow_ungroup'),
  persistent_opacity_and_dim: observation => {
    const states = observation.states || {};
    return result(nonEmptyState(states.beforeRerender) && nonEmptyState(states.afterRerender)
      && statesEqual(states.beforeRerender, states.afterRerender), {
      before: states.beforeRerender,
      after: states.afterRerender,
    });
  },
  camera_focus: observation => booleanFact(observation, 'camera_focus'),
  deterministic_chapter_navigation: observation => {
    const states = observation.states || {};
    return result(nonEmptyState(states.directChapter) && nonEmptyState(states.sequentialChapter)
      && statesEqual(states.directChapter, states.sequentialChapter), {
      direct: states.directChapter,
      sequential: states.sequentialChapter,
    });
  },
  overview_to_chapter: observation => booleanFact(observation, 'overview_to_chapter'),
  chapter_inheritance: observation => booleanFact(observation, 'chapter_inheritance'),
  arbitrary_chapter_start: observation => booleanFact(observation, 'arbitrary_chapter_start'),
  previous_next_and_pause_resume: observation => booleanFact(observation, 'previous_next_and_pause_resume'),
  completion_returns_overview: observation => booleanFact(observation, 'completion_returns_overview'),
  audio_animation_timing: observation => {
    const timing = observation.timing || {};
    return result(timing.actualStepMs >= Math.max(timing.animationMs || 0, timing.audioMs || 0)
      && timing.invalidAudioBlocked !== true && timing.noAudioBlocked !== true, timing);
  },
  lifecycle_cleanup: observation => {
    const life = observation.lifecycle || {};
    const pending = ['timers', 'rafs', 'audio', 'resizeObservers', 'subscriptions']
      .reduce((sum, key) => sum + (life.afterDestroy?.[key] || 0), 0);
    return result(pending === 0 && life.callbacksAfterDestroy === 0 && life.hostChildrenAfterDestroy === 0, life);
  },
  component_api_and_types: observation => booleanFact(observation, 'component_api_and_types'),
  resize_and_stale_transition_control: observation => {
    const states = observation.states || {};
    const behavior = observation.behavior || {};
    return result(nonEmptyState(states.beforeResize) && nonEmptyState(states.afterResize)
      && statesEqual(states.beforeResize, states.afterResize)
      && behavior.staleTransitionWrites === 0, {
      beforeResize: states.beforeResize,
      afterResize: states.afterResize,
      staleTransitionWrites: behavior.staleTransitionWrites,
    });
  },
  cleanup_and_no_duplicate_events: observation => {
    const events = observation.events || {};
    const life = observation.lifecycle || {};
    return result(events.duplicateDispatches === 0 && life.duplicateBindings === 0
      && life.callbacksAfterDestroy === 0, { events, lifecycle: life });
  },
  automated_tests: observation => booleanFact(observation, 'automated_tests'),
  examples_and_documentation: observation => booleanFact(observation, 'examples_and_documentation'),
};

function booleanFact(observation, id) {
  const value = observation.behavior?.[id];
  return result(value === true, { observed: value });
}

function comparePositionSnapshots(observation, beforeName, afterName) {
  const before = observation.positions?.[beforeName] || [];
  const after = observation.positions?.[afterName] || [];
  const failures = positionDrift(before, after).filter(
    item => item.reason || item.distance > GEOMETRY_TOLERANCE.stablePositionPx,
  );
  return result(before.length > 0 && after.length > 0 && failures.length === 0, {
    failures,
    tolerancePx: GEOMETRY_TOLERANCE.stablePositionPx,
  });
}

function result(ok, details) {
  return { ok, details };
}

function outcome(id, assertion, observation) {
  const paths = observation.artifact_paths?.[id] || observation.artifact_paths?.default || [];
  const artifacts = Array.isArray(paths) ? paths : [paths];
  return {
    status: assertion.ok ? 'pass' : 'fail',
    reason: assertion.ok ? null : `deterministic assertion failed: ${id}`,
    evidence: {
      details: assertion.details,
      artifact_paths: artifacts,
    },
    artifacts,
  };
}

function includesAll(actual = [], expected) {
  return expected.every(value => actual.includes(value));
}

function nonEmptyState(state) {
  return state && typeof state === 'object' && Object.keys(state).length > 0;
}

function inferLevel(category, id) {
  if (category === 'engineering_delivery' || id === 'small-container-degradation') return 'p2';
  return 'p1';
}

export function registeredAssertionIds() {
  return Object.keys(ASSERTIONS).map(id => id.replaceAll('_', '-')).sort();
}
