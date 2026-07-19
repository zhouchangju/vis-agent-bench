const REQUIRED_METHODS = [
  'mount',
  'update',
  'selectNode',
  'selectRelation',
  'clearSelection',
  'getPerformanceStats',
  'dispose',
];

export class SceneAdapterContractError extends Error {
  constructor(summary, nextActions, details = []) {
    super(summary);
    this.name = 'SceneAdapterContractError';
    this.result = {
      status: 'error',
      summary,
      next_actions: nextActions,
      artifacts: [],
      details,
      error: {
        root_cause_hint: summary,
        safe_retry: 'Implement the missing adapter methods, then rerun npm test.',
        stop_condition: 'Stop after two identical failures and inspect the listed method names.',
      },
    };
  }
}

export function assertSceneAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new SceneAdapterContractError(
      'A scene adapter object is required.',
      ['Provide an object implementing the documented scene adapter methods.'],
    );
  }
  const missing = REQUIRED_METHODS.filter((method) => typeof adapter[method] !== 'function');
  if (missing.length > 0) {
    throw new SceneAdapterContractError(
      `Scene adapter is missing ${missing.length} required method(s).`,
      ['Implement every method listed in details and rerun npm test.'],
      missing,
    );
  }
  return adapter;
}

export function createUnimplementedAdapter() {
  const unavailable = (operation) => ({
    status: 'warning',
    summary: `Scene operation "${operation}" is not implemented in the starter.`,
    next_actions: ['Replace createUnimplementedAdapter with a candidate implementation.'],
    artifacts: [],
  });
  return {
    mount: () => unavailable('mount'),
    update: () => unavailable('update'),
    selectNode: () => unavailable('selectNode'),
    selectRelation: () => unavailable('selectRelation'),
    clearSelection: () => unavailable('clearSelection'),
    getPerformanceStats: () => unavailable('getPerformanceStats'),
    dispose: () => unavailable('dispose'),
  };
}

export const SCENE_INPUT_CONTRACT = Object.freeze({
  themes: ['light', 'dark'],
  languages: ['zh', 'en'],
  viewModes: ['sphere-3d', 'relation-2d'],
  relationStrategies: ['always', 'interaction-only', 'primary-emphasis'],
  fallbackStates: ['ready', 'reduced-quality', 'webgl-unavailable', 'context-lost'],
  performanceFields: [
    'fps',
    'frame_ms',
    'draw_calls',
    'triangles',
    'textures',
    'visible_objects',
  ],
});

export function validateRuntimeOptions(options) {
  const issues = [];
  if (!options || typeof options !== 'object') {
    issues.push('$.runtime');
  } else {
    if (!SCENE_INPUT_CONTRACT.themes.includes(options.theme)) issues.push('$.runtime.theme');
    if (!SCENE_INPUT_CONTRACT.languages.includes(options.language)) issues.push('$.runtime.language');
    if (!SCENE_INPUT_CONTRACT.viewModes.includes(options.viewMode)) issues.push('$.runtime.viewMode');
    if (!SCENE_INPUT_CONTRACT.relationStrategies.includes(options.relationStrategy)) {
      issues.push('$.runtime.relationStrategy');
    }
    const offset = options.visibleOffset;
    if (!offset || ['top', 'right', 'bottom', 'left'].some((key) => !Number.isFinite(offset[key]))) {
      issues.push('$.runtime.visibleOffset');
    }
  }
  if (issues.length === 0) {
    return {
      status: 'success',
      summary: 'Runtime options satisfy the scene input contract.',
      next_actions: [],
      artifacts: [],
    };
  }
  return {
    status: 'error',
    summary: `Runtime options have ${issues.length} contract issue(s).`,
    next_actions: ['Correct the listed runtime option paths and retry.'],
    artifacts: [],
    details: issues,
    error: {
      root_cause_hint: 'One or more runtime options are missing or unsupported.',
      safe_retry: 'Use only values declared by SCENE_INPUT_CONTRACT.',
      stop_condition: 'Stop if the same option fails twice and inspect data/contract.md.',
    },
  };
}
