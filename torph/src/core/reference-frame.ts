import { nearlyEqual } from "./math";
import type {
  MorphMeasurement,
  MorphMeasurementCause,
  MorphMeasurementStability,
  MorphRenderPlan,
  MorphSession,
  MorphStage,
  MorphState,
} from "./types";
import { MORPH } from "./types";

export function pinMeasurementToCurrentOrigin(
  measurement: MorphMeasurement,
  origin: { left: number; top: number },
) {
  if (
    nearlyEqual(measurement.rootOrigin.left, origin.left, MORPH.geometryEpsilon) &&
    nearlyEqual(measurement.rootOrigin.top, origin.top, MORPH.geometryEpsilon)
  ) {
    return measurement;
  }

  return {
    snapshot: measurement.snapshot,
    layoutInlineSize: measurement.layoutInlineSize,
    reservedInlineSize: measurement.reservedInlineSize,
    flowInlineSize: measurement.flowInlineSize,
    rootOrigin: origin,
  };
}

export function resolvePreparedMeasurementOrigin(
  measurement: MorphMeasurement,
  origin: { left: number; top: number },
) {
  return pinMeasurementToCurrentOrigin(measurement, origin);
}

export function resolvePreparedPlanVisualBridge(
  plan: MorphRenderPlan,
  origin: { left: number; top: number },
) {
  const offsetX = plan.sourceRootOrigin.left - origin.left;
  const offsetY = plan.sourceRootOrigin.top - origin.top;
  if (
    nearlyEqual(plan.visualBridge.offsetX, offsetX, MORPH.geometryEpsilon) &&
    nearlyEqual(plan.visualBridge.offsetY, offsetY, MORPH.geometryEpsilon)
  ) {
    return plan;
  }

  return {
    ...plan,
    visualBridge: {
      offsetX,
      offsetY,
    },
  };
}

export function resolvePreparedMorphState(
  measurement: MorphMeasurement,
  plan: MorphRenderPlan,
  origin: { left: number; top: number },
) {
  const nextMeasurement = resolvePreparedMeasurementOrigin(measurement, origin);
  const nextPlan = resolvePreparedPlanVisualBridge(plan, origin);

  return {
    measurement: nextMeasurement,
    plan: nextPlan,
    changed: nextMeasurement !== measurement || nextPlan !== plan,
  };
}

export function rebaseActiveMorphState(
  state: MorphState,
  origin: { left: number; top: number },
) {
  if (state.stage === "idle" || state.measurement === null || state.plan === null) {
    return state;
  }

  const nextState = resolvePreparedMorphState(
    state.measurement,
    state.plan,
    origin,
  );
  if (!nextState.changed) {
    return state;
  }

  return {
    ...state,
    measurement: nextState.measurement,
    plan: nextState.plan,
  };
}

export function shouldRebaseObservedActiveMorphState(args: {
  stateStage: MorphStage;
  decisionKind: "freeze-animating-target" | "commit-static" | "start-morph";
}) {
  return args.decisionKind === "freeze-animating-target" && args.stateStage !== "prepare";
}

function shouldFreezePrepareMeasurement(args: {
  measurementCause: MorphMeasurementCause;
  nextMeasurement: MorphMeasurement;
  session: MorphSession;
  stateStage: MorphStage;
  visibleMeasurement: MorphMeasurement | null;
}) {
  return (
    args.measurementCause === "root-motion" &&
    args.stateStage === "prepare" &&
    args.session.animating &&
    args.visibleMeasurement !== null &&
    args.visibleMeasurement.snapshot.renderText ===
      args.nextMeasurement.snapshot.renderText
  );
}

function shouldPinAnimatingTarget(args: {
  measurementCause: MorphMeasurementCause;
  nextMeasurement: MorphMeasurement;
  session: MorphSession;
}) {
  return (
    args.measurementCause === "root-motion" &&
    args.session.animating &&
    args.session.target !== null &&
    args.session.target.snapshot.renderText ===
      args.nextMeasurement.snapshot.renderText
  );
}

function shouldPinCommittedMeasurement(args: {
  measurementCause: MorphMeasurementCause;
  measurementStability: MorphMeasurementStability;
  nextMeasurement: MorphMeasurement;
  session: MorphSession;
}) {
  return (
    args.measurementCause === "root-motion" &&
    !args.session.animating &&
    args.session.committed !== null &&
    args.session.committed.snapshot.renderText ===
      args.nextMeasurement.snapshot.renderText &&
    args.measurementStability !== "stable"
  );
}

export function selectSessionMeasurementObservation({
  measurementCause,
  session,
  nextMeasurement,
  measurementStability,
  stateStage,
  visibleMeasurement,
}: {
  measurementCause: MorphMeasurementCause;
  session: MorphSession;
  nextMeasurement: MorphMeasurement;
  measurementStability: MorphMeasurementStability;
  stateStage: MorphStage;
  visibleMeasurement: MorphMeasurement | null;
}): MorphMeasurement {
  if (
    shouldFreezePrepareMeasurement({
      measurementCause,
      nextMeasurement,
      session,
      stateStage,
      visibleMeasurement,
    })
  ) {
    if (visibleMeasurement !== null) {
      return visibleMeasurement;
    }
  }

  if (
    shouldPinAnimatingTarget({
      measurementCause,
      nextMeasurement,
      session,
    })
  ) {
    const target = session.target;
    if (target !== null) {
      return pinMeasurementToCurrentOrigin(target, nextMeasurement.rootOrigin);
    }
  }

  if (
    shouldPinCommittedMeasurement({
      measurementCause,
      measurementStability,
      nextMeasurement,
      session,
    })
  ) {
    const committed = session.committed;
    if (committed !== null) {
    return pinMeasurementToCurrentOrigin(
        committed,
      nextMeasurement.rootOrigin,
    );
    }
  }

  return nextMeasurement;
}
