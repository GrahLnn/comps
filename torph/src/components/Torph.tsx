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
import {
  clearPretextMorphCaches,
  getPretextMorphMeasurementBackend,
  getPretextMorphRenderedText,
  getPretextMorphStyleSignature,
  measureMorphSnapshotWithPretext,
  type PretextMorphMeasurementBackend,
} from "../utils/text-layout/pretextMorph";

const MORPH = {
  durationMs: 280,
  maxFadeMs: 150,
  ease: "cubic-bezier(0.22, 1, 0.36, 1)",
  geometryEpsilon: 0.5,
  lineGroupingEpsilon: 1,
} as const;

const MORPH_SEGMENT_CACHE_LIMIT = 256;
const DOM_MEASUREMENT_SNAPSHOT_CACHE_LIMIT = 8;

export type SupportedWhiteSpace = "normal" | "nowrap" | "pre-wrap";

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
  visualBridge: MorphVisualBridge;
  liveItems: MorphLiveItem[];
  exitItems: MorphCharacterLayout[];
};

type LayoutContext = {
  display: string;
  direction: string;
  font: string;
  fontFeatureSettings: string;
  fontVariationSettings: string;
  letterSpacingPx: number;
  lineHeightPx: number;
  parentDisplay: string;
  textTransform: string;
  whiteSpace: SupportedWhiteSpace;
  width: number;
  wordSpacingPx: number;
  measurementVersion: number;
};

type MorphSegment = {
  glyph: string;
  key: string;
};

type GraphemeSegment = {
  segment: string;
};

type GraphemeSegmenterLike = {
  segment(text: string): Iterable<GraphemeSegment>;
};

type GraphemeSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: "grapheme" },
) => GraphemeSegmenterLike;

type DomMeasurementService = {
  root: HTMLDivElement;
  host: HTMLSpanElement;
  glyphNodes: HTMLSpanElement[];
};

type IntlWithOptionalSegmenter = typeof Intl & {
  Segmenter?: GraphemeSegmenterConstructor;
};

type MorphStage = "idle" | "prepare" | "animate";

type MorphState = {
  stage: MorphStage;
  measurement: MorphMeasurement | null;
  plan: MorphRenderPlan | null;
};

type MorphSession = {
  committed: MorphMeasurement | null;
  target: MorphMeasurement | null;
  animating: boolean;
};

type MorphTimeline = {
  prepareFrame: number | null;
  animateFrame: number | null;
  finalizeTimer: number | null;
};

type MorphMeasurementRequest = {
  text: string;
  renderText: string;
  segments: readonly MorphSegment[];
  measurementBackend: PretextMorphMeasurementBackend;
  useContentInlineSize: boolean;
  domMeasurementKey: string | null;
};

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

const EMPTY_STATE: MorphState = {
  stage: "idle",
  measurement: null,
  plan: null,
};

const EMPTY_SESSION: MorphSession = {
  committed: null,
  target: null,
  animating: false,
};

const EMPTY_TIMELINE: MorphTimeline = {
  prepareFrame: null,
  animateFrame: null,
  finalizeTimer: null,
};

const ZERO_BRIDGE: MorphVisualBridge = {
  offsetX: 0,
  offsetY: 0,
};

const EMPTY_SEGMENTS: readonly MorphSegment[] = [];

const morphSegmentCache = new Map<string, readonly MorphSegment[]>();
const pretextMorphTrustCache = new Map<string, boolean>();
let morphMeasurementEpoch = 1;
let activeMorphMeasurementConsumers = 0;
let detachMorphMeasurementInvalidationListeners: (() => void) | null = null;

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

const MEASUREMENT_LAYER_STYLE = {
  pointerEvents: "none",
  visibility: "hidden",
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  display: "block",
} satisfies CSSProperties;

const FALLBACK_TEXT_STYLE = {
  display: "block",
  gridArea: "1 / 1",
} satisfies CSSProperties;

const OVERLAY_STYLE = {
  position: "absolute",
  inset: 0,
  minWidth: 0,
  pointerEvents: "none",
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

const MEASUREMENT_GLYPH_STYLE = {
  ...SHARED_GLYPH_TYPOGRAPHY_STYLE,
  display: "inline",
} satisfies CSSProperties;

const ABSOLUTE_GLYPH_STYLE = {
  ...SHARED_GLYPH_TYPOGRAPHY_STYLE,
  position: "absolute",
  display: "block",
  overflow: "visible",
  transformOrigin: "left top",
  whiteSpace: "pre",
} satisfies CSSProperties;

let graphemeSegmenter: GraphemeSegmenterLike | null = null;
let domMeasurementService: DomMeasurementService | null = null;

function parsePx(value: string) {
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return null;
}

function readFont(styles: CSSStyleDeclaration) {
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

function readLayoutContext(node: HTMLElement, width?: number): LayoutContext {
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
    a.parentDisplay === b.parentDisplay &&
    a.textTransform === b.textTransform &&
    a.whiteSpace === b.whiteSpace &&
    Math.abs(a.width - b.width) < MORPH.geometryEpsilon &&
    Math.abs(a.wordSpacingPx - b.wordSpacingPx) < MORPH.geometryEpsilon
  );
}

function clearPretextMorphTrustCache() {
  pretextMorphTrustCache.clear();
}

function clearMorphMeasurementCaches() {
  morphSegmentCache.clear();
  clearPretextMorphTrustCache();
  clearPretextMorphCaches();
}

function bumpMorphMeasurementEpoch() {
  morphMeasurementEpoch += 1;
}

function getMorphMeasurementEpoch() {
  return morphMeasurementEpoch;
}

function isSingleLineSnapshot(snapshot: MorphSnapshot) {
  if (snapshot.graphemes.length <= 1) {
    return true;
  }

  const firstTop = snapshot.graphemes[0]!.top;
  return snapshot.graphemes.every((grapheme) =>
    nearlyEqual(grapheme.top, firstTop, MORPH.lineGroupingEpsilon),
  );
}

function acquireMorphMeasurementInvalidationListeners() {
  activeMorphMeasurementConsumers += 1;

  if (detachMorphMeasurementInvalidationListeners === null) {
    const handleFontChange = () => {
      clearMorphMeasurementCaches();
      bumpMorphMeasurementEpoch();
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

function useObservedLayoutContext<T extends HTMLElement>(deps: readonly unknown[]) {
  const ref = useRef<T | null>(null);
  const [layoutContext, setLayoutContext] = useState<LayoutContext | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }

    let disposed = false;

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

      const next = readLayoutContext(node, width);
      commitLayoutContext(next, refreshMeasurements);
    };

    const initialLayoutContext = readLayoutContext(node);
    const shouldObserveWrappingWidth =
      initialLayoutContext.whiteSpace !== "nowrap" &&
      !supportsIntrinsicWidthLock(initialLayoutContext.display, initialLayoutContext.parentDisplay);
    commitLayoutContext(initialLayoutContext, true);

    let resizeObserver: ResizeObserver | null = null;
    if (shouldObserveWrappingWidth) {
      resizeObserver = new ResizeObserver(([entry]) => {
        syncLayoutContext({
          width: entry?.contentRect.width,
        });
      });
    }

    resizeObserver?.observe(node);
    acquireMorphMeasurementInvalidationListeners();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      releaseMorphMeasurementInvalidationListeners();
    };
  }, deps);

  return { ref, layoutContext };
}

