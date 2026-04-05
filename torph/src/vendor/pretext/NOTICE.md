Vendored from `C:\Users\admin\pretext` under the MIT license.

Current upstream sync baseline:
- repo: `@chenglou/pretext`
- commit: `488d8c6`

Upstream runtime files copied here:
- `src/analysis.ts`
- `src/bidi.ts`
- `src/layout.ts`
- `src/line-break.ts`
- `src/measurement.ts`

Local compatibility patch:
- `analysis.ts` keeps `export function normalizeWhitespacePreWrap(...)`
  because `torph/src/utils/text-layout/pretextMorph.ts` imports it directly.

Vendor sync guardrails live under `vendor-sync/pretext/`:
- `layout.test.ts`
- `test-data.ts`

Local project code should import through `torph/src/utils/text-layout/pretext.ts`
instead of importing these vendor files directly, except for the intentional
internal use in `pretextMorph.ts`.
