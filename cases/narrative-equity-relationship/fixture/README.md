# VAB-T03 fixture

`starter/` is the only model-visible source tree. It is a dependency-free
TypeScript browser shell: it can build, typecheck, test, and serve, but it
contains no graph layout, playback, animation, or evaluator solution.

## Build a worker fixture

```sh
node scripts/build-fixture.mjs \
  --case narrative-equity-relationship \
  --source-root cases/narrative-equity-relationship/fixture/starter \
  --export-root /tmp/vab-t03-fixture
```

The generated `/tmp/vab-t03-fixture/.fixture/manifest.json` records file
hashes, declared provenance, the asset-generation command, baseline results,
and the exact worker-visible file list.

## Visibility boundary

- `starter/data/public/` is worker-visible: valid graph input plus a safe
  boundary sample.
- `control/` is evaluator/control-plane input only and is never passed as the
  builder's `--source-root`.
- The fixture deliberately has no reference screenshot, coordinates, expected
  DOM, implementation classes, source snapshots, or source history.

All art in `starter/public/assets/` is hand-authored SVG. The short WAV tone is
generated deterministically by `starter/scripts/generate-assets.mjs`; it has no
recorded speech or third-party material.
