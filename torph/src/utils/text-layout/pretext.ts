import {
  clearCache as clearPretextLayoutCache,
  layout,
  layoutNextLine,
  layoutNextLineRange,
  layoutWithLines,
  materializeLineRange,
  measureLineStats,
  measureNaturalWidth as measurePreparedNaturalWidth,
  prepare,
  prepareWithSegments as preparePretextWithSegments,
  setLocale,
  walkLineRanges,
  type LayoutCursor,
  type LayoutLine,
  type LayoutLineRange,
  type LayoutLinesResult,
  type LayoutResult,
  type PrepareOptions,
  type PreparedText,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";

const COLLAPSIBLE_WHITESPACE_RUN_RE = /[ \t\n\r\f]+/g;
const NEEDS_WHITESPACE_NORMALIZATION_RE = /[\t\n\r\f]| {2,}|^ | $/;
const PREFIX_WIDTH_CACHE_LIMIT = 512;

let sharedGraphemeSegmenter: Intl.Segmenter | null = null;
let preparedSegmentGraphemeCache = new WeakMap<
  PreparedTextWithSegments,
  Map<number, string[]>
>();
let preparedSegmentAdvanceCache = new WeakMap<
  PreparedTextWithSegments,
  Map<number, number[]>
>();
const prefixWidthCache = new Map<string, number>();

function getSharedGraphemeSegmenter() {
  if (sharedGraphemeSegmenter !== null) {
    return sharedGraphemeSegmenter;
  }

  sharedGraphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  });
  return sharedGraphemeSegmenter;
}

function rememberCachedPrefixWidth(cacheKey: string, width: number) {
  prefixWidthCache.delete(cacheKey);
  prefixWidthCache.set(cacheKey, width);

  if (prefixWidthCache.size > PREFIX_WIDTH_CACHE_LIMIT) {
    const oldest = prefixWidthCache.keys().next();
    if (!oldest.done) {
      prefixWidthCache.delete(oldest.value);
    }
  }
}

function getPrefixWidthCacheKey(prefix: string, font: string, letterSpacingPx: number) {
  return `${font}\u0000${letterSpacingPx.toFixed(4)}\u0000${prefix}`;
}

function measureRenderedPrefixWidth(
  prefix: string,
  font: string,
  letterSpacingPx: number,
) {
  const cacheKey = getPrefixWidthCacheKey(prefix, font, letterSpacingPx);
  const cached = prefixWidthCache.get(cacheKey);
  if (cached !== undefined) {
    prefixWidthCache.delete(cacheKey);
    prefixWidthCache.set(cacheKey, cached);
    return cached;
  }

  const options: PrepareOptions = {
    whiteSpace: "pre-wrap",
  };
  if (Math.abs(letterSpacingPx) > 0.0001) {
    options.letterSpacing = letterSpacingPx;
  }

  const width = measurePreparedNaturalWidth(
    preparePretextWithSegments(prefix, font, options),
  );
  rememberCachedPrefixWidth(cacheKey, width);
  return width;
}

export function clearCache() {
  sharedGraphemeSegmenter = null;
  preparedSegmentGraphemeCache = new WeakMap();
  preparedSegmentAdvanceCache = new WeakMap();
  prefixWidthCache.clear();
  clearPretextLayoutCache();
}

export function prepareWithSegments(
  text: string,
  font: string,
  options?: PrepareOptions,
) {
  return preparePretextWithSegments(text, font, options);
}

export function measureNaturalWidth(prepared: PreparedTextWithSegments) {
  return measurePreparedNaturalWidth(prepared);
}

/**
 * Torph needs the same whitespace-rendering contract as Pretext before any
 * canvas-backed preparation is available in tests or non-browser environments.
 */
export function normalizePretextWhiteSpace(
  text: string,
  whiteSpace: "normal" | "pre-wrap",
) {
  if (whiteSpace === "pre-wrap") {
    return text.replace(/\r\n/g, "\n").replace(/[\r\f]/g, "\n");
  }

  if (!NEEDS_WHITESPACE_NORMALIZATION_RE.test(text)) {
    return text;
  }

  let normalized = text.replace(COLLAPSIBLE_WHITESPACE_RUN_RE, " ");
  if (normalized.charCodeAt(0) === 0x20) {
    normalized = normalized.slice(1);
  }
  if (normalized.length > 0 && normalized.charCodeAt(normalized.length - 1) === 0x20) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function readPreparedSegmentGraphemes(
  prepared: PreparedTextWithSegments,
  segmentIndex: number,
) {
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

/**
 * Pretext only guarantees breakable fit advances for segments that need them
 * during line breaking. Torph still needs stable per-grapheme positions for
 * every rendered segment, so uncommon non-breakable multi-grapheme runs fall
 * back to prefix-width reconstruction through Pretext's public API.
 */
export function readPreparedSegmentGraphemeAdvances(
  prepared: PreparedTextWithSegments,
  segmentIndex: number,
  {
    font,
    letterSpacingPx,
  }: {
    font: string;
    letterSpacingPx: number;
  },
) {
  const graphemes = readPreparedSegmentGraphemes(prepared, segmentIndex);
  let cache = preparedSegmentAdvanceCache.get(prepared);
  if (cache === undefined) {
    cache = new Map<number, number[]>();
    preparedSegmentAdvanceCache.set(prepared, cache);
  }

  const cached = cache.get(segmentIndex);
  if (cached !== undefined) {
    return {
      graphemes,
      advances: cached,
    };
  }

  let advances: number[];
  if (graphemes.length <= 1) {
    advances = [prepared.widths[segmentIndex]!];
  } else {
    const fitAdvances = prepared.breakableFitAdvances[segmentIndex];
    if (fitAdvances !== null) {
      advances = fitAdvances.slice();
    } else {
      advances = [];
      let prefix = "";
      let previousWidth = 0;

      for (const grapheme of graphemes) {
        prefix += grapheme;
        const nextWidth = measureRenderedPrefixWidth(prefix, font, letterSpacingPx);
        advances.push(nextWidth - previousWidth);
        previousWidth = nextWidth;
      }
    }
  }

  cache.set(segmentIndex, advances);
  return {
    graphemes,
    advances,
  };
}

export {
  layout,
  layoutNextLine,
  layoutNextLineRange,
  layoutWithLines,
  materializeLineRange,
  measureLineStats,
  prepare,
  setLocale,
  walkLineRanges,
  type LayoutCursor,
  type LayoutLine,
  type LayoutLineRange,
  type LayoutLinesResult,
  type LayoutResult,
  type PrepareOptions,
  type PreparedText,
  type PreparedTextWithSegments,
};
