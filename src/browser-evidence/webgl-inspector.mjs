// WebGL semantic facts collector and declarative semantic assertions.
//
// Roadmap M3 task: "WebGL 语义正确性". This module is a pure-functions
// companion to the browser-evidence capture pipeline. It does NOT execute
// JavaScript itself; the caller hands it a Playwright `page` (or anything
// exposing `evaluate`), and the in-page probe runs through page.evaluate.
//
// Contract:
//   - No npm dependencies. The probe uses the page's own WebGL bindings.
//   - Failures degrade to `{status:'skip', reason}` rather than throwing,
//     because the lifecycle runner treats a thrown error as a harness
//     crash. A skip status is recorded by the evaluator's lifecycle.
//   - Structured errors use the shape `{status:'error', code, message,
//     root_cause_hint}` required by the architecture.

// In-page probe. Defined as a normal function so Playwright can serialize
// it across the boundary. It must NOT close over Node-side state.
function webglProbe() {
  const probes = [...document.querySelectorAll('canvas')].map((canvas, index) => {
    const summary = {
      index,
      css_width: 0,
      css_height: 0,
      has_webgl: false,
      has_webgl2: false,
      context_lost: false,
      renderer: null,
      vendor: null,
      version: null,
      shading_language_version: null,
      max_texture_size: null,
      max_viewport_dims: null,
      max_vertex_attribs: null,
      max_texture_image_units: null,
      drawing_buffer_width: 0,
      drawing_buffer_height: 0,
      active_program: null,
      active_attribute_count: null,
      active_uniform_count: null,
      read_error: null,
    };
    const rect = canvas.getBoundingClientRect();
    summary.css_width = Math.round(rect.width);
    summary.css_height = Math.round(rect.height);
    summary.drawing_buffer_width = canvas.width;
    summary.drawing_buffer_height = canvas.height;
    let gl = null;
    try {
      gl = canvas.getContext('webgl2') || null;
      if (gl) {
        summary.has_webgl2 = true;
        summary.has_webgl = true;
      } else {
        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') || null;
        if (gl) summary.has_webgl = true;
      }
      if (!gl) {
        summary.read_error = summary.read_error || 'no-webgl-context';
        return summary;
      }
      const currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      summary.active_program = currentProgram ? 1 : 0;
      try {
        if (currentProgram && typeof gl.getProgramParameter === 'function') {
          summary.active_attribute_count = gl.getProgramParameter(currentProgram, gl.ACTIVE_ATTRIBUTES);
          summary.active_uniform_count = gl.getProgramParameter(currentProgram, gl.ACTIVE_UNIFORMS);
        }
      } catch (innerError) {
        summary.read_error = `program-parameter:${innerError.message}`;
      }
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      summary.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : String(gl.getParameter(gl.RENDERER));
      summary.vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : String(gl.getParameter(gl.VENDOR));
      summary.version = String(gl.getParameter(gl.VERSION));
      summary.shading_language_version = String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
      summary.max_texture_size = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const viewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      summary.max_viewport_dims = Array.from(viewportDims || []);
      summary.max_vertex_attribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
      summary.max_texture_image_units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
      summary.drawing_buffer_width = gl.drawingBufferWidth;
      summary.drawing_buffer_height = gl.drawingBufferHeight;
      summary.context_lost = typeof gl.isContextLost === 'function' ? gl.isContextLost() : false;
    } catch (outerError) {
      summary.read_error = `probe:${outerError.message}`;
    }
    return summary;
  });
  return {
    canvas_count: probes.length,
    canvases: probes,
    webgl_available: probes.some(p => p.has_webgl),
    webgl2_available: probes.some(p => p.has_webgl2),
    any_context_lost: probes.some(p => p.context_lost === true),
  };
}

/**
 * Extract WebGL facts from the active page.
 *
 * @param {{evaluate: Function}} page - Playwright page (or test double).
 * @param {object} [options]
 * @returns {Promise<object>} A `WebGLFacts` object. When the page cannot be
 *   probed (no evaluate function, or evaluate throws), the result is
 *   `{ status:'skip', reason, root_cause_hint }` instead of throwing.
 */