function getSegmenter() {
  if (graphemeSegmenter !== null) {
    return graphemeSegmenter;
  }

  const segmenterConstructor = (Intl as IntlWithOptionalSegmenter).Segmenter;
  if (segmenterConstructor === undefined) {
    throw new Error("Torph requires Intl.Segmenter for grapheme-safe pairing.");
  }

  graphemeSegmenter = new segmenterConstructor(undefined, {
    granularity: "grapheme",
  });

  return graphemeSegmenter;
}

function createMeasurementGlyphNode() {
  const node = document.createElement("span");
  node.style.font = "inherit";
  node.style.fontKerning = "inherit";
  node.style.fontFeatureSettings = "inherit";
  node.style.fontOpticalSizing = "inherit";
  node.style.fontStretch = "inherit";
  node.style.fontStyle = "inherit";
  node.style.fontVariant = "inherit";
  node.style.fontVariantNumeric = "inherit";
  node.style.fontVariationSettings = "inherit";
  node.style.fontWeight = "inherit";
  node.style.letterSpacing = "inherit";
  node.style.textTransform = "inherit";
  node.style.wordSpacing = "inherit";
  node.style.direction = "inherit";
  node.style.display = "inline";
  return node;
}

function getDomMeasurementService() {
  if (domMeasurementService !== null) {
    return domMeasurementService;
  }

  const root = document.createElement("div");
  root.setAttribute("aria-hidden", "true");
  root.style.position = "fixed";
  root.style.left = "0";
  root.style.top = "0";
  root.style.width = "0";
  root.style.height = "0";
  root.style.overflow = "hidden";
  root.style.visibility = "hidden";
  root.style.pointerEvents = "none";
  root.style.zIndex = "-1";
  root.style.contain = "layout style paint";

  const host = document.createElement("span");
  root.appendChild(host);
  document.body.appendChild(root);

  domMeasurementService = {
    root,
    host,
    glyphNodes: [],
  };
  return domMeasurementService;
}

function syncMeasurementGlyphNodes(
  service: DomMeasurementService,
  segments: readonly MorphSegment[],
) {
  while (service.glyphNodes.length < segments.length) {
    const node = createMeasurementGlyphNode();
    service.host.appendChild(node);
    service.glyphNodes.push(node);
  }

  while (service.glyphNodes.length > segments.length) {
    const node = service.glyphNodes.pop();
    node?.remove();
  }

  for (let index = 0; index < segments.length; index += 1) {
    service.glyphNodes[index]!.textContent = segments[index]!.glyph;
  }
}

function applyMeasurementHostStyle({
  host,
  root,
  layoutContext,
  useContentInlineSize,
}: {
  host: HTMLSpanElement;
  root: HTMLElement;
  layoutContext: LayoutContext;
  useContentInlineSize: boolean;
}) {
  const styles = getComputedStyle(root);
  host.style.position = "absolute";
  host.style.top = "0";
  host.style.left = "0";
  host.style.right = "auto";
  host.style.display = "block";
  host.style.margin = "0";
  host.style.padding = "0";
  host.style.border = "0";
  host.style.minWidth = "0";
  host.style.boxSizing = "content-box";
  host.style.font = readFont(styles);
  host.style.fontKerning = styles.fontKerning;
  host.style.fontFeatureSettings = styles.fontFeatureSettings;
  host.style.fontOpticalSizing = styles.fontOpticalSizing;
  host.style.fontSynthesis = styles.fontSynthesis;
  host.style.fontStretch = styles.fontStretch;
  host.style.fontStyle = styles.fontStyle;
  host.style.fontVariant = styles.fontVariant;
  host.style.fontVariantAlternates = styles.fontVariantAlternates;
  host.style.fontVariantCaps = styles.fontVariantCaps;
  host.style.fontVariantEastAsian = styles.fontVariantEastAsian;
  host.style.fontVariantLigatures = styles.fontVariantLigatures;
  host.style.fontVariantNumeric = styles.fontVariantNumeric;
  host.style.fontVariantPosition = styles.fontVariantPosition;
  host.style.fontVariationSettings = styles.fontVariationSettings;
  host.style.fontWeight = styles.fontWeight;
  host.style.letterSpacing = styles.letterSpacing;
  host.style.lineHeight = styles.lineHeight;
  host.style.textRendering = styles.textRendering;
  host.style.textTransform = styles.textTransform;
  host.style.whiteSpace = styles.whiteSpace;
  host.style.wordSpacing = styles.wordSpacing;
  host.style.direction = styles.direction;
  host.style.width = `${layoutContext.width}px`;
  if (useContentInlineSize || layoutContext.whiteSpace === "nowrap") {
    host.style.width = "max-content";
  }
}

