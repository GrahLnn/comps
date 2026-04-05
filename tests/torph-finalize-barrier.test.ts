import { describe, expect, test } from "bun:test";
import {
  createMorphFinalizeBarrier,
  isMorphFinalizeBarrierSatisfied,
  recordMorphFinalizeSignal,
  summarizeMorphFinalizeBarrier,
} from "../torph/src/core/finalize-barrier";

describe("morph finalize barrier", () => {
  test("waits for live transform when move transitions are active", () => {
    let barrier = createMorphFinalizeBarrier(true);

    expect(isMorphFinalizeBarrierSatisfied(barrier)).toBe(false);

    barrier = recordMorphFinalizeSignal(barrier, "live-transform");
    expect(isMorphFinalizeBarrierSatisfied(barrier)).toBe(true);
    expect(summarizeMorphFinalizeBarrier(barrier)).toEqual({
      waitForLiveTransform: true,
      sawLiveTransform: true,
      satisfied: true,
    });
  });

  test("is already satisfied when no move transitions exist", () => {
    const barrier = createMorphFinalizeBarrier(false);

    expect(isMorphFinalizeBarrierSatisfied(barrier)).toBe(true);
    expect(summarizeMorphFinalizeBarrier(barrier)).toEqual({
      waitForLiveTransform: false,
      sawLiveTransform: false,
      satisfied: true,
    });
  });
});
