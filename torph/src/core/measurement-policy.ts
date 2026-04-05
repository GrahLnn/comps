import {
  clearPretextMorphCaches,
  getPretextMorphMeasurementBackend,
  getPretextMorphRenderedText,
  getPretextMorphTrustSignature,
  type PretextMorphMeasurementBackend,
} from "../utils/text-layout/pretextMorph";
import { nearlyEqual } from "./math";
import { supportsIntrinsicWidthLock } from "./render";
import { isSingleLineSnapshot } from "./snapshot";
import {
  MORPH,
  EMPTY_SEGMENTS,
  resolveContentWidthLockInlineSize,
  type LayoutContext,
  type MorphMeasurement,
  type MorphMeasurementRequest,
  type MorphSegment,
  type MorphSnapshot,
} from "./types";

const MORPH_SEGMENT_CACHE_LIMIT = 256;
const morphSegmentCache = new Map<string, readonly MorphSegment[]>();
const pretextMorphTrustCache = new Map<string, boolean>();
let morphMeasurementEpoch = 1;
let graphemeSegmenter: Intl.Segmenter | null = null;

function getGraphemeSegmenter() {
  if (graphemeSegmenter !== null) {
    return graphemeSegmenter;
  }

  graphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  });
  return graphemeSegmenter;
}

export function clearPretextMorphTrustCache() {
  pretextMorphTrustCache.clear();
}

export function clearMorphMeasurementCaches() {
  morphSegmentCache.clear();
  clearPretextMorphTrustCache();
  clearPretextMorphCaches();
}

export function bumpMorphMeasurementEpoch() {
  morphMeasurementEpoch += 1;
}

export function getMorphMeasurementEpoch() {
  return morphMeasurementEpoch;
}

export function readCachedMorphSegments(text: string): readonly MorphSegment[] {
  const cached = morphSegmentCache.get(text);
  if (cached !== undefined) {
    morphSegmentCache.delete(text);
    morphSegmentCache.set(text, cached);
    return cached;
  }

  const segments = Array.from(getGraphemeSegmenter().segment(text), (segment, index) => ({
    glyph: segment.segment,
    key: `${segment.segment}:${index}`,
  }));
  morphSegmentCache.set(text, segments);

  if (morphSegmentCache.size > MORPH_SEGMENT_CACHE_LIMIT) {
    const oldest = morphSegmentCache.keys().next();
    if (!oldest.done) {
      morphSegmentCache.delete(oldest.value);
    }
  }

  return segments;
}

export function shouldMeasureUsingContentInlineSize(
  layoutContext: LayoutContext,
  layoutHint: MorphMeasurement | null,
) {
  if (supportsIntrinsicWidthLock(layoutContext.display, layoutContext.parentDisplay)) {
    return true;
  }

  if (layoutContext.whiteSpace === "nowrap") {
    return true;
  }

  if (layoutHint === null) {
    return false;
  }

  if (!isSingleLineSnapshot(layoutHint.snapshot)) {
    return false;
  }

  return nearlyEqual(
    layoutHint.layoutInlineSize,
    resolveContentWidthLockInlineSize(layoutHint),
    MORPH.contentWidthLockEpsilon,
  );
}

export function getTrustedPretextMeasurementBackend(
  text: string,
  renderText: string,
  layoutContext: LayoutContext,
  useContentInlineSize: boolean,
): PretextMorphMeasurementBackend {
  const backend = getPretextMorphMeasurementBackend(text, layoutContext);
  if (backend !== "probe") {
    return backend;
  }

  const signature = getPretextMorphTrustSignature({
    renderText,
    layoutContext,
    useContentInlineSize,
  });
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

export function needsMeasurementLayer(
  measurementBackend: PretextMorphMeasurementBackend,
  renderText: string,
) {
  if (measurementBackend === "pretext") {
    return false;
  }

  return renderText.length > 0;
}

export function canCacheMeasurementLayerSnapshot(
  measurementBackend: PretextMorphMeasurementBackend | null,
) {
  return measurementBackend === "dom";
}

export function createMorphMeasurementRequest({
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
  const useContentInlineSize = shouldMeasureUsingContentInlineSize(
    layoutContext,
    layoutHint,
  );
  const measurementBackend = getTrustedPretextMeasurementBackend(
    text,
    renderText,
    layoutContext,
    useContentInlineSize,
  );
  let segments: readonly MorphSegment[] = readCachedMorphSegments(renderText);
  if (measurementBackend === "pretext") {
    segments = EMPTY_SEGMENTS;
  }

  let domMeasurementKey: string | null = null;
  if (needsMeasurementLayer(measurementBackend, renderText)) {
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

export function rememberPretextMeasurementTrust({
  renderText,
  layoutContext,
  useContentInlineSize,
  trusted,
}: {
  renderText: string;
  layoutContext: LayoutContext;
  useContentInlineSize: boolean;
  trusted: boolean;
}) {
  const signature = getPretextMorphTrustSignature({
    renderText,
    layoutContext,
    useContentInlineSize,
  });
  if (signature === null) {
    return;
  }

  pretextMorphTrustCache.set(signature, trusted);
}

export function areSnapshotsEquivalentForPretextTrust(
  left: MorphSnapshot,
  right: MorphSnapshot,
) {
  if (left.renderText !== right.renderText || left.graphemes.length !== right.graphemes.length) {
    return false;
  }

  if (Math.abs(left.width - right.width) > MORPH.geometryEpsilon) {
    return false;
  }

  if (Math.abs(left.height - right.height) > MORPH.geometryEpsilon) {
    return false;
  }

  for (let index = 0; index < left.graphemes.length; index += 1) {
    const from = left.graphemes[index]!;
    const to = right.graphemes[index]!;

    if (from.glyph !== to.glyph) {
      return false;
    }

    if (Math.abs(from.left - to.left) > MORPH.geometryEpsilon) {
      return false;
    }

    if (Math.abs(from.top - to.top) > MORPH.geometryEpsilon) {
      return false;
    }

    if (Math.abs(from.width - to.width) > MORPH.geometryEpsilon) {
      return false;
    }

    if (Math.abs(from.height - to.height) > MORPH.geometryEpsilon) {
      return false;
    }
  }

  return true;
}
