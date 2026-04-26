import { describe, expect, test } from "bun:test";
import {
  applyMorphSessionDecision,
  decideMorphSessionUpdate,
  finalizeMorphTransition,
  resolveFinalizeMeasurement,
  reconcileMorphSessionUpdate,
  resolvePreparedMeasurementOrigin,
  resolvePreparedMorphState,
  resolvePreparedPlanVisualBridge,
  type MorphSessionDecision,
} from "../torph/src/core/session";
import type {
  MorphMeasurement,
  MorphSession,
  MorphTimeline,
} from "../torph/src/core/types";

function createMeasurement(text: string, width = 80): MorphMeasurement {
  return {
    snapshot: {
      text,
      renderText: text,
      width,
      height: 24,
      graphemes: [],
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

function expectDecisionKind(
  decision: MorphSessionDecision,
  kind: MorphSessionDecision["kind"],
) {
  expect(decision.kind).toBe(kind);
}

describe("decideMorphSessionUpdate", () => {
  test("freezes the current morph target while the same target text is animating", () => {
    const target = createMeasurement("Night Drive", 81);
    const nextMeasurement = createMeasurement("Night Drive", 82);
    const decision = decideMorphSessionUpdate({
      committed: createMeasurement("Slow Bloom", 87),
      target,
      animating: true,
      nextMeasurement,
      fontsReady: true,
    });

    expectDecisionKind(decision, "freeze-animating-target");
    if (decision.kind !== "freeze-animating-target") {
      return;
    }

    expect(decision.target).toBe(nextMeasurement);
  });

  test("starts a new morph from the active target when the text changes mid-flight", () => {
    const committed = createMeasurement("Slow Bloom", 87);
    const target = createMeasurement("Night Drive", 81);
    const nextMeasurement = createMeasurement("Silver Thread", 95);
    const decision = decideMorphSessionUpdate({
      committed,
      target,
      animating: true,
      nextMeasurement,
      fontsReady: true,
    });

    expectDecisionKind(decision, "start-morph");
    if (decision.kind !== "start-morph") {
      return;
    }

    expect(decision.source).toBe(target);
    expect(decision.target).toBe(nextMeasurement);
  });

  test("commits statically when fonts are not ready", () => {
    const nextMeasurement = createMeasurement("Open Window", 102);
    const decision = decideMorphSessionUpdate({
      committed: createMeasurement("Quiet Morning", 103),
      target: null,
      animating: false,
      nextMeasurement,
      fontsReady: false,
    });

    expectDecisionKind(decision, "commit-static");
    if (decision.kind !== "commit-static") {
      return;
    }

    expect(decision.measurement).toBe(nextMeasurement);
  });
});

describe("applyMorphSessionDecision", () => {
  test("keeps the active timeline intact while freezing an animating target", () => {
    const target = createMeasurement("Night Drive", 81);
    const session: MorphSession = {
      committed: createMeasurement("Slow Bloom", 87),
      target,
      animating: true,
    };
    const timeline: MorphTimeline = {
      prepareFrame: 11,
      animateFrame: 12,
      finalizeTimer: 13,
    };
    const setStateCalls: unknown[] = [];

    const result = applyMorphSessionDecision({
      decision: {
        kind: "freeze-animating-target",
        target,
      },
      session,
      timeline,
      setState: (value) => {
        setStateCalls.push(value);
        return value;
      },
    });

    expect(result).toBe(target);
    expect(timeline).toEqual({
      prepareFrame: 11,
      animateFrame: 12,
      finalizeTimer: 13,
    });
    expect(session.animating).toBe(true);
    expect(session.target).toBe(target);
    expect(setStateCalls).toHaveLength(0);
  });

  test("freezes by updating only the session target reference", () => {
    const target = createMeasurement("Night Drive", 81);
    const refreshedTarget = {
      ...target,
      rootOrigin: {
        left: 240,
        top: 36,
      },
    };
    const session: MorphSession = {
      committed: createMeasurement("Slow Bloom", 87),
      target,
      animating: true,
    };
    const timeline: MorphTimeline = {
      prepareFrame: 11,
      animateFrame: 12,
      finalizeTimer: 13,
    };
    const setStateCalls: unknown[] = [];

    const result = applyMorphSessionDecision({
      decision: {
        kind: "freeze-animating-target",
        target: refreshedTarget,
      },
      session,
      timeline,
      setState: (value) => {
        setStateCalls.push(value);
        return value;
      },
    });

    expect(result).toBe(refreshedTarget);
    expect(session.target).toBe(refreshedTarget);
    expect(setStateCalls).toHaveLength(0);
  });
});

describe("reconcileMorphSessionUpdate", () => {
  test("does not cancel an active timeline when the same target is remeasured", () => {
    const target = createMeasurement("Night Drive", 81);
    const session: MorphSession = {
      committed: createMeasurement("Slow Bloom", 87),
      target,
      animating: true,
    };
    const timeline: MorphTimeline = {
      prepareFrame: 21,
      animateFrame: 22,
      finalizeTimer: 23,
    };
    const setStateCalls: unknown[] = [];

    const result = reconcileMorphSessionUpdate({
      session,
      timeline,
      nextMeasurement: createMeasurement("Night Drive", 82),
      fontsReady: true,
      setState: (value) => {
        setStateCalls.push(value);
        return value;
      },
    });

    expect(result.appliedMeasurement).toEqual(createMeasurement("Night Drive", 82));
    expect(result.nextMeasurement).toEqual(createMeasurement("Night Drive", 82));
    expectDecisionKind(result.decision, "freeze-animating-target");
    expect(timeline).toEqual({
      prepareFrame: 21,
      animateFrame: 22,
      finalizeTimer: 23,
    });
    expect(setStateCalls).toHaveLength(0);
  });

  test("keeps the freeze decision pure and returns the supplied observed target", () => {
    const target = createMeasurement("Night Drive", 81);
    const nextMeasurement = {
      ...createMeasurement("Night Drive", 82),
      rootOrigin: {
        left: 240,
        top: 36,
      },
    };
    const decision = decideMorphSessionUpdate({
      committed: createMeasurement("Slow Bloom", 87),
      target,
      animating: true,
      nextMeasurement,
      fontsReady: true,
    });

    expectDecisionKind(decision, "freeze-animating-target");
    if (decision.kind !== "freeze-animating-target") {
      return;
    }

    expect(decision.target).toBe(nextMeasurement);
  });
});

describe("finalizeMorphTransition", () => {
  test("commits the active target and clears the watchdog timer", () => {
    const committed = createMeasurement("Slow Bloom", 87);
    const target = createMeasurement("Night Drive", 81);
    const session: MorphSession = {
      committed,
      target,
      animating: true,
    };
    const timeline: MorphTimeline = {
      prepareFrame: null,
      animateFrame: null,
      finalizeTimer: 23,
    };
    const setStateCalls: unknown[] = [];
    const scope = globalThis as typeof globalThis & {
      window?: {
        clearTimeout: typeof clearTimeout;
      };
    };
    const previousWindow = scope.window;

    try {
      scope.window = {
        clearTimeout,
      };

      finalizeMorphTransition({
        session,
        timeline,
        measurement: createMeasurement("Night Drive", 82),
        setState: (value) => {
          setStateCalls.push(value);
          return value;
        },
      });
    } finally {
      if (previousWindow === undefined) {
        delete scope.window;
      } else {
        scope.window = previousWindow;
      }
    }

    expect(timeline.finalizeTimer).toBeNull();
    expect(session.animating).toBe(false);
    expect(session.target).toBeNull();
    expect(session.committed).toBe(target);
    expect(setStateCalls).toHaveLength(1);
  });
});

describe("resolveFinalizeMeasurement", () => {
  test("prefers the visible live snapshot so idle steady glyphs stay on the real final pixels", () => {
    const measurement = createMeasurement("PlayList 1", 158.0313);
    const visibleSnapshot = {
      ...measurement.snapshot,
      width: 158.0105,
      graphemes: [
        {
          glyph: "P",
          key: "P-0",
          left: 0.0104,
          top: 0,
          width: 15.2,
          height: 40,
        },
      ],
    };

    expect(
      resolveFinalizeMeasurement({
        measurement,
        rootOrigin: {
          left: 620.9792,
          top: 385.6667,
        },
        visibleSnapshot,
        fallbackSnapshot: null,
      }),
    ).toEqual({
      ...measurement,
      snapshot: visibleSnapshot,
      rootOrigin: {
        left: 620.9792,
        top: 385.6667,
      },
    });
  });

  test("falls back to the flow snapshot when no visible overlay snapshot exists", () => {
    const measurement = createMeasurement("PlayList 1", 158.0313);
    const fallbackSnapshot = {
      ...measurement.snapshot,
      width: 158.0417,
    };

    expect(
      resolveFinalizeMeasurement({
        measurement,
        rootOrigin: {
          left: 620.9792,
          top: 385.6667,
        },
        visibleSnapshot: null,
        fallbackSnapshot,
      }),
    ).toEqual({
      ...measurement,
      snapshot: fallbackSnapshot,
      rootOrigin: {
        left: 620.9792,
        top: 385.6667,
      },
    });
  });
});

describe("prepared morph refinement", () => {
  test("retargets the prepared measurement to the rendered root origin", () => {
    const measurement = createMeasurement("Open Window", 102);

    expect(
      resolvePreparedMeasurementOrigin(measurement, {
        left: 12,
        top: 24,
      }),
    ).toEqual({
      ...measurement,
      rootOrigin: {
        left: 12,
        top: 24,
      },
    });
  });

  test("recomputes the visual bridge from the frozen source origin", () => {
    const plan = resolvePreparedPlanVisualBridge(
      {
        frameWidth: 102,
        frameHeight: 24,
        layoutInlineSizeFrom: 103,
        layoutInlineSizeTo: 102,
        sourceRenderText: "Quiet Morning",
        targetRenderText: "Open Window",
        sourceRootOrigin: {
          left: 664,
          top: 393,
        },
        visualBridge: {
          offsetX: 0,
          offsetY: 0,
        },
        liveItems: [],
        exitItems: [],
      },
      {
        left: 645,
        top: 393,
      },
    );

    expect(plan.visualBridge).toEqual({
      offsetX: 19,
      offsetY: 0,
    });
  });

  test("keeps measurement origin and visual bridge in the same prepared refinement step", () => {
    const measurement = createMeasurement("Open Window", 102);
    const plan = {
      frameWidth: 102,
      frameHeight: 24,
      layoutInlineSizeFrom: 103,
      layoutInlineSizeTo: 102,
      sourceRenderText: "Quiet Morning",
      targetRenderText: "Open Window",
      sourceRootOrigin: {
        left: 664,
        top: 393,
      },
      visualBridge: {
        offsetX: 0,
        offsetY: 0,
      },
      liveItems: [],
      exitItems: [],
    };

    expect(
      resolvePreparedMorphState(measurement, plan, {
        left: 645,
        top: 381,
      }),
    ).toEqual({
      measurement: {
        ...measurement,
        rootOrigin: {
          left: 645,
          top: 381,
        },
      },
      plan: {
        ...plan,
        visualBridge: {
          offsetX: 19,
          offsetY: 12,
        },
      },
      changed: true,
    });
  });
});
