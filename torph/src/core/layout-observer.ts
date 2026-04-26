import { useLayoutEffect, useRef, useState } from "react";
import {
  bumpMorphMeasurementEpoch,
  clearMorphMeasurementCaches,
} from "./measurement-policy";
import { supportsIntrinsicWidthLock } from "./render";
import {
  MORPH,
  type LayoutContext,
  type MorphMeasurementCause,
  type MorphMeasurementStability,
  type SupportedWhiteSpace,
} from "./types";

let activeMorphMeasurementConsumers = 0;
let detachMorphMeasurementInvalidationListeners: (() => void) | null = null;
const morphMeasurementInvalidationSubscribers = new Set<() => void>();
const FONT_METRIC_TRANSITION_PROPERTIES = new Set([
  "font",
  "font-family",
  "font-size",
  "font-stretch",
  "font-style",
  "font-weight",
  "font-variation-settings",
  "letter-spacing",
  "line-height",
  "text-transform",
  "word-spacing",
]);
const GEOMETRY_TRANSITION_PROPERTIES = new Set([
  "transform",
  "translate",
  "scale",
  "rotate",
  "left",
  "top",
  "right",
  "bottom",
  "inset",
  "inset-block",
  "inset-inline",
  "inset-block-start",
  "inset-block-end",
  "inset-inline-start",
  "inset-inline-end",
]);
const ROOT_STABILIZATION_EPSILON = 0.05;
const ROOT_STABILIZATION_STABLE_FRAMES = 4;
const ROOT_STABILIZATION_MAX_FRAMES = 12;

function parsePx(value: string) {
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return null;
}

export function readFont(styles: CSSStyleDeclaration) {
  if (styles.font.length > 0) {
    return styles.font;
  }

  return `${styles.fontStyle} ${styles.fontVariant} ${styles.fontWeight} ${styles.fontSize} / ${styles.lineHeight} ${styles.fontFamily}`;
}

function readLineHeightPx(styles: CSSStyleDeclaration) {
  const lineHeightPx = parsePx(styles.lineHeight);
  if (lineHeightPx !== null) {
    return lineHeightPx;
  }

  const fontSizePx = parsePx(styles.fontSize);
  return (fontSizePx ?? 0) * 1.2;
}

function readSpacingPx(value: string) {
  if (value === "normal") {
    return 0;
  }

  return parsePx(value) ?? 0;
}

function readWhiteSpace(value: string): SupportedWhiteSpace {
  if (value === "normal" || value === "nowrap" || value === "pre-wrap") {
    return value;
  }

  throw new Error(
    `Torph only supports white-space: normal | nowrap | pre-wrap. Received: ${value}`,
  );
}

function readContentWidth(node: HTMLElement, styles: CSSStyleDeclaration) {
  const rectWidth = node.getBoundingClientRect().width;
  const paddingLeft = parsePx(styles.paddingLeft) ?? 0;
  const paddingRight = parsePx(styles.paddingRight) ?? 0;
  const borderLeft = parsePx(styles.borderLeftWidth) ?? 0;
  const borderRight = parsePx(styles.borderRightWidth) ?? 0;

  return Math.max(0, rectWidth - paddingLeft - paddingRight - borderLeft - borderRight);
}

export function isFontMetricTransitionProperty(propertyName: string) {
  return FONT_METRIC_TRANSITION_PROPERTIES.has(propertyName);
}

export function isGeometryTransitionProperty(propertyName: string) {
  return GEOMETRY_TRANSITION_PROPERTIES.has(propertyName);
}

export function doesTransitionTargetAffectNode(
  node: Node,
  target: EventTarget | null,
) {
  if (target === node) {
    return true;
  }

  if (
    typeof target !== "object" ||
    target === null ||
    !("contains" in target) ||
    typeof target.contains !== "function"
  ) {
    return false;
  }

  return target.contains(node);
}

export function hasRootRectChangedWithEpsilon(
  previousRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  nextRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  epsilon: number,
) {
  return (
    Math.abs(nextRect.left - previousRect.left) > epsilon ||
    Math.abs(nextRect.top - previousRect.top) > epsilon ||
    Math.abs(nextRect.width - previousRect.width) > epsilon ||
    Math.abs(nextRect.height - previousRect.height) > epsilon
  );
}

