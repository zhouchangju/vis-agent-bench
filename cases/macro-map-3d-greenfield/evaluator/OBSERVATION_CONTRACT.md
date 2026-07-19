# Macro Map 3D deterministic observation contract

The evaluator consumes a control-plane observation assembled after candidate
commands and browser exercises complete. This contract, hidden control inputs,
and expected values are never exported to the worker workspace.

`rubric.yaml` remains the repository's legacy Case-governance rubric.
`deterministic-rubric.yaml` expands those same six weighted categories into
the exact one-to-one check IDs executed by this evaluator.

Required top-level objects:

- `commands`: `build`, `typecheck`, and `test` exit codes.
- `inputs`: public valid/boundary outcomes plus all hidden invalid outcomes.
- `datasets`: the 200/800/1481 scale ladder and rendered counts.
- `layout`: repeated position snapshots, layer radii, size samples, and mapping
  counts. Coordinates remain observation evidence, not fixture answers.
- `render`: stable semantic tokens for relation direction/type, layer/depth,
  language, theme, and labels.
- `browser`: an unmodified VAB-T11 Playwright evidence manifest.
- `camera`, `interactions`, `selection`, and `runtime`: canonical state-machine
  transitions collected through the component adapter and browser actions.
- `resize`, `fallback`, `performance`, and `lifecycle`: production-readiness
  counters and terminal states.
- `engineering`: adapter surface, runtime update coverage, tests, and docs.
- `proof_boundary`: explicit separation between deterministic observations and
  human visual review.
- `artifact_paths`: optional check-ID-to-path map.

## Browser proof boundary

The real Chromium manifest proves only the declared action status, runtime
errors, DOM state, screenshot existence, and observable non-empty Canvas bytes.
`canvas_webgl_proven` must remain `false`: a Canvas signature does not establish
WebGL correctness, graph semantics, visual quality, or aesthetics.

The evaluator never derives a visual-quality pass from screenshot pixels. The
`visual_quality` machine checks establish only deterministic prerequisites:
distinct semantic tokens, runtime state changes, layer/depth state, and label
availability. Spatial hierarchy quality, camera comfort, label aesthetics,
animation smoothness, and overall desirability remain human review.

## Stable budgets

On the declared unified test profile:

- every scale must report an interactive terminal state;
- all six public performance fields must be finite and non-negative;
- sampled FPS must be at least 20 and p95 frame time at most 50 ms;
- draw calls must not exceed 100 and textures must not exceed 64;
- no full-edge traversal/rebuild may occur every frame;
- repeated mount/dispose uses at least 20 cycles and must return tracked
  animation, listener, geometry, material, texture, and renderer counts to
  zero.

These are coarse regression budgets, not claims about animation feel or
cross-device performance.
