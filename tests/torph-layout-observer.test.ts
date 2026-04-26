import { describe, expect, test } from "bun:test";
import {
  doesTransitionTargetAffectNode,
  hasRootRectChangedWithEpsilon,
  isGeometryTransitionProperty,
  resolveNextLayoutContext,
  shouldRefreshLayoutContextForRootMotion,
} from "../torph/src/core/layout-observer";
import type { LayoutContext } from "../torph/src/core/types";

function createLayoutContext(
  overrides: Partial<LayoutContext> = {},
): LayoutContext {
  return {
    display: "inline-grid",
    direction: "ltr",
    font: "400 16px / 24px Test",
    fontFeatureSettings: "normal",
    fontVariationSettings: "\"wght\" 520",
    letterSpacingPx: -0.32,
    lineHeightPx: 24,
    measurementCause: "steady",
    measurementStability: "live",
    parentDisplay: "block",
    textTransform: "none",
    whiteSpace: "nowrap",
    width: 155.5,
    wordSpacingPx: 0,
    measurementVersion: 7,
    ...overrides,
  };
}

describe("isGeometryTransitionProperty", () => {
  test("tracks transform-driven motion props that can move a live Torph root", () => {
    expect(isGeometryTransitionProperty("transform")).toBe(true);
    expect(isGeometryTransitionProperty("translate")).toBe(true);
    expect(isGeometryTransitionProperty("inset-inline-start")).toBe(true);
  });

  test("ignores typography-only transitions that belong to the font metric path", () => {
    expect(isGeometryTransitionProperty("font-size")).toBe(false);
    expect(isGeometryTransitionProperty("letter-spacing")).toBe(false);
    expect(isGeometryTransitionProperty("opacity")).toBe(false);
  });
});

describe("doesTransitionTargetAffectNode", () => {
  test("treats ancestor transitions as affecting descendant Torph nodes", () => {
    const child = {} as Node;
    const parent = {
      contains(candidate: Node) {
        return candidate === child;
      },
    };

    expect(doesTransitionTargetAffectNode(child, parent)).toBe(true);
  });

  test("ignores unrelated transition targets", () => {
    const node = {} as Node;
    const unrelated = {
      contains() {
        return false;
      },
    };

    expect(doesTransitionTargetAffectNode(node, unrelated)).toBe(false);
  });
});

describe("hasRootRectChangedWithEpsilon", () => {
  test("keeps subpixel settling detectable with a tighter epsilon", () => {
    const previousRect = {
      left: 100,
      top: 40,
      width: 160,
      height: 40,
    } satisfies Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;
    const nextRect = {
      left: 100,
      top: 40,
      width: 159.72,
      height: 40,
    } satisfies Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;

    expect(
      hasRootRectChangedWithEpsilon(previousRect, nextRect, 0.5),
    ).toBe(false);
    expect(
      hasRootRectChangedWithEpsilon(previousRect, nextRect, 0.05),
    ).toBe(true);
  });
});

describe("shouldRefreshLayoutContextForRootMotion", () => {
  test("refreshes layout context when root motion first becomes authoritative", () => {
    expect(
      shouldRefreshLayoutContextForRootMotion({
        measurementCause: "steady",
        measurementStability: "stable",
        previousRect: {
          left: 100,
          top: 40,
          width: 160,
          height: 40,
        },
        nextRect: {
          left: 101,
          top: 40,
          width: 160,
          height: 40,
        },
      }),
    ).toBe(true);
  });

  test("skips layout-context refresh for pure translation once root motion is already active", () => {
    expect(
      shouldRefreshLayoutContextForRootMotion({
        measurementCause: "root-motion",
        measurementStability: "live",
        previousRect: {
          left: 100,
          top: 40,
          width: 160,
          height: 40,
        },
        nextRect: {
          left: 112,
          top: 44,
          width: 160,
          height: 40,
        },
      }),
    ).toBe(false);
  });

  test("refreshes layout context when root motion also changes box size", () => {
    expect(
      shouldRefreshLayoutContextForRootMotion({
        measurementCause: "root-motion",
        measurementStability: "live",
        previousRect: {
          left: 100,
          top: 40,
          width: 160,
          height: 40,
        },
        nextRect: {
          left: 112,
          top: 44,
          width: 159.2,
          height: 40,
        },
      }),
    ).toBe(true);
  });
});

describe("resolveNextLayoutContext", () => {
  test("reuses the previous layout context during motion polling when metrics are unchanged", () => {
    const previous = createLayoutContext();
    const next = createLayoutContext({
      measurementVersion: 0,
    });

    expect(
      resolveNextLayoutContext({
        previous,
        next,
        refreshMode: "motion",
      }),
    ).toBe(previous);
  });

  test("forces a new measurement version for invalidation even when metrics are unchanged", () => {
    const previous = createLayoutContext();
    const next = createLayoutContext({
      measurementVersion: 0,
    });

    expect(
      resolveNextLayoutContext({
        previous,
        next,
        refreshMode: "invalidate",
      }),
    ).toEqual({
      ...next,
      measurementVersion: 8,
    });
  });

  test("advances the measurement version when the instability cause changes", () => {
    const previous = createLayoutContext({
      measurementCause: "root-motion",
    });

    expect(
      resolveNextLayoutContext({
        previous,
        next: createLayoutContext({
          measurementCause: "font-metrics",
          measurementVersion: 0,
        }),
        refreshMode: "motion",
      }),
    ).toEqual({
      ...createLayoutContext({
        measurementCause: "font-metrics",
        measurementVersion: 0,
      }),
      measurementVersion: 8,
    });
  });

  test("advances the measurement version when live metrics actually change", () => {
    const previous = createLayoutContext();

    expect(
      resolveNextLayoutContext({
        previous,
        next: createLayoutContext({
          width: 157.875,
          measurementVersion: 0,
        }),
        refreshMode: "motion",
      }),
    ).toEqual({
      ...createLayoutContext({
        width: 157.875,
        measurementVersion: 0,
      }),
      measurementVersion: 8,
    });
  });
});
