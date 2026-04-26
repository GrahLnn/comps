import type { Dispatch, SetStateAction } from "react";
import { nearlyEqual } from "./math";
import {
  EMPTY_STATE,
  MORPH,
  ZERO_BRIDGE,
  type MorphCharacterLayout,
  type MorphMeasurement,
  type MorphRenderPlan,
  type MorphSession,
  type MorphSnapshot,
  type MorphState,
  type MorphTimeline,
  type MorphVisualBridge,
} from "./types";

type GlyphMove = {
  kind: "move";
  from: MorphCharacterLayout;
  to: MorphCharacterLayout;
};

type GlyphEnter = {
  kind: "enter";
  to: MorphCharacterLayout;
};

type GlyphExit = {
  kind: "exit";
  from: MorphCharacterLayout;
};

type GlyphPairing = GlyphMove | GlyphEnter | GlyphExit;

export type MorphSessionDecision =
  | {
      kind: "freeze-animating-target";
      target: MorphMeasurement;
    }
  | {
      kind: "commit-static";
      measurement: MorphMeasurement;
    }
  | {
      kind: "start-morph";
      source: MorphMeasurement;
      target: MorphMeasurement;
    };

export type MorphSessionUpdateResult = {
  nextMeasurement: MorphMeasurement;
  appliedMeasurement: MorphMeasurement;
  decision: MorphSessionDecision;
};

function bucketByGlyph(graphemes: MorphCharacterLayout[]) {
  const buckets = new Map<string, MorphCharacterLayout[]>();
  for (const grapheme of graphemes) {
    const bucket = buckets.get(grapheme.glyph);
    if (bucket !== undefined) {
      bucket.push(grapheme);
      continue;
    }

    buckets.set(grapheme.glyph, [grapheme]);
  }

  return buckets;
}

export function pairMorphCharacters(
  previous: MorphCharacterLayout[],
  next: MorphCharacterLayout[],
): GlyphPairing[] {
  const previousBuckets = bucketByGlyph(previous);
  const nextBuckets = bucketByGlyph(next);
  const pairings: GlyphPairing[] = [];

  for (const [glyph, previousItems] of previousBuckets) {
    const nextItems = nextBuckets.get(glyph) ?? [];
    const shared = Math.min(previousItems.length, nextItems.length);

    for (let index = 0; index < shared; index += 1) {
      pairings.push({
        kind: "move",
        from: previousItems[index]!,
        to: nextItems[index]!,
      });
    }

    for (let index = shared; index < previousItems.length; index += 1) {
      pairings.push({
        kind: "exit",
        from: previousItems[index]!,
      });
    }
  }

  for (const [glyph, nextItems] of nextBuckets) {
    const previousItems = previousBuckets.get(glyph) ?? [];
    const shared = Math.min(previousItems.length, nextItems.length);

    for (let index = shared; index < nextItems.length; index += 1) {
      pairings.push({
        kind: "enter",
        to: nextItems[index]!,
      });
    }
  }

  return pairings;
}

export function resolveMorphFrameBounds(
  previous: MorphMeasurement["snapshot"],
  next: MorphMeasurement["snapshot"],
) {
  return {
    width: Math.max(previous.width, next.width),
    height: Math.max(previous.height, next.height),
  };
}

export function buildMorphPlan(
  previous: MorphMeasurement,
  next: MorphMeasurement,
  visualBridge: MorphVisualBridge = ZERO_BRIDGE,
): MorphRenderPlan {
  const pairings = pairMorphCharacters(previous.snapshot.graphemes, next.snapshot.graphemes);
  const movesByDestinationKey = new Map<string, GlyphMove>();
  const exitItems: MorphCharacterLayout[] = [];

  for (const pairing of pairings) {
    if (pairing.kind === "move") {
      movesByDestinationKey.set(pairing.to.key, pairing);
      continue;
    }

    if (pairing.kind === "exit") {
      exitItems.push(pairing.from);
    }
  }

  const frame = resolveMorphFrameBounds(previous.snapshot, next.snapshot);

  return {
    frameWidth: frame.width,
    frameHeight: frame.height,
    layoutInlineSizeFrom: previous.layoutInlineSize,
    layoutInlineSizeTo: next.layoutInlineSize,
    sourceRenderText: previous.snapshot.renderText,
    targetRenderText: next.snapshot.renderText,
    sourceRootOrigin: previous.rootOrigin,
    visualBridge,
    liveItems: next.snapshot.graphemes.map((grapheme) => {
      const move = movesByDestinationKey.get(grapheme.key);
      if (move !== undefined) {
        return {
          ...grapheme,
          kind: "move" as const,
          fromLeft: move.from.left,
          fromTop: move.from.top,
        };
      }

      return {
        ...grapheme,
        kind: "enter" as const,
        fromLeft: null,
        fromTop: null,
      };
    }),
    exitItems,
  };
}

