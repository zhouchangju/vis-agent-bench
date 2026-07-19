# Macro Map 3D synthetic fixture

This fixture is a clean-room starter. It contains synthetic public graph data,
generated local assets, and an integration contract. It intentionally contains
no layout coordinates, renderer, interaction state machine, expected
screenshots, or source-project identifiers.

## Worker-visible starter

`starter/` is the only source root exported by the Fixture Builder. It provides:

- deterministic 200, 800, and 1481 node datasets;
- a valid boundary dataset with long bilingual labels, isolated nodes, extreme
  weights, and unknown relationships;
- metrics and periods for runtime switching;
- a minimal page and a narrow scene adapter contract;
- deterministic build, typecheck, and test commands;
- generated SVG assets with no remote dependency.

Install is not required. From `starter/` run:

```sh
npm run build
npm run typecheck
npm test
```

The candidate owns the visualization implementation. `src/scene-adapter.js`
only validates the public adapter shape and returns a structured error when an
implementation is absent.

## Control-only material

`control/invalid-inputs.json` is hidden from the worker because the builder
source root is `starter/`. It contains evaluator cases for duplicate IDs,
dangling edges, invalid enums, malformed weights, and invalid runtime options.

## Reproduction

From the repository root:

```sh
node scripts/fixtures/macro-map-3d/generate-fixture.mjs
node scripts/fixtures/macro-map-3d/verify-fixture.mjs
node tests/cases/macro-map-3d/run.mjs
```

The generator is seedless and integer-driven. Re-running it produces byte-for-
byte identical data and SVG assets.
