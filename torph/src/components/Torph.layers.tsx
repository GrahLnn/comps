import type { CSSProperties, RefObject } from "react";
import {
  getExitTransform as getExitTransformModel,
  getExitTransition as getExitTransitionModel,
  getLiveTransform as getLiveTransformModel,
  getLiveTransition as getLiveTransitionModel,
  getMeasurementLayerStyle as getMeasurementLayerStyleModel,
  getOverlayStyle as getOverlayStyleModel,
} from "../core/render";
import type {
  LayoutContext,
  MorphCharacterLayout,
  MorphLiveItem,
  MorphRenderPlan,
  MorphStage,
  MorphVisualBridge,
} from "../core/types";

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

export function getScreenReaderOnlyStyle() {
  return SCREEN_READER_ONLY_STYLE;
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

export function MorphOverlay({
  overlayRef,
  stage,
  plan,
  sourceSliceWhiteSpace,
  targetSliceWhiteSpace,
  debugInstanceId,
  debugLabel = null,
}: {
  overlayRef?: RefObject<HTMLDivElement | null>;
  stage: MorphStage;
  plan: MorphRenderPlan;
  sourceSliceWhiteSpace: "inherit" | "nowrap";
  targetSliceWhiteSpace: "inherit" | "nowrap";
  debugInstanceId: number;
  debugLabel?: string | null;
}) {
  const exitItems = stage !== "idle" ? plan.exitItems : [];

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      data-torph-debug-role="overlay"
      data-torph-debug-instance-id={String(debugInstanceId)}
      data-torph-debug-label={debugLabel ?? undefined}
      data-torph-debug-stage={stage}
      style={getOverlayStyleModel(stage, plan)}
    >
      {exitItems.map((item) => (
        <span
          key={`exit-${item.key}`}
          data-morph-role="exit"
          data-morph-key={item.key}
          data-morph-glyph={item.glyph}
          data-torph-debug-instance-id={String(debugInstanceId)}
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
          data-torph-debug-instance-id={String(debugInstanceId)}
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

export function MeasurementLayer({
  layerRef,
  layoutContext,
  text,
  useContentInlineSize,
  debugInstanceId,
  debugLabel = null,
}: {
  layerRef: RefObject<HTMLSpanElement | null>;
  layoutContext: LayoutContext | null;
  text: string;
  useContentInlineSize: boolean;
  debugInstanceId: number;
  debugLabel?: string | null;
}) {
  return (
    <span
      ref={layerRef}
      aria-hidden="true"
      data-torph-debug-role="measurement"
      data-torph-debug-instance-id={String(debugInstanceId)}
      data-torph-debug-label={debugLabel ?? undefined}
      data-torph-debug-text={text}
      style={getMeasurementLayerStyleModel(layoutContext, useContentInlineSize)}
    >
      {text}
    </span>
  );
}

export function FlowTextLayer({
  flowText,
  flowTextRef,
  shouldHideFlowText,
  debugInstanceId,
  debugLabel = null,
}: {
  flowText: string;
  flowTextRef: RefObject<HTMLSpanElement | null>;
  shouldHideFlowText: boolean;
  debugInstanceId: number;
  debugLabel?: string | null;
}) {
  return (
    <span
      aria-hidden="true"
      data-torph-debug-role="flow-shell"
      data-torph-debug-instance-id={String(debugInstanceId)}
      data-torph-debug-label={debugLabel ?? undefined}
      data-torph-debug-text={flowText}
      style={getFallbackTextStyle(shouldHideFlowText)}
    >
      <span
        ref={flowTextRef}
        data-torph-debug-role="flow"
        data-torph-debug-instance-id={String(debugInstanceId)}
        data-torph-debug-label={debugLabel ?? undefined}
        data-torph-debug-text={flowText}
        style={FLOW_TEXT_LAYOUT_STYLE}
      >
        {flowText}
      </span>
    </span>
  );
}