function segmentTorphText(text: string): MorphSegment[] {
  const segments: MorphSegment[] = [];
  let ordinal = 0;

  for (const segment of getSegmenter().segment(text)) {
    segments.push({
      glyph: segment.segment,
      key: `${segment.segment}:${ordinal}`,
    });
    ordinal += 1;
  }

  return segments;
}

function readCachedMorphSegments(text: string): readonly MorphSegment[] {
  const cached = morphSegmentCache.get(text);
  if (cached !== undefined) {
    morphSegmentCache.delete(text);
    morphSegmentCache.set(text, cached);
    return cached;
  }

  const segments = segmentTorphText(text);
  morphSegmentCache.set(text, segments);

  if (morphSegmentCache.size > MORPH_SEGMENT_CACHE_LIMIT) {
    const oldest = morphSegmentCache.keys().next();
    if (!oldest.done) {
      morphSegmentCache.delete(oldest.value);
    }
  }

  return segments;
}

function getDomMeasurementRequestKey(
  text: string,
  renderText: string,
  layoutContext: LayoutContext,
  useContentInlineSize: boolean,
) {
  let inlineSizeMode = "container";
  if (useContentInlineSize) {
    inlineSizeMode = "content";
  }

  return `dom\u0000${inlineSizeMode}\u0000${text}\u0000${renderText}\u0000${layoutContext.measurementVersion}\u0000${getMorphMeasurementEpoch()}`;
}

function readCachedMorphSnapshot(cache: Map<string, MorphSnapshot>, cacheKey: string) {
  const cached = cache.get(cacheKey);
  if (cached === undefined) {
    return null;
  }

  cache.delete(cacheKey);
  cache.set(cacheKey, cached);
  return cached;
}

function rememberCachedMorphSnapshot(
  cache: Map<string, MorphSnapshot>,
  cacheKey: string,
  snapshot: MorphSnapshot,
) {
  cache.delete(cacheKey);
  cache.set(cacheKey, snapshot);

  if (cache.size > DOM_MEASUREMENT_SNAPSHOT_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
}

function assertMeasurementLayer(layer: HTMLElement | null, segments: readonly MorphSegment[]) {
  if (layer === null) {
    throw new Error("Torph measurement layer is missing.");
  }

  if (layer.children.length !== segments.length) {
    throw new Error(
      `Torph measurement layer is out of sync. Expected ${segments.length} glyph nodes, received ${layer.children.length}.`,
    );
  }

  return layer;
}

type MeasuredGlyphLayout = {
  glyph: string;
  key: string;
  left: number;
  top: number;
  width: number;
};

function readMeasuredGlyphLayouts(
  layer: HTMLElement,
  layerRect: DOMRect,
  segments: readonly MorphSegment[],
) {
  const measuredGlyphs: MeasuredGlyphLayout[] = [];
  const layerOffsetTop = layer.offsetTop;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const child = layer.children[index];
    if (!(child instanceof HTMLElement)) {
      throw new Error(`Torph glyph node ${index} is not an HTMLElement.`);
    }

    const rect = child.getBoundingClientRect();
    measuredGlyphs.push({
      glyph: segment.glyph,
      key: segment.key,
      left: rect.left - layerRect.left,
      top: child.offsetTop - layerOffsetTop,
      width: rect.width,
    } satisfies MeasuredGlyphLayout);
  }

  return measuredGlyphs;
}

function assignMeasuredGlyphLineIndices(measuredGlyphs: readonly MeasuredGlyphLayout[]) {
  const lineIndices: number[] = [];
  let lineCount = 0;
  let currentLineTop: number | null = null;

  for (const glyph of measuredGlyphs) {
    if (
      currentLineTop === null ||
      Math.abs(glyph.top - currentLineTop) > MORPH.lineGroupingEpsilon
    ) {
      currentLineTop = glyph.top;
      lineCount += 1;
    }

    lineIndices.push(lineCount - 1);
  }

  return {
    lineCount,
    lineIndices,
  };
}

export function measureMorphSnapshotFromLayer(
  text: string,
  renderText: string,
  segments: readonly MorphSegment[],
  layer: HTMLElement | null,
): MorphSnapshot {
  if (renderText.length === 0) {
    return {
      text,
      renderText,
      width: 0,
      height: 0,
      graphemes: [],
    };
  }

  const measurementLayer = assertMeasurementLayer(layer, segments);
  const layerRect = measurementLayer.getBoundingClientRect();
  const measuredGlyphs = readMeasuredGlyphLayouts(measurementLayer, layerRect, segments);
  const { lineCount, lineIndices } = assignMeasuredGlyphLineIndices(measuredGlyphs);
  let lineHeight = 0;
  if (lineCount !== 0) {
    lineHeight = layerRect.height / lineCount;
  }

  let width = 0;
  const graphemes = measuredGlyphs.map((glyph, index) => {
    const lineIndex = lineIndices[index];
    if (lineIndex === undefined) {
      throw new Error("Torph failed to assign a line index.");
    }

    width = Math.max(width, glyph.left + glyph.width);

    return {
      glyph: glyph.glyph,
      key: glyph.key,
      left: glyph.left,
      top: lineIndex * lineHeight,
      width: glyph.width,
      height: lineHeight,
    } satisfies MorphCharacterLayout;
  });

  return {
    text,
    renderText,
    width,
    height: layerRect.height,
    graphemes,
  };
}

function measureMorphSnapshotWithDomService({
  root,
  layoutContext,
  text,
  renderText,
  segments,
  useContentInlineSize,
}: {
  root: HTMLElement;
  layoutContext: LayoutContext;
  text: string;
  renderText: string;
  segments: readonly MorphSegment[];
  useContentInlineSize: boolean;
}) {
  if (renderText.length === 0) {
    return {
      text,
      renderText,
      width: 0,
      height: 0,
      graphemes: [],
    } satisfies MorphSnapshot;
  }

  const service = getDomMeasurementService();
  applyMeasurementHostStyle({
    host: service.host,
    root,
    layoutContext,
    useContentInlineSize,
  });
  syncMeasurementGlyphNodes(service, segments);
  return measureMorphSnapshotFromLayer(text, renderText, segments, service.host);
}

