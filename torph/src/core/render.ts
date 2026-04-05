import type { CSSProperties } from "react";
import {
  MORPH,
  type LayoutContext,
  type MorphCharacterLayout,
  type MorphLiveItem,
  type MorphMeasurement,
  type MorphRenderPlan,
  type MorphSnapshot,
  type MorphStage,
  type MorphVisualBridge,
  ZERO_BRIDGE,
} from "./types";

const OVERLAY_STYLE = {
  position: "absolute",
  inset: 0,
  minWidth: 0,
  pointerEvents: "none",
} satisfies CSSProperties;

const MEASUREMENT_LAYER_STYLE = {
  pointerEvents: "none",
  visibility: "hidden",
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  display: "block",
} satisfies CSSProperties;

export function getFadeDuration(fraction: number) {
  return Math.min(MORPH.durationMs * fraction, MORPH.maxFadeMs);
}

export function getOverlayStyle(
  stage: MorphStage,
  plan: MorphRenderPlan,
): CSSProperties {
  if (stage === "idle") {
    return OVERLAY_STYLE;
  }

  return {
    ...OVERLAY_STYLE,
    right: "auto",
    bottom: "auto",
    width: plan.frameWidth,
    height: plan.frameHeight,
  };
}

export function getLiveTransform(
  item: MorphLiveItem,
  stage: MorphStage,
  visualBridge: MorphVisualBridge,
) {
  if (stage !== "prepare") {
    return "translate(0px, 0px)";
  }

  if (item.kind === "move") {
    return `translate(${(item.fromLeft ?? item.left) - item.left + visualBridge.offsetX}px, ${(item.fromTop ?? item.top) - item.top + visualBridge.offsetY}px)`;
  }

  return `translate(${visualBridge.offsetX}px, ${visualBridge.offsetY}px)`;
}

function getLiveOpacity(item: MorphLiveItem, stage: MorphStage) {
  if (stage === "prepare" && item.kind === "enter") {
    return 0;
  }

  return 1;
}

export function getLiveTransition(item: MorphLiveItem, stage: MorphStage) {
  if (stage !== "animate") {
    return undefined;
  }

  if (item.kind === "enter") {
    return `opacity ${getFadeDuration(0.5)}ms linear ${getFadeDuration(0.25)}ms`;
  }

  return `transform ${MORPH.durationMs}ms ${MORPH.ease}, opacity ${getFadeDuration(0.25)}ms linear`;
}

function getExitOpacity(stage: MorphStage) {
  if (stage === "animate") {
    return 0;
  }

  return 1;
}

export function getExitTransform(visualBridge: MorphVisualBridge) {
  return `translate(${visualBridge.offsetX}px, ${visualBridge.offsetY}px)`;
}

export function getExitTransition(stage: MorphStage) {
  if (stage !== "animate") {
    return undefined;
  }

  return `transform ${MORPH.durationMs}ms ${MORPH.ease}, opacity ${getFadeDuration(0.25)}ms linear`;
}

export function supportsIntrinsicWidthLock(display: string, parentDisplay: string) {
  let parentNeedsReservation = false;
  if (
    parentDisplay === "flex" ||
    parentDisplay === "inline-flex" ||
    parentDisplay === "grid" ||
    parentDisplay === "inline-grid"
  ) {
    parentNeedsReservation = true;
  }

  if (
    display === "inline" ||
    display === "inline-block" ||
    display === "inline-flex" ||
    display === "inline-grid"
  ) {
    return true;
  }

  return parentNeedsReservation;
}

export function getRootDisplay(
  layoutContext: LayoutContext | null,
): "grid" | "inline-grid" {
  if (layoutContext === null) {
    return "grid";
  }

  if (supportsIntrinsicWidthLock(layoutContext.display, layoutContext.parentDisplay)) {
    return "inline-grid";
  }

  return "grid";
}

export function getRootStyle(
  stage: MorphStage,
  plan: MorphRenderPlan | null,
  measurement: MorphMeasurement | null,
  layoutContext: LayoutContext | null,
): CSSProperties {
  let width = measurement?.reservedInlineSize;
  if (measurement !== null && measurement.flowInlineSize !== null) {
    width = measurement.layoutInlineSize;
  }
  if (plan !== null) {
    width = plan.layoutInlineSizeTo;
  }

  let height: number | undefined;
  if (plan !== null) {
    height = plan.frameHeight;
  }

  const style: CSSProperties = {
    position: "relative",
    display: getRootDisplay(layoutContext),
  };

  if (width !== null && width !== undefined) {
    style.width = width;
  }

  if (height !== undefined) {
    style.height = height;
  }
  return style;
}

export function getMeasurementLayerStyle(
  layoutContext: LayoutContext | null,
  useContentInlineSize = false,
): CSSProperties {
  let intrinsicWidthLock = false;
  if (layoutContext !== null) {
    if (useContentInlineSize) {
      intrinsicWidthLock = true;
    } else if (
      supportsIntrinsicWidthLock(layoutContext.display, layoutContext.parentDisplay)
    ) {
      intrinsicWidthLock = true;
    }
  }

  if (!intrinsicWidthLock) {
    return MEASUREMENT_LAYER_STYLE;
  }

  return {
    ...MEASUREMENT_LAYER_STYLE,
    right: "auto",
    width: "max-content",
  };
}

export function resolveFlowText(
  committedMeasurement: MorphMeasurement | null,
  stateMeasurement: MorphMeasurement | null,
  text: string,
) {
  return stateMeasurement?.snapshot.text ?? committedMeasurement?.snapshot.text ?? text;
}

export function shouldRenderGlyphLayer(
  stage: MorphStage,
  plan: MorphRenderPlan | null,
  measurement: MorphMeasurement | null,
) {
  if (stage === "idle") {
    return measurement !== null;
  }

  return plan !== null;
}

export function resolveGlyphSliceWhiteSpace(
  snapshot: MorphSnapshot | null,
): "inherit" | "nowrap" {
  if (snapshot === null) {
    return "inherit";
  }

  return "nowrap";
}

function toSteadyLiveItem(grapheme: MorphCharacterLayout): MorphLiveItem {
  return {
    ...grapheme,
    kind: "move",
    fromLeft: grapheme.left,
    fromTop: grapheme.top,
  };
}

export function createSteadyGlyphPlan(
  measurement: MorphMeasurement,
): MorphRenderPlan {
  const snapshot = measurement.snapshot;

  return {
    frameWidth: snapshot.width,
    frameHeight: snapshot.height,
    layoutInlineSizeFrom: measurement.layoutInlineSize,
    layoutInlineSizeTo: measurement.layoutInlineSize,
    sourceRenderText: snapshot.renderText,
    targetRenderText: snapshot.renderText,
    sourceRootOrigin: measurement.rootOrigin,
    visualBridge: ZERO_BRIDGE,
    liveItems: snapshot.graphemes.map(toSteadyLiveItem),
    exitItems: [],
  };
}
