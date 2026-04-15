import {
  type CSSProperties,
  type Dispatch,
  type ReactElement,
  type RefObject,
  type SetStateAction,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";
import {
  type PretextMorphMeasurementBackend,
} from "../utils/text-layout/pretextMorph";
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
  areFontsReady as areFontsReadyModel,
  cancelTimeline as cancelTimelineModel,
  finalizeMorphTransition as finalizeMorphTransitionModel,
  reconcileMorphSessionUpdate as reconcileMorphSessionUpdateModel,
  resetMorph as resetMorphModel,
  resolvePreparedMeasurementOrigin as resolvePreparedMeasurementOriginModel,
  resolvePreparedPlanVisualBridge as resolvePreparedPlanVisualBridgeModel,
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
  createSteadyGlyphPlan as createSteadyGlyphPlanModel,
  getExitTransform as getExitTransformModel,
  getExitTransition as getExitTransitionModel,
  getLiveTransform as getLiveTransformModel,
  getLiveTransition as getLiveTransitionModel,
  getMeasurementLayerStyle as getMeasurementLayerStyleModel,
  getOverlayStyle as getOverlayStyleModel,
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
  type MorphCharacterLayout,
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
  summarizeDebugRect,
  summarizeDebugRootOriginDrift,
  summarizeDebugSnapshot,
  summarizeDebugViewportAnchors,
  summarizeSnapshotDrift,
} from "../debug/trace";

const SCREEN_READER_ONLY_STYLE = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  border: 0,
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  overflow: "hidden",
  whiteSpace: "nowrap",
} satisfies CSSProperties;

const FALLBACK_TEXT_STYLE = {
  display: "block",
  gridArea: "1 / 1",
  whiteSpace: "nowrap",
} satisfies CSSProperties;

const FLOW_TEXT_LAYOUT_STYLE = {
  display: "inline-block",
} satisfies CSSProperties;

const SHARED_GLYPH_TYPOGRAPHY_STYLE = {
  font: "inherit",
  fontKerning: "inherit",
  fontFeatureSettings: "inherit",
  fontOpticalSizing: "inherit",
  fontStretch: "inherit",
  fontStyle: "inherit",
  fontVariant: "inherit",
  fontVariantNumeric: "inherit",
  fontVariationSettings: "inherit",
  fontWeight: "inherit",
  letterSpacing: "inherit",
  textTransform: "inherit",
  wordSpacing: "inherit",
  direction: "inherit",
} satisfies CSSProperties;

const ABSOLUTE_GLYPH_STYLE = {
  position: "absolute",
  display: "block",
  overflow: "hidden",
  transformOrigin: "left top",
} satisfies CSSProperties;

const CONTEXT_SLICE_TEXT_STYLE = {
  ...SHARED_GLYPH_TYPOGRAPHY_STYLE,
  position: "absolute",
  display: "block",
  minWidth: 0,
  whiteSpace: "inherit",
} satisfies CSSProperties;

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

  return reconcileMorphSessionUpdateModel({
    session,
    timeline,
    nextMeasurement,
    fontsReady: areFontsReadyModel(),
    setState,
  });
}

function getLiveOpacity(item: MorphLiveItem, stage: MorphStage) {
  if (stage === "prepare" && item.kind === "enter") {
    return 0;
  }

  return 1;
}

function getExitOpacity(stage: MorphStage) {
  if (stage === "animate") {
    return 0;
  }

  return 1;
}

export function getFallbackTextStyle(shouldHideFlowText: boolean): CSSProperties {
  if (!shouldHideFlowText) {
    return FALLBACK_TEXT_STYLE;
  }

  return {
    ...FALLBACK_TEXT_STYLE,
    visibility: "hidden",
    pointerEvents: "none",
  };
}