export function shouldRefreshLayoutContextForRootMotion(args: {
  measurementCause: MorphMeasurementCause;
  measurementStability: MorphMeasurementStability;
  previousRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height"> | null;
  nextRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;
}) {
  if (
    args.measurementCause !== "root-motion" ||
    args.measurementStability !== "live"
  ) {
    return true;
  }

  if (args.previousRect === null) {
    return false;
  }

  return (
    Math.abs(args.nextRect.width - args.previousRect.width) > MORPH.geometryEpsilon ||
    Math.abs(args.nextRect.height - args.previousRect.height) > MORPH.geometryEpsilon
  );
}

function hasRootRectChanged(
  previousRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  nextRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
) {
  return hasRootRectChangedWithEpsilon(
    previousRect,
    nextRect,
    MORPH.geometryEpsilon,
  );
}

function doesScrollTargetAffectNode(
  node: HTMLElement,
  target: EventTarget | null,
  ownerDocument: Document,
) {
  if (
    target === ownerDocument ||
    target === ownerDocument.scrollingElement ||
    target === ownerDocument.documentElement ||
    target === ownerDocument.body
  ) {
    return true;
  }

  if (!(target instanceof Node)) {
    return false;
  }

  return target === node || target.contains(node) || node.contains(target);
}

function readLayoutContext(
  node: HTMLElement,
  width: number | undefined,
  measurementStability: MorphMeasurementStability,
  measurementCause: MorphMeasurementCause,
): LayoutContext {
  const styles = getComputedStyle(node);
  const parentDisplay =
    (node.parentElement && getComputedStyle(node.parentElement).display) ?? "block";

  return {
    display: styles.display,
    direction: styles.direction,
    font: readFont(styles),
    fontFeatureSettings: styles.fontFeatureSettings,
    fontVariationSettings: styles.fontVariationSettings,
    letterSpacingPx: readSpacingPx(styles.letterSpacing),
    lineHeightPx: readLineHeightPx(styles),
    measurementCause,
    measurementStability,
    parentDisplay,
    textTransform: styles.textTransform,
    whiteSpace: readWhiteSpace(styles.whiteSpace),
    width: width ?? readContentWidth(node, styles),
    wordSpacingPx: readSpacingPx(styles.wordSpacing),
    measurementVersion: 0,
  };
}

function sameLayoutContext(a: LayoutContext | null, b: LayoutContext) {
  if (a === null) {
    return false;
  }

  return (
    a.display === b.display &&
    a.direction === b.direction &&
    a.font === b.font &&
    a.fontFeatureSettings === b.fontFeatureSettings &&
    a.fontVariationSettings === b.fontVariationSettings &&
    Math.abs(a.letterSpacingPx - b.letterSpacingPx) < MORPH.geometryEpsilon &&
    Math.abs(a.lineHeightPx - b.lineHeightPx) < MORPH.geometryEpsilon &&
    a.measurementCause === b.measurementCause &&
    a.measurementStability === b.measurementStability &&
    a.parentDisplay === b.parentDisplay &&
    a.textTransform === b.textTransform &&
    a.whiteSpace === b.whiteSpace &&
    Math.abs(a.width - b.width) < MORPH.geometryEpsilon &&
    Math.abs(a.wordSpacingPx - b.wordSpacingPx) < MORPH.geometryEpsilon
  );
}

export type LayoutContextRefreshMode = "passive" | "motion" | "invalidate";

export function resolveNextLayoutContext(args: {
  previous: LayoutContext | null;
  next: LayoutContext;
  refreshMode?: LayoutContextRefreshMode;
}) {
  const refreshMode = args.refreshMode ?? "passive";
  const same = sameLayoutContext(args.previous, args.next);
  if (same && refreshMode !== "invalidate") {
    return args.previous;
  }

  return {
    ...args.next,
    measurementVersion: (args.previous?.measurementVersion ?? 0) + 1,
  } satisfies LayoutContext;
}

