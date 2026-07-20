# Macro Map 3D deterministic observation contract

The evaluator consumes a control-plane observation assembled after candidate
commands and browser exercises complete. This contract, hidden control inputs,
and expected values are never exported to the worker workspace.

Production callers must use the contained SHA-256 attestation described in
`docs/architecture/EVALUATOR_PROTOCOL.md`; bare observation objects and arbitrary
paths are rejected. `allowTestDouble:true` is unit-test-only and makes the
result explicitly ineligible for a real Run conclusion. Boolean facts require
per-path provenance bound to browser action/state, command/workspace, or
hidden-control evidence.

`rubric.yaml` remains the repository's legacy Case-governance rubric.
`deterministic-rubric.yaml` expands those same six weighted categories into
the exact one-to-one check IDs executed by this evaluator.

Required top-level objects:

- `commands`: `build`, `typecheck`, and `test` exit codes.
- `inputs`: public valid/boundary outcomes plus all hidden invalid outcomes.
- `datasets`: the 200/800/1481 scale ladder and rendered counts.
- `layout`: repeated position snapshots, layer radii, size samples, and mapping
  counts. Coordinates remain observation evidence, not fixture answers.
  `renderedRelationIntegrity` records whether the rendered relation set matches
  the input data on endpoint IDs, relation type, and direction. It exists to
  catch data-modeling regressions where the candidate invents, duplicates, or
  misconnects edges.
- `render`: stable semantic tokens for relation direction/type, layer/depth,
  language, theme, and labels. `projection` records the camera projection mode
  (`perspective` vs `orthographic`) and a near/far size ratio sample, so the
  evaluator can deterministically reject an orthographic fallback that
  collapses the spatial hierarchy.
- `browser`: an unmodified VAB-T11 Playwright evidence manifest.
- `camera`, `interactions`, `selection`, and `runtime`: canonical state-machine
  transitions collected through the component adapter and browser actions.
  `camera.rotationAxisStable` records whether the camera up vector remains
  aligned with the world Y axis across a declared drag gesture, so off-axis
  drift after user rotation is detectable. `selection.labelScoping` records
  whether non-related node labels become hidden in local state, matching the
  P0 requirement that selected-node focus scopes the visible label set.
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

## Regression checks derived from revision feedback

The following checks were added after the first revision round surfaced
recurring implementation bugs that the original rubric did not catch. They
are still deterministic state/data checks, not visual judgments:

- `relation-data-integrity` (P0, hard gate): the rendered relation set must
  agree with the input fixture on endpoint IDs, relation type, and direction.
  It rejects duplicated edges, edges whose endpoints were swapped or invented,
  and relations whose semantic type was remapped. Source: revision feedback
  "连线多组节点关系的连线" and "边的逻辑关系错误（数据关系建模错误）".
- `label-scoping-state` (P1): in selected-node local state, labels of
  non-related nodes must be hidden or otherwise removed from the readable
  label set, so unrelated factors do not leak labels into the focused view.
  Source: revision feedback "非相关因子出现标签". Aesthetic label readability
  remains human review.
- `camera-rotation-axis-stability` (P1): across a declared drag gesture the
  camera up vector must stay aligned with the world Y axis within a small
  tolerance, rejecting off-axis drift after rotation. Source: revision
  feedback "选择没有按照y轴旋转". Camera comfort itself remains human review.
- `perspective-depth-state` (P1): the camera projection must remain
  perspective and the observed near/far size ratio must show depth
  attenuation, rejecting a silent fallback to orthographic projection.
  Source: revision feedback "透视效果消失". Depth aesthetic remains human
  review.

These four checks complement, but do not replace, the visual review boundary:
they prove only that the declared data and state invariants hold, not that
the scene looks good.

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