function sameSnapshot(
  a: MorphMeasurement["snapshot"],
  b: MorphMeasurement["snapshot"],
) {
  if (a === b) {
    return true;
  }

  if (
    a.text !== b.text ||
    a.renderText !== b.renderText ||
    a.graphemes.length !== b.graphemes.length
  ) {
    return false;
  }

  if (!nearlyEqual(a.width, b.width, MORPH.geometryEpsilon)) {
    return false;
  }

  if (!nearlyEqual(a.height, b.height, MORPH.geometryEpsilon)) {
    return false;
  }

  for (let index = 0; index < a.graphemes.length; index += 1) {
    const left = a.graphemes[index]!;
    const right = b.graphemes[index]!;
    if (left.glyph !== right.glyph || left.key !== right.key) {
      return false;
    }

    if (!nearlyEqual(left.left, right.left, MORPH.geometryEpsilon)) {
      return false;
    }

    if (!nearlyEqual(left.top, right.top, MORPH.geometryEpsilon)) {
      return false;
    }

    if (!nearlyEqual(left.width, right.width, MORPH.geometryEpsilon)) {
      return false;
    }

    if (!nearlyEqual(left.height, right.height, MORPH.geometryEpsilon)) {
      return false;
    }
  }

  return true;
}

export function sameMeasurement(a: MorphMeasurement, b: MorphMeasurement) {
  const sameReservedInlineSize =
    (a.reservedInlineSize === null && b.reservedInlineSize === null) ||
    (a.reservedInlineSize !== null &&
      b.reservedInlineSize !== null &&
      nearlyEqual(a.reservedInlineSize, b.reservedInlineSize, MORPH.geometryEpsilon));

  const sameFlowInlineSize =
    (a.flowInlineSize === null && b.flowInlineSize === null) ||
    (a.flowInlineSize !== null &&
      b.flowInlineSize !== null &&
      nearlyEqual(a.flowInlineSize, b.flowInlineSize, MORPH.geometryEpsilon));

  return (
    sameSnapshot(a.snapshot, b.snapshot) &&
    nearlyEqual(a.layoutInlineSize, b.layoutInlineSize, MORPH.geometryEpsilon) &&
    sameReservedInlineSize &&
    sameFlowInlineSize &&
    nearlyEqual(a.rootOrigin.left, b.rootOrigin.left, MORPH.geometryEpsilon) &&
    nearlyEqual(a.rootOrigin.top, b.rootOrigin.top, MORPH.geometryEpsilon)
  );
}

export function selectMorphLayoutHint(session: MorphSession) {
  if (session.animating && session.target !== null) {
    return session.target;
  }

  return session.committed;
}

export function decideMorphSessionUpdate({
  committed,
  target,
  animating,
  nextMeasurement,
  fontsReady,
}: {
  committed: MorphMeasurement | null;
  target: MorphMeasurement | null;
  animating: boolean;
  nextMeasurement: MorphMeasurement;
  fontsReady: boolean;
}): MorphSessionDecision {
  let source = committed;
  if (animating && target !== null) {
    source = target;
  }

  if (source === null) {
    return {
      kind: "commit-static",
      measurement: nextMeasurement,
    };
  }

  if (!fontsReady) {
    return {
      kind: "commit-static",
      measurement: nextMeasurement,
    };
  }

  if (animating && target !== null) {
    if (nextMeasurement.snapshot.renderText === target.snapshot.renderText) {
      return {
        kind: "freeze-animating-target",
        target: nextMeasurement,
      };
    }
  }

  if (committed !== null) {
    if (committed.snapshot.renderText === nextMeasurement.snapshot.renderText) {
      if (sameMeasurement(committed, nextMeasurement)) {
        return {
          kind: "commit-static",
          measurement: committed,
        };
      }

      return {
        kind: "commit-static",
        measurement: nextMeasurement,
      };
    }
  }

  return {
    kind: "start-morph",
    source,
    target: nextMeasurement,
  };
}

function createStaticState(measurement: MorphMeasurement): MorphState {
  return {
    stage: "idle",
    measurement,
    plan: null,
  };
}

export function areFontsReady() {
  return document.fonts.status === "loaded";
}

export function cancelTimeline(timeline: MorphTimeline) {
  if (timeline.prepareFrame !== null) {
    cancelAnimationFrame(timeline.prepareFrame);
    timeline.prepareFrame = null;
  }

  if (timeline.animateFrame !== null) {
    cancelAnimationFrame(timeline.animateFrame);
    timeline.animateFrame = null;
  }

  if (timeline.finalizeTimer !== null) {
    window.clearTimeout(timeline.finalizeTimer);
    timeline.finalizeTimer = null;
  }
}

