# StandardChart Two-Way Tree deterministic observation contract

The evaluator consumes a control-plane observation assembled after candidate
commands and browser exercises complete. This contract, hidden control inputs,
and expected values are never exported to the worker workspace.

Production callers must use the contained SHA-256 attestation described in
`docs/architecture/EVALUATOR_PROTOCOL.md`; bare observation objects and
arbitrary paths are rejected. `allowTestDouble:true` is unit-test-only and
makes the result explicitly ineligible for a real Run conclusion. Boolean
facts require per-path provenance bound to browser action/state,
command/workspace, or hidden-control evidence.

`rubric.yaml` is the v1 deterministic rubric; the case evaluator declares
one assertion per `categories.checks` entry.

Required top-level objects:

- `commands`: `build`, `typecheck`, and `test` exit codes.
- `input`: public valid/boundary outcomes and hidden invalid outcomes. The
  hidden inputs cover one-sided (empty upstream or downstream), asymmetric
  depth, duplicate display names, missing change metric, and zero/extreme
  change values.
- `tree_structure`: focus node, declared upstream/downstream depths, and
  the full rendered node set keyed by direction. The evaluator re-derives
  expected traversal from the fixture and compares against this snapshot.
- `bidirectional_traversal`: the upstream and downstream path sets for a
  declared selection, plus whether the two directions stay symmetric (every
  upstream pair has a downstream reverse link and vice versa).
- `node_selection`: toggle, blank-click deselect, and event payload
  snapshots. `selection` and `deselection` must produce structurally
  identical event envelopes modulo `selected`.
- `layout`: coordinate-free layout integrity markers (overlap counts,
  cross-direction edge crossings, focus node stability, render source).
  Coordinates are evidence, not fixture answers.
- `performance`: large-tree (>= 200 nodes) interaction metrics and a
  teardown lifecycle counter.
- `browserEvidence`: an unmodified Playwright evidence manifest.
- `responsive`: declared viewport kinds and their overflow/reachability
  markers, plus the Resize state preservation snapshot.
- `accessibility`: keyboard reachability and activation keys.
- `engineering`: tests, theme/group style coverage, and implementation
  notes required sections.
- `proof_boundary`: explicit separation between deterministic observations
  and human visual review.
- `artifact_paths`: optional check-ID-to-path map.

## Browser proof boundary

The real Chromium manifest proves only the declared action status, runtime
errors, DOM state, screenshot existence, and the observable presence of the
implementation surface. It does not prove layout aesthetics, animation feel,
cross-browser parity, or that the candidate looks like the production
StandardChart extension.

The evaluator never derives a visual-quality pass from screenshot pixels.
The `layout` machine checks establish only deterministic prerequisites:
overlap counts are zero, the focus node position does not drift across
expand/collapse, the data source is the fixture (not hardcoded coordinates),
and the long-label degradation rule does not overflow the viewport. Spatial
hierarchy quality, edge curvature aesthetics, typography, and color harmony
remain human review.

## Deterministic tolerances

- `path_symmetry_tolerance`: 0 — every upstream link must have a downstream
  reverse for the focus node.
- `overlap_tolerance`: 0 — no node bounding box may overlap another within
  the same direction column, and no edge segment may pass through another
  node's bounding box.
- `focus_drift_tolerance`: 0 — the focus node centroid must not move when a
  sibling branch expands or collapses.
- `large_tree_node_budget`: 200 — the performance budget uses a synthetic
  200+ node fixture and requires FPS >= 20 with p95 frame time <= 80 ms.
- `lifecycle_leak_tolerance`: 0 — after `dispose()`, tracked timers, rafs,
  resize observers, listeners, and StandardChart option subscriptions must
  all return to zero.

These are coarse regression budgets, not claims about animation feel or
cross-device performance.

## Regression intent

The evaluator deliberately covers the failure modes surfaced by the
scenario's S2 review feedback:

- `asymmetric-and-empty-sides` rejects implementations that assume both
  sides always have content.
- `expand-collapse-stability` rejects layouts that jump when one side
  expands while the other stays put.
- `no-edge-node-overlap` rejects naive SVG paths that draw through nodes.
- `long-label-degradation` rejects implementations that overflow the
  container on the included long label boundary.
- `duplicate-and-boundary-nodes` rejects implementations that key nodes by
  display name rather than stable id.
