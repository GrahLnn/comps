import {
  clearCache as clearPretextLayoutCaches,
  prepareWithSegments,
  walkLineRanges,
  type PreparedTextWithSegments,
} from "./pretext.js";
import {
  normalizeWhitespaceNormal,
  normalizeWhitespacePreWrap,
} from "../../vendor/pretext/analysis.js";
import {
  getEngineProfile,
  getFontMeasurementState,
  getSegmentGraphemePrefixWidths,
  getSegmentMetrics,
  textMayContainEmoji,
} from "../../vendor/pretext/measurement.js";

const UNBOUNDED_LAYOUT_WIDTH = Number.MAX_SAFE_INTEGER / 4;
const PREPARED_TEXT_CACHE_LIMIT = 256;
const PROBE_COMPLEX_WHITESPACE_RE = /[\t\n\r\f]| {2,}|^ | $/;
const FAST_PATH_RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/u;
const PROBE_SYSTEM_UI_RE = /\bsystem-ui\b/i;

export type PretextMorphWhiteSpace = "normal" | "nowrap" | "pre-wrap";
export type PretextMorphMeasurementBackend = "pretext" | "probe" | "dom";

export type PretextMorphLayoutContext = {
  display: string;
  font: string;
  lineHeightPx: number;
  parentDisplay: string;
  whiteSpace: PretextMorphWhiteSpace;
  width: number;
  direction: string;
  textTransform: string;
  letterSpacingPx: number;
  wordSpacingPx: number;
  fontFeatureSettings: string;
  fontVariationSettings: string;
};

export type PretextMorphCharacterLayout = {
  glyph: string;
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PretextMorphSnapshot = {
  text: string;
  renderText: string;
  width: number;
  height: number;
  graphemes: PretextMorphCharacterLayout[];
};

const preparedTextCache = new Map<string, PreparedTextWithSegments>();
const preparedSegmentGraphemeCache = new WeakMap<PreparedTextWithSegments, Map<number, string[]>>();
let sharedGraphemeSegmenter: Intl.Segmenter | null = null;

function getSharedGraphemeSegmenter() {
  if (sharedGraphemeSegmenter !== null) {
    return sharedGraphemeSegmenter;
  }

  sharedGraphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  });
  return sharedGraphemeSegmenter;
}

function readPretextWhiteSpace(whiteSpace: PretextMorphWhiteSpace): "normal" | "pre-wrap" {
  return whiteSpace === "pre-wrap" ? "pre-wrap" : "normal";
}

function getPreparedTextCacheKey(renderText: string, layoutContext: PretextMorphLayoutContext) {
  return `${layoutContext.font}\u0000${layoutContext.whiteSpace}\u0000${renderText}`;
}

function getPreparedText(
  text: string,
  renderText: string,
  layoutContext: PretextMorphLayoutContext,
) {
  const cacheKey = getPreparedTextCacheKey(renderText, layoutContext);
  const cached = preparedTextCache.get(cacheKey);
  if (cached !== undefined) {
    preparedTextCache.delete(cacheKey);
    preparedTextCache.set(cacheKey, cached);
    return cached;
  }

  const prepared = prepareWithSegments(text, layoutContext.font, {
    whiteSpace: readPretextWhiteSpace(layoutContext.whiteSpace),
  });
  preparedTextCache.set(cacheKey, prepared);

  if (preparedTextCache.size > PREPARED_TEXT_CACHE_LIMIT) {
    const oldest = preparedTextCache.keys().next();
    if (!oldest.done) {
      preparedTextCache.delete(oldest.value);
    }
  }

  return prepared;
}

export function clearPretextMorphCaches() {
  preparedTextCache.clear();
  sharedGraphemeSegmenter = null;
  clearPretextLayoutCaches();
}

function getPreparedSegmentGraphemeTexts(prepared: PreparedTextWithSegments, segmentIndex: number) {
  let cache = preparedSegmentGraphemeCache.get(prepared);
  if (cache === undefined) {
    cache = new Map<number, string[]>();
    preparedSegmentGraphemeCache.set(prepared, cache);
  }

  const cached = cache.get(segmentIndex);
  if (cached !== undefined) {
    return cached;
  }

  const graphemes: string[] = [];
  for (const segment of getSharedGraphemeSegmenter().segment(prepared.segments[segmentIndex]!)) {
    graphemes.push(segment.segment);
  }

  cache.set(segmentIndex, graphemes);
  return graphemes;
}

function deriveAdvancesFromPrefixWidths(prefixWidths: readonly number[]) {
  const advances: number[] = [];

  for (let index = 0; index < prefixWidths.length; index += 1) {
    const previous = index === 0 ? 0 : prefixWidths[index - 1]!;
    advances.push(prefixWidths[index]! - previous);
  }

  return advances;
}

