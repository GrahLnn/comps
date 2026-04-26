import {
  type Dispatch,
  type ReactElement,
  type SetStateAction,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type PretextMorphMeasurementBackend } from "../utils/text-layout/pretextMorph";
import {
  canCacheMeasurementLayerSnapshot as canCacheMeasurementLayerSnapshotModel,
  createMorphMeasurementRequest as createMorphMeasurementRequestModel,
} from "../core/measurement-policy";
import {
  createMorphFinalizeBarrier as createMorphFinalizeBarrierModel,
  isMorphFinalizeBarrierSatisfied as isMorphFinalizeBarrierSatisfiedModel,
  recordMorphFinalizeSignal as recordMorphFinalizeSignalModel,
  summarizeMorphFinalizeBarrier as summarizeMorphFinalizeBarrierModel,
  type MorphFinalizeBarrier,
  type MorphFinalizeSignal,
} from "../core/finalize-barrier";
import {
  rebaseActiveMorphState as rebaseActiveMorphStateModel,
  selectSessionMeasurementObservation as selectSessionMeasurementObservationModel,
  shouldRebaseObservedActiveMorphState as shouldRebaseObservedActiveMorphStateModel,
} from "../core/reference-frame";
import {
  areFontsReady as areFontsReadyModel,
  cancelTimeline as cancelTimelineModel,
  type MorphSessionDecision,
  finalizeMorphTransition as finalizeMorphTransitionModel,
  reconcileMorphSessionUpdate as reconcileMorphSessionUpdateModel,
  resetMorph as resetMorphModel,
  resolveFinalizeMeasurement as resolveFinalizeMeasurementModel,
  resolvePreparedMorphState as resolvePreparedMorphStateModel,
  selectMorphLayoutHint as selectMorphLayoutHintModel,
} from "../core/session";
import { useObservedLayoutContext } from "../core/layout-observer";
import {
  measureFromNodes,
  measureLiveFlowSnapshot,
  measureOverlayBoxSnapshot,
  measureSnapshotDrift,
  readCachedMorphSnapshot,
  readRootOrigin,
  rememberCachedMorphSnapshot,
} from "../core/dom-measurement";
import {
  getRootStyle as getRootStyleModel,
  resolveGlyphSliceWhiteSpace as resolveGlyphSliceWhiteSpaceModel,
  resolveFlowText as resolveFlowTextModel,
  shouldRenderGlyphLayer as shouldRenderGlyphLayerModel,
} from "../core/render";
import {
  EMPTY_SEGMENTS,
  EMPTY_SESSION,
  EMPTY_STATE,
  EMPTY_TIMELINE,
  MORPH,
  type LayoutContext,
  type MorphLiveItem,
  type MorphMeasurement,
  type MorphRenderPlan,
  type MorphSegment,
  type MorphSession,
  type MorphSnapshot,
  type MorphStage,
  type MorphState,
  type MorphTimeline,
  type MorphVisualBridge,
} from "../core/types";
import {
  TORPH_TRACE_SCHEMA_VERSION,
  ensureTorphTraceApi,
  logTorphDebug,
  nextTorphDebugInstanceId,
  readTorphDebugConfig,
  summarizeDebugGlyphs,
  roundDebugValue,
  shouldRunTorphInstrumentation,
  summarizeDebugLayoutContext,
  summarizeDebugMeasurement,
  summarizeDebugMeasurementAnchors,
  summarizeDebugRect,
  summarizeDebugRootOriginDrift,
  summarizeDebugSnapshot,
  summarizeDebugViewportAnchors,
  summarizeSnapshotDrift,
} from "../debug/trace";
import {
  FlowTextLayer,
  MeasurementLayer,
  MorphOverlay,
  getScreenReaderOnlyStyle,
} from "./Torph.layers";

const debugDomNodeIds = new WeakMap<object, number>();
let debugDomNodeOrdinal = 0;

function getDebugDomNodeId(node: object | null) {
  if (node === null) {
    return null;
  }

  const existing = debugDomNodeIds.get(node);
  if (existing !== undefined) {
    return existing;
  }

  debugDomNodeOrdinal += 1;
  debugDomNodeIds.set(node, debugDomNodeOrdinal);
  return debugDomNodeOrdinal;
}

function reconcileMorphChange({
  root,
  measurementLayer,
  measurementBackend,
  snapshotOverride,
  text,
  renderText,
  segments,
  layoutContext,
  stateStage,
  visibleMeasurement,
  session,
  timeline,
  setState,
}: {
  root: HTMLElement | null;
  measurementLayer: HTMLElement | null;
  measurementBackend: PretextMorphMeasurementBackend | null;
  snapshotOverride: MorphSnapshot | null;
  text: string;
  renderText: string;
  segments: readonly MorphSegment[];
  layoutContext: LayoutContext | null;
  stateStage: MorphStage;
  visibleMeasurement: MorphMeasurement | null;
  session: MorphSession;
  timeline: MorphTimeline;
  setState: Dispatch<SetStateAction<MorphState>>;
}) {
  if (root === null || layoutContext === null) {
    resetMorphModel(session, timeline, setState);
    return null;
  }

  if (measurementBackend === null) {
    throw new Error("Torph measurement backend is missing.");
  }

  const layoutHint = selectMorphLayoutHintModel(session);
  const nextMeasurement = measureFromNodes({
    root,
    layoutContext,
    layoutHint,
    layer: measurementLayer,
    measurementBackend,
    snapshotOverride,
    text,
    renderText,
    segments,
  });
  const observedMeasurement = selectSessionMeasurementObservationModel({
    measurementCause: layoutContext.measurementCause,
    session,
    nextMeasurement,
    measurementStability: layoutContext.measurementStability,
    stateStage,
    visibleMeasurement,
  });

  const result = reconcileMorphSessionUpdateModel({
    session,
    timeline,
    nextMeasurement: observedMeasurement,
    fontsReady: areFontsReadyModel(),
    setState,
  });
  if (
    shouldRebaseObservedActiveMorphStateModel({
      stateStage,
      decisionKind: result.decision.kind,
    })
  ) {
    setState((current) =>
      rebaseActiveMorphStateModel(current, result.appliedMeasurement.rootOrigin),
    );
  }

  return result;
}

function summarizePreciseRect(rect: DOMRect | null) {
  if (rect === null) {
    return null;
  }

  return {
    left: roundDebugValue(rect.left),
    top: roundDebugValue(rect.top),
    width: roundDebugValue(rect.width),
    height: roundDebugValue(rect.height),
  };
}

function summarizePreciseGlyphs(snapshot: MorphSnapshot | null, rootRect: DOMRect | null) {
  if (snapshot === null) {
    return null;
  }

  return snapshot.graphemes.map((grapheme, index) => ({
    index,
    glyph: grapheme.glyph,
    key: grapheme.key,
    left: roundDebugValue(grapheme.left),
    top: roundDebugValue(grapheme.top),
    width: roundDebugValue(grapheme.width),
    height: roundDebugValue(grapheme.height),
    viewportLeft: rootRect === null ? null : roundDebugValue(rootRect.left + grapheme.left),
    viewportTop: rootRect === null ? null : roundDebugValue(rootRect.top + grapheme.top),
  }));
}

