# Narrative Equity deterministic observation contract

The case evaluator consumes a control-plane observation JSON document. The
worker workspace does not receive this contract, the rubric, hidden inputs, or
expected states. A browser driver may use any selectors or component adapter
needed to collect the document, but the evaluator only reads semantic IDs,
geometry, events, state snapshots, and resource counters.

Production intake follows `docs/architecture/EVALUATOR_PROTOCOL.md`: callers
must provide a contained, digest-bound trusted observation attestation. Bare
`observation`/`observationPath` inputs are rejected unless a unit test explicitly
sets `allowTestDouble:true`; such output is marked ineligible for real Run
conclusions. Every boolean leaf requires source provenance bound to browser,
command/workspace, or hidden-control evidence.

Required top-level fields:

- `commands`: `build`, `typecheck`, and `test` exit codes.
- `dsl`: valid/boundary/hidden-invalid load outcomes and orphan-edge
  diagnostics. `hiddenInvalidSampleUsed` confirms the control-only fixture was
  exercised without exporting it to the worker.
- `overview`: fixed-viewport semantic snapshot with node/edge geometry.
- `events`: emitted payload validation and duplicate counts.
- `states`: canonical state snapshots for direct/sequential navigation,
  rerender, resize, and animation terminal states.
- `behavior`: deterministic interaction and delivery observations.
- `lifecycle`: callback/resource counts before and after `destroy()`.
- `artifact_paths`: optional check-ID-to-path map. A failing check includes
  these screenshot or state-snapshot paths in its result.

## Geometry

Rectangles are `{x,y,width,height}` in CSS pixels. Edge paths are arrays of
`{x,y}` points in viewport coordinates. Hidden nodes and edges use
`visible:false`. The evaluator applies these implementation-independent
tolerances:

- severe node overlap: intersection exceeds 8% of the smaller node area;
- edge through node: a path segment enters an unrelated node rectangle after
  shrinking the rectangle by 2 px to ignore antialiasing;
- endpoint boundary: endpoint is more than 6 px from the source/target image
  rectangle boundary;
- stable position: unchanged node center moves by at most 2 px;
- same-layer alignment: center-line spread is at most 4 px.

The values account for pixel rounding and SVG antialiasing. They are not tuned
to a class name, layout library, or fixture entity.

Geometry is fail-closed. Visible nodes require finite positive bounds; visible
edges require IDs, known source/target IDs, and a path with at least two finite
points. Endpoint geometry requires endpoint bounds. Position snapshots must
share entities and preserve the complete entity set; missing entities or
disjoint snapshots fail rather than silently producing zero drift.

## State equality

Canonical states contain only business-visible fields: view, chapter/step,
playing, caption, visible/hidden/dimmed IDs, opacities, groups, replacements,
and persistent scales. Arrays are sorted before comparison and numbers are
rounded to three decimals. Transient timer IDs, DOM identity, animation frame
IDs, and implementation caches are intentionally ignored.

## Human review boundary

Machine checks establish measurable prerequisites such as collision absence,
layer separation, direction tokens, and bounded camera movement. They do not
claim that the story is clear, the camera feels comfortable, animation is
tasteful, or the component is desirable to maintain. Those judgments remain in
VAB-T06.
