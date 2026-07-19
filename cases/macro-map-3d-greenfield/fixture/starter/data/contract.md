# Public data contract

Each graph JSON document has:

- `meta.metrics`: switchable metric keys;
- `meta.periods`: switchable time keys;
- `nodes`: unique string ID, bilingual labels, category, `core` or
  `peripheral` layer, finite importance, and metric/period values;
- `relations`: unique ID, valid source/target, `positive`, `negative`, or
  `unknown` type, and a `primary` flag.

Node order and relation order are stable. IDs are opaque. Consumers must not
infer coordinates from IDs or array positions. No layout coordinates are
provided.

Runtime options:

```js
{
  data,
  theme: "light" | "dark",
  language: "zh" | "en",
  viewMode: "sphere-3d" | "relation-2d",
  visibleOffset: { top, right, bottom, left },
  metric,
  period,
  relationStrategy: "always" | "interaction-only" | "primary-emphasis",
  onNodeSelect,
  onRelationSelect,
  onStateChange
}
```

The component must expose performance statistics named by
`SCENE_INPUT_CONTRACT.performanceFields`, handle resize and WebGL degradation,
and release animation, resources, and listeners on `dispose()`.