function summarizeLiveNodeStyles(overlayNode: HTMLDivElement | null) {
  if (overlayNode === null) {
    return null;
  }

  return Array.from(overlayNode.querySelectorAll<HTMLElement>("[data-morph-role='live']")).map(
    (node, index) => {
      const styles = getComputedStyle(node);
      const sliceNode = node.firstElementChild;
      let sliceStyles: CSSStyleDeclaration | null = null;
      let sliceRect: DOMRect | null = null;
      if (sliceNode instanceof HTMLElement) {
        sliceStyles = getComputedStyle(sliceNode);
        sliceRect = sliceNode.getBoundingClientRect();
      }

      let nodeRect: DOMRect | null = null;
      nodeRect = node.getBoundingClientRect();

      let sliceScrollWidth: number | null = null;
      let sliceClientWidth: number | null = null;
      let sliceOffsetWidth: number | null = null;
      if (sliceNode instanceof HTMLElement) {
        sliceScrollWidth = sliceNode.scrollWidth;
        sliceClientWidth = sliceNode.clientWidth;
        sliceOffsetWidth = sliceNode.offsetWidth;
      }

      return {
        index,
        nodeId: getDebugDomNodeId(node),
        key: node.dataset.morphKey ?? null,
        glyph: node.dataset.morphGlyph ?? null,
        kind: node.dataset.morphKind ?? null,
        transform: styles.transform,
        inlineTransform: node.style.transform,
        opacity: styles.opacity,
        transitionProperty: styles.transitionProperty,
        transitionDuration: styles.transitionDuration,
        transitionTimingFunction: styles.transitionTimingFunction,
        nodeRect: summarizePreciseRect(nodeRect),
        sliceNodeId: getDebugDomNodeId(sliceNode),
        sliceInlineLeft:
          node.firstElementChild instanceof HTMLElement ? node.firstElementChild.style.left : null,
        sliceInlineTop:
          node.firstElementChild instanceof HTMLElement ? node.firstElementChild.style.top : null,
        sliceInlineWidth:
          node.firstElementChild instanceof HTMLElement ? node.firstElementChild.style.width : null,
        sliceLeft: sliceStyles?.left ?? null,
        sliceTop: sliceStyles?.top ?? null,
        sliceWidth: sliceStyles?.width ?? null,
        sliceWhiteSpace: sliceStyles?.whiteSpace ?? null,
        sliceText: sliceNode instanceof HTMLElement ? sliceNode.textContent : null,
        sliceRect: summarizePreciseRect(sliceRect),
        sliceScrollWidth: roundDebugValue(sliceScrollWidth),
        sliceClientWidth: roundDebugValue(sliceClientWidth),
        sliceOffsetWidth: roundDebugValue(sliceOffsetWidth),
      };
    },
  );
}

function summarizeRootRuntimeStyles(root: HTMLDivElement | null) {
  if (root === null) {
    return null;
  }

  const styles = getComputedStyle(root);
  const parent = root.parentElement;
  let parentStyles: CSSStyleDeclaration | null = null;
  let parentRect: DOMRect | null = null;
  if (parent instanceof HTMLElement) {
    parentStyles = getComputedStyle(parent);
    parentRect = parent.getBoundingClientRect();
  }

  let parentSummary: Record<string, unknown> | null = null;
  if (parent !== null) {
    parentSummary = {
      display: parentStyles?.display ?? null,
      justifyContent: parentStyles?.justifyContent ?? null,
      alignItems: parentStyles?.alignItems ?? null,
      placeItems: parentStyles?.placeItems ?? null,
      textAlign: parentStyles?.textAlign ?? null,
      rect: summarizePreciseRect(parentRect),
    };
  }

  return {
    inlineWidth: root.style.width || null,
    computedWidth: styles.width,
    inlineTransition: root.style.transition || null,
    computedTransitionProperty: styles.transitionProperty,
    computedTransitionDuration: styles.transitionDuration,
    computedTransform: styles.transform,
    offsetWidth: roundDebugValue(root.offsetWidth),
    clientWidth: roundDebugValue(root.clientWidth),
    scrollWidth: roundDebugValue(root.scrollWidth),
    parent: parentSummary,
  };
}

function summarizeNullableDelta(nextValue: number | null, previousValue: number | null) {
  if (nextValue === null || previousValue === null) {
    if (nextValue === previousValue) {
      return 0;
    }

    return null;
  }

  return roundDebugValue(nextValue - previousValue);
}

function summarizeMeasurementComparison(
  reference: MorphMeasurement | null,
  nextMeasurement: MorphMeasurement,
) {
  if (reference === null) {
    return null;
  }

  return {
    layoutInlineSizeDelta: roundDebugValue(
      nextMeasurement.layoutInlineSize - reference.layoutInlineSize,
    ),
    reservedInlineSizeDelta: summarizeNullableDelta(
      nextMeasurement.reservedInlineSize,
      reference.reservedInlineSize,
    ),
    flowInlineSizeDelta: summarizeNullableDelta(
      nextMeasurement.flowInlineSize,
      reference.flowInlineSize,
    ),
    rootOriginDelta: {
      left: roundDebugValue(nextMeasurement.rootOrigin.left - reference.rootOrigin.left),
      top: roundDebugValue(nextMeasurement.rootOrigin.top - reference.rootOrigin.top),
    },
    snapshotDelta: summarizeSnapshotDrift(
      measureSnapshotDrift(reference.snapshot, nextMeasurement.snapshot),
    ),
  };
}

function summarizeSessionDecision(decision: MorphSessionDecision) {
  if (decision.kind === "freeze-animating-target") {
    return {
      kind: decision.kind,
      target: summarizeDebugMeasurement(decision.target),
      targetAnchors: summarizeDebugMeasurementAnchors(decision.target),
    };
  }

  if (decision.kind === "commit-static") {
    return {
      kind: decision.kind,
      measurement: summarizeDebugMeasurement(decision.measurement),
      measurementAnchors: summarizeDebugMeasurementAnchors(decision.measurement),
    };
  }

  return {
    kind: decision.kind,
    source: summarizeDebugMeasurement(decision.source),
    sourceAnchors: summarizeDebugMeasurementAnchors(decision.source),
    target: summarizeDebugMeasurement(decision.target),
    targetAnchors: summarizeDebugMeasurementAnchors(decision.target),
  };
}

function isMorphOverlayTransformFinalizeEvent(event: TransitionEvent, hasMoveTransitions: boolean) {
  if (!hasMoveTransitions) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.dataset.morphRole !== "live") {
    return false;
  }

  return event.propertyName === "transform";
}

function resolveMorphFinalizeSignal(
  event: TransitionEvent,
  hasMoveTransitions: boolean,
): MorphFinalizeSignal | null {
  if (isMorphOverlayTransformFinalizeEvent(event, hasMoveTransitions)) {
    return "live-transform";
  }

  return null;
}

type PreparedMorphSnapshot = {
  measurement: MorphMeasurement;
  plan: MorphRenderPlan;
};

type PreparedMorphRefinement = PreparedMorphSnapshot & {
  origin: { left: number; top: number };
  changed: boolean;
};

function readPreparedMorphRefinement(
  root: HTMLElement,
  preparedState: PreparedMorphSnapshot,
): PreparedMorphRefinement {
  const origin = readRootOrigin(root);
  const refinement = resolvePreparedMorphStateModel(
    preparedState.measurement,
    preparedState.plan,
    origin,
  );

  return {
    origin,
    measurement: refinement.measurement,
    plan: refinement.plan,
    changed: refinement.changed,
  };
}