export function notifyMorphMeasurementInvalidationSubscribers() {
  for (const subscriber of morphMeasurementInvalidationSubscribers) {
    subscriber();
  }
}

export function subscribeMorphMeasurementInvalidation(
  subscriber: () => void,
) {
  morphMeasurementInvalidationSubscribers.add(subscriber);
  return () => {
    morphMeasurementInvalidationSubscribers.delete(subscriber);
  };
}

function acquireMorphMeasurementInvalidationListeners() {
  activeMorphMeasurementConsumers += 1;

  if (detachMorphMeasurementInvalidationListeners === null) {
    const handleFontChange = () => {
      clearMorphMeasurementCaches();
      bumpMorphMeasurementEpoch();
      notifyMorphMeasurementInvalidationSubscribers();
    };

    void document.fonts.ready.then(handleFontChange);
    if (typeof document.fonts.addEventListener === "function") {
      document.fonts.addEventListener("loadingdone", handleFontChange);
    }

    detachMorphMeasurementInvalidationListeners = () => {
      if (typeof document.fonts.removeEventListener === "function") {
        document.fonts.removeEventListener("loadingdone", handleFontChange);
      }
    };
  }
}

function releaseMorphMeasurementInvalidationListeners() {
  activeMorphMeasurementConsumers = Math.max(0, activeMorphMeasurementConsumers - 1);
  if (
    activeMorphMeasurementConsumers === 0 &&
    detachMorphMeasurementInvalidationListeners !== null
  ) {
    detachMorphMeasurementInvalidationListeners();
    detachMorphMeasurementInvalidationListeners = null;
  }
}

