import type { PretextMorphMeasurementBackend } from "../utils/text-layout/pretextMorph";

export const MORPH = {
  durationMs: 280,
  maxFadeMs: 150,
  ease: "cubic-bezier(0.22, 1, 0.36, 1)",
  geometryEpsilon: 0.5,
  contentWidthLockEpsilon: 2,
  lineGroupingEpsilon: 1,
} as const;

export type SupportedWhiteSpace = "normal" | "nowrap" | "pre-wrap";
export type MorphMeasurementStability = "stable" | "live" | "finalize";
export type MorphMeasurementCause =
  | "steady"
  | "root-motion"
  | "font-metrics";

export type MorphCharacterLayout = {
  glyph: string;
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type MorphSnapshot = {
  text: string;
  renderText: string;
  width: number;
  height: number;
  graphemes: MorphCharacterLayout[];
};

export type MorphMeasurement = {
  snapshot: MorphSnapshot;
  layoutInlineSize: number;
  reservedInlineSize: number | null;
  flowInlineSize: number | null;
  rootOrigin: { left: number; top: number };
};

export type MorphVisualBridge = {
  offsetX: number;
  offsetY: number;
};

export type MorphLiveItem = MorphCharacterLayout & {
  kind: "move" | "enter";
  fromLeft: number | null;
  fromTop: number | null;
};

export type MorphRenderPlan = {
  frameWidth: number;
  frameHeight: number;
  layoutInlineSizeFrom: number;
  layoutInlineSizeTo: number;
  sourceRenderText: string;
  targetRenderText: string;
  sourceRootOrigin: { left: number; top: number };
  visualBridge: MorphVisualBridge;
  liveItems: MorphLiveItem[];
  exitItems: MorphCharacterLayout[];
};

export type LayoutContext = {
  display: string;
  direction: string;
  font: string;
  fontFeatureSettings: string;
  fontVariationSettings: string;
  letterSpacingPx: number;
  lineHeightPx: number;
  measurementCause: MorphMeasurementCause;
  measurementStability: MorphMeasurementStability;
  parentDisplay: string;
  textTransform: string;
  whiteSpace: SupportedWhiteSpace;
  width: number;
  wordSpacingPx: number;
  measurementVersion: number;
};

export type MorphSegment = {
  glyph: string;
  key: string;
};

export type MorphStage = "idle" | "prepare" | "animate";

export type MorphState = {
  stage: MorphStage;
  measurement: MorphMeasurement | null;
  plan: MorphRenderPlan | null;
};

export type MorphSession = {
  committed: MorphMeasurement | null;
  target: MorphMeasurement | null;
  animating: boolean;
};

export type MorphTimeline = {
  prepareFrame: number | null;
  animateFrame: number | null;
  finalizeTimer: number | null;
};

export type MorphMeasurementRequest = {
  text: string;
  renderText: string;
  segments: readonly MorphSegment[];
  measurementBackend: PretextMorphMeasurementBackend;
  useContentInlineSize: boolean;
  domMeasurementKey: string | null;
};

export const EMPTY_STATE: MorphState = {
  stage: "idle",
  measurement: null,
  plan: null,
};

export const EMPTY_SESSION: MorphSession = {
  committed: null,
  target: null,
  animating: false,
};

export const EMPTY_TIMELINE: MorphTimeline = {
  prepareFrame: null,
  animateFrame: null,
  finalizeTimer: null,
};

export const ZERO_BRIDGE: MorphVisualBridge = {
  offsetX: 0,
  offsetY: 0,
};

export const EMPTY_SEGMENTS: readonly MorphSegment[] = [];

export function resolveContentWidthLockInlineSize(layoutHint: MorphMeasurement) {
  if (layoutHint.flowInlineSize !== null) {
    return layoutHint.flowInlineSize;
  }

  return layoutHint.snapshot.width;
}
