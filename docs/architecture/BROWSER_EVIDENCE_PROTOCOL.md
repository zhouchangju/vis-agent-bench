# Browser Evidence Protocol

## Playwright Driver scope

The VAB-T11 Driver launches a real headless Chromium for loopback or `file:` URLs and emits the
VAB-T06 evidence package. It records a fixed viewport, screenshots with SHA-256 digests, console
messages and errors, uncaught page errors, failed network requests, step results, selected DOM
state, and canvas PNG signatures.

The Driver accepts data, not JavaScript. Its allowlisted steps are:

- `goto`: navigate to a `file:` or loopback `http(s)` URL; this must be the first step.
- `wait`: wait for a CSS selector state or for at most 10 seconds.
- `click`, `hover`: interact with one CSS selector.
- `keyboard`: press one Playwright key, optionally against a selector.
- `resize`: set a positive integer viewport.
- `screenshot`: save a labeled PNG.
- `assert-visible`: require a selector to resolve to a visible element.
- `assert-text`: require exact or contained text.
- `collect-state`: collect counts, visibility, text, node counts, and canvas signatures for declared
  selectors.

Unknown steps and fields are rejected. Labels are restricted to URL-safe names, remote hosts are
rejected, non-local subresource requests are aborted, and there is no expression/evaluate/function
step. These restrictions limit the Driver's authority; they do not make browser rendering itself a
security sandbox.

## Failure boundary

The existing VAB-T06 codes remain the machine contract. Each Driver failure also carries
`failure_class`:

| Class | Existing code | Meaning |
| --- | --- | --- |
| `environment` | `DRIVER_UNAVAILABLE` | Playwright cannot be loaded or Chromium cannot start. No product behavior was evaluated. |
| `navigation` | `LOAD_FAILED` | Chromium started, but the declared local page could not be reached or loaded. |
| `product` | `SELECTOR_MISSING`, `ACTION_TIMEOUT`, `ASSERT_FAILED`, `PAGE_ERROR`, `NETWORK_FAILURE`, `CAPTURE_INCOMPLETE` | The page loaded and a declared interaction, assertion, runtime, request, or capture contract failed. |

An environment failure must not be reported as a product regression. A navigation failure proves
browser startup but not page behavior. Product failures can produce `warning` evidence and continue
to later evidence steps; navigation failures stop the sequence.

## Runtime discovery

The repository deliberately does not add Playwright to `package.json` in VAB-T11. Runtime discovery
tries the project package, `PLAYWRIGHT_MODULE_PATH`, the local npm npx cache, and global modules.
Chromium discovery tries `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, the package's executable, and the
standard Playwright browser cache. Paths are discovered from the current environment; no personal
browser path is embedded in source.

Run a smoke with:

```sh
node scripts/capture-playwright-evidence.mjs smoke.json --out-dir /tmp/vab-browser-evidence
```

The stable manifest is `<out-dir>/browser-evidence.json`; screenshot names come from validated step
labels.

## Proof boundary

A successful smoke proves only its declared selectors, interactions, text assertions, captured
runtime signals, and observed DOM/canvas signatures in the launched Chromium version. It does not
prove aesthetics, complete visual correctness, pixel-level equivalence, responsive completeness,
cross-browser behavior, accessibility quality, animation quality, or WebGL correctness.

`canvas_webgl_proven` therefore remains `false`. Canvas signatures show that bytes were observable,
not that a chart is correct or attractive. Screenshots and structured evidence still enter human
visual review.
