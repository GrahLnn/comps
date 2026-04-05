Vendor sync guardrails for the vendored Pretext runtime used by `torph`.

Source baseline:
- upstream repo: `C:\Users\admin\pretext`
- upstream commit: `488d8c6`

Files in this folder:
- `layout.test.ts`: copied from upstream and run against the current vendored runtime
- `test-data.ts`: copied from upstream for future browser probes and comparison work
- `layout.ts`: shim re-export to `torph/src/vendor/pretext/layout.ts`
- `line-break.ts`: shim re-export to `torph/src/vendor/pretext/line-break.ts`

Run the guardrail suite with:

```bash
bun run test:vendor-pretext
```
