import { describe, expect, test } from "bun:test";
import {
  getPretextMorphMeasurementBackend,
  getPretextMorphRenderedText,
  getPretextMorphTrustSignature,
  type PretextMorphLayoutContext,
} from "../torph/src/utils/text-layout/pretextMorph";

function createLayoutContext(
  overrides: Partial<PretextMorphLayoutContext> = {},
): PretextMorphLayoutContext {
  return {
    display: "grid",
    font: "16px system-ui",
    lineHeightPx: 24,
    parentDisplay: "block",
    whiteSpace: "normal",
    width: 240,
    direction: "ltr",
    textTransform: "none",
    letterSpacingPx: 0,
    wordSpacingPx: 0,
    fontFeatureSettings: "normal",
    fontVariationSettings: "normal",
    ...overrides,
  };
}

describe("getPretextMorphMeasurementBackend", () => {
  test("probes wrap-capable text instead of trusting pretext directly", () => {
    const backend = getPretextMorphMeasurementBackend(
      "alpha beta gamma",
      createLayoutContext({ whiteSpace: "normal", font: "16px Arial" }),
    );

    expect(backend).toBe("probe");
  });

  test("keeps nowrap text on the pretext fast path when features are supported", () => {
    const backend = getPretextMorphMeasurementBackend(
      "alpha beta gamma",
      createLayoutContext({ whiteSpace: "nowrap", font: "16px Arial" }),
    );

    expect(backend).toBe("pretext");
  });

  test("keeps letter spacing on the pretext fast path when the rest of the style is supported", () => {
    const backend = getPretextMorphMeasurementBackend(
      "playlist 2",
      createLayoutContext({
        whiteSpace: "nowrap",
        font: "16px Arial",
        letterSpacingPx: 1.5,
      }),
    );

    expect(backend).toBe("pretext");
  });
});

describe("getPretextMorphRenderedText", () => {
  test("collapses normal whitespace without needing measurement primitives", () => {
    const renderText = getPretextMorphRenderedText(
      "  Hello\t \n  World  ",
      createLayoutContext({ whiteSpace: "normal" }),
    );

    expect(renderText).toBe("Hello World");
  });

  test("preserves pre-wrap spacing while normalizing hard-break control characters", () => {
    const renderText = getPretextMorphRenderedText(
      "Hello\r\nWorld\f!",
      createLayoutContext({ whiteSpace: "pre-wrap" }),
    );

    expect(renderText).toBe("Hello\nWorld\n!");
  });
});

describe("getPretextMorphTrustSignature", () => {
  test("separates trust cache entries by rendered text", () => {
    const layoutContext = createLayoutContext({ font: "16px Arial" });
    const left = getPretextMorphTrustSignature({
      renderText: "alpha beta",
      layoutContext,
      useContentInlineSize: false,
    });
    const right = getPretextMorphTrustSignature({
      renderText: "alpha gamma",
      layoutContext,
      useContentInlineSize: false,
    });

    expect(left).not.toBe(right);
  });

  test("separates trust cache entries by inline size mode", () => {
    const layoutContext = createLayoutContext({ font: "16px Arial" });
    const containerSized = getPretextMorphTrustSignature({
      renderText: "alpha beta",
      layoutContext,
      useContentInlineSize: false,
    });
    const contentSized = getPretextMorphTrustSignature({
      renderText: "alpha beta",
      layoutContext,
      useContentInlineSize: true,
    });

    expect(containerSized).not.toBe(contentSized);
  });

  test("separates trust cache entries by letter spacing", () => {
    const left = getPretextMorphTrustSignature({
      renderText: "playlist 2",
      layoutContext: createLayoutContext({ font: "16px Arial", letterSpacingPx: 0 }),
      useContentInlineSize: false,
    });
    const right = getPretextMorphTrustSignature({
      renderText: "playlist 2",
      layoutContext: createLayoutContext({ font: "16px Arial", letterSpacingPx: 1.5 }),
      useContentInlineSize: false,
    });

    expect(left).not.toBe(right);
  });
});