function readRootOrigin(node: HTMLElement) {
  const rect = node.getBoundingClientRect();
  return { left: rect.left, top: rect.top };
}

function getTrustedPretextMeasurementBackend(
  text: string,
  layoutContext: LayoutContext,
): PretextMorphMeasurementBackend {
  const backend = getPretextMorphMeasurementBackend(text, layoutContext);
  if (backend !== "probe") {
    return backend;
  }

  const signature = getPretextMorphStyleSignature(layoutContext);
  if (signature === null) {
    return "dom";
  }

  const trusted = pretextMorphTrustCache.get(signature);
  if (trusted === undefined) {
    return "probe";
  }

  if (trusted) {
    return "pretext";
  }

  return "dom";
}

function shouldMeasureUsingContentInlineSize(
  layoutContext: LayoutContext,
  layoutHint: MorphMeasurement | null,
) {
  if (supportsIntrinsicWidthLock(layoutContext.display, layoutContext.parentDisplay)) {
    return true;
  }

  if (layoutContext.whiteSpace === "nowrap") {
    return true;
  }

  if (layoutHint === null || !isSingleLineSnapshot(layoutHint.snapshot)) {
    return false;
  }

  return nearlyEqual(layoutHint.layoutInlineSize, layoutHint.snapshot.width);
}

function createMorphMeasurementRequest({
  text,
  layoutContext,
  layoutHint,
}: {
  text: string;
  layoutContext: LayoutContext | null;
  layoutHint: MorphMeasurement | null;
}): MorphMeasurementRequest | null {
  if (layoutContext === null) {
    return null;
  }

  const renderText = getPretextMorphRenderedText(text, layoutContext);
  const useContentInlineSize = shouldMeasureUsingContentInlineSize(layoutContext, layoutHint);
  const measurementBackend = getTrustedPretextMeasurementBackend(text, layoutContext);
  let segments: readonly MorphSegment[] = readCachedMorphSegments(renderText);
  if (measurementBackend === "pretext") {
    segments = EMPTY_SEGMENTS;
  }

  let domMeasurementKey: string | null = null;
  if (measurementBackend === "dom" && renderText.length > 0) {
    domMeasurementKey = getDomMeasurementRequestKey(
      text,
      renderText,
      layoutContext,
      useContentInlineSize,
    );
  }

  return {
    text,
    renderText,
    segments,
    measurementBackend,
    useContentInlineSize,
    domMeasurementKey,
  };
}

function rememberPretextMeasurementTrust(layoutContext: LayoutContext, trusted: boolean) {
  const signature = getPretextMorphStyleSignature(layoutContext);
  if (signature === null) {
    return;
  }

  pretextMorphTrustCache.set(signature, trusted);
}

function areSnapshotsEquivalentForPretextTrust(left: MorphSnapshot, right: MorphSnapshot) {
  if (left.renderText !== right.renderText || left.graphemes.length !== right.graphemes.length) {
    return false;
  }

  if (
    Math.abs(left.width - right.width) > MORPH.geometryEpsilon ||
    Math.abs(left.height - right.height) > MORPH.geometryEpsilon
  ) {
    return false;
  }

  for (let index = 0; index < left.graphemes.length; index += 1) {
    const from = left.graphemes[index]!;
    const to = right.graphemes[index]!;

    if (from.glyph !== to.glyph) {
      return false;
    }

    if (
      Math.abs(from.left - to.left) > MORPH.geometryEpsilon ||
      Math.abs(from.top - to.top) > MORPH.geometryEpsilon ||
      Math.abs(from.width - to.width) > MORPH.geometryEpsilon ||
      Math.abs(from.height - to.height) > MORPH.geometryEpsilon
    ) {
      return false;
    }
  }

  return true;
}

function measureFromNodes({
  root,
  layoutContext,
  layoutHint,
  layer,
  measurementBackend,
  snapshotOverride,
  text,
  renderText,
  segments,
}: {
  root: HTMLElement;
  layoutContext: LayoutContext;
  layoutHint: MorphMeasurement | null;
  layer: HTMLElement | null;
  measurementBackend: PretextMorphMeasurementBackend;
  snapshotOverride: MorphSnapshot | null;
  text: string;
  renderText: string;
  segments: readonly MorphSegment[];
}): MorphMeasurement {
  const useContentInlineSize = shouldMeasureUsingContentInlineSize(layoutContext, layoutHint);
  let measurementLayoutContext = layoutContext;
  if (useContentInlineSize && layoutContext.whiteSpace !== "nowrap") {
    measurementLayoutContext = {
      ...layoutContext,
      width: Number.MAX_SAFE_INTEGER / 4,
    };
  }
  const snapshot =
    snapshotOverride ??
    (() => {
      let pretextSnapshot: MorphSnapshot | null = null;
      if (measurementBackend !== "dom") {
        pretextSnapshot = measureMorphSnapshotWithPretext(text, measurementLayoutContext);
      }

      let domSnapshot: MorphSnapshot | null = null;
      if (measurementBackend === "dom") {
        domSnapshot = measureMorphSnapshotFromLayer(text, renderText, segments, layer);
      } else if (measurementBackend !== "pretext") {
        domSnapshot = measureMorphSnapshotWithDomService({
          root,
          layoutContext,
          text,
          renderText,
          segments,
          useContentInlineSize,
        });
      }

      if (measurementBackend === "probe" && pretextSnapshot !== null && domSnapshot !== null) {
        const trusted = areSnapshotsEquivalentForPretextTrust(pretextSnapshot, domSnapshot);
        rememberPretextMeasurementTrust(layoutContext, trusted);
        if (trusted) {
          return pretextSnapshot;
        }

        return domSnapshot;
      }

      const resolvedSnapshot = pretextSnapshot ?? domSnapshot;
      if (resolvedSnapshot === null) {
        throw new Error("Torph failed to resolve a measurement snapshot.");
      }

      return resolvedSnapshot;
    })();

  let layoutInlineSize = layoutContext.width;
  if (useContentInlineSize) {
    layoutInlineSize = snapshot.width;
  }

  let reservedInlineSize: number | null = null;
  if (supportsIntrinsicWidthLock(layoutContext.display, layoutContext.parentDisplay)) {
    reservedInlineSize = snapshot.width;
  }

  return {
    snapshot,
    layoutInlineSize,
    reservedInlineSize,
    rootOrigin: readRootOrigin(root),
  };
}

