import { describe, expect, test } from "bun:test";
import {
  rebaseActiveMorphState,
  selectSessionMeasurementObservation,
  shouldRebaseObservedActiveMorphState,
} from "../torph/src/core/reference-frame";
import type {
  MorphMeasurement,
  MorphSession,
  MorphState,
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

describe("selectSessionMeasurementObservation", () => {
  test("keeps committed geometry while an idle host is still moving", () => {
    const committed = {
      ...createMeasurement("PlayList 2", 158),
      rootOrigin: {
        left: 620,
        top: 385,
      },
    };
    const nextMeasurement = {
      ...createMeasurement("PlayList 2", 160),
      rootOrigin: {
        left: 446,
        top: 385,
      },
    };
    const session: MorphSession = {
      committed,
      target: null,
      animating: false,
    };

    expect(
      selectSessionMeasurementObservation({
        measurementCause: "root-motion",
        session,
        nextMeasurement,
        measurementStability: "live",
        stateStage: "idle",
        visibleMeasurement: committed,
      }),
    ).toEqual({
      ...committed,
      rootOrigin: {
        left: 446,
        top: 385,
      },
    });
  });

  test("keeps the frozen target geometry while the active morph root repositions", () => {
    const target = {
      ...createMeasurement("Night Drive", 81),
      rootOrigin: {
        left: 620,
        top: 385,
      },
    };
    const nextMeasurement = {
      ...createMeasurement("Night Drive", 96),
      rootOrigin: {
        left: 446,
        top: 385,
      },
    };
    const session: MorphSession = {
      committed: createMeasurement("Slow Bloom", 87),
      target,
      animating: true,
    };

    expect(
      selectSessionMeasurementObservation({
        measurementCause: "root-motion",
        session,
        nextMeasurement,
        measurementStability: "live",
        stateStage: "animate",
        visibleMeasurement: target,
      }),
    ).toEqual({
      ...target,
      rootOrigin: {
        left: 446,
        top: 385,
      },
    });
  });

  test("keeps the frozen prepare measurement authoritative until prepare refinement rebases it", () => {
    const preparedMeasurement = {
      ...createMeasurement("PlayList 2", 158),
      rootOrigin: {
        left: 444,
        top: 386,
      },
    };
    const session: MorphSession = {
      committed: createMeasurement("ZWEI2 OST - A Prayer to Espina", 510),
      target: preparedMeasurement,
      animating: true,
    };
    const transientMeasurement = {
      ...createMeasurement("PlayList 2", 158),
      rootOrigin: {
        left: 621,
        top: 386,
      },
    };

    expect(
      selectSessionMeasurementObservation({
        measurementCause: "root-motion",
        session,
        nextMeasurement: transientMeasurement,
        measurementStability: "live",
        stateStage: "prepare",
        visibleMeasurement: preparedMeasurement,
      }),
    ).toBe(preparedMeasurement);
  });

  test("does not freeze a committed measurement while font metrics are changing", () => {
    const committed = {
      ...createMeasurement("PlayList 2", 158),
      rootOrigin: {
        left: 620,
        top: 385,
      },
    };
    const nextMeasurement = {
      ...createMeasurement("PlayList 2", 170),
      rootOrigin: {
        left: 620,
        top: 385,
      },
    };
    const session: MorphSession = {
      committed,
      target: null,
      animating: false,
    };

    expect(
      selectSessionMeasurementObservation({
        measurementCause: "font-metrics",
        session,
        nextMeasurement,
        measurementStability: "live",
        stateStage: "idle",
        visibleMeasurement: committed,
      }),
    ).toBe(nextMeasurement);
  });

  test("does not keep a prepared target frozen when typography is changing", () => {
    const preparedMeasurement = {
      ...createMeasurement("PlayList 2", 158),
      rootOrigin: {
        left: 444,
        top: 386,
      },
    };
    const nextMeasurement = {
      ...createMeasurement("PlayList 2", 170),
      rootOrigin: {
        left: 444,
        top: 386,
      },
    };
    const session: MorphSession = {
      committed: createMeasurement("ZWEI2 OST - A Prayer to Espina", 510),
      target: preparedMeasurement,
      animating: true,
    };

    expect(
      selectSessionMeasurementObservation({
        measurementCause: "font-metrics",
        session,
        nextMeasurement,
        measurementStability: "live",
        stateStage: "prepare",
        visibleMeasurement: preparedMeasurement,
      }),
    ).toBe(nextMeasurement);
  });
});

describe("rebaseActiveMorphState", () => {
  test("leaves prepare-stage rebasing to the explicit prepare refinement step", () => {
    expect(
      shouldRebaseObservedActiveMorphState({
        stateStage: "prepare",
        decisionKind: "freeze-animating-target",
      }),
    ).toBe(false);
  });

  test("keeps animate-stage rebasing enabled for a frozen target", () => {
    expect(
      shouldRebaseObservedActiveMorphState({
        stateStage: "animate",
        decisionKind: "freeze-animating-target",
      }),
    ).toBe(true);
  });

  test("rebinds the visible morph state to the current root origin without changing stage", () => {
    const state: MorphState = {
      stage: "animate",
      measurement: {
        ...createMeasurement("Night Drive", 81),
        rootOrigin: {
          left: 620,
          top: 385,
        },
      },
      plan: {
        frameWidth: 81,
        frameHeight: 24,
        layoutInlineSizeFrom: 87,
        layoutInlineSizeTo: 81,
        sourceRenderText: "Slow Bloom",
        targetRenderText: "Night Drive",
        sourceRootOrigin: {
          left: 664,
          top: 385,
        },
        visualBridge: {
          offsetX: 44,
          offsetY: 0,
        },
        liveItems: [],
        exitItems: [],
      },
    };

    expect(
      rebaseActiveMorphState(state, {
        left: 446,
        top: 381,
      }),
    ).toEqual({
      ...state,
      measurement: {
        ...state.measurement,
        rootOrigin: {
          left: 446,
          top: 381,
        },
      },
      plan: {
        ...state.plan,
        visualBridge: {
          offsetX: 218,
          offsetY: 4,
        },
      },
    });
  });
});
