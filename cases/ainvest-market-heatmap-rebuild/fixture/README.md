# Synthetic Market Heatmap Fixture

This fixture is generated from the approved Case requirements. It does not
contain production source, network responses, screenshots, brand assets, or
reference layout coordinates.

- `starter/` is the only worker-visible source root.
- `control/` contains malformed samples for fixture-author tests and must not
  be exported to a worker.
- `plan.yaml` declares baseline commands and leakage rules for the common
  Fixture Builder.

The Starter intentionally renders a control shell and an empty implementation
surface. It does not implement a treemap.