function useMorphTransition(
  text: string,
  className?: string,
  debugLabel?: string | null,
  debugMeta?: Record<string, unknown> | null,
) {
  const [state, setState] = useState<MorphState>(EMPTY_STATE);
  const latestStateRef = useRef(state);
  const { ref, layoutContext, motionFrameVersion } = useObservedLayoutContext<HTMLDivElement>([
    className,
  ]);
  const debugInstanceIdRef = useRef<number | null>(null);
  const debugRenderOrdinalRef = useRef(0);
  const flowTextRef = useRef<HTMLSpanElement | null>(null);
  const measurementLayerRef = useRef<HTMLSpanElement | null>(null);
  const completedDomMeasurementKeyRef = useRef<string | null>(null);
  const domMeasurementSnapshotCacheRef = useRef(new Map<string, MorphSnapshot>());
  const sessionRef = useRef<MorphSession>({ ...EMPTY_SESSION });
  const timelineRef = useRef<MorphTimeline>({ ...EMPTY_TIMELINE });
  const debugDriftSignatureRef = useRef<string | null>(null);
  const [domMeasurementRequestKey, setDomMeasurementRequestKey] = useState<string | null>(null);
  latestStateRef.current = state;
  debugRenderOrdinalRef.current += 1;
  const debugRenderOrdinal = debugRenderOrdinalRef.current;
  if (debugInstanceIdRef.current === null) {
    debugInstanceIdRef.current = nextTorphDebugInstanceId();
  }

  const measurementHint = selectMorphLayoutHintModel(sessionRef.current);
  const measurementRequest = useMemo(
    () =>
      createMorphMeasurementRequestModel({
        text,
        layoutContext,
        layoutHint: measurementHint,
      }),
    [text, layoutContext, measurementHint],
  );
  const renderText = measurementRequest?.renderText ?? text;
  const useContentInlineSize = measurementRequest?.useContentInlineSize ?? false;
  const measurementBackend = measurementRequest?.measurementBackend ?? null;
  const segments = measurementRequest?.segments ?? EMPTY_SEGMENTS;
  const domMeasurementKey = measurementRequest?.domMeasurementKey ?? null;
  const logTransitionTrace = (event: string, payload: Record<string, unknown> = {}) => {
    const config = readTorphDebugConfig();
    if (!shouldRunTorphInstrumentation(config)) {
      return;
    }

    logTorphDebug(debugInstanceIdRef.current!, event, {
      traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
      debugLabel,
      debugMeta,
      renderOrdinal: debugRenderOrdinal,
      text,
      renderText,
      stateStage: state.stage,
      committed: summarizeDebugMeasurement(sessionRef.current.committed),
      stateMeasurement: summarizeDebugMeasurement(state.measurement),
      layoutContext: summarizeDebugLayoutContext(layoutContext),
      measurementBackend,
      useContentInlineSize,
      domMeasurementKey,
      domMeasurementRequestKey,
      completedDomMeasurementKey: completedDomMeasurementKeyRef.current,
      ...payload,
    });
  };

  const logMeasurementReconcile = ({
    reason,
    committedBefore,
    targetBefore,
    result,
  }: {
    reason: string;
    committedBefore: MorphMeasurement | null;
    targetBefore: MorphMeasurement | null;
    result: ReturnType<typeof reconcileMorphSessionUpdateModel>;
  }) => {
    logTransitionTrace("effect:measurement-reconcile", {
      reason,
      committedBefore: summarizeDebugMeasurement(committedBefore),
      committedBeforeAnchors: summarizeDebugMeasurementAnchors(committedBefore),
      targetBefore: summarizeDebugMeasurement(targetBefore),
      targetBeforeAnchors: summarizeDebugMeasurementAnchors(targetBefore),
      nextMeasurement: summarizeDebugMeasurement(result.nextMeasurement),
      nextMeasurementAnchors: summarizeDebugMeasurementAnchors(result.nextMeasurement),
      appliedMeasurement: summarizeDebugMeasurement(result.appliedMeasurement),
      appliedMeasurementAnchors: summarizeDebugMeasurementAnchors(result.appliedMeasurement),
      decision: summarizeSessionDecision(result.decision),
      nextVsCommitted: summarizeMeasurementComparison(committedBefore, result.nextMeasurement),
      nextVsTarget: summarizeMeasurementComparison(targetBefore, result.nextMeasurement),
      appliedVsCommitted: summarizeMeasurementComparison(
        committedBefore,
        result.appliedMeasurement,
      ),
      appliedVsTarget: summarizeMeasurementComparison(targetBefore, result.appliedMeasurement),
    });
  };

  useLayoutEffect(() => {
    ensureTorphTraceApi();
  }, []);

  useLayoutEffect(() => {
    if (ref.current === null || layoutContext === null) {
      completedDomMeasurementKeyRef.current = null;
      if (domMeasurementRequestKey !== null) {
        logTransitionTrace("effect:dom-measurement-request-update", {
          reason: "clear-missing-root-or-layout",
          nextDomMeasurementRequestKey: null,
        });
        setDomMeasurementRequestKey(null);
      }

      reconcileMorphChange({
        root: ref.current,
        measurementLayer: measurementLayerRef.current,
        measurementBackend,
        snapshotOverride: null,
        text,
        renderText,
        segments,
        layoutContext,
        stateStage: state.stage,
        visibleMeasurement: state.measurement,
        session: sessionRef.current,
        timeline: timelineRef.current,
        setState,
      });
      return;
    }

    if (domMeasurementKey !== null) {
      let cachedSnapshot: MorphSnapshot | null = null;
      if (canCacheMeasurementLayerSnapshotModel(measurementBackend)) {
        cachedSnapshot = readCachedMorphSnapshot(
          domMeasurementSnapshotCacheRef.current,
          domMeasurementKey,
        );
      }
      if (cachedSnapshot !== null) {
        const committedBefore = sessionRef.current.committed;
        const targetBefore = sessionRef.current.target;
        completedDomMeasurementKeyRef.current = domMeasurementKey;
        if (domMeasurementRequestKey !== null) {
          logTransitionTrace("effect:dom-measurement-request-update", {
            reason: "clear-after-cache-hit",
            nextDomMeasurementRequestKey: null,
            snapshotSource: "cache",
          });
          setDomMeasurementRequestKey(null);
        }

        const result = reconcileMorphChange({
          root: ref.current,
          measurementLayer: null,
          measurementBackend,
          snapshotOverride: cachedSnapshot,
          text,
          renderText,
          segments,
          layoutContext,
          stateStage: state.stage,
          visibleMeasurement: state.measurement,
          session: sessionRef.current,
          timeline: timelineRef.current,
          setState,
        });
        if (result !== null) {
          logMeasurementReconcile({
            reason: "cache-hit",
            committedBefore,
            targetBefore,
            result,
          });
        }
        return;
      }

      if (completedDomMeasurementKeyRef.current !== domMeasurementKey) {
        if (domMeasurementRequestKey !== domMeasurementKey) {
          logTransitionTrace("effect:dom-measurement-request-update", {
            reason: "request-measurement-layer",
            nextDomMeasurementRequestKey: domMeasurementKey,
          });
          setDomMeasurementRequestKey(domMeasurementKey);
          return;
        }

        if (measurementLayerRef.current === null) {
          logTransitionTrace("effect:dom-measurement-await-layer", {
            reason: "measurement-layer-not-mounted",
          });
          return;
        }

        const committedBefore = sessionRef.current.committed;
        const targetBefore = sessionRef.current.target;
        const result = reconcileMorphChange({
          root: ref.current,
          measurementLayer: measurementLayerRef.current,
          measurementBackend,
          snapshotOverride: null,
          text,
          renderText,
          segments,
          layoutContext,
          stateStage: state.stage,
          visibleMeasurement: state.measurement,
          session: sessionRef.current,
          timeline: timelineRef.current,
          setState,
        });
        if (result !== null) {
          logMeasurementReconcile({
            reason: "live-layer",
            committedBefore,
            targetBefore,
            result,
          });
          if (canCacheMeasurementLayerSnapshotModel(measurementBackend)) {
            rememberCachedMorphSnapshot(
              domMeasurementSnapshotCacheRef.current,
              domMeasurementKey,
              result.nextMeasurement.snapshot,
            );
          }
        }
        completedDomMeasurementKeyRef.current = domMeasurementKey;

        if (domMeasurementRequestKey !== null) {
          logTransitionTrace("effect:dom-measurement-request-update", {
            reason: "clear-after-live-measurement",
            nextDomMeasurementRequestKey: null,
            snapshotSource: "layer",
          });
          setDomMeasurementRequestKey(null);
        }
        return;
      }

      if (domMeasurementRequestKey !== null) {
        logTransitionTrace("effect:dom-measurement-request-update", {
          reason: "clear-completed-measurement",
          nextDomMeasurementRequestKey: null,
        });
        setDomMeasurementRequestKey(null);
      }
      return;
    }

    completedDomMeasurementKeyRef.current = null;
    if (domMeasurementRequestKey !== null) {
      logTransitionTrace("effect:dom-measurement-request-update", {
        reason: "clear-no-dom-measurement-needed",
        nextDomMeasurementRequestKey: null,
      });
      setDomMeasurementRequestKey(null);
    }

    const committedBefore = sessionRef.current.committed;
    const targetBefore = sessionRef.current.target;
    const result = reconcileMorphChange({
      root: ref.current,
      measurementLayer: measurementLayerRef.current,
      measurementBackend,
      snapshotOverride: null,
      text,
      renderText,
      segments,
      layoutContext,
      stateStage: state.stage,
      visibleMeasurement: state.measurement,
      session: sessionRef.current,
      timeline: timelineRef.current,
      setState,
    });
    if (result !== null) {
      logMeasurementReconcile({
        reason: "no-dom-measurement",
        committedBefore,
        targetBefore,
        result,
      });
    }
  }, [
    text,
    renderText,
    segments,
    layoutContext,
    motionFrameVersion,
    measurementBackend,
    measurementRequest,
    domMeasurementKey,
    domMeasurementRequestKey,
  ]);

  useLayoutEffect(() => {
    const config = readTorphDebugConfig();
    if (!shouldRunTorphInstrumentation(config)) {
      debugDriftSignatureRef.current = null;
      return;
    }

    if (state.stage !== "idle" || state.measurement === null) {
      debugDriftSignatureRef.current = null;
      return;
    }

    const root = ref.current;
    const flowTextNode = flowTextRef.current;
    if (root === null || flowTextNode === null) {
      debugDriftSignatureRef.current = null;
      return;
    }

    const liveSnapshot = measureLiveFlowSnapshot(root, flowTextNode);
    if (liveSnapshot === null) {
      debugDriftSignatureRef.current = null;
      return;
    }

    const drift = measureSnapshotDrift(state.measurement.snapshot, liveSnapshot);
    const hasDrift =
      drift.expectedGlyphs !== drift.actualGlyphs ||
      Math.abs(drift.snapshotWidthDelta) > MORPH.geometryEpsilon ||
      drift.maxAbsLeftDelta > MORPH.geometryEpsilon ||
      drift.maxAbsTopDelta > MORPH.geometryEpsilon ||
      drift.maxAbsWidthDelta > MORPH.geometryEpsilon ||
      drift.maxAbsHeightDelta > MORPH.geometryEpsilon;

    if (!hasDrift) {
      debugDriftSignatureRef.current = null;
      return;
    }

    const signature = JSON.stringify({
      text,
      renderText: state.measurement.snapshot.renderText,
      drift: summarizeSnapshotDrift(drift),
    });
    if (debugDriftSignatureRef.current === signature) {
      return;
    }

    debugDriftSignatureRef.current = signature;
    logTorphDebug(debugInstanceIdRef.current!, "effect:idle-flow-drift", {
      text,
      expected: summarizeDebugSnapshot(state.measurement.snapshot),
      actual: summarizeDebugSnapshot(liveSnapshot),
      drift: summarizeSnapshotDrift(drift),
    });
  }, [state, text]);

  useLayoutEffect(() => {
    return () => {
      cancelTimelineModel(timelineRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (state.stage !== "prepare") {
      return;
    }

    const readPreparedState = () => {
      const current = latestStateRef.current;
      if (current.stage !== "prepare" || current.measurement === null || current.plan === null) {
        return null;
      }

      return {
        measurement: current.measurement,
        plan: current.plan,
      } satisfies PreparedMorphSnapshot;
    };

    const refinePreparedState = (reason: string) => {
      const currentRoot = ref.current;
      const preparedState = readPreparedState();
      if (currentRoot === null || preparedState === null) {
        return null;
      }

      const refinement = readPreparedMorphRefinement(currentRoot, preparedState);
      if (
        sessionRef.current.animating &&
        sessionRef.current.target !== null &&
        sessionRef.current.target.snapshot.renderText ===
          preparedState.measurement.snapshot.renderText
      ) {
        sessionRef.current.target = refinement.measurement;
      }

      if (refinement.changed) {
        logTransitionTrace("effect:prepare-refine", {
          reason,
          preparedOrigin: {
            left: roundDebugValue(refinement.origin.left),
            top: roundDebugValue(refinement.origin.top),
          },
          refinedMeasurement: summarizeDebugMeasurement(refinement.measurement),
          refinedVisualBridge: {
            offsetX: roundDebugValue(refinement.plan.visualBridge.offsetX),
            offsetY: roundDebugValue(refinement.plan.visualBridge.offsetY),
          },
        });
        setState((current) => {
          if (
            current.stage !== "prepare" ||
            current.measurement !== preparedState.measurement ||
            current.plan !== preparedState.plan
          ) {
            return current;
          }

          return {
            ...current,
            measurement: refinement.measurement,
            plan: refinement.plan,
          };
        });
      }

      return refinement;
    };

    refinePreparedState("prepare-layout");

    timelineRef.current.prepareFrame = requestAnimationFrame(() => {
      timelineRef.current.prepareFrame = null;
      refinePreparedState("prepare-frame");
      timelineRef.current.animateFrame = requestAnimationFrame(() => {
        timelineRef.current.animateFrame = null;
        const animateFrameRefinement = refinePreparedState("animate-frame");
        if (animateFrameRefinement === null) {
          return;
        }

        logTransitionTrace("effect:prepare-animate", {
          preparedOrigin: {
            left: roundDebugValue(animateFrameRefinement.origin.left),
            top: roundDebugValue(animateFrameRefinement.origin.top),
          },
          visualBridge: {
            offsetX: roundDebugValue(animateFrameRefinement.plan.visualBridge.offsetX),
            offsetY: roundDebugValue(animateFrameRefinement.plan.visualBridge.offsetY),
          },
        });
        setState((current) => {
          if (
            current.stage !== "prepare" ||
            current.measurement === null ||
            current.plan === null
          ) {
            return current;
          }

          return {
            stage: "animate",
            measurement: animateFrameRefinement.measurement,
            plan: animateFrameRefinement.plan,
          };
        });
      });
    });

    return () => {
      if (timelineRef.current.prepareFrame !== null) {
        cancelAnimationFrame(timelineRef.current.prepareFrame);
        timelineRef.current.prepareFrame = null;
      }

      if (timelineRef.current.animateFrame !== null) {
        cancelAnimationFrame(timelineRef.current.animateFrame);
        timelineRef.current.animateFrame = null;
      }
    };
  }, [state.stage]);

  const finalizeMorphTransition = (measurement: MorphMeasurement, reason: string) => {
    logTransitionTrace("effect:finalize-trigger", {
      reason,
      measurement: summarizeDebugMeasurement(measurement),
    });
    finalizeMorphTransitionModel({
      session: sessionRef.current,
      timeline: timelineRef.current,
      measurement,
      setState,
    });
  };

  return {
    debugInstanceId: debugInstanceIdRef.current,
    debugRenderOrdinal,
    committedMeasurement: sessionRef.current.committed,
    domMeasurementRequestKey,
    flowTextRef,
    ref,
    measurementLayerRef,
    measurementBackend,
    domMeasurementKey,
    renderText,
    segments,
    layoutContext,
    state,
    useContentInlineSize,
    finalizeMorphTransition,
    timelineRef,
  };
}

function ActiveTorph({
  text,
  className,
  debugLabel = null,
  debugMeta = null,
  onStageChange,
}: {
  text: string;
  className?: string;
  debugLabel?: string | null;
  debugMeta?: Record<string, unknown> | null;
  onStageChange?: (stage: MorphStage) => void;
}) {
  const debugRenderOrdinalRef = useRef(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const debugFinalizeSignatureRef = useRef<string | null>(null);
  const debugFrameHandleRef = useRef<number | null>(null);
  const debugFrameOrdinalRef = useRef(0);
  const debugAnimateTailFramesRef = useRef<Array<Record<string, unknown>>>([]);
  const debugIdlePostFrameHandleRef = useRef<number | null>(null);
  const debugIdlePostFrameOrdinalRef = useRef(0);
  const debugIdlePostFrameTokenRef = useRef(0);
  const debugPendingIdlePostFramesRef = useRef(false);
  const debugPreviousStageRef = useRef<MorphStage | null>(null);
  debugRenderOrdinalRef.current += 1;
  const debugRenderOrdinal = debugRenderOrdinalRef.current;
  const {
    debugInstanceId,
    debugRenderOrdinal: hookRenderOrdinal,
    committedMeasurement,
    domMeasurementRequestKey,
    domMeasurementKey,
    flowTextRef,
    ref,
    measurementLayerRef,
    measurementBackend,
    renderText,
    segments,
    layoutContext,
    state,
    useContentInlineSize,
    finalizeMorphTransition,
    timelineRef,
  } = useMorphTransition(text, className, debugLabel, debugMeta);
  const plan = state.plan;
  const visibleGlyphPlan: MorphRenderPlan | null = plan;

  let sourceSliceWhiteSpace: "inherit" | "nowrap" = "inherit";
  if (committedMeasurement !== null) {
    sourceSliceWhiteSpace = resolveGlyphSliceWhiteSpaceModel(committedMeasurement.snapshot);
  }

  let targetSliceWhiteSpace: "inherit" | "nowrap" = "inherit";
  if (state.measurement !== null) {
    targetSliceWhiteSpace = resolveGlyphSliceWhiteSpaceModel(state.measurement.snapshot);
  }

  const shouldRenderGlyphLayer = shouldRenderGlyphLayerModel(
    state.stage,
    visibleGlyphPlan,
    state.measurement,
  );
  const shouldHideFlowText = shouldRenderGlyphLayer;
  const shouldRenderMeasurementLayer = domMeasurementRequestKey !== null;
  const flowText = resolveFlowTextModel(committedMeasurement, state.measurement, text);

  useLayoutEffect(() => {
    const config = readTorphDebugConfig();
    if (!shouldRunTorphInstrumentation(config)) {
      return;
    }

    logTorphDebug(debugInstanceId, "effect:trace-meta", {
      traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
      debugLabel,
      debugMeta,
      includesIdlePostFrame: true,
      includesIdlePostFrameLifecycle: true,
      includesViewportAnchors: true,
      includesRootOriginRefine: true,
      includesFullGlyphLayouts: true,
      includesIdleVisibleGlyphLayer: false,
      includesPreciseGlyphGeometry: true,
      includesAnimateTailFrames: true,
      includesLiveNodeStyles: true,
    });
  }, [debugInstanceId]);

  useLayoutEffect(() => {
    const config = readTorphDebugConfig();
    if (!shouldRunTorphInstrumentation(config)) {
      debugFinalizeSignatureRef.current = null;
      return;
    }

    if (state.stage !== "animate" || state.measurement === null || plan === null) {
      debugFinalizeSignatureRef.current = null;
    }
  }, [plan, state.measurement, state.stage]);

  const logAnimateFinalizeSnapshot = (
    measurement: MorphMeasurement,
    resolvedMeasurementSource: "target" | "overlay-live" | "flow-live",
    activePlan: MorphRenderPlan,
    reason: "transitionend" | "watchdog-timeout",
    barrier: MorphFinalizeBarrier,
    signal: MorphFinalizeSignal | null,
    event?: TransitionEvent,
  ) => {
    const config = readTorphDebugConfig();
    if (!shouldRunTorphInstrumentation(config)) {
      return;
    }

    const root = ref.current;
    const overlayNode = overlayRef.current;
    const flowNode = flowTextRef.current;
    if (root === null || overlayNode === null || flowNode === null) {
      return;
    }

    const overlayLiveSnapshot = measureOverlayBoxSnapshot(root, overlayNode, "live");
    const overlayExitSnapshot = measureOverlayBoxSnapshot(root, overlayNode, "exit");
    const flowSnapshot = measureLiveFlowSnapshot(root, flowNode);
    if (overlayLiveSnapshot === null || flowSnapshot === null) {
      return;
    }

    const overlayLiveDrift = measureSnapshotDrift(measurement.snapshot, overlayLiveSnapshot);
    const flowDrift = measureSnapshotDrift(measurement.snapshot, flowSnapshot);
    const rootRect = root.getBoundingClientRect();
    const flowRect = flowNode.getBoundingClientRect();
    const overlayRect = overlayNode.getBoundingClientRect();
    const signature = JSON.stringify({
      text,
      renderText: measurement.snapshot.renderText,
      reason,
      signal,
      barrier: summarizeMorphFinalizeBarrierModel(barrier),
      overlayLiveDrift: summarizeSnapshotDrift(overlayLiveDrift),
      flowDrift: summarizeSnapshotDrift(flowDrift),
      overlayWidth: roundDebugValue(overlayRect.width),
      rootWidth: roundDebugValue(rootRect.width),
    });
    if (debugFinalizeSignatureRef.current === signature) {
      return;
    }

    debugFinalizeSignatureRef.current = signature;
    let morphRole: string | null = null;
    let morphKey: string | null = null;
    let morphGlyph: string | null = null;
    const target = event?.target;
    if (target instanceof HTMLElement) {
      morphRole = target.dataset.morphRole ?? null;
      morphKey = target.dataset.morphKey ?? null;
      morphGlyph = target.dataset.morphGlyph ?? null;
    }

    logTorphDebug(debugInstanceId, "effect:animate-finalize-snapshot", {
      text,
      resolvedMeasurementSource,
      reason,
      propertyName: event?.propertyName ?? null,
      finalizeSignal: signal,
      morphRole,
      morphKey,
      morphGlyph,
      barrier: summarizeMorphFinalizeBarrierModel(barrier),
      target: {
        layoutInlineSize: roundDebugValue(measurement.layoutInlineSize),
        reservedInlineSize: roundDebugValue(measurement.reservedInlineSize),
        flowInlineSize: roundDebugValue(measurement.flowInlineSize),
        rootOrigin: {
          left: roundDebugValue(measurement.rootOrigin.left),
          top: roundDebugValue(measurement.rootOrigin.top),
        },
        snapshot: summarizeDebugSnapshot(measurement.snapshot),
      },
      plan: {
        frameWidth: roundDebugValue(activePlan.frameWidth),
        frameHeight: roundDebugValue(activePlan.frameHeight),
        layoutInlineSizeFrom: roundDebugValue(activePlan.layoutInlineSizeFrom),
        layoutInlineSizeTo: roundDebugValue(activePlan.layoutInlineSizeTo),
        sourceRenderText: activePlan.sourceRenderText,
        targetRenderText: activePlan.targetRenderText,
      },
      overlayLive: summarizeDebugSnapshot(overlayLiveSnapshot),
      overlayLiveGlyphs: summarizeDebugGlyphs(overlayLiveSnapshot),
      overlayLiveGlyphsPrecise: summarizePreciseGlyphs(overlayLiveSnapshot, rootRect),
      overlayLiveDrift: summarizeSnapshotDrift(overlayLiveDrift),
      overlayExit: summarizeDebugSnapshot(overlayExitSnapshot),
      overlayExitGlyphs: summarizeDebugGlyphs(overlayExitSnapshot),
      flow: summarizeDebugSnapshot(flowSnapshot),
      flowGlyphs: summarizeDebugGlyphs(flowSnapshot),
      flowGlyphsPrecise: summarizePreciseGlyphs(flowSnapshot, rootRect),
      flowDrift: summarizeSnapshotDrift(flowDrift),
      rootOriginDrift: summarizeDebugRootOriginDrift(measurement, rootRect),
      overlayLiveViewportAnchors: summarizeDebugViewportAnchors(overlayLiveSnapshot, rootRect),
      overlayExitViewportAnchors: summarizeDebugViewportAnchors(overlayExitSnapshot, rootRect),
      flowViewportAnchors: summarizeDebugViewportAnchors(flowSnapshot, rootRect),
      rootBox: {
        width: roundDebugValue(rootRect.width),
        height: roundDebugValue(rootRect.height),
      },
      overlayBox: {
        width: roundDebugValue(overlayRect.width),
        height: roundDebugValue(overlayRect.height),
      },
      flowBox: {
        width: roundDebugValue(flowRect.width),
        height: roundDebugValue(flowRect.height),
      },
      rootBoxPrecise: summarizePreciseRect(rootRect),
      overlayBoxPrecise: summarizePreciseRect(overlayRect),
      flowBoxPrecise: summarizePreciseRect(flowRect),
      rootRuntimeStyles: summarizeRootRuntimeStyles(root),
      overlayLiveNodeStyles: summarizeLiveNodeStyles(overlayNode),
      animateTailFrames: debugAnimateTailFramesRef.current,
    });
    debugAnimateTailFramesRef.current = [];
  };

  useLayoutEffect(() => {
    if (state.stage !== "animate" || state.measurement === null || plan === null) {
      return;
    }

    const root = ref.current;
    if (root === null) {
      return;
    }

    const measurement = state.measurement;
    const hasMoveTransitions = plan.liveItems.some((item) => item.kind === "move");
    let barrier = createMorphFinalizeBarrierModel(hasMoveTransitions);
    let finalizeCommitted = false;
    let finalizeFrame: number | null = null;
    const armedAt = performance.now();
    const finalizeNow = (
      reason: "transitionend" | "watchdog-timeout",
      signal: MorphFinalizeSignal | null,
      barrierState: MorphFinalizeBarrier,
      event?: TransitionEvent,
    ) => {
      if (finalizeCommitted) {
        return;
      }

      finalizeCommitted = true;
      if (timelineRef.current.finalizeTimer !== null) {
        window.clearTimeout(timelineRef.current.finalizeTimer);
        timelineRef.current.finalizeTimer = null;
      }

      const target = event?.target;
      let morphRole: string | null = null;
      let morphKey: string | null = null;
      let morphGlyph: string | null = null;
      if (target instanceof HTMLElement) {
        morphRole = target.dataset.morphRole ?? null;
        morphKey = target.dataset.morphKey ?? null;
        morphGlyph = target.dataset.morphGlyph ?? null;
      }

      const rootNode = ref.current;
      const overlayNode = overlayRef.current;
      const flowNode = flowTextRef.current;
      let overlayLiveSnapshot = null;
      if (rootNode !== null && overlayNode !== null) {
        overlayLiveSnapshot = measureOverlayBoxSnapshot(rootNode, overlayNode, "live");
      }

      let flowSnapshot = null;
      if (rootNode !== null && flowNode !== null) {
        flowSnapshot = measureLiveFlowSnapshot(rootNode, flowNode);
      }

      const resolvedMeasurementSource =
        overlayLiveSnapshot !== null
          ? "overlay-live"
          : flowSnapshot !== null
            ? "flow-live"
            : "target";
      const resolvedMeasurement =
        rootNode === null
          ? measurement
          : resolveFinalizeMeasurementModel({
              measurement,
              rootOrigin: readRootOrigin(rootNode),
              visibleSnapshot: overlayLiveSnapshot,
              fallbackSnapshot: flowSnapshot,
            });

      logAnimateFinalizeSnapshot(
        resolvedMeasurement,
        resolvedMeasurementSource,
        plan,
        reason,
        barrierState,
        signal,
        event,
      );
      finalizeMorphTransition(resolvedMeasurement, reason);
      const config = readTorphDebugConfig();
      if (!shouldRunTorphInstrumentation(config)) {
        return;
      }

      logTorphDebug(debugInstanceId, "effect:finalize-authority", {
        text,
        resolvedMeasurementSource,
        reason,
        propertyName: event?.propertyName ?? null,
        morphRole,
        morphKey,
        morphGlyph,
        elapsedMs: roundDebugValue(performance.now() - armedAt),
        hasMoveTransitions,
        finalizeSignal: signal,
        barrier: summarizeMorphFinalizeBarrierModel(barrierState),
        measurement: summarizeDebugMeasurement(resolvedMeasurement),
      });
    };

    const tryFinalize = (
      reason: "transitionend" | "watchdog-timeout",
      signal: MorphFinalizeSignal | null,
      barrierState: MorphFinalizeBarrier,
      event?: TransitionEvent,
    ) => {
      if (finalizeCommitted) {
        return;
      }
      finalizeNow(reason, signal, barrierState, event);
    };

    const scheduleFinalize = (
      reason: "transitionend" | "watchdog-timeout",
      signal: MorphFinalizeSignal | null,
      barrierState: MorphFinalizeBarrier,
      event?: TransitionEvent,
    ) => {
      if (finalizeCommitted || finalizeFrame !== null) {
        return;
      }

      logTorphDebug(debugInstanceId, "effect:finalize-raf-schedule", {
        text,
        debugLabel,
        reason,
        propertyName: event?.propertyName ?? null,
        finalizeSignal: signal,
        elapsedMs: roundDebugValue(performance.now() - armedAt),
        barrier: summarizeMorphFinalizeBarrierModel(barrierState),
      });

      finalizeFrame = requestAnimationFrame(() => {
        finalizeFrame = null;
        tryFinalize(reason, signal, barrierState, event);
      });
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      const signal = resolveMorphFinalizeSignal(event, hasMoveTransitions);
      if (signal === null) {
        return;
      }

      barrier = recordMorphFinalizeSignalModel(barrier, signal);
      const target = event.target;
      let morphRole: string | null = null;
      let morphKey: string | null = null;
      let morphGlyph: string | null = null;
      if (target instanceof HTMLElement) {
        morphRole = target.dataset.morphRole ?? null;
        morphKey = target.dataset.morphKey ?? null;
        morphGlyph = target.dataset.morphGlyph ?? null;
      }

      logTorphDebug(debugInstanceId, "effect:finalize-barrier-progress", {
        text,
        propertyName: event.propertyName,
        signal,
        morphRole,
        morphKey,
        morphGlyph,
        elapsedMs: roundDebugValue(performance.now() - armedAt),
        barrier: summarizeMorphFinalizeBarrierModel(barrier),
      });

      if (!isMorphFinalizeBarrierSatisfiedModel(barrier)) {
        return;
      }

      scheduleFinalize("transitionend", signal, barrier, event);
    };

    root.addEventListener("transitionend", onTransitionEnd);
    if (timelineRef.current.finalizeTimer !== null) {
      window.clearTimeout(timelineRef.current.finalizeTimer);
    }
    timelineRef.current.finalizeTimer = window.setTimeout(() => {
      timelineRef.current.finalizeTimer = null;
      scheduleFinalize("watchdog-timeout", null, barrier);
    }, MORPH.durationMs + 32);

    return () => {
      root.removeEventListener("transitionend", onTransitionEnd);
      if (finalizeFrame !== null) {
        cancelAnimationFrame(finalizeFrame);
        finalizeFrame = null;
      }
      if (timelineRef.current.finalizeTimer !== null) {
        window.clearTimeout(timelineRef.current.finalizeTimer);
        timelineRef.current.finalizeTimer = null;
      }
    };
  }, [
    debugInstanceId,
    finalizeMorphTransition,
    plan,
    state.measurement,
    state.stage,
    text,
    timelineRef,
  ]);

  useLayoutEffect(() => {
    const config = readTorphDebugConfig();
    if (!shouldRunTorphInstrumentation(config)) {
      debugPendingIdlePostFramesRef.current = false;
      debugPreviousStageRef.current = state.stage;
      return;
    }

    const previousStage = debugPreviousStageRef.current;
    if (previousStage !== state.stage) {
      if (state.stage === "idle") {
        debugPendingIdlePostFramesRef.current = true;
        debugIdlePostFrameTokenRef.current += 1;
      } else {
        debugPendingIdlePostFramesRef.current = false;
      }

      logTorphDebug(debugInstanceId, "effect:stage-transition", {
        traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
        renderOrdinal: debugRenderOrdinal,
        text,
        fromStage: previousStage,
        toStage: state.stage,
        committed: summarizeDebugMeasurement(committedMeasurement),
        stateMeasurement: summarizeDebugMeasurement(state.measurement),
        flowText,
        domMeasurementRequestKey,
        domMeasurementKey,
        measurementBackend,
      });
      debugPreviousStageRef.current = state.stage;
    }
  }, [committedMeasurement, debugInstanceId, flowText, state, text]);

  useLayoutEffect(() => {
    onStageChange?.(state.stage);
  }, [onStageChange, state.stage]);

  useLayoutEffect(() => {
    const config = readTorphDebugConfig();
    if (!shouldRunTorphInstrumentation(config)) {
      if (debugFrameHandleRef.current !== null) {
        cancelAnimationFrame(debugFrameHandleRef.current);
        debugFrameHandleRef.current = null;
      }
      debugAnimateTailFramesRef.current = [];
      return;
    }

    if (state.stage === "idle" || state.measurement === null) {
      if (debugFrameHandleRef.current !== null) {
        cancelAnimationFrame(debugFrameHandleRef.current);
        debugFrameHandleRef.current = null;
      }
      debugFrameOrdinalRef.current = 0;
      debugAnimateTailFramesRef.current = [];
      return;
    }

    debugFrameOrdinalRef.current = 0;
    const measurement = state.measurement;
    let cancelled = false;

    const captureFrame = () => {
      if (cancelled) {
        return;
      }

      const root = ref.current;
      const flowNode = flowTextRef.current;
      const overlayNode = overlayRef.current;
      let rootRect: DOMRect | null = null;
      if (root !== null) {
        rootRect = root.getBoundingClientRect();
      }

      let flowRect: DOMRect | null = null;
      if (flowNode !== null) {
        flowRect = flowNode.getBoundingClientRect();
      }

      let overlayRect: DOMRect | null = null;
      if (overlayNode !== null) {
        overlayRect = overlayNode.getBoundingClientRect();
      }

      let overlayLiveSnapshot: MorphSnapshot | null = null;
      if (root !== null && overlayNode !== null) {
        overlayLiveSnapshot = measureOverlayBoxSnapshot(root, overlayNode, "live");
      }

      let overlayExitSnapshot: MorphSnapshot | null = null;
      if (root !== null && overlayNode !== null) {
        overlayExitSnapshot = measureOverlayBoxSnapshot(root, overlayNode, "exit");
      }

      let flowSnapshot: MorphSnapshot | null = null;
      if (root !== null && flowNode !== null) {
        flowSnapshot = measureLiveFlowSnapshot(root, flowNode);
      }
      let overlayLiveDrift: ReturnType<typeof summarizeSnapshotDrift> | null = null;
      if (overlayLiveSnapshot !== null) {
        overlayLiveDrift = summarizeSnapshotDrift(
          measureSnapshotDrift(measurement.snapshot, overlayLiveSnapshot),
        );
      }
      let flowDrift: ReturnType<typeof summarizeSnapshotDrift> | null = null;
      if (flowSnapshot !== null) {
        flowDrift = summarizeSnapshotDrift(
          measureSnapshotDrift(measurement.snapshot, flowSnapshot),
        );
      }

      debugAnimateTailFramesRef.current.push({
        frame: debugFrameOrdinalRef.current,
        stateStage: state.stage,
        rootBoxPrecise: summarizePreciseRect(rootRect),
        overlayBoxPrecise: summarizePreciseRect(overlayRect),
        flowBoxPrecise: summarizePreciseRect(flowRect),
        overlayLiveGlyphsPrecise: summarizePreciseGlyphs(overlayLiveSnapshot, rootRect),
        flowGlyphsPrecise: summarizePreciseGlyphs(flowSnapshot, rootRect),
        overlayLiveNodeStyles: summarizeLiveNodeStyles(overlayNode),
      });
      if (debugAnimateTailFramesRef.current.length > 8) {
        debugAnimateTailFramesRef.current.shift();
      }

      let planSummary: Record<string, unknown> | null = null;
      if (plan !== null) {
        planSummary = {
          frameWidth: roundDebugValue(plan.frameWidth),
          frameHeight: roundDebugValue(plan.frameHeight),
          layoutInlineSizeFrom: roundDebugValue(plan.layoutInlineSizeFrom),
          layoutInlineSizeTo: roundDebugValue(plan.layoutInlineSizeTo),
          sourceRenderText: plan.sourceRenderText,
          targetRenderText: plan.targetRenderText,
          visualBridge: {
            offsetX: roundDebugValue(plan.visualBridge.offsetX),
            offsetY: roundDebugValue(plan.visualBridge.offsetY),
          },
          liveItems: plan.liveItems.length,
          exitItems: plan.exitItems.length,
        };
      }

      logTorphDebug(debugInstanceId, "effect:frame-snapshot", {
        text,
        frame: debugFrameOrdinalRef.current,
        stateStage: state.stage,
        propText: text,
        flowText,
        committed: summarizeDebugMeasurement(committedMeasurement),
        stateMeasurement: summarizeDebugMeasurement(measurement),
        plan: planSummary,
        rootBox: summarizeDebugRect(rootRect),
        overlayBox: summarizeDebugRect(overlayRect),
        flowBox: summarizeDebugRect(flowRect),
        rootOriginDrift: summarizeDebugRootOriginDrift(measurement, rootRect),
        overlayLive: summarizeDebugSnapshot(overlayLiveSnapshot),
        overlayLiveGlyphs: summarizeDebugGlyphs(overlayLiveSnapshot),
        overlayLiveViewportAnchors: summarizeDebugViewportAnchors(overlayLiveSnapshot, rootRect),
        overlayLiveDrift,
        overlayExit: summarizeDebugSnapshot(overlayExitSnapshot),
        overlayExitGlyphs: summarizeDebugGlyphs(overlayExitSnapshot),
        overlayExitViewportAnchors: summarizeDebugViewportAnchors(overlayExitSnapshot, rootRect),
        flow: summarizeDebugSnapshot(flowSnapshot),
        flowGlyphs: summarizeDebugGlyphs(flowSnapshot),
        flowViewportAnchors: summarizeDebugViewportAnchors(flowSnapshot, rootRect),
        flowDrift,
        rootRuntimeStyles: summarizeRootRuntimeStyles(root),
      });

      debugFrameOrdinalRef.current += 1;
      debugFrameHandleRef.current = requestAnimationFrame(captureFrame);
    };

    debugFrameHandleRef.current = requestAnimationFrame(captureFrame);
    return () => {
      cancelled = true;
      if (debugFrameHandleRef.current !== null) {
        cancelAnimationFrame(debugFrameHandleRef.current);
        debugFrameHandleRef.current = null;
      }
    };
  }, [committedMeasurement, debugInstanceId, flowText, plan, ref, state, text]);

  useLayoutEffect(() => {
    const config = readTorphDebugConfig();
    if (!shouldRunTorphInstrumentation(config)) {
      debugPendingIdlePostFramesRef.current = false;
      if (debugIdlePostFrameHandleRef.current !== null) {
        logTorphDebug(debugInstanceId, "effect:idle-post-frame-cleanup", {
          traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
          reason: "instrumentation-disabled",
          renderOrdinal: debugRenderOrdinal,
          hookRenderOrdinal,
          token: debugIdlePostFrameTokenRef.current,
          handle: debugIdlePostFrameHandleRef.current,
          domMeasurementRequestKey,
          domMeasurementKey,
          measurementBackend,
        });
        cancelAnimationFrame(debugIdlePostFrameHandleRef.current);
        debugIdlePostFrameHandleRef.current = null;
      }
      return;
    }

    if (!debugPendingIdlePostFramesRef.current) {
      return;
    }

    if (state.stage !== "idle" || state.measurement === null) {
      return;
    }

    debugIdlePostFrameOrdinalRef.current = 0;
    const token = debugIdlePostFrameTokenRef.current;
    const scheduledRenderOrdinal = debugRenderOrdinal;
    const scheduledHookRenderOrdinal = hookRenderOrdinal;
    const measurement = state.measurement;
    let remainingFrames = 3;
    let cancelled = false;

    logTorphDebug(debugInstanceId, "effect:idle-post-frame-arm", {
      traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
      renderOrdinal: scheduledRenderOrdinal,
      hookRenderOrdinal: scheduledHookRenderOrdinal,
      token,
      text,
      stateStage: state.stage,
      flowText,
      committed: summarizeDebugMeasurement(committedMeasurement),
      stateMeasurement: summarizeDebugMeasurement(measurement),
      domMeasurementRequestKey,
      domMeasurementKey,
      measurementBackend,
    });

    const captureIdlePostFrame = () => {
      if (cancelled) {
        return;
      }

      if (debugPendingIdlePostFramesRef.current) {
        debugPendingIdlePostFramesRef.current = false;
      }

      logTorphDebug(debugInstanceId, "effect:idle-post-frame-fire", {
        traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
        renderOrdinal: debugRenderOrdinalRef.current,
        hookRenderOrdinal,
        scheduledRenderOrdinal,
        scheduledHookRenderOrdinal,
        token,
        frame: debugIdlePostFrameOrdinalRef.current,
        remainingFrames,
        text,
        stateStage: state.stage,
        flowText,
      });

      const root = ref.current;
      const flowNode = flowTextRef.current;
      const overlayNode = overlayRef.current;
      if (root === null || flowNode === null || overlayNode === null) {
        logTorphDebug(debugInstanceId, "effect:idle-post-frame-skip", {
          traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
          renderOrdinal: debugRenderOrdinalRef.current,
          hookRenderOrdinal,
          scheduledRenderOrdinal,
          scheduledHookRenderOrdinal,
          token,
          text,
          stateStage: state.stage,
          frame: debugIdlePostFrameOrdinalRef.current,
          hasRoot: root !== null,
          hasFlowNode: flowNode !== null,
          hasOverlayNode: overlayNode !== null,
          flowText,
          committed: summarizeDebugMeasurement(committedMeasurement),
          stateMeasurement: summarizeDebugMeasurement(measurement),
        });
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const flowRect = flowNode.getBoundingClientRect();
      const overlayRect = overlayNode.getBoundingClientRect();
      const flowSnapshot = measureLiveFlowSnapshot(root, flowNode);
      let visibleSnapshot: MorphSnapshot | null = null;
      if (overlayNode !== null) {
        visibleSnapshot = measureOverlayBoxSnapshot(root, overlayNode, "live");
      }
      let flowDrift: ReturnType<typeof summarizeSnapshotDrift> | null = null;
      if (flowSnapshot !== null) {
        flowDrift = summarizeSnapshotDrift(
          measureSnapshotDrift(measurement.snapshot, flowSnapshot),
        );
      }
      let visibleDrift: ReturnType<typeof summarizeSnapshotDrift> | null = null;
      if (visibleSnapshot !== null) {
        visibleDrift = summarizeSnapshotDrift(
          measureSnapshotDrift(measurement.snapshot, visibleSnapshot),
        );
      }

      logTorphDebug(debugInstanceId, "effect:idle-post-frame", {
        traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
        renderOrdinal: debugRenderOrdinalRef.current,
        hookRenderOrdinal,
        scheduledRenderOrdinal,
        scheduledHookRenderOrdinal,
        token,
        text,
        frame: debugIdlePostFrameOrdinalRef.current,
        stateStage: state.stage,
        propText: text,
        flowText,
        committed: summarizeDebugMeasurement(committedMeasurement),
        stateMeasurement: summarizeDebugMeasurement(measurement),
        rootBox: summarizeDebugRect(rootRect),
        rootBoxPrecise: summarizePreciseRect(rootRect),
        overlayBox: summarizeDebugRect(overlayRect),
        overlayBoxPrecise: summarizePreciseRect(overlayRect),
        flowBox: summarizeDebugRect(flowRect),
        flowBoxPrecise: summarizePreciseRect(flowRect),
        rootRuntimeStyles: summarizeRootRuntimeStyles(root),
        rootOriginDrift: summarizeDebugRootOriginDrift(measurement, rootRect),
        flow: summarizeDebugSnapshot(flowSnapshot),
        flowGlyphs: summarizeDebugGlyphs(flowSnapshot),
        flowGlyphsPrecise: summarizePreciseGlyphs(flowSnapshot, rootRect),
        flowViewportAnchors: summarizeDebugViewportAnchors(flowSnapshot, rootRect),
        flowDrift,
        visible: summarizeDebugSnapshot(visibleSnapshot),
        visibleGlyphs: summarizeDebugGlyphs(visibleSnapshot),
        visibleGlyphsPrecise: summarizePreciseGlyphs(visibleSnapshot, rootRect),
        visibleViewportAnchors: summarizeDebugViewportAnchors(visibleSnapshot, rootRect),
        visibleDrift,
        visibleLiveNodeStyles: summarizeLiveNodeStyles(overlayNode),
      });

      debugIdlePostFrameOrdinalRef.current += 1;
      remainingFrames -= 1;
      if (remainingFrames <= 0) {
        debugIdlePostFrameHandleRef.current = null;
        return;
      }

      debugIdlePostFrameHandleRef.current = requestAnimationFrame(captureIdlePostFrame);
      logTorphDebug(debugInstanceId, "effect:idle-post-frame-reschedule", {
        traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
        renderOrdinal: debugRenderOrdinalRef.current,
        hookRenderOrdinal,
        scheduledRenderOrdinal,
        scheduledHookRenderOrdinal,
        token,
        handle: debugIdlePostFrameHandleRef.current,
        nextFrame: debugIdlePostFrameOrdinalRef.current,
        remainingFrames,
        text,
        stateStage: state.stage,
        flowText,
      });
    };

    debugIdlePostFrameHandleRef.current = requestAnimationFrame(captureIdlePostFrame);
    logTorphDebug(debugInstanceId, "effect:idle-post-frame-schedule", {
      traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
      renderOrdinal: scheduledRenderOrdinal,
      hookRenderOrdinal: scheduledHookRenderOrdinal,
      token,
      handle: debugIdlePostFrameHandleRef.current,
      remainingFrames,
      text,
      stateStage: state.stage,
      flowText,
      domMeasurementRequestKey,
      domMeasurementKey,
      measurementBackend,
    });
    return () => {
      cancelled = true;
      if (debugIdlePostFrameHandleRef.current !== null) {
        logTorphDebug(debugInstanceId, "effect:idle-post-frame-cleanup", {
          traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
          reason: "effect-rerun-or-unmount",
          renderOrdinal: debugRenderOrdinalRef.current,
          hookRenderOrdinal,
          scheduledRenderOrdinal,
          scheduledHookRenderOrdinal,
          token,
          handle: debugIdlePostFrameHandleRef.current,
          completedFrames: debugIdlePostFrameOrdinalRef.current,
          remainingFrames,
          text,
          stateStage: state.stage,
          flowText,
          domMeasurementRequestKey,
          domMeasurementKey,
          measurementBackend,
        });
        cancelAnimationFrame(debugIdlePostFrameHandleRef.current);
        debugIdlePostFrameHandleRef.current = null;
      }
    };
  }, [committedMeasurement, debugInstanceId, flowText, ref, state, text]);

  useLayoutEffect(() => {
    return () => {
      if (debugIdlePostFrameHandleRef.current !== null) {
        logTorphDebug(debugInstanceId, "effect:idle-post-frame-cleanup", {
          traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
          reason: "component-unmount",
          renderOrdinal: debugRenderOrdinalRef.current,
          token: debugIdlePostFrameTokenRef.current,
          handle: debugIdlePostFrameHandleRef.current,
        });
        cancelAnimationFrame(debugIdlePostFrameHandleRef.current);
        debugIdlePostFrameHandleRef.current = null;
      }
    };
  }, []);

  let measurementLayer: ReactElement | null = null;
  if (shouldRenderMeasurementLayer) {
    measurementLayer = (
      <MeasurementLayer
        layerRef={measurementLayerRef}
        layoutContext={layoutContext}
        text={renderText}
        useContentInlineSize={useContentInlineSize}
        debugInstanceId={debugInstanceId}
        debugLabel={debugLabel}
      />
    );
  }

  let overlay: ReactElement | null = null;
  if (shouldRenderGlyphLayer && visibleGlyphPlan !== null) {
    overlay = (
      <MorphOverlay
        overlayRef={overlayRef}
        stage={state.stage}
        plan={visibleGlyphPlan}
        sourceSliceWhiteSpace={sourceSliceWhiteSpace}
        targetSliceWhiteSpace={targetSliceWhiteSpace}
        debugInstanceId={debugInstanceId}
        debugLabel={debugLabel}
      />
    );
  }

  return (
    <div
      ref={ref}
      className={className}
      data-torph-debug-role="root"
      data-torph-debug-instance-id={String(debugInstanceId)}
      data-torph-debug-label={debugLabel ?? undefined}
      data-torph-debug-stage={state.stage}
      data-torph-debug-text={text}
      style={getRootStyleModel(state.stage, plan, state.measurement, layoutContext)}
    >
      <span style={getScreenReaderOnlyStyle()}>{text}</span>
      <FlowTextLayer
        flowText={flowText}
        flowTextRef={flowTextRef}
        shouldHideFlowText={shouldHideFlowText}
        debugInstanceId={debugInstanceId}
        debugLabel={debugLabel}
      />
      {measurementLayer}
      {overlay}
    </div>
  );
}

export type TorphProps = {
  text: string;
  className?: string;
  debugLabel?: string | null;
  debugMeta?: Record<string, unknown> | null;
  onStageChange?: (stage: MorphStage) => void;
};

export function Torph({
  text,
  className,
  debugLabel = null,
  debugMeta = null,
  onStageChange,
}: TorphProps) {
  return (
    <ActiveTorph
      text={text}
      className={className}
      debugLabel={debugLabel}
      debugMeta={debugMeta}
      onStageChange={onStageChange}
    />
  );
}