function getSegmentGraphemeAdvances(
  prepared: PreparedTextWithSegments,
  segmentIndex: number,
  layoutContext: PretextMorphLayoutContext,
) {
  const segmentText = prepared.segments[segmentIndex]!;
  const graphemes = getPreparedSegmentGraphemeTexts(prepared, segmentIndex);

  if (graphemes.length <= 1) {
    return {
      graphemes,
      advances: [prepared.widths[segmentIndex]!],
    };
  }

  const cachedPrefixWidths = prepared.breakablePrefixWidths[segmentIndex];
  if (cachedPrefixWidths !== null) {
    return {
      graphemes,
      advances: deriveAdvancesFromPrefixWidths(cachedPrefixWidths),
    };
  }

  const cachedWidths = prepared.breakableWidths[segmentIndex];
  if (cachedWidths !== null) {
    return {
      graphemes,
      advances: cachedWidths,
    };
  }

  const { cache, emojiCorrection } = getFontMeasurementState(
    layoutContext.font,
    textMayContainEmoji(segmentText),
  );
  const segmentMetrics = getSegmentMetrics(segmentText, cache);
  const prefixWidths = getSegmentGraphemePrefixWidths(
    segmentText,
    segmentMetrics,
    cache,
    emojiCorrection,
  );

  return {
    graphemes,
    advances:
      prefixWidths === null
        ? [prepared.widths[segmentIndex]!]
        : deriveAdvancesFromPrefixWidths(prefixWidths),
  };
}

function getPretextMaxWidth(layoutContext: PretextMorphLayoutContext) {
  return layoutContext.whiteSpace === "nowrap"
    ? UNBOUNDED_LAYOUT_WIDTH
    : Math.max(0, layoutContext.width);
}

function normalizeFeatureSetting(value: string) {
  return value.length === 0 ? "normal" : value;
}

function hasUnsupportedPretextMorphFeatures(
  text: string,
  layoutContext: PretextMorphLayoutContext | null,
) {
  if (layoutContext === null) {
    return true;
  }

  if (text.length === 0) {
    return false;
  }

  if (layoutContext.font.length === 0 || layoutContext.lineHeightPx <= 0) {
    return true;
  }

  if (layoutContext.direction !== "ltr") {
    return true;
  }

  if (layoutContext.textTransform !== "none") {
    return true;
  }

  if (Math.abs(layoutContext.letterSpacingPx) > 0.01) {
    return true;
  }

  if (Math.abs(layoutContext.wordSpacingPx) > 0.01) {
    return true;
  }

  if (
    normalizeFeatureSetting(layoutContext.fontFeatureSettings) !== "normal" ||
    normalizeFeatureSetting(layoutContext.fontVariationSettings) !== "normal"
  ) {
    return true;
  }

  if (text.includes("\u00ad") || FAST_PATH_RTL_RE.test(text)) {
    return true;
  }

  return false;
}

function shouldProbePretextMorph(text: string, layoutContext: PretextMorphLayoutContext) {
  if (layoutContext.whiteSpace !== "nowrap") {
    return true;
  }

  if (PROBE_COMPLEX_WHITESPACE_RE.test(text)) {
    return true;
  }

  return PROBE_SYSTEM_UI_RE.test(layoutContext.font);
}

export function getPretextMorphRenderedText(
  text: string,
  layoutContext: Pick<PretextMorphLayoutContext, "whiteSpace"> | null,
) {
  if (layoutContext === null) {
    return text;
  }

  return layoutContext.whiteSpace === "pre-wrap"
    ? normalizeWhitespacePreWrap(text)
    : normalizeWhitespaceNormal(text);
}

export function getPretextMorphStyleSignature(layoutContext: PretextMorphLayoutContext | null) {
  if (layoutContext === null) {
    return null;
  }

  const engineProfile = getEngineProfile();
  return [
    layoutContext.font,
    layoutContext.whiteSpace,
    layoutContext.direction,
    layoutContext.textTransform,
    layoutContext.letterSpacingPx.toFixed(4),
    layoutContext.wordSpacingPx.toFixed(4),
    normalizeFeatureSetting(layoutContext.fontFeatureSettings),
    normalizeFeatureSetting(layoutContext.fontVariationSettings),
    String(engineProfile.lineFitEpsilon),
    engineProfile.carryCJKAfterClosingQuote ? "1" : "0",
    engineProfile.preferPrefixWidthsForBreakableRuns ? "1" : "0",
    engineProfile.preferEarlySoftHyphenBreak ? "1" : "0",
  ].join("\u0000");
}

