export type MorphFinalizeSignal = "live-transform";

export type MorphFinalizeBarrier = {
  waitForLiveTransform: boolean;
  sawLiveTransform: boolean;
};

export function createMorphFinalizeBarrier(
  hasMoveTransitions: boolean,
): MorphFinalizeBarrier {
  return {
    waitForLiveTransform: hasMoveTransitions,
    sawLiveTransform: false,
  };
}

export function recordMorphFinalizeSignal(
  barrier: MorphFinalizeBarrier,
  signal: MorphFinalizeSignal,
): MorphFinalizeBarrier {
  return {
    ...barrier,
    sawLiveTransform: signal === "live-transform",
  };
}

export function isMorphFinalizeBarrierSatisfied(
  barrier: MorphFinalizeBarrier,
) {
  if (barrier.waitForLiveTransform && !barrier.sawLiveTransform) {
    return false;
  }

  return true;
}

export function summarizeMorphFinalizeBarrier(
  barrier: MorphFinalizeBarrier,
) {
  return {
    waitForLiveTransform: barrier.waitForLiveTransform,
    sawLiveTransform: barrier.sawLiveTransform,
    satisfied: isMorphFinalizeBarrierSatisfied(barrier),
  };
}
