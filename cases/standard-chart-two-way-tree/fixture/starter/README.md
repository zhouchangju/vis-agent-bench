# Synthetic Two-Way Industry Chain Starter

This Starter is the worker-visible scaffold for the
`standard-chart-two-way-tree` benchmark Case. It intentionally renders a
three-column shell (`Upstream`, `Focus`, `Downstream`) and a first-level
neighbour list, but does **not** implement the production two-way tree:
there is no real bidirectional traversal, no edge routing, no theme wiring,
and no StandardChart option API.

The candidate is expected to replace the placeholder with a data-driven
implementation that:

- walks the synthetic industry chain in both `upstream` and `downstream`
  directions,
- keeps the focus node centred while supporting asymmetric depth on either
  side and one-sided (empty) trees,
- emits structured events on `window.__TWO_WAY_TREE__` for selection,
  expand/collapse, and node-click,
- preserves positions across data updates and Resize,
- and re-uses the StandardChart extension lifecycle rather than bypassing it.

## Data shape

`public/assets/sample-data.json` is a self-contained JSON document:

- `root_id` is the focus node id.
- `nodes` carry `id`, `name`, `changePct` (nullable), and optional `group`.
- `edges` carry `from`, `to`, and `direction` (`'upstream'` or
  `'downstream'`). The starter deliberately declares both directions on
  the same logical link separately so the candidate must build the
  symmetric bidirectional traversal on top.

The dataset includes boundary samples the rubric exercises:
null change, zero change, extreme positive/negative change, a long label,
and a duplicate of the focus node's display name.

## Public DOM contract

- `#root` is the mount point; the implementation surface is
  `#two-way-tree-root`.
- Each visible node should expose `data-node-id` and `data-direction`
  (`'upstream'`, `'root'`, or `'downstream'`).
- Selection and expand/collapse events are dispatched as
  `two-way-tree:event` `CustomEvent`s with `{ type, payload }` details and
  also forwarded to `window.__TWO_WAY_TREE__.emit`.

## Scripts

- `npm run build` copies the Starter into `dist/`.
- `npm run typecheck` runs `node --check` over all `.mjs` modules.
- `npm test` validates the synthetic fixture data shape and boundary tags.
- `npm start` serves `dist/` from `127.0.0.1:4173` (port overridable via
  `PORT`).
