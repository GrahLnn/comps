import { describe, expect, test } from "bun:test";
import {
  createMorphMeasurementRequest,
  readCachedMorphSegments,
  shouldMeasureUsingContentInlineSize,
} from "../torph/src/core/measurement-policy";
import type { LayoutContext, MorphMeasurement } from "../torph/src/core/types";

function createLayoutContext(
  overrides: Partial<LayoutContext> = {},
): LayoutContext {
  return {
    display: "grid",
    direction: "ltr",
    font: "16px Arial",
    fontFeatureSettings: "normal",
    fontVariationSettings: "normal",
    letterSpacingPx: 0,
    lineHeightPx: 24,
    measurementStability: "stable",
    parentDisplay: "block",
    textTransform: "none",
    whiteSpace: "normal",
    width: 120,
    wordSpacingPx: 0,
    measurementVersion: 1,
    ...overrides,
  };
}

function createMeasurement(
  width: number,
  graphemeTops: number[],
): MorphMeasurement {
  return {
    snapshot: {
      text: "sample",
      renderText: "sample",
      width,
      height: 24 * Math.max(1, graphemeTops.length),
      graphemes: graphemeTops.map((top, index) => ({
        glyph: `${index}`,
        key: `${index}:${index}`,
        left: index * 10,
        top,
        width: 10,
        height: 24,
      })),
    },
    layoutInlineSize: width,
    reservedInlineSize: null,
    flowInlineSize: null,
    rootOrigin: {
      left: 0,
      top: 0,
    },
  };
}

describe("readCachedMorphSegments", () => {
  test("segments grapheme clusters instead of raw code points", () => {
    const segments = readCachedMorphSegments("A👨‍👩‍👧‍👦B");

    expect(segments.map((segment) => segment.glyph)).toEqual([
      "A",
      "👨‍👩‍👧‍👦",
      "B",
    ]);
  });
});

describe("shouldMeasureUsingContentInlineSize", () => {
  test("prefers content width only for single-line matching layouts", () => {
    const singleLine = createMeasurement(80, [0, 0, 0]);
    expect(
      shouldMeasureUsingContentInlineSize(
        createLayoutContext({ width: 80 }),
        singleLine,
      ),
    ).toBe(true);

    const multiLine = createMeasurement(80, [0, 24, 24]);
    expect(
      shouldMeasureUsingContentInlineSize(
        createLayoutContext({ width: 80 }),
        multiLine,
      ),
    ).toBe(false);
  });
});

describe("createMorphMeasurementRequest", () => {
  test("keeps stable eligible layouts on the pretext fast path", () => {
    const request = createMorphMeasurementRequest({
      text: "OpenWindow",
      layoutContext: createLayoutContext({
        whiteSpace: "nowrap",
      }),
      layoutHint: null,
    });

    expect(request?.measurementBackend).toBe("pretext");
    expect(request?.domMeasurementKey).toBeNull();
  });

  test("forces dom measurement while font metrics are animating", () => {
    const request = createMorphMeasurementRequest({
      text: "OpenWindow",
      layoutContext: createLayoutContext({
        whiteSpace: "nowrap",
        measurementStability: "live",
      }),
      layoutHint: null,
    });

    expect(request?.measurementBackend).toBe("dom");
    expect(request?.domMeasurementKey).not.toBeNull();
  });

  test("keeps final settling on dom before returning to stable fast paths", () => {
    const request = createMorphMeasurementRequest({
      text: "OpenWindow",
      layoutContext: createLayoutContext({
        whiteSpace: "nowrap",
        measurementStability: "finalize",
      }),
      layoutHint: null,
    });

    expect(request?.measurementBackend).toBe("dom");
    expect(request?.domMeasurementKey).not.toBeNull();
  });
});
