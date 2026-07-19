# Browser Evidence Protocol

## Playwright Driver scope

The hardened Playwright Driver launches a real headless Chromium only after the trusted control
plane supplies a capture policy. It emits the VAB-T06 evidence package and records a fixed
viewport, screenshots with SHA-256 digests and dimensions parsed from the PNG IHDR, console
messages and errors, uncaught page errors, failed network requests, step results, selected DOM
state, and canvas PNG signatures. `page_url` is read from the page at the end of the capture, after
interactions and redirects.

## Control-plane URL policy

The declarative smoke spec does not grant its own filesystem or network authority. The caller
passes a separate trusted policy:

```js
{
  allowed_origins: ['http://127.0.0.1:41771'],
  allowed_file_roots: ['/absolute/path/to/sanitized-fixtures'],
}
```

Both arrays default to empty. HTTP(S) entries must be exact loopback origins: scheme, hostname,
and effective port must all match. Allowing `http://localhost:41771` does not allow
`http://127.0.0.1:41771`, another port, HTTPS, or any other loopback service.

For every `file:` navigation and subresource, the Driver converts the URL to a path and resolves
all symlinks before comparing it to the real paths of the allowed fixture roots. Missing files,
remote file authorities, host files such as `/etc/hosts`, sibling paths, and symlink escapes are
denied. Supplying no file root grants no file access.

The same policy is installed as a browser-context route, so redirects and subresources cannot
escape the declared authority. Blocked subresources are recorded as policy-blocked network events.
Service Worker registration is blocked by both Chromium context policy and an initialization
guard. All WebSocket routes are closed without connecting to a server. A Playwright version without
WebSocket routing support is rejected as an environment failure.

These controls reduce accidental host exposure, but local file and loopback filtering are
application-level isolation, not an OS security sandbox. Untrusted benchmark runs still require a
separate worktree/container boundary and least-privilege fixtures.

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
rejected, and there is no expression/evaluate/function step. Per-step and default timeouts must be
integers from 1 through 120000 milliseconds. A spec has at most 64 steps and a total
`capture_deadline_ms` from 1 through 120000 milliseconds (default 60000). The total deadline covers
browser launch, context setup, navigation, actions, capture, and teardown. When it expires, the
Driver force-closes context and browser and emits `DRIVER_UNAVAILABLE/environment` if no page loaded,
or `CAPTURE_INCOMPLETE/product` after product evaluation began.

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
node scripts/capture-playwright-evidence.mjs smoke.json --out-dir /tmp/vab-browser-evidence \
  --allow-origin http://127.0.0.1:41771
```

Repeat `--allow-origin` or `--allow-file-root` only for authorities required by the fixture. The
stable manifest is `<out-dir>/browser-evidence.json`; screenshot names come from validated step
labels.

## Proof boundary

A successful smoke proves only its declared selectors, interactions, text assertions, captured
runtime signals, and observed DOM/canvas signatures in the launched Chromium version. It does not
prove aesthetics, complete visual correctness, pixel-level equivalence, responsive completeness,
cross-browser behavior, accessibility quality, animation quality, or WebGL correctness.

`canvas_webgl_proven` therefore remains `false`. Canvas signatures show that bytes were observable,
not that a chart is correct or attractive. Screenshots and structured evidence still enter human
visual review.
