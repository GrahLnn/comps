import { useLayoutEffect, useRef, useState } from "react";
import {
  bumpMorphMeasurementEpoch,
  clearMorphMeasurementCaches,
} from "./measurement-policy";
import { supportsIntrinsicWidthLock } from "./render";
import {
  MORPH,
  type LayoutContext,
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

function readLayoutContext(
  node: HTMLElement,
  width: number | undefined,
  measurementStability: MorphMeasurementStability,
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
    a.measurementStability === b.measurementStability &&
    a.parentDisplay === b.parentDisplay &&
    a.textTransform === b.textTransform &&
    a.whiteSpace === b.whiteSpace &&
    Math.abs(a.width - b.width) < MORPH.geometryEpsilon &&
    Math.abs(a.wordSpacingPx - b.wordSpacingPx) < MORPH.geometryEpsilon
  );
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
  const syncLayoutContextRef = useRef<
    | ((options?: {
        width?: number;
        refreshMeasurements?: boolean;
      }) => void)
    | null
  >(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }

    let disposed = false;
    let measurementStability: MorphMeasurementStability = "stable";

    const commitLayoutContext = (next: LayoutContext, refreshMeasurements = false) => {
      setLayoutContext((previous) => {
        if (sameLayoutContext(previous, next) && !refreshMeasurements) {
          return previous;
        }

        const measurementVersion = (previous?.measurementVersion ?? 0) + 1;

        return {
          ...next,
          measurementVersion,
        };
      });
    };

    const syncLayoutContext = ({
      width,
      refreshMeasurements = false,
    }: {
      width?: number;
      refreshMeasurements?: boolean;
    } = {}) => {
      if (disposed) {
        return;
      }

      const next = readLayoutContext(node, width, measurementStability);
      commitLayoutContext(next, refreshMeasurements);
    };
    syncLayoutContextRef.current = syncLayoutContext;

    const initialLayoutContext = readLayoutContext(node, undefined, measurementStability);
    const shouldObserveWrappingWidth =
      initialLayoutContext.whiteSpace !== "nowrap" &&
      !supportsIntrinsicWidthLock(
        initialLayoutContext.display,
        initialLayoutContext.parentDisplay,
      );
    commitLayoutContext(initialLayoutContext, true);

    const unsubscribeInvalidation = subscribeMorphMeasurementInvalidation(() => {
      syncLayoutContext({
        refreshMeasurements: true,
      });
    });
    const activeFontMetricTransitions = new Map<EventTarget, Set<string>>();
    const ownerDocument = node.ownerDocument;
    const ownerWindow = ownerDocument.defaultView ?? window;

    let fontMetricTransitionFrame: number | null = null;
    let stabilizeMeasurementFrame: number | null = null;
    const stopFontMetricTransitionPolling = () => {
      if (fontMetricTransitionFrame === null) {
        return;
      }

      ownerWindow.cancelAnimationFrame(fontMetricTransitionFrame);
      fontMetricTransitionFrame = null;
    };
    const cancelMeasurementStabilization = () => {
      if (stabilizeMeasurementFrame === null) {
        return;
      }

      ownerWindow.cancelAnimationFrame(stabilizeMeasurementFrame);
      stabilizeMeasurementFrame = null;
    };
    const pollFontMetricTransition = () => {
      syncLayoutContext({
        refreshMeasurements: true,
      });
      fontMetricTransitionFrame = ownerWindow.requestAnimationFrame(
        pollFontMetricTransition,
      );
    };
    const startFontMetricTransitionPolling = () => {
      cancelMeasurementStabilization();
      measurementStability = "live";

      if (fontMetricTransitionFrame !== null) {
        syncLayoutContext({
          refreshMeasurements: true,
        });
        return;
      }

      syncLayoutContext({
        refreshMeasurements: true,
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
      cancelMeasurementStabilization();
      measurementStability = "finalize";
      syncLayoutContext({
        refreshMeasurements: true,
      });
      stabilizeMeasurementFrame = ownerWindow.requestAnimationFrame(() => {
        stabilizeMeasurementFrame = null;
        if (disposed || activeFontMetricTransitions.size > 0) {
          return;
        }

        measurementStability = "stable";
        syncLayoutContext({
          refreshMeasurements: true,
        });
      });
    };

    let resizeObserver: ResizeObserver | null = null;
    if (shouldObserveWrappingWidth) {
      resizeObserver = new ResizeObserver(([entry]) => {
        syncLayoutContext({
          width: entry?.contentRect.width,
        });
      });
    }

    resizeObserver?.observe(node);
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
      unsubscribeInvalidation();
      resizeObserver?.disconnect();
      stopFontMetricTransitionPolling();
      cancelMeasurementStabilization();
      activeFontMetricTransitions.clear();
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

  return { ref, layoutContext };
}
