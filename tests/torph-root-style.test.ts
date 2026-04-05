import { describe, expect, test } from "bun:test";
import {
  createSteadyGlyphPlan,
  getOverlayStyle,
  getRootStyle,
  resolveGlyphSliceWhiteSpace,
  resolveFlowText,
  shouldRenderGlyphLayer,
} from "../torph/src/core/render";
import {
  resolveContentWidthLockInlineSize,
  type MorphMeasurement,
  type MorphRenderPlan,
} from "../torph/src/core/types";

const measurement: MorphMeasurement = {
  snapshot: {
    text: "BAA",
    renderText: "BAA",
    width: 24,
    height: 48,
    graphemes: [],
  },
  layoutInlineSize: 24,
  reservedInlineSize: null,
  flowInlineSize: null,
  rootOrigin: { left: 0, top: 0 },
};

const plan: MorphRenderPlan = {
  frameWidth: 24,
  frameHeight: 48,
  layoutInlineSizeFrom: 24,
  layoutInlineSizeTo: 24,
  sourceRenderText: "BAA",
  targetRenderText: "BAA",
  sourceRootOrigin: { left: 0, top: 0 },
  visualBridge: { offsetX: 0, offsetY: 0 },
  liveItems: [],
  exitItems: [],
};

describe("getRootStyle", () => {
  test("does not pin height after animation settles", () => {
    const style = getRootStyle("idle", null, measurement, null);
    expect(style.height).toBeUndefined();
  });

  test("keeps idle root width explicit once the measurement is content-width locked", () => {
    const style = getRootStyle(
      "idle",
      null,
      {
        ...measurement,
        flowInlineSize: 24,
      },
      null,
    );

    expect(style.width).toBe(24);
  });

  test("keeps idle root width unset when the measurement is still container-driven", () => {
    const style = getRootStyle(
      "idle",
      null,
      {
        ...measurement,
        layoutInlineSize: 240,
      },
      null,
    );

    expect(style.width).toBeUndefined();
  });

  test("keeps frame height while overlay is active", () => {
    const style = getRootStyle("prepare", plan, measurement, null);
    expect(style.height).toBe(48);
  });

  test("locks the visible root to the target inline size during prepare", () => {
    const style = getRootStyle(
      "prepare",
      {
        ...plan,
        layoutInlineSizeFrom: 24,
        layoutInlineSizeTo: 40,
      },
      measurement,
      null,
    );

    expect(style.width).toBe(40);
  });

  test("prefers real flow width over snapshot width for width-lock decisions", () => {
    const flowMeasured: MorphMeasurement = {
      ...measurement,
      layoutInlineSize: 40,
      flowInlineSize: 40,
      snapshot: {
        ...measurement.snapshot,
        width: 36,
      },
    };

    expect(resolveContentWidthLockInlineSize(flowMeasured)).toBe(40);
  });

  test("prefers the state measurement text so hidden flow stays on the target during morph", () => {
    const committedMeasurement: MorphMeasurement = {
      ...measurement,
      snapshot: {
        ...measurement.snapshot,
        text: "Quiet Morning",
        renderText: "Quiet Morning",
      },
    };
    const stateMeasurement: MorphMeasurement = {
      ...measurement,
      snapshot: {
        ...measurement.snapshot,
        text: "Open Window",
        renderText: "Open Window",
      },
    };

    expect(resolveFlowText(committedMeasurement, stateMeasurement, "Open Window")).toBe(
      "Open Window",
    );
  });

  test("does not add a width transition when the plan is absent", () => {
    const style = getRootStyle("animate", null, measurement, null);
    expect(style.transition).toBeUndefined();
  });

  test("uses the glyph layer as the only visible text path once measurement exists", () => {
    expect(shouldRenderGlyphLayer("idle", null, measurement)).toBe(true);
    expect(shouldRenderGlyphLayer("prepare", plan, measurement)).toBe(true);
    expect(shouldRenderGlyphLayer("prepare", null, measurement)).toBe(false);
    expect(shouldRenderGlyphLayer("idle", null, null)).toBe(false);
  });

  test("lets the idle overlay fill the root instead of pinning a separate pixel width", () => {
    const style = getOverlayStyle("idle", plan);

    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
    expect(style.inset).toBe(0);
  });

  test("pins overlay frame bounds while animating", () => {
    const style = getOverlayStyle("animate", plan);

    expect(style.width).toBe(24);
    expect(style.height).toBe(48);
    expect(style.right).toBe("auto");
    expect(style.bottom).toBe("auto");
  });

  test("builds a steady glyph plan from the committed measurement for idle rendering", () => {
    const steadyPlan = createSteadyGlyphPlan({
      ...measurement,
      snapshot: {
        ...measurement.snapshot,
        graphemes: [
          { glyph: "B", key: "B:0", left: 0, top: 0, width: 8, height: 24 },
          { glyph: "A", key: "A:1", left: 8, top: 0, width: 8, height: 24 },
        ],
      },
    });

    expect(steadyPlan.frameWidth).toBe(24);
    expect(steadyPlan.frameHeight).toBe(48);
    expect(steadyPlan.sourceRenderText).toBe("BAA");
    expect(steadyPlan.targetRenderText).toBe("BAA");
    expect(steadyPlan.exitItems).toHaveLength(0);
    expect(steadyPlan.liveItems).toHaveLength(2);
    expect(steadyPlan.liveItems[0]).toMatchObject({
      glyph: "B",
      key: "B:0",
      fromLeft: 0,
      fromTop: 0,
      kind: "move",
    });
  });

  test("locks single-line glyph slices to nowrap", () => {
    expect(
      resolveGlyphSliceWhiteSpace({
        ...measurement.snapshot,
        graphemes: [
          { glyph: "O", key: "O:0", left: 0, top: 0, width: 8, height: 24 },
          { glyph: "p", key: "p:1", left: 8, top: 0, width: 8, height: 24 },
          { glyph: "e", key: "e:2", left: 16, top: 0, width: 8, height: 24 },
        ],
      }),
    ).toBe("nowrap");
  });

  test("locks measured glyph slices to nowrap whenever a snapshot exists", () => {
    expect(
      resolveGlyphSliceWhiteSpace({
        ...measurement.snapshot,
        graphemes: [
          { glyph: "O", key: "O:0", left: 0, top: 0, width: 8, height: 24 },
          { glyph: "p", key: "p:1", left: 8, top: 0, width: 8, height: 24 },
          { glyph: "e", key: "e:2", left: 0, top: 24, width: 8, height: 24 },
        ],
      }),
    ).toBe("nowrap");
  });

  test("keeps the pre-measurement fallback path on inherited whitespace rules", () => {
    expect(resolveGlyphSliceWhiteSpace(null)).toBe("inherit");
  });
});
