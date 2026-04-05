import { describe, expect, test } from "bun:test";
import {
  getPretextMorphMeasurementBackend,
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
});
