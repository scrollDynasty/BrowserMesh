# Testing

## Test suites

```bash
npm test                  # unit tests
npm run test:integration  # MCP and real-browser integration
npm run test:e2e          # external-client workflow
npm run test:stress       # bounded concurrency stress
npm run test:coverage     # coverage thresholds
```

Run real-browser suites after installing Chromium. Set `BROWSERMESH_HEADLESS=true` on environments without a display.

## Verification gates

```bash
npm run verify
npm run verify:package
npm run docs:build
```

`verify` runs strict type checking, lint, formatting, coverage, and the production build. `verify:package` builds and packs the npm artifact, installs it into a clean temporary project, checks exports/bin/MCP discovery, and performs a real Chromium smoke test. It does not publish.

Tests cover session isolation, cross-session page misuse, cross-session parallelism, same-session ordering, queue recovery, timeouts/cancellation, close/shutdown races, persistence ordering/quotas, browser disconnect, bounded evidence, redaction, and package startup.