function getLiveGlyphStyle(
  item: MorphLiveItem,
  stage: MorphStage,
  visualBridge: MorphVisualBridge,
): CSSProperties {
  return {
    ...ABSOLUTE_GLYPH_STYLE,
    left: item.left,
    top: item.top,
    width: item.width,
    height: item.height,
    opacity: getLiveOpacity(item, stage),
    transform: getLiveTransformModel(item, stage, visualBridge),
    transition: getLiveTransitionModel(item, stage),
  };
}

function getExitGlyphStyle(
  item: MorphCharacterLayout,
  stage: MorphStage,
  visualBridge: MorphVisualBridge,
): CSSProperties {
  return {
    ...ABSOLUTE_GLYPH_STYLE,
    left: item.left,
    top: item.top,
    width: item.width,
    height: item.height,
    opacity: getExitOpacity(stage),
    transform: getExitTransformModel(visualBridge),
    transition: getExitTransitionModel(stage),
  };
}

function getContextSliceStyle(
  layoutInlineSize: number,
  item: MorphCharacterLayout,
  whiteSpace: "inherit" | "nowrap",
): CSSProperties {
  return {
    ...CONTEXT_SLICE_TEXT_STYLE,
    left: -item.left,
    top: -item.top,
    width: layoutInlineSize,
    whiteSpace,
  };
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

function summarizePreciseGlyphs(
  snapshot: MorphSnapshot | null,
  rootRect: DOMRect | null,
) {
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
    viewportLeft:
      rootRect === null ? null : roundDebugValue(rootRect.left + grapheme.left),
    viewportTop:
      rootRect === null ? null : roundDebugValue(rootRect.top + grapheme.top),
  }));
}

function summarizeLiveNodeStyles(overlayNode: HTMLDivElement | null) {
  if (overlayNode === null) {
    return null;
  }

  return Array.from(
    overlayNode.querySelectorAll<HTMLElement>("[data-morph-role='live']"),
  ).map((node, index) => {
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
      sliceInlineLeft: node.firstElementChild instanceof HTMLElement ? node.firstElementChild.style.left : null,
      sliceInlineTop: node.firstElementChild instanceof HTMLElement ? node.firstElementChild.style.top : null,
      sliceInlineWidth: node.firstElementChild instanceof HTMLElement ? node.firstElementChild.style.width : null,
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
  });
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

function MorphOverlay({
  overlayRef,
  stage,
  plan,
  sourceSliceWhiteSpace,
  targetSliceWhiteSpace,
}: {
  overlayRef?: RefObject<HTMLDivElement | null>;
  stage: MorphStage;
  plan: MorphRenderPlan;
  sourceSliceWhiteSpace: "inherit" | "nowrap";
  targetSliceWhiteSpace: "inherit" | "nowrap";
}) {
  let exitItems: MorphCharacterLayout[] = [];
  if (stage !== "idle") {
    exitItems = plan.exitItems;
  }

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      style={getOverlayStyleModel(stage, plan)}
    >
      {exitItems.map((item) => (
        <span
          key={`exit-${item.key}`}
          data-morph-role="exit"
          data-morph-key={item.key}
          data-morph-glyph={item.glyph}
          style={getExitGlyphStyle(item, stage, plan.visualBridge)}
        >
          <span
            data-morph-slice="context"
            style={getContextSliceStyle(
              plan.layoutInlineSizeFrom,
              item,
              sourceSliceWhiteSpace,
            )}
          >
            {plan.sourceRenderText}
          </span>
        </span>
      ))}
      {plan.liveItems.map((item) => (
        <span
          key={item.key}
          data-morph-role="live"
          data-morph-key={item.key}
          data-morph-glyph={item.glyph}
          data-morph-kind={item.kind}
          style={getLiveGlyphStyle(item, stage, plan.visualBridge)}
        >
          <span
            data-morph-slice="context"
            style={getContextSliceStyle(
              plan.layoutInlineSizeTo,
              item,
              targetSliceWhiteSpace,
            )}
          >
            {plan.targetRenderText}
          </span>
        </span>
      ))}
    </div>
  );
}

