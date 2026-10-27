# Review — Persistent chart-mode toggle

**Reviewed commit:** [ea934ff4779361eacc567cb497d47ff356b48474](https://github.com/enmohsen20111975/GLMinvestment/commit/ea934ff4779361eacc567cb497d47ff356b48474)  
**Review status:** Changes are present, but do not treat this commit as fully verified or deploy solely on the author's summary.  
**Scope:** Review of the commit diff and current `chart-test/page.tsx` and `next.config.mjs` as visible on GitHub. No runtime or VPS test was performed by this reviewer.

## Findings

### R1 — High: localStorage is read during initial render in a Next.js client component

Both the chart test page and the chart view initialize React state with a lazy initializer that reads `localStorage`. The `try/catch` prevents a server-side ReferenceError, but it does not make this hydration-safe: the server render cannot read the saved preference and defaults to Premium, while the browser's first render can initialize to Simple. That can produce a server/client markup mismatch. The persistence effect may also write the default before the saved value is reliably restored, depending on the final component lifecycle.

**Required fix:** initialize with a deterministic server-safe default, then read the saved value in a mount effect; track a `preferenceLoaded`/hydrated flag and do not write the preference until restoration has completed. Avoid a flash of the wrong chart where practical. Apply the same approach consistently to the main chart and `/chart-test`.

**Acceptance test:** set preference to `simple`, reload with a fresh server render, and verify no hydration warning, no accidental overwrite to `premium`, and the final visible mode remains `simple`. Repeat for `premium`.

### R2 — Medium: the test page does not compare equivalent chart inputs

The premium chart on `/chart-test` receives locally generated random OHLCV data. The simple `TradingViewChart` is mounted with only ticker/name props and appears to obtain its own data path. Therefore, seeing one chart disappear and the other appear verifies conditional rendering, but does not prove visual/data equivalence between modes.

**Required clarification/fix:** label `/chart-test` as a rendering smoke test, not a parity test, unless both chart implementations can be supplied the same deterministic OHLCV fixture. Do not use random data to claim correctness of real-price rendering.

### R3 — Medium: changed Turbopack alias needs version-specific verification

The commit changes `next-auth/react` alias from an absolute `path.resolve(...)` value to `'./src/lib/next-auth-shim.ts'`. The commit message says this addresses Turbopack resolution, but this review did not run builds under the project's actual Next.js versions. A relative alias accepted in one sandbox/version may not behave identically on the VPS.

**Required verification:** run the repository's relevant build/test commands under the actual supported Next.js version(s), record `next --version`, and verify that the alias resolves to the intended shim without breaking imports. Do not alter unrelated Next.js configuration as part of the chart toggle fix unless the test demonstrates the need.

### R4 — Low/Medium: the commit diff includes unrelated-looking content

The commit diff returned by GitHub includes a one-line change from conflict-marker text around a numeric value to `1121`, in addition to the chart changes. Identify the exact file and confirm this is intentional, not an accidental merge/conflict cleanup. Include the explanation in the handoff.

## Required test evidence

1. Main chart mode persists after reload in both directions.
2. `/chart-test` mode persists after reload in both directions.
3. First load with no stored value defaults deterministically to Premium.
4. Existing stored `simple` does not get overwritten during hydration.
5. No hydration mismatch or console errors on both pages.
6. Premium chart and simple chart render without runtime errors.
7. Type-check and production build pass for the actual supported Next.js version(s), with any unrelated pre-existing failures listed separately.
8. Diff review identifies the unrelated numeric/conflict-marker hunk and confirms whether it belongs in this commit.

## Deployment guidance

Do not run `pm2 restart all` or `pm2 stop 5` based only on this report. First inspect `pm2 list` and identify the exact application process and what process ID 5 represents. Prefer restarting only the intended application after the reviewed commit is on the intended branch and the production build succeeds.

**No production files, services, database, or VPS were changed by this review.**
