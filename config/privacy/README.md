# Privacy-gate scan profile

Transferring this repository between machines is gated by the
`pre-transfer-privacy-gate` skill. This directory holds the project's scan
profile so the mute decisions are explicit and recorded, not silent.

## Usage

```bash
node ~/.agents/skills/pre-transfer-privacy-gate/scripts/scan-transfer.mjs \
  --source <this-repo> \
  --profile config/privacy/transfer-scan-profile.json \
  --out-md /tmp/transfer-report.md
```

`build-safe-copy.mjs` and `verify-safe-copy.mjs` accept the same `--profile`.

## Muted rules

| Rule id | Reason |
| --- | --- |
| `personal-record:interview-material` | Cases are built from real company requirements by design; internal screenshots and requirement material are accepted inputs (ADR-0004). |
| `personal-context:personal-finance` | Functional vocabulary of this domain — e.g. 「机构持仓」 is a chart case title, not a personal finance log. |

Muting is a recorded decision. Remove an entry from `transfer-scan-profile.json`
to re-enable a rule; do not add mute entries without a reason documented here.