type MeasurementLayerProps = {
  layerRef: RefObject<HTMLSpanElement | null>;
  layoutContext: LayoutContext | null;
  text: string;
  useContentInlineSize: boolean;
};

function MeasurementLayer({
  layerRef,
  layoutContext,
  text,
  useContentInlineSize,
}: MeasurementLayerProps) {
  return (
    <span
      ref={layerRef}
      aria-hidden="true"
      style={getMeasurementLayerStyleModel(layoutContext, useContentInlineSize)}
    >
      {text}
    </span>
  );
}

type FlowTextLayerProps = {
  flowText: string;
  flowTextRef: RefObject<HTMLSpanElement | null>;
  layoutId: string | null;
  shouldHideFlowText: boolean;
};

export function FlowTextLayer({
  flowText,
  flowTextRef,
  layoutId,
  shouldHideFlowText,
}: FlowTextLayerProps) {
  return (
    <span aria-hidden="true" style={getFallbackTextStyle(shouldHideFlowText)}>
      <motion.span
        ref={flowTextRef}
        layoutId={layoutId ?? undefined}
        style={FLOW_TEXT_LAYOUT_STYLE}
      >
        {flowText}
      </motion.span>
    </span>
  );
}

function isMorphOverlayTransformFinalizeEvent(
  event: TransitionEvent,
  hasMoveTransitions: boolean,
) {
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

function useMorphTransition(text: string, className?: string) {
  const [state, setState] = useState<MorphState>(EMPTY_STATE);
  const { ref, layoutContext } = useObservedLayoutContext<HTMLDivElement>([
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
  const logTransitionTrace = (
    event: string,
    payload: Record<string, unknown> = {},
  ) => {
    const config = readTorphDebugConfig();
    if (!shouldRunTorphInstrumentation(config)) {
      return;
    }

    logTorphDebug(debugInstanceIdRef.current!, event, {
      traceSchemaVersion: TORPH_TRACE_SCHEMA_VERSION,
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
        completedDomMeasurementKeyRef.current = domMeasurementKey;
        if (domMeasurementRequestKey !== null) {
          logTransitionTrace("effect:dom-measurement-request-update", {
            reason: "clear-after-cache-hit",
            nextDomMeasurementRequestKey: null,
            snapshotSource: "cache",
          });
          setDomMeasurementRequestKey(null);
        }

        reconcileMorphChange({
          root: ref.current,
          measurementLayer: null,
          measurementBackend,
          snapshotOverride: cachedSnapshot,
          text,
          renderText,
          segments,
          layoutContext,
          session: sessionRef.current,
          timeline: timelineRef.current,
          setState,
        });
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

        const nextMeasurement = reconcileMorphChange({
          root: ref.current,
          measurementLayer: measurementLayerRef.current,
          measurementBackend,
          snapshotOverride: null,
          text,
          renderText,
          segments,
          layoutContext,
          session: sessionRef.current,
          timeline: timelineRef.current,
          setState,
        });
        if (nextMeasurement !== null) {
          if (canCacheMeasurementLayerSnapshotModel(measurementBackend)) {
            rememberCachedMorphSnapshot(
              domMeasurementSnapshotCacheRef.current,
              domMeasurementKey,
              nextMeasurement.snapshot,
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

    const nextMeasurement = reconcileMorphChange({
      root: ref.current,
      measurementLayer: measurementLayerRef.current,
      measurementBackend,
      snapshotOverride: null,
      text,
      renderText,
      segments,
      layoutContext,
      session: sessionRef.current,
      timeline: timelineRef.current,
      setState,
    });
  }, [
    text,
    renderText,
    segments,
    layoutContext,
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
    if (state.stage !== "prepare" || state.measurement === null || state.plan === null) {
      return;
    }

    const root = ref.current;
    if (root === null) {
      return;
    }

    const nextOrigin = readRootOrigin(root);
    const nextMeasurement = resolvePreparedMeasurementOriginModel(
      state.measurement,
      nextOrigin,
    );
    const nextPlan = resolvePreparedPlanVisualBridgeModel(state.plan, nextOrigin);
    if (nextMeasurement !== state.measurement || nextPlan !== state.plan) {
      sessionRef.current.target = nextMeasurement;
      logTransitionTrace("effect:prepare-refine", {
        preparedOrigin: {
          left: roundDebugValue(nextOrigin.left),
          top: roundDebugValue(nextOrigin.top),
        },
        refinedMeasurement: summarizeDebugMeasurement(nextMeasurement),
        refinedVisualBridge: {
          offsetX: roundDebugValue(nextPlan.visualBridge.offsetX),
          offsetY: roundDebugValue(nextPlan.visualBridge.offsetY),
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

        if (current.measurement === nextMeasurement && current.plan === nextPlan) {
          return current;
        }

        return {
          stage: "prepare",
          measurement: nextMeasurement,
          plan: nextPlan,
        };
      });
      return;
    }

    timelineRef.current.prepareFrame = requestAnimationFrame(() => {
      timelineRef.current.prepareFrame = null;
      timelineRef.current.animateFrame = requestAnimationFrame(() => {
        timelineRef.current.animateFrame = null;
        logTransitionTrace("effect:prepare-animate", {
          preparedOrigin: {
            left: roundDebugValue(nextOrigin.left),
            top: roundDebugValue(nextOrigin.top),
          },
          visualBridge: {
            offsetX: roundDebugValue(nextPlan.visualBridge.offsetX),
            offsetY: roundDebugValue(nextPlan.visualBridge.offsetY),
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
            measurement: current.measurement,
            plan: current.plan,
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
  }, [state.measurement, state.plan, state.stage]);

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
  layoutId = null,
}: {
  text: string;
  className?: string;
  layoutId?: string | null;
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
  } = useMorphTransition(text, className);

  const plan = state.plan;
  let visibleGlyphPlan: MorphRenderPlan | null = plan;
  if (state.stage === "idle" && state.measurement !== null) {
    visibleGlyphPlan = createSteadyGlyphPlanModel(state.measurement);
  }

  let sourceSliceWhiteSpace: "inherit" | "nowrap" = "inherit";
  if (committedMeasurement !== null) {
    sourceSliceWhiteSpace = resolveGlyphSliceWhiteSpaceModel(
      committedMeasurement.snapshot,
    );
  }

  let targetSliceWhiteSpace: "inherit" | "nowrap" = "inherit";
  if (state.measurement !== null) {
    targetSliceWhiteSpace = resolveGlyphSliceWhiteSpaceModel(
      state.measurement.snapshot,
    );
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
      includesIdlePostFrame: true,
      includesIdlePostFrameLifecycle: true,
      includesViewportAnchors: true,
      includesRootOriginRefine: true,
      includesFullGlyphLayouts: true,
      includesIdleVisibleGlyphLayer: true,
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

    const overlayLiveDrift = measureSnapshotDrift(
      measurement.snapshot,
      overlayLiveSnapshot,
    );
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
      overlayLiveGlyphsPrecise: summarizePreciseGlyphs(
        overlayLiveSnapshot,
        rootRect,
      ),
      overlayLiveDrift: summarizeSnapshotDrift(overlayLiveDrift),
      overlayExit: summarizeDebugSnapshot(overlayExitSnapshot),
      overlayExitGlyphs: summarizeDebugGlyphs(overlayExitSnapshot),
      flow: summarizeDebugSnapshot(flowSnapshot),
      flowGlyphs: summarizeDebugGlyphs(flowSnapshot),
      flowGlyphsPrecise: summarizePreciseGlyphs(flowSnapshot, rootRect),
      flowDrift: summarizeSnapshotDrift(flowDrift),
      rootOriginDrift: summarizeDebugRootOriginDrift(measurement, rootRect),
      overlayLiveViewportAnchors: summarizeDebugViewportAnchors(
        overlayLiveSnapshot,
        rootRect,
      ),
      overlayExitViewportAnchors: summarizeDebugViewportAnchors(
        overlayExitSnapshot,
        rootRect,
      ),
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
    let finalizeScheduled = false;
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

      const target = event?.target;
      let morphRole: string | null = null;
      let morphKey: string | null = null;
      let morphGlyph: string | null = null;
      if (target instanceof HTMLElement) {
        morphRole = target.dataset.morphRole ?? null;
        morphKey = target.dataset.morphKey ?? null;
        morphGlyph = target.dataset.morphGlyph ?? null;
      }

      logAnimateFinalizeSnapshot(measurement, plan, reason, barrierState, signal, event);
      finalizeMorphTransition(measurement, reason);
      const config = readTorphDebugConfig();
      if (!shouldRunTorphInstrumentation(config)) {
        return;
      }

      logTorphDebug(debugInstanceId, "effect:finalize-authority", {
        text,
        reason,
        propertyName: event?.propertyName ?? null,
        morphRole,
        morphKey,
        morphGlyph,
        elapsedMs: roundDebugValue(performance.now() - armedAt),
        hasMoveTransitions,
        finalizeSignal: signal,
        barrier: summarizeMorphFinalizeBarrierModel(barrierState),
        measurement: summarizeDebugMeasurement(measurement),
      });
    };

    const scheduleFinalize = (
      reason: "transitionend" | "watchdog-timeout",
      signal: MorphFinalizeSignal | null,
      barrierState: MorphFinalizeBarrier,
      event?: TransitionEvent,
    ) => {
      if (finalizeCommitted || finalizeScheduled) {
        return;
      }

      finalizeScheduled = true;
      if (timelineRef.current.finalizeTimer !== null) {
        window.clearTimeout(timelineRef.current.finalizeTimer);
        timelineRef.current.finalizeTimer = null;
      }

      logTorphDebug(debugInstanceId, "effect:finalize-raf-schedule", {
        text,
        reason,
        propertyName: event?.propertyName ?? null,
        finalizeSignal: signal,
        elapsedMs: roundDebugValue(performance.now() - armedAt),
        barrier: summarizeMorphFinalizeBarrierModel(barrierState),
      });

      finalizeFrame = requestAnimationFrame(() => {
        finalizeFrame = null;
        finalizeNow(reason, signal, barrierState, event);
      });
    };

    const onTransitionEnd = (event: TransitionEvent) => {
      const signal = resolveMorphFinalizeSignal(
        event,
        hasMoveTransitions,
      );
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
        overlayLiveViewportAnchors: summarizeDebugViewportAnchors(
          overlayLiveSnapshot,
          rootRect,
        ),
        overlayLiveDrift,
        overlayExit: summarizeDebugSnapshot(overlayExitSnapshot),
        overlayExitGlyphs: summarizeDebugGlyphs(overlayExitSnapshot),
        overlayExitViewportAnchors: summarizeDebugViewportAnchors(
          overlayExitSnapshot,
          rootRect,
        ),
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
      />
    );
  }

  return (
    <div
      ref={ref}
      className={className}
      style={getRootStyleModel(state.stage, plan, state.measurement, layoutContext)}
    >
      <span style={SCREEN_READER_ONLY_STYLE}>{text}</span>
      <FlowTextLayer
        flowText={flowText}
        flowTextRef={flowTextRef}
        layoutId={layoutId}
        shouldHideFlowText={shouldHideFlowText}
      />
      {measurementLayer}
      {overlay}
    </div>
  );
}

export type TorphProps = {
  text: string;
  className?: string;
  layoutId?: string | null;
};

export function Torph({
  text,
  className,
  layoutId = null,
}: TorphProps) {
  return <ActiveTorph text={text} className={className} layoutId={layoutId} />;
}