export function useObservedLayoutContext<T extends HTMLElement>(
  deps: readonly unknown[],
) {
  const ref = useRef<T | null>(null);
  const [layoutContext, setLayoutContext] = useState<LayoutContext | null>(null);
  const [motionFrameVersion, setMotionFrameVersion] = useState(0);
  const previousRootRectRef = useRef<DOMRectReadOnly | null>(null);
  const syncLayoutContextRef = useRef<
    | ((options?: {
        width?: number;
        refreshMode?: LayoutContextRefreshMode;
      }) => void)
    | null
  >(null);
  const armRootMotionPollingRef = useRef<
    | ((options?: {
        restartWindow?: boolean;
      }) => void)
    | null
  >(null);

  useLayoutEffect(() => {
    const node = ref.current;
    const armRootMotionPolling = armRootMotionPollingRef.current;
    if (node === null || armRootMotionPolling === null) {
      return;
    }

    const nextRect = node.getBoundingClientRect();
    const previousRect = previousRootRectRef.current;
    if (previousRect !== null && hasRootRectChanged(previousRect, nextRect)) {
      armRootMotionPolling();
      return;
    }

    previousRootRectRef.current = nextRect;
  });

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }

    let disposed = false;
    let measurementStability: MorphMeasurementStability = "stable";
    let measurementCause: MorphMeasurementCause = "steady";

    const commitLayoutContext = (
      next: LayoutContext,
      refreshMode: LayoutContextRefreshMode = "passive",
    ) => {
      setLayoutContext((previous) => {
        return resolveNextLayoutContext({
          previous,
          next,
          refreshMode,
        });
      });
    };

    const syncLayoutContext = ({
      width,
      refreshMode = "passive",
    }: {
      width?: number;
      refreshMode?: LayoutContextRefreshMode;
    } = {}) => {
      if (disposed) {
        return;
      }

      const next = readLayoutContext(
        node,
        width,
        measurementStability,
        measurementCause,
      );
      commitLayoutContext(next, refreshMode);
    };
    syncLayoutContextRef.current = syncLayoutContext;

    const initialLayoutContext = readLayoutContext(
      node,
      undefined,
      measurementStability,
      measurementCause,
    );
    const shouldObserveWrappingWidth =
      initialLayoutContext.whiteSpace !== "nowrap" &&
      !supportsIntrinsicWidthLock(
        initialLayoutContext.display,
        initialLayoutContext.parentDisplay,
      );
    commitLayoutContext(initialLayoutContext, "invalidate");

    const unsubscribeInvalidation = subscribeMorphMeasurementInvalidation(() => {
      syncLayoutContext({
        refreshMode: "invalidate",
      });
    });
    const activeFontMetricTransitions = new Map<EventTarget, Set<string>>();
    const ownerDocument = node.ownerDocument;
    const ownerWindow = ownerDocument.defaultView ?? window;

    let fontMetricTransitionFrame: number | null = null;
    let rootMotionFrame: number | null = null;
    let stabilizeMeasurementFrame: number | null = null;
    let stabilizeMeasurementStableFrames = 0;
    let stabilizeMeasurementFramesRemaining = ROOT_STABILIZATION_MAX_FRAMES;
    let previousStabilizeRect: DOMRectReadOnly | null = null;
    let rootMotionObservedMotion = false;
    let rootMotionStableFrames = 0;
    let rootMotionFramesRemaining = 24;
    previousRootRectRef.current = node.getBoundingClientRect();
    const publishRootMotionFrame = () => {
      setMotionFrameVersion((current) => current + 1);
    };
    const stopFontMetricTransitionPolling = () => {
      if (fontMetricTransitionFrame === null) {
        return;
      }

      ownerWindow.cancelAnimationFrame(fontMetricTransitionFrame);
      fontMetricTransitionFrame = null;
    };
    const stopRootMotionPolling = () => {
      if (rootMotionFrame === null) {
        return;
      }

      ownerWindow.cancelAnimationFrame(rootMotionFrame);
      rootMotionFrame = null;
    };
    const cancelMeasurementStabilization = () => {
      if (stabilizeMeasurementFrame !== null) {
        ownerWindow.cancelAnimationFrame(stabilizeMeasurementFrame);
        stabilizeMeasurementFrame = null;
      }

      stabilizeMeasurementStableFrames = 0;
      stabilizeMeasurementFramesRemaining = ROOT_STABILIZATION_MAX_FRAMES;
      previousStabilizeRect = null;
    };
    const pollMeasurementStabilization = () => {
      stabilizeMeasurementFrame = ownerWindow.requestAnimationFrame(() => {
        stabilizeMeasurementFrame = null;
        if (disposed || activeFontMetricTransitions.size > 0 || rootMotionFrame !== null) {
          return;
        }
        const nextRect = node.getBoundingClientRect();
        const previousRect =
          previousStabilizeRect ?? previousRootRectRef.current ?? nextRect;
        const changedBeyondGeometryEpsilon = hasRootRectChanged(
          previousRect,
          nextRect,
        );
        const changedBeyondStabilizationEpsilon = hasRootRectChangedWithEpsilon(
          previousRect,
          nextRect,
          ROOT_STABILIZATION_EPSILON,
        );
        previousRootRectRef.current = nextRect;
        previousStabilizeRect = nextRect;

        if (changedBeyondGeometryEpsilon) {
          startRootMotionPolling({
            restartWindow: true,
          });
          return;
        }

        if (changedBeyondStabilizationEpsilon) {
          stabilizeMeasurementStableFrames = 0;
          stabilizeMeasurementFramesRemaining -= 1;
          syncLayoutContext({
            refreshMode: "motion",
          });
          if (stabilizeMeasurementFramesRemaining <= 0) {
            measurementStability = "stable";
            measurementCause = "steady";
            syncLayoutContext({
              refreshMode: "motion",
            });
            return;
          }

          pollMeasurementStabilization();
          return;
        }

        stabilizeMeasurementStableFrames += 1;
        if (
          stabilizeMeasurementStableFrames >= ROOT_STABILIZATION_STABLE_FRAMES ||
          stabilizeMeasurementFramesRemaining <= 0
        ) {
          measurementStability = "stable";
          measurementCause = "steady";
          syncLayoutContext({
            refreshMode: "motion",
          });
          return;
        }

        stabilizeMeasurementFramesRemaining -= 1;
        pollMeasurementStabilization();
      });
    };
    const armMeasurementStabilization = () => {
      cancelMeasurementStabilization();
      measurementStability = "finalize";
      syncLayoutContext({
        refreshMode: "motion",
      });
      previousStabilizeRect = node.getBoundingClientRect();
      pollMeasurementStabilization();
    };
    const pollRootMotion = () => {
      if (disposed) {
        return;
      }

      const nextRect = node.getBoundingClientRect();
      const previousRect = previousRootRectRef.current;
      const moved =
        previousRect !== null && hasRootRectChanged(previousRect, nextRect);
      previousRootRectRef.current = nextRect;

      if (moved) {
        rootMotionObservedMotion = true;
        rootMotionStableFrames = 0;
        cancelMeasurementStabilization();
        const shouldRefreshLayoutContext = shouldRefreshLayoutContextForRootMotion({
          measurementCause,
          measurementStability,
          previousRect,
          nextRect,
        });
        measurementCause = "root-motion";
        measurementStability = "live";
        if (shouldRefreshLayoutContext) {
          syncLayoutContext({
            refreshMode: "motion",
          });
        }
        publishRootMotionFrame();
      } else if (rootMotionObservedMotion) {
        rootMotionStableFrames += 1;
        if (rootMotionStableFrames >= 4) {
          stopRootMotionPolling();
          if (activeFontMetricTransitions.size === 0) {
            armMeasurementStabilization();
          } else {
            measurementCause = "font-metrics";
            syncLayoutContext({
              refreshMode: "motion",
            });
          }
          return;
        }
      } else {
        rootMotionFramesRemaining -= 1;
        if (rootMotionFramesRemaining <= 0) {
          stopRootMotionPolling();
          return;
        }
      }

      rootMotionFrame = ownerWindow.requestAnimationFrame(pollRootMotion);
    };
    const startRootMotionPolling = ({
      restartWindow = false,
    }: {
      restartWindow?: boolean;
    } = {}) => {
      if (disposed) {
        return;
      }

      if (restartWindow || rootMotionFrame === null) {
        rootMotionObservedMotion = false;
        rootMotionStableFrames = 0;
        rootMotionFramesRemaining = 24;
      } else {
        rootMotionFramesRemaining = Math.max(rootMotionFramesRemaining, 24);
      }

      const nextRect = node.getBoundingClientRect();
      const previousRect = previousRootRectRef.current;
      const moved =
        previousRect !== null && hasRootRectChanged(previousRect, nextRect);
      previousRootRectRef.current = nextRect;

      if (moved) {
        rootMotionObservedMotion = true;
        rootMotionStableFrames = 0;
        cancelMeasurementStabilization();
        const shouldRefreshLayoutContext = shouldRefreshLayoutContextForRootMotion({
          measurementCause,
          measurementStability,
          previousRect,
          nextRect,
        });
        measurementCause = "root-motion";
        measurementStability = "live";
        if (shouldRefreshLayoutContext) {
          syncLayoutContext({
            refreshMode: "motion",
          });
        }
        publishRootMotionFrame();
      }

      if (rootMotionFrame !== null) {
        return;
      }

      rootMotionFrame = ownerWindow.requestAnimationFrame(pollRootMotion);
    };
    armRootMotionPollingRef.current = startRootMotionPolling;
    const pollFontMetricTransition = () => {
      syncLayoutContext({
        refreshMode: "motion",
      });
      fontMetricTransitionFrame = ownerWindow.requestAnimationFrame(
        pollFontMetricTransition,
      );
    };
    const startFontMetricTransitionPolling = () => {
      cancelMeasurementStabilization();
      if (rootMotionFrame === null) {
        measurementCause = "font-metrics";
      }
      measurementStability = "live";

      if (fontMetricTransitionFrame !== null) {
        syncLayoutContext({
          refreshMode: "motion",
        });
        return;
      }

      syncLayoutContext({
        refreshMode: "motion",
      });
      fontMetricTransitionFrame = ownerWindow.requestAnimationFrame(
        pollFontMetricTransition,
      );
    };
    const handleFontMetricTransitionStart = (event: TransitionEvent) => {
      if (!isFontMetricTransitionProperty(event.propertyName)) {
        return;
      }

      if (!doesTransitionTargetAffectNode(node, event.target)) {
        return;
      }

      const transitionTarget = event.target;
      if (transitionTarget === null) {
        return;
      }

      let activeProperties = activeFontMetricTransitions.get(transitionTarget);
      if (activeProperties === undefined) {
        activeProperties = new Set<string>();
        activeFontMetricTransitions.set(transitionTarget, activeProperties);
      }

      activeProperties.add(`${event.propertyName}\u0000${event.pseudoElement}`);
      startFontMetricTransitionPolling();
    };
    const handleFontMetricTransitionStop = (event: TransitionEvent) => {
      if (!isFontMetricTransitionProperty(event.propertyName)) {
        return;
      }

      if (!doesTransitionTargetAffectNode(node, event.target)) {
        return;
      }

      const transitionTarget = event.target;
      if (transitionTarget === null) {
        return;
      }

      const activeProperties = activeFontMetricTransitions.get(transitionTarget);
      if (activeProperties === undefined) {
        return;
      }

      activeProperties.delete(`${event.propertyName}\u0000${event.pseudoElement}`);
      if (activeProperties.size > 0) {
        return;
      }

      activeFontMetricTransitions.delete(transitionTarget);
      if (activeFontMetricTransitions.size > 0) {
        return;
      }

      stopFontMetricTransitionPolling();
      if (rootMotionFrame === null) {
        armMeasurementStabilization();
      }
    };
    const handleGeometryTransitionStart = (event: TransitionEvent) => {
      if (!isGeometryTransitionProperty(event.propertyName)) {
        return;
      }

      if (!doesTransitionTargetAffectNode(node, event.target)) {
        return;
      }

      startRootMotionPolling({
        restartWindow: true,
      });
    };
    const handleScroll = (event: Event) => {
      if (!doesScrollTargetAffectNode(node, event.target, ownerDocument)) {
        return;
      }

      startRootMotionPolling();
    };

    let resizeObserver: ResizeObserver | null = null;
    if (shouldObserveWrappingWidth) {
      resizeObserver = new ResizeObserver(([entry]) => {
        syncLayoutContext({
          width: entry?.contentRect.width,
        });
      });
    }

    startRootMotionPolling({
      restartWindow: true,
    });
    resizeObserver?.observe(node);
    ownerDocument.addEventListener("scroll", handleScroll, true);
    ownerDocument.addEventListener(
      "transitionrun",
      handleGeometryTransitionStart,
      true,
    );
    ownerDocument.addEventListener(
      "transitionstart",
      handleGeometryTransitionStart,
      true,
    );
    ownerDocument.addEventListener("transitionrun", handleFontMetricTransitionStart, true);
    ownerDocument.addEventListener(
      "transitionstart",
      handleFontMetricTransitionStart,
      true,
    );
    ownerDocument.addEventListener("transitionend", handleFontMetricTransitionStop, true);
    ownerDocument.addEventListener(
      "transitioncancel",
      handleFontMetricTransitionStop,
      true,
    );
    acquireMorphMeasurementInvalidationListeners();

    return () => {
      disposed = true;
      syncLayoutContextRef.current = null;
      armRootMotionPollingRef.current = null;
      unsubscribeInvalidation();
      resizeObserver?.disconnect();
      stopRootMotionPolling();
      stopFontMetricTransitionPolling();
      cancelMeasurementStabilization();
      activeFontMetricTransitions.clear();
      ownerDocument.removeEventListener("scroll", handleScroll, true);
      ownerDocument.removeEventListener(
        "transitionrun",
        handleGeometryTransitionStart,
        true,
      );
      ownerDocument.removeEventListener(
        "transitionstart",
        handleGeometryTransitionStart,
        true,
      );
      ownerDocument.removeEventListener(
        "transitionrun",
        handleFontMetricTransitionStart,
        true,
      );
      ownerDocument.removeEventListener(
        "transitionstart",
        handleFontMetricTransitionStart,
        true,
      );
      ownerDocument.removeEventListener(
        "transitionend",
        handleFontMetricTransitionStop,
        true,
      );
      ownerDocument.removeEventListener(
        "transitioncancel",
        handleFontMetricTransitionStop,
        true,
      );
      releaseMorphMeasurementInvalidationListeners();
    };
  }, deps);

  return { ref, layoutContext, motionFrameVersion };
}