function pinMeasurementToCurrentOrigin(
  measurement: MorphMeasurement,
  origin: { left: number; top: number },
): MorphMeasurement {
  if (
    nearlyEqual(measurement.rootOrigin.left, origin.left) &&
    nearlyEqual(measurement.rootOrigin.top, origin.top)
  ) {
    return measurement;
  }

  return {
    snapshot: measurement.snapshot,
    layoutInlineSize: measurement.layoutInlineSize,
    reservedInlineSize: measurement.reservedInlineSize,
    rootOrigin: origin,
  };
}

function bucketByGlyph(graphemes: MorphCharacterLayout[]) {
  const buckets = new Map<string, MorphCharacterLayout[]>();
  for (const grapheme of graphemes) {
    const bucket = buckets.get(grapheme.glyph);
    if (bucket) {
      bucket.push(grapheme);
    } else {
      buckets.set(grapheme.glyph, [grapheme]);
    }
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

export function resolveMorphFrameBounds(previous: MorphSnapshot, next: MorphSnapshot) {
  return {
    width: Math.max(previous.width, next.width),
    height: Math.max(previous.height, next.height),
  };
}

export function buildMorphVisualBridge(
  previous: MorphMeasurement,
  next: MorphMeasurement,
): MorphVisualBridge {
  return {
    offsetX: previous.rootOrigin.left - next.rootOrigin.left,
    offsetY: previous.rootOrigin.top - next.rootOrigin.top,
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
    visualBridge,
    liveItems: next.snapshot.graphemes.map((grapheme) => {
      const move = movesByDestinationKey.get(grapheme.key);
      if (move) {
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

function nearlyEqual(a: number, b: number, epsilon: number = MORPH.geometryEpsilon) {
  return Math.abs(a - b) <= epsilon;
}

function sameSnapshot(a: MorphSnapshot, b: MorphSnapshot) {
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

  if (!nearlyEqual(a.width, b.width) || !nearlyEqual(a.height, b.height)) {
    return false;
  }

  for (let index = 0; index < a.graphemes.length; index += 1) {
    const left = a.graphemes[index]!;
    const right = b.graphemes[index]!;

    if (left.glyph !== right.glyph || left.key !== right.key) {
      return false;
    }

    if (
      !nearlyEqual(left.left, right.left) ||
      !nearlyEqual(left.top, right.top) ||
      !nearlyEqual(left.width, right.width) ||
      !nearlyEqual(left.height, right.height)
    ) {
      return false;
    }
  }

  return true;
}

function sameMeasurement(a: MorphMeasurement, b: MorphMeasurement) {
  if (a === b) {
    return true;
  }

  return (
    sameSnapshot(a.snapshot, b.snapshot) &&
    nearlyEqual(a.layoutInlineSize, b.layoutInlineSize) &&
    ((a.reservedInlineSize === null && b.reservedInlineSize === null) ||
      (a.reservedInlineSize !== null &&
        b.reservedInlineSize !== null &&
        nearlyEqual(a.reservedInlineSize, b.reservedInlineSize))) &&
    nearlyEqual(a.rootOrigin.left, b.rootOrigin.left) &&
    nearlyEqual(a.rootOrigin.top, b.rootOrigin.top)
  );
}

function refreshAnimatingTarget(
  activeTarget: MorphMeasurement,
  measurement: MorphMeasurement,
): MorphMeasurement {
  if (sameMeasurement(activeTarget, measurement)) {
    return activeTarget;
  }

  return {
    snapshot: activeTarget.snapshot,
    layoutInlineSize: measurement.layoutInlineSize,
    reservedInlineSize: measurement.reservedInlineSize,
    rootOrigin: measurement.rootOrigin,
  };
}

function reuseCommittedMeasurement(
  committed: MorphMeasurement,
  measurement: MorphMeasurement,
): MorphMeasurement {
  if (sameMeasurement(committed, measurement)) {
    return committed;
  }

  return measurement;
}

function createStaticState(measurement: MorphMeasurement): MorphState {
  return {
    stage: "idle",
    measurement,
    plan: null,
  };
}

function areFontsReady() {
  return document.fonts.status === "loaded";
}

function cancelTimeline(timeline: MorphTimeline) {
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

function resetMorph(
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

function commitStaticMeasurement(
  session: MorphSession,
  measurement: MorphMeasurement,
  setState: (state: MorphState) => void,
) {
  session.committed = measurement;
  session.target = null;
  session.animating = false;
  setState(createStaticState(measurement));
}

function scheduleMorphTimeline({
  session,
  timeline,
  measurement,
  plan,
  setState,
}: {
  session: MorphSession;
  timeline: MorphTimeline;
  measurement: MorphMeasurement;
  plan: MorphRenderPlan;
  setState: Dispatch<SetStateAction<MorphState>>;
}) {
  timeline.prepareFrame = requestAnimationFrame(() => {
    timeline.prepareFrame = null;

    setState((current) => {
      if (current.measurement !== measurement || current.plan !== plan) {
        return current;
      }

      return {
        stage: "animate",
        measurement,
        plan,
      };
    });

    timeline.animateFrame = requestAnimationFrame(() => {
      timeline.animateFrame = null;
      timeline.finalizeTimer = window.setTimeout(() => {
        timeline.finalizeTimer = null;
        commitStaticMeasurement(session, session.target ?? measurement, setState);
      }, MORPH.durationMs);
    });
  });
}

function startMorph({
  nextMeasurement,
  session,
  timeline,
  setState,
}: {
  nextMeasurement: MorphMeasurement;
  session: MorphSession;
  timeline: MorphTimeline;
  setState: Dispatch<SetStateAction<MorphState>>;
}) {
  let sourceMeasurement = session.committed;
  if (session.animating && session.target) {
    sourceMeasurement = session.target;
  }
  if (sourceMeasurement === null) {
    commitStaticMeasurement(session, nextMeasurement, setState);
    return;
  }

  const previousMeasurement = pinMeasurementToCurrentOrigin(
    sourceMeasurement,
    nextMeasurement.rootOrigin,
  );
  const visualBridge = buildMorphVisualBridge(previousMeasurement, nextMeasurement);
  const plan = buildMorphPlan(previousMeasurement, nextMeasurement, visualBridge);

  session.target = nextMeasurement;
  session.animating = true;
  setState({
    stage: "prepare",
    measurement: nextMeasurement,
    plan,
  });

  scheduleMorphTimeline({
    session,
    timeline,
    measurement: nextMeasurement,
    plan,
    setState,
  });
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
    resetMorph(session, timeline, setState);
    return null;
  }

  if (measurementBackend === null) {
    throw new Error("Torph measurement backend is missing.");
  }

  let layoutHint = session.committed;
  if (session.animating && session.target !== null) {
    layoutHint = session.target;
  }
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

  if (session.animating && session.target !== null) {
    if (nextMeasurement.snapshot.renderText === session.target.snapshot.renderText) {
      session.target = refreshAnimatingTarget(session.target, nextMeasurement);
      return nextMeasurement;
    }
  }

  cancelTimeline(timeline);

  if (session.committed === null) {
    commitStaticMeasurement(session, nextMeasurement, setState);
    return nextMeasurement;
  }

  if (!areFontsReady()) {
    commitStaticMeasurement(session, nextMeasurement, setState);
    return nextMeasurement;
  }

  if (session.committed.snapshot.renderText === nextMeasurement.snapshot.renderText) {
    commitStaticMeasurement(
      session,
      reuseCommittedMeasurement(session.committed, nextMeasurement),
      setState,
    );
    return nextMeasurement;
  }

  startMorph({
    nextMeasurement,
    session,
    timeline,
    setState,
  });
  return nextMeasurement;
}

function syncCommittedRootOriginWhenIdle({
  root,
  layoutContext,
  state,
  session,
}: {
  root: HTMLElement | null;
  layoutContext: LayoutContext | null;
  state: MorphState;
  session: MorphSession;
}) {
  if (root === null || layoutContext === null) {
    return;
  }

  if (state.stage !== "idle" || state.measurement === null) {
    return;
  }

  const nextRootOrigin = readRootOrigin(root);
  const committedMeasurement = state.measurement;
  if (
    nearlyEqual(committedMeasurement.rootOrigin.left, nextRootOrigin.left) &&
    nearlyEqual(committedMeasurement.rootOrigin.top, nextRootOrigin.top)
  ) {
    session.committed = committedMeasurement;
    return;
  }

  session.committed = {
    snapshot: committedMeasurement.snapshot,
    layoutInlineSize: committedMeasurement.layoutInlineSize,
    reservedInlineSize: committedMeasurement.reservedInlineSize,
    rootOrigin: nextRootOrigin,
  };
}

function getFadeDuration(fraction: number) {
  return Math.min(MORPH.durationMs * fraction, MORPH.maxFadeMs);
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
  const parentNeedsReservation =
    parentDisplay === "flex" ||
    parentDisplay === "inline-flex" ||
    parentDisplay === "grid" ||
    parentDisplay === "inline-grid";

  return (
    display === "inline" ||
    display === "inline-block" ||
    display === "inline-flex" ||
    display === "inline-grid" ||
    parentNeedsReservation
  );
}

export function getRootDisplay(layoutContext: LayoutContext | null): "grid" | "inline-grid" {
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
  let width = measurement?.reservedInlineSize ?? undefined;
  if (plan !== null) {
    width = plan.layoutInlineSizeTo;
    if (stage === "prepare") {
      width = plan.layoutInlineSizeFrom;
    }
  }

  const height = plan?.frameHeight ?? measurement?.snapshot.height;
  const shouldTransitionWidth =
    stage === "animate" &&
    plan !== null &&
    !nearlyEqual(plan.layoutInlineSizeFrom, plan.layoutInlineSizeTo);

  const style: CSSProperties = {
    position: "relative",
    display: getRootDisplay(layoutContext),
  };

  if (width !== undefined) {
    style.width = width;
  }

  if (height !== undefined) {
    style.height = height;
  }

  if (shouldTransitionWidth) {
    style.transition = `width ${MORPH.durationMs}ms ${MORPH.ease}`;
  }

  return style;
}

export function getMeasurementLayerStyle(
  layoutContext: LayoutContext | null,
  useContentInlineSize = false,
): CSSProperties {
  const intrinsicWidthLock =
    layoutContext !== null &&
    (useContentInlineSize ||
      supportsIntrinsicWidthLock(layoutContext.display, layoutContext.parentDisplay));

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
  return committedMeasurement?.snapshot.text ?? stateMeasurement?.snapshot.text ?? text;
}

export function resolveVisibleFlowText(
  pendingBootstrapText: string | null,
  committedMeasurement: MorphMeasurement | null,
  stateMeasurement: MorphMeasurement | null,
  text: string,
) {
  return pendingBootstrapText ?? resolveFlowText(committedMeasurement, stateMeasurement, text);
}

export function resolveActivationBootstrapText(
  isActivated: boolean,
  previousText: string,
  nextText: string,
) {
  if (!isActivated && nextText !== previousText) {
    return previousText;
  }

  return null;
}

function getOverlayStyle(plan: MorphRenderPlan): CSSProperties {
  return {
    ...OVERLAY_STYLE,
    right: "auto",
    bottom: "auto",
    width: plan.frameWidth,
    height: plan.frameHeight,
  };
}

function getFallbackTextStyle(shouldRenderOverlay: boolean): CSSProperties {
  if (!shouldRenderOverlay) {
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
    lineHeight: `${item.height}px`,
    opacity: getLiveOpacity(item, stage),
    transform: getLiveTransform(item, stage, visualBridge),
    transition: getLiveTransition(item, stage),
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
    lineHeight: `${item.height}px`,
    opacity: getExitOpacity(stage),
    transform: getExitTransform(visualBridge),
    transition: getExitTransition(stage),
  };
}

function MorphOverlay({ stage, plan }: { stage: MorphStage; plan: MorphRenderPlan }) {
  let exitItems: MorphCharacterLayout[] = [];
  if (stage !== "idle") {
    exitItems = plan.exitItems;
  }

  return (
    <div aria-hidden="true" style={getOverlayStyle(plan)}>
      {exitItems.map((item) => (
        <span
          key={`exit-${item.key}`}
          style={getExitGlyphStyle(item, stage, plan.visualBridge)}
        >
          {item.glyph}
        </span>
      ))}
      {plan.liveItems.map((item) => (
        <span key={item.key} style={getLiveGlyphStyle(item, stage, plan.visualBridge)}>
          {item.glyph}
        </span>
      ))}
    </div>
  );
}

function MeasurementLayer({
  layerRef,
  layoutContext,
  text,
  segments,
  useContentInlineSize,
}: {
  layerRef: RefObject<HTMLSpanElement | null>;
  layoutContext: LayoutContext | null;
  text: string;
  segments: readonly MorphSegment[];
  useContentInlineSize: boolean;
}) {
  let glyphs: readonly MorphSegment[] = segments;
  if (text.length === 0) {
    glyphs = EMPTY_SEGMENTS;
  }

  return (
    <span
      ref={layerRef}
      aria-hidden="true"
      style={getMeasurementLayerStyle(layoutContext, useContentInlineSize)}
    >
      {glyphs.map((segment) => (
        <span key={segment.key} data-morph-key={segment.key} style={MEASUREMENT_GLYPH_STYLE}>
          {segment.glyph}
        </span>
      ))}
    </span>
  );
}

function useMorphTransition(text: string, className?: string, bootstrapText: string | null = null) {
  const { ref, layoutContext } = useObservedLayoutContext<HTMLDivElement>([className]);
  const measurementLayerRef = useRef<HTMLSpanElement | null>(null);
  const bootstrapMeasurementLayerRef = useRef<HTMLSpanElement | null>(null);
  const completedDomMeasurementKeyRef = useRef<string | null>(null);
  const domMeasurementSnapshotCacheRef = useRef(new Map<string, MorphSnapshot>());
  const pendingBootstrapTextRef = useRef<string | null>(bootstrapText);
  const sessionRef = useRef<MorphSession>({ ...EMPTY_SESSION });
  const timelineRef = useRef<MorphTimeline>({ ...EMPTY_TIMELINE });
  const [domMeasurementRequestKey, setDomMeasurementRequestKey] = useState<string | null>(null);
  const [state, setState] = useState<MorphState>(EMPTY_STATE);
  if (
    pendingBootstrapTextRef.current === null &&
    bootstrapText !== null &&
    bootstrapText !== text &&
    sessionRef.current.committed === null
  ) {
    pendingBootstrapTextRef.current = bootstrapText;
  }

  let measurementHint = sessionRef.current.committed;
  if (sessionRef.current.animating) {
    measurementHint = sessionRef.current.target ?? sessionRef.current.committed;
  }
  const measurementRequest = useMemo(
    () =>
      createMorphMeasurementRequest({
        text,
        layoutContext,
        layoutHint: measurementHint,
      }),
    [text, layoutContext, measurementHint],
  );
  let pendingBootstrapText: string | null = null;
  if (sessionRef.current.committed === null) {
    pendingBootstrapText = pendingBootstrapTextRef.current;
  }
  const bootstrapMeasurementRequest = useMemo(
    () => {
      if (pendingBootstrapText === null) {
        return null;
      }

      return createMorphMeasurementRequest({
        text: pendingBootstrapText,
        layoutContext,
        layoutHint: null,
      });
    },
    [pendingBootstrapText, layoutContext],
  );
  const renderText = measurementRequest?.renderText ?? text;
  const useContentInlineSize = measurementRequest?.useContentInlineSize ?? false;
  const measurementBackend = measurementRequest?.measurementBackend ?? null;
  const segments = measurementRequest?.segments ?? EMPTY_SEGMENTS;
  const domMeasurementKey = measurementRequest?.domMeasurementKey ?? null;
  const shouldRenderBootstrapSourceMeasurementLayer =
    bootstrapMeasurementRequest?.measurementBackend === "dom" &&
    bootstrapMeasurementRequest.renderText.length > 0;

  useLayoutEffect(() => {
    if (ref.current === null || layoutContext === null) {
      completedDomMeasurementKeyRef.current = null;
      if (domMeasurementRequestKey !== null) {
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

    if (
      pendingBootstrapText !== null &&
      pendingBootstrapText !== text &&
      bootstrapMeasurementRequest !== null &&
      measurementRequest !== null
    ) {
      let bootstrapDomSnapshot: MorphSnapshot | null = null;
      if (bootstrapMeasurementRequest.domMeasurementKey !== null) {
        bootstrapDomSnapshot = readCachedMorphSnapshot(
          domMeasurementSnapshotCacheRef.current,
          bootstrapMeasurementRequest.domMeasurementKey,
        );
      }
      if (
        bootstrapMeasurementRequest.domMeasurementKey !== null &&
        bootstrapDomSnapshot === null &&
        bootstrapMeasurementLayerRef.current === null
      ) {
        return;
      }

      const bootstrapMeasurement = measureFromNodes({
        root: ref.current,
        layoutContext,
        layoutHint: null,
        layer: bootstrapMeasurementLayerRef.current,
        measurementBackend: bootstrapMeasurementRequest.measurementBackend,
        snapshotOverride: bootstrapDomSnapshot,
        text: bootstrapMeasurementRequest.text,
        renderText: bootstrapMeasurementRequest.renderText,
        segments: bootstrapMeasurementRequest.segments,
      });
      if (bootstrapMeasurementRequest.domMeasurementKey !== null && bootstrapDomSnapshot === null) {
        rememberCachedMorphSnapshot(
          domMeasurementSnapshotCacheRef.current,
          bootstrapMeasurementRequest.domMeasurementKey,
          bootstrapMeasurement.snapshot,
        );
      }
      completedDomMeasurementKeyRef.current = null;
      pendingBootstrapTextRef.current = null;
      if (domMeasurementRequestKey !== null) {
        setDomMeasurementRequestKey(null);
      }

      commitStaticMeasurement(sessionRef.current, bootstrapMeasurement, setState);
      return;
    }

    if (domMeasurementKey !== null) {
      const cachedSnapshot = readCachedMorphSnapshot(
        domMeasurementSnapshotCacheRef.current,
        domMeasurementKey,
      );
      if (cachedSnapshot !== null) {
        completedDomMeasurementKeyRef.current = domMeasurementKey;
        if (domMeasurementRequestKey !== null) {
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
          setDomMeasurementRequestKey(domMeasurementKey);
          return;
        }

        if (measurementLayerRef.current === null) {
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
          rememberCachedMorphSnapshot(
            domMeasurementSnapshotCacheRef.current,
            domMeasurementKey,
            nextMeasurement.snapshot,
          );
        }
        completedDomMeasurementKeyRef.current = domMeasurementKey;

        if (domMeasurementRequestKey !== null) {
          setDomMeasurementRequestKey(null);
        }
        return;
      }

      if (domMeasurementRequestKey !== null) {
        setDomMeasurementRequestKey(null);
      }
      return;
    }

    completedDomMeasurementKeyRef.current = null;
    if (domMeasurementRequestKey !== null) {
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
  }, [
    text,
    renderText,
    segments,
    layoutContext,
    measurementBackend,
    measurementRequest,
    pendingBootstrapText,
    bootstrapMeasurementRequest,
    domMeasurementKey,
    domMeasurementRequestKey,
  ]);

  useLayoutEffect(() => {
    syncCommittedRootOriginWhenIdle({
      root: ref.current,
      layoutContext,
      state,
      session: sessionRef.current,
    });
  }, [layoutContext, state]);

  useLayoutEffect(() => {
    return () => {
      cancelTimeline(timelineRef.current);
    };
  }, []);

  return {
    committedMeasurement: sessionRef.current.committed,
    domMeasurementRequestKey,
    ref,
    bootstrapMeasurementLayerRef,
    measurementBackend,
    measurementLayerRef,
    renderText,
    segments,
    layoutContext,
    state,
    pendingBootstrapText,
    shouldRenderBootstrapSourceMeasurementLayer,
    bootstrapMeasurementRequest,
    useContentInlineSize,
  };
}

function StaticTorph({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <span style={SCREEN_READER_ONLY_STYLE}>{text}</span>
      <span aria-hidden="true" style={FALLBACK_TEXT_STYLE}>
        {text}
      </span>
    </div>
  );
}

function ActiveTorph({
  text,
  className,
  bootstrapText,
}: {
  text: string;
  className?: string;
  bootstrapText?: string | null;
}) {
  const {
    committedMeasurement,
    domMeasurementRequestKey,
    ref,
    bootstrapMeasurementLayerRef,
    measurementBackend,
    measurementLayerRef,
    renderText,
    segments,
    layoutContext,
    state,
    pendingBootstrapText,
    shouldRenderBootstrapSourceMeasurementLayer,
    bootstrapMeasurementRequest,
    useContentInlineSize,
  } = useMorphTransition(text, className, bootstrapText);

  const plan = state.plan;
  const shouldRenderOverlay = state.stage !== "idle" && plan !== null;
  const shouldRenderMeasurementLayer =
    measurementBackend === "dom" && domMeasurementRequestKey !== null;
  const flowText = resolveVisibleFlowText(
    pendingBootstrapText,
    committedMeasurement,
    state.measurement,
    text,
  );
  let bootstrapMeasurementLayer: ReactElement | null = null;
  if (shouldRenderBootstrapSourceMeasurementLayer && bootstrapMeasurementRequest !== null) {
    bootstrapMeasurementLayer = (
      <MeasurementLayer
        layerRef={bootstrapMeasurementLayerRef}
        layoutContext={layoutContext}
        text={bootstrapMeasurementRequest.renderText}
        segments={bootstrapMeasurementRequest.segments}
        useContentInlineSize={bootstrapMeasurementRequest.useContentInlineSize}
      />
    );
  }

  let measurementLayer: ReactElement | null = null;
  if (shouldRenderMeasurementLayer) {
    measurementLayer = (
      <MeasurementLayer
        layerRef={measurementLayerRef}
        layoutContext={layoutContext}
        text={renderText}
        segments={segments}
        useContentInlineSize={useContentInlineSize}
      />
    );
  }

  let overlay: ReactElement | null = null;
  if (shouldRenderOverlay) {
    overlay = <MorphOverlay stage={state.stage} plan={plan} />;
  }

  return (
    <div
      ref={ref}
      className={className}
      style={getRootStyle(state.stage, plan, state.measurement, layoutContext)}
    >
      <span style={SCREEN_READER_ONLY_STYLE}>{text}</span>
      <span aria-hidden="true" style={getFallbackTextStyle(shouldRenderOverlay)}>
        {flowText}
      </span>
      {bootstrapMeasurementLayer}
      {measurementLayer}
      {overlay}
    </div>
  );
}

export function Torph({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [isActivated, setIsActivated] = useState(false);
  const previousTextRef = useRef(text);
  const bootstrapText = resolveActivationBootstrapText(isActivated, previousTextRef.current, text);
  const shouldActivate = isActivated || bootstrapText !== null;

  useLayoutEffect(() => {
    if (!isActivated && text !== previousTextRef.current) {
      previousTextRef.current = text;
      setIsActivated(true);
      return;
    }

    previousTextRef.current = text;
  }, [isActivated, text]);

  if (shouldActivate) {
    return <ActiveTorph text={text} className={className} bootstrapText={bootstrapText} />;
  }

  return <StaticTorph text={text} className={className} />;
}