export function resetMorph(
  session: MorphSession,
  timeline: MorphTimeline,
  setState: (state: MorphState) => void,
) {
  cancelTimeline(timeline);
  session.committed = null;
  session.target = null;
  session.animating = false;
  setState(EMPTY_STATE);
}

export function commitStaticMeasurement(
  session: MorphSession,
  measurement: MorphMeasurement,
  setState: Dispatch<SetStateAction<MorphState>>,
) {
  if (
    !session.animating &&
    session.target === null &&
    session.committed !== null &&
    sameMeasurement(session.committed, measurement)
  ) {
    return;
  }

  session.committed = measurement;
  session.target = null;
  session.animating = false;
  setState((current) => {
    if (
      current.stage === "idle" &&
      current.plan === null &&
      current.measurement !== null &&
      sameMeasurement(current.measurement, measurement)
    ) {
      return current;
    }

    return createStaticState(measurement);
  });
}

export function applyMorphSessionDecision({
  decision,
  session,
  timeline,
  setState,
}: {
  decision: MorphSessionDecision;
  session: MorphSession;
  timeline: MorphTimeline;
  setState: Dispatch<SetStateAction<MorphState>>;
}) {
  if (decision.kind === "freeze-animating-target") {
    if (session.target === decision.target) {
      return decision.target;
    }

    session.target = decision.target;
    return decision.target;
  }

  cancelTimeline(timeline);

  if (decision.kind === "commit-static") {
    commitStaticMeasurement(session, decision.measurement, setState);
    return decision.measurement;
  }

  startMorph({
    source: decision.source,
    target: decision.target,
    session,
    timeline,
    setState,
  });
  return decision.target;
}

export function reconcileMorphSessionUpdate({
  session,
  timeline,
  nextMeasurement,
  fontsReady,
  setState,
}: {
  session: MorphSession;
  timeline: MorphTimeline;
  nextMeasurement: MorphMeasurement;
  fontsReady: boolean;
  setState: Dispatch<SetStateAction<MorphState>>;
}): MorphSessionUpdateResult {
  const decision = decideMorphSessionUpdate({
    committed: session.committed,
    target: session.target,
    animating: session.animating,
    nextMeasurement,
    fontsReady,
  });

  const appliedMeasurement = applyMorphSessionDecision({
    decision,
    session,
    timeline,
    setState,
  });

  return {
    nextMeasurement,
    appliedMeasurement,
    decision,
  };
}

export function finalizeMorphTransition({
  session,
  timeline,
  measurement,
  setState,
}: {
  session: MorphSession;
  timeline: MorphTimeline;
  measurement: MorphMeasurement;
  setState: Dispatch<SetStateAction<MorphState>>;
}) {
  cancelTimeline(timeline);
  commitStaticMeasurement(session, session.target ?? measurement, setState);
}

export function resolveFinalizeMeasurement({
  measurement,
  rootOrigin,
  visibleSnapshot,
  fallbackSnapshot,
}: {
  measurement: MorphMeasurement;
  rootOrigin: { left: number; top: number };
  visibleSnapshot: MorphSnapshot | null;
  fallbackSnapshot: MorphSnapshot | null;
}) {
  const nextSnapshot = visibleSnapshot ?? fallbackSnapshot ?? measurement.snapshot;
  const hasSameSnapshot = sameSnapshot(measurement.snapshot, nextSnapshot);
  const hasSameOrigin =
    nearlyEqual(measurement.rootOrigin.left, rootOrigin.left, MORPH.geometryEpsilon) &&
    nearlyEqual(measurement.rootOrigin.top, rootOrigin.top, MORPH.geometryEpsilon);

  if (hasSameSnapshot && hasSameOrigin) {
    return measurement;
  }

  return {
    snapshot: nextSnapshot,
    layoutInlineSize: measurement.layoutInlineSize,
    reservedInlineSize: measurement.reservedInlineSize,
    flowInlineSize: measurement.flowInlineSize,
    rootOrigin,
  };
}
export {
  resolvePreparedMeasurementOrigin,
  resolvePreparedMorphState,
  resolvePreparedPlanVisualBridge,
} from "./reference-frame";

export function startMorph({
  source,
  target,
  session,
  timeline,
  setState,
}: {
  source: MorphMeasurement;
  target: MorphMeasurement;
  session: MorphSession;
  timeline: MorphTimeline;
  setState: Dispatch<SetStateAction<MorphState>>;
}) {
  const plan = buildMorphPlan(source, target, ZERO_BRIDGE);

  session.target = target;
  session.animating = true;
  setState({
    stage: "prepare",
    measurement: target,
    plan,
  });
}
