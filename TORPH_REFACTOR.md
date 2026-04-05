# Torph Runtime Refactor

## Goals

- Separate layout observation, measurement, session state, rendering, and debug tracing.
- Freeze a morph session once it starts. The source, target, and plan do not change until completion.
- Remove production-path self-healing that mutates measurements from live DOM after render.
- Keep debug tooling outside runtime decisions; trace must stay opt-in and observational.

## Status

- Verified on 2026-04-05.
- Layout observation now lives in `torph/src/core/layout-observer.ts`.
- Measurement resolution and DOM snapshot helpers now live in `torph/src/core/dom-measurement.ts` plus `torph/src/core/measurement-policy.ts`.
- Session decisions and timeline control live in `torph/src/core/session.ts`.
- Render style and overlay helpers live in `torph/src/core/render.ts`.
- Trace capture and export live in `torph/src/debug/trace.ts`.
- `torph/src/components/Torph.tsx` no longer contains the old duplicated layout-observer or DOM-measurement runtime blocks.
- Live flow and overlay inspection remains debug-only and does not feed runtime state decisions.
- Trace capture is off by default with console logging off; `window.__TORPH_DEBUG__ = { capture: true }` enables trace export when needed.
- Idle and animate now share the same visible glyph overlay path; Torph no longer swaps to a second idle-only visual layer after finalize.
- Morph finalize now waits on an explicit barrier for all active completion signals instead of finalizing on the first matching transition event.
- Finalize snapshots now log from the same authoritative finalize path that commits the morph, so trace timing matches runtime teardown.
- Prepare now renders at the target inline size immediately, then refines the target root origin before entering animate.
- The visible root no longer animates width; layout width and glyph motion now live on separate planes.

## Keep

- Grapheme segmentation and pairing.
- Pretext-backed measurement and DOM probe measurement.
- Overlay-based glyph morph rendering.
- A single visible glyph path across idle and animate.

## Remove Or Replace

- Runtime heal passes based on post-render flow inspection.
- Idle-time committed measurement mutation from live DOM.
- Animating-target refresh driven by intermediate width observation.
- Debug code mutating runtime decisions.

## Runtime Boundaries

- Layout constraints: observe stable host constraints only.
- Measurement engine: pure input to output measurement resolution.
- Morph session: pure decisions about commit or start-morph.
- Renderer: consume frozen plans only.
- Debug: subscribe only, never participate in runtime decisions.
