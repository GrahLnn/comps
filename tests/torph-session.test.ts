import { describe, expect, test } from "bun:test";
import {
  applyMorphSessionDecision,
  decideMorphSessionUpdate,
  finalizeMorphTransition,
  reconcileMorphSessionUpdate,
  resolvePreparedMeasurementOrigin,
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
    const decision = decideMorphSessionUpdate({
      committed: createMeasurement("Slow Bloom", 87),
      target,
      animating: true,
      nextMeasurement: createMeasurement("Night Drive", 82),
      fontsReady: true,
    });

    expectDecisionKind(decision, "freeze-animating-target");
    if (decision.kind !== "freeze-animating-target") {
      return;
    }

    expect(decision.target).toBe(target);
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

    expect(result).toBe(target);
    expect(timeline).toEqual({
      prepareFrame: 21,
      animateFrame: 22,
      finalizeTimer: 23,
    });
    expect(setStateCalls).toHaveLength(0);
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
});