export async function extractWebGLFacts(page, options = {}) {
  if (!page || typeof page.evaluate !== 'function') {
    return {
      status: 'skip',
      reason: 'page_unavailable',
      root_cause_hint: 'extractWebGLFacts requires a page with an evaluate() method (Playwright).',
    };
  }
  let raw;
  try {
    raw = await page.evaluate(webglProbe);
  } catch (error) {
    return {
      status: 'skip',
      reason: 'evaluate_failed',
      root_cause_hint: error instanceof Error ? error.message : String(error),
    };
  }
  if (!raw || typeof raw !== 'object') {
    return {
      status: 'skip',
      reason: 'empty_probe_result',
      root_cause_hint: 'page.evaluate returned a non-object WebGL probe result.',
    };
  }
  return normalizeFacts(raw);
}

function normalizeFacts(raw) {
  const canvases = Array.isArray(raw.canvases) ? raw.canvases.map((canvas, index) => ({
    index: Number.isInteger(canvas?.index) ? canvas.index : index,
    css_width: Number(canvas?.css_width) || 0,
    css_height: Number(canvas?.css_height) || 0,
    has_webgl: canvas?.has_webgl === true,
    has_webgl2: canvas?.has_webgl2 === true,
    context_lost: canvas?.context_lost === true,
    renderer: typeof canvas?.renderer === 'string' ? canvas.renderer : null,
    vendor: typeof canvas?.vendor === 'string' ? canvas.vendor : null,
    version: typeof canvas?.version === 'string' ? canvas.version : null,
    shading_language_version: typeof canvas?.shading_language_version === 'string'
      ? canvas.shading_language_version
      : null,
    max_texture_size: Number.isFinite(canvas?.max_texture_size) ? canvas.max_texture_size : null,
    max_viewport_dims: Array.isArray(canvas?.max_viewport_dims) ? canvas.max_viewport_dims : null,
    max_vertex_attribs: Number.isFinite(canvas?.max_vertex_attribs) ? canvas.max_vertex_attribs : null,
    max_texture_image_units: Number.isFinite(canvas?.max_texture_image_units)
      ? canvas.max_texture_image_units
      : null,
    drawing_buffer_width: Number(canvas?.drawing_buffer_width) || 0,
    drawing_buffer_height: Number(canvas?.drawing_buffer_height) || 0,
    active_program: Number.isFinite(canvas?.active_program) ? canvas.active_program : null,
    active_attribute_count: Number.isFinite(canvas?.active_attribute_count)
      ? canvas.active_attribute_count
      : null,
    active_uniform_count: Number.isFinite(canvas?.active_uniform_count)
      ? canvas.active_uniform_count
      : null,
    read_error: typeof canvas?.read_error === 'string' ? canvas.read_error : null,
  })) : [];
  return {
    status: 'ok',
    canvas_count: canvases.length,
    webgl_available: canvases.some(canvas => canvas.has_webgl),
    webgl2_available: canvases.some(canvas => canvas.has_webgl2),
    any_context_lost: canvases.some(canvas => canvas.context_lost),
    canvases,
    probe_kind: 'webgl-debug-renderer-info',
  };
}

/**
 * Compare extracted WebGL facts against a declarative expectation set.
 *
 * Expectation schema (all optional):
 *   - min_canvas_count: number
 *   - require_webgl: boolean
 *   - require_webgl2: boolean
 *   - context_lost: boolean (false = must not be lost)
 *   - renderer_includes: string (substring match, case-insensitive)
 *   - min_max_texture_size: number
 *   - min_drawing_buffer_area: number (w * h)
 *   - min_active_programs: number (across canvases, summed)
 *
 * Returns `{status, reason, evidence}` where status is 'pass' | 'fail'.
 * When facts.status === 'skip', the assertion mirrors the skip status so the
 * lifecycle can record a non-blocking skip rather than a hard failure.
 */
