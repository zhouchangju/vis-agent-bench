# Synthetic Two-Way Tree Fixture

This fixture is generated from the approved Case requirements. It does not
contain production StandardChart source, network responses, screenshots,
brand assets, reference layout coordinates, or any real industry-chain data.

- `starter/` is the only worker-visible source root.
- `plan.yaml` declares baseline commands and leakage rules for the common
  Fixture Builder.
- The synthetic industry-chain sample in `starter/public/assets/sample-data.json`
  is generated for this benchmark only; it is not derived from a real product
  dataset and uses fabricated company/material names.

The Starter intentionally renders a control shell plus a minimal skeleton that
mounts a root node and two adjacent columns. It deliberately omits the
production two-way tree algorithm, real edge routing, symmetric bidirectional
traversal, and stable layout. The candidate is expected to implement those
inside the surface and emit the structured events described in
`prompt/requirement.md`.