export function getPretextMorphTrustSignature({
  renderText,
  layoutContext,
  useContentInlineSize,
}: {
  renderText: string;
  layoutContext: PretextMorphLayoutContext | null;
  useContentInlineSize: boolean;
}) {
  if (layoutContext === null) {
    return null;
  }

  const styleSignature = getPretextMorphStyleSignature(layoutContext);
  if (styleSignature === null) {
    return null;
  }

  let inlineSizeSignature = layoutContext.width.toFixed(2);
  if (useContentInlineSize) {
    inlineSizeSignature = "content";
  }

  return [styleSignature, inlineSizeSignature, renderText].join("\u0000");
}

export function getPretextMorphMeasurementBackend(
  text: string,
  layoutContext: PretextMorphLayoutContext | null,
): PretextMorphMeasurementBackend {
  if (layoutContext === null) {
    return "dom";
  }

  if (text.length === 0) {
    return "pretext";
  }

  if (hasUnsupportedPretextMorphFeatures(text, layoutContext)) {
    return "dom";
  }

  return shouldProbePretextMorph(text, layoutContext) ? "probe" : "pretext";
}

export function canUsePretextMorphFastPath(
  text: string,
  layoutContext: PretextMorphLayoutContext | null,
) {
  return getPretextMorphMeasurementBackend(text, layoutContext) === "pretext";
}

function pushSegmentGraphemeRange({
  advances,
  graphemes,
  startGraphemeIndex,
  endGraphemeIndex,
  top,
  left,
  ordinal,
  output,
  lineHeightPx,
}: {
  advances: readonly number[];
  graphemes: readonly string[];
  startGraphemeIndex: number;
  endGraphemeIndex: number;
  top: number;
  left: number;
  ordinal: number;
  output: PretextMorphCharacterLayout[];
  lineHeightPx: number;
}) {
  let nextLeft = left;
  let nextOrdinal = ordinal;

  for (
    let graphemeIndex = startGraphemeIndex;
    graphemeIndex < endGraphemeIndex;
    graphemeIndex += 1
  ) {
    const glyph = graphemes[graphemeIndex]!;
    const advance = advances[graphemeIndex]!;
    output.push({
      glyph,
      key: `${glyph}:${nextOrdinal}`,
      left: nextLeft,
      top,
      width: advance,
      height: lineHeightPx,
    });
    nextOrdinal += 1;
    nextLeft += advance;
  }

  return {
    left: nextLeft,
    ordinal: nextOrdinal,
  };
}

export function measureMorphSnapshotWithPretext(
  text: string,
  layoutContext: PretextMorphLayoutContext,
): PretextMorphSnapshot {
  const renderText = getPretextMorphRenderedText(text, layoutContext);
  if (text.length === 0) {
    return {
      text,
      renderText,
      width: 0,
      height: 0,
      graphemes: [],
    };
  }

  const prepared = getPreparedText(text, renderText, layoutContext);
  const graphemes: PretextMorphCharacterLayout[] = [];
  let width = 0;
  let ordinal = 0;
  let lineIndex = 0;

  const lineCount = walkLineRanges(prepared, getPretextMaxWidth(layoutContext), (line) => {
    const top = lineIndex * layoutContext.lineHeightPx;
    let left = 0;

    for (
      let segmentIndex = line.start.segmentIndex;
      segmentIndex < line.end.segmentIndex;
      segmentIndex += 1
    ) {
      const startGraphemeIndex =
        segmentIndex === line.start.segmentIndex ? line.start.graphemeIndex : 0;
      const { advances, graphemes: segmentGraphemes } = getSegmentGraphemeAdvances(
        prepared,
        segmentIndex,
        layoutContext,
      );
      const next = pushSegmentGraphemeRange({
        advances,
        graphemes: segmentGraphemes,
        startGraphemeIndex,
        endGraphemeIndex: segmentGraphemes.length,
        top,
        left,
        ordinal,
        output: graphemes,
        lineHeightPx: layoutContext.lineHeightPx,
      });
      left = next.left;
      ordinal = next.ordinal;
    }

    if (line.end.graphemeIndex > 0) {
      const startGraphemeIndex =
        line.start.segmentIndex === line.end.segmentIndex ? line.start.graphemeIndex : 0;
      const { advances, graphemes: segmentGraphemes } = getSegmentGraphemeAdvances(
        prepared,
        line.end.segmentIndex,
        layoutContext,
      );
      const next = pushSegmentGraphemeRange({
        advances,
        graphemes: segmentGraphemes,
        startGraphemeIndex,
        endGraphemeIndex: line.end.graphemeIndex,
        top,
        left,
        ordinal,
        output: graphemes,
        lineHeightPx: layoutContext.lineHeightPx,
      });
      left = next.left;
      ordinal = next.ordinal;
    }

    width = Math.max(width, left);
    lineIndex += 1;
  });

  return {
    text,
    renderText,
    width,
    height: lineCount * layoutContext.lineHeightPx,
    graphemes,
  };
}