export function assertWebGLSemantic(facts, expectations = {}) {
  if (!facts || typeof facts !== 'object') {
    return {
      status: 'error',
      code: 'WEBGL_FACTS_INVALID',
      message: 'assertWebGLSemantic requires a facts object.',
      root_cause_hint: 'extractWebGLFacts must run before asserting.',
      evidence: { expectations },
    };
  }
  if (facts.status === 'skip') {
    return {
      status: 'skip',
      reason: facts.reason || 'webgl_unavailable',
      root_cause_hint: facts.root_cause_hint || null,
      evidence: { expectations },
    };
  }
  const failures = [];
  const canvases = Array.isArray(facts.canvases) ? facts.canvases : [];
  if (Number.isFinite(expectations.min_canvas_count)
    && canvases.length < expectations.min_canvas_count) {
    failures.push({
      field: 'min_canvas_count',
      expected: expectations.min_canvas_count,
      observed: canvases.length,
    });
  }
  if (expectations.require_webgl === true && facts.webgl_available !== true) {
    failures.push({ field: 'require_webgl', expected: true, observed: facts.webgl_available });
  }
  if (expectations.require_webgl2 === true && facts.webgl2_available !== true) {
    failures.push({ field: 'require_webgl2', expected: true, observed: facts.webgl2_available });
  }
  if (expectations.context_lost === false && facts.any_context_lost === true) {
    failures.push({ field: 'context_lost', expected: false, observed: true });
  }
  if (typeof expectations.renderer_includes === 'string' && expectations.renderer_includes.length) {
    const needle = expectations.renderer_includes.toLowerCase();
    const matched = canvases.some(canvas => typeof canvas.renderer === 'string'
      && canvas.renderer.toLowerCase().includes(needle));
    if (!matched) {
      failures.push({
        field: 'renderer_includes',
        expected: expectations.renderer_includes,
        observed: canvases.map(canvas => canvas.renderer),
      });
    }
  }
  if (Number.isFinite(expectations.min_max_texture_size)) {
    const max = canvases.reduce((acc, canvas) => Math.max(acc, canvas.max_texture_size ?? 0), 0);
    if (max < expectations.min_max_texture_size) {
      failures.push({
        field: 'min_max_texture_size',
        expected: expectations.min_max_texture_size,
        observed: max,
      });
    }
  }
  if (Number.isFinite(expectations.min_drawing_buffer_area)) {
    const maxArea = canvases.reduce(
      (acc, canvas) => Math.max(acc, canvas.drawing_buffer_width * canvas.drawing_buffer_height),
      0,
    );
    if (maxArea < expectations.min_drawing_buffer_area) {
      failures.push({
        field: 'min_drawing_buffer_area',
        expected: expectations.min_drawing_buffer_area,
        observed: maxArea,
      });
    }
  }
  if (Number.isFinite(expectations.min_active_programs)) {
    const activeCount = canvases.reduce(
      (acc, canvas) => acc + (canvas.active_program ?? 0),
      0,
    );
    if (activeCount < expectations.min_active_programs) {
      failures.push({
        field: 'min_active_programs',
        expected: expectations.min_active_programs,
        observed: activeCount,
      });
    }
  }
  if (failures.length) {
    return {
      status: 'fail',
      reason: 'webgl-semantic-mismatch',
      evidence: {
        expectations,
        facts,
        failures,
        claim: 'WebGL semantic invariants did not hold; not a visual/aesthetic judgment.',
      },
    };
  }
  return {
    status: 'pass',
    reason: null,
    evidence: {
      expectations,
      facts,
      claim: 'WebGL semantic invariants hold; not a visual/aesthetic judgment.',
    },
  };
}

/**
 * Plain-boolean projection of the facts so the evaluator provenance
 * collector can treat them as ordinary boolean paths. Nested arrays
 * are avoided per the ROADMAP M3 contract.
 */
export function webglBooleanFacts(facts) {
  if (!facts || typeof facts !== 'object') return {};
  return {
    webgl_available: facts.webgl_available === true,
    webgl2_available: facts.webgl2_available === true,
    any_context_lost: facts.any_context_lost === true,
    canvas_count: Number(facts.canvas_count) || 0,
  };
}
