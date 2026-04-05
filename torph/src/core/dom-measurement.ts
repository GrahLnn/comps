import {
  measureMorphSnapshotWithPretext,
  type PretextMorphMeasurementBackend,
} from "../utils/text-layout/pretextMorph";
import {
  areSnapshotsEquivalentForPretextTrust,
  readCachedMorphSegments,
  rememberPretextMeasurementTrust,
  shouldMeasureUsingContentInlineSize,
} from "./measurement-policy";
import { supportsIntrinsicWidthLock } from "./render";
import { assertSingleLineSnapshot } from "./snapshot";
import {
  type LayoutContext,
  MORPH,
  type MorphCharacterLayout,
  type MorphMeasurement,
  type MorphSegment,
  type MorphSnapshot,
} from "./types";
import { readFont } from "./layout-observer";

type DomMeasurementService = {
  root: HTMLDivElement;
  host: HTMLSpanElement;
};

type MeasuredGlyphLayout = {
  glyph: string;
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SnapshotDrift = {
  comparedGlyphs: number;
  expectedGlyphs: number;
  actualGlyphs: number;
  maxAbsLeftDelta: number;
  maxAbsTopDelta: number;
  maxAbsWidthDelta: number;
  maxAbsHeightDelta: number;
  snapshotWidthDelta: number;
  snapshotHeightDelta: number;
  mismatches: Array<{
    index: number;
    glyph: string;
    leftDelta: number;
    topDelta: number;
    widthDelta: number;
    heightDelta: number;
  }>;
};

let domMeasurementService: DomMeasurementService | null = null;

function readFirstTextNode(node: HTMLElement | null) {
  if (node === null) {
    return null;
  }

  for (const childNode of node.childNodes) {
    if (childNode.nodeType === Node.TEXT_NODE) {
      return childNode as Text;
    }
  }

  return null;
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
  };
  return domMeasurementService;
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

export function readCachedMorphSnapshot(
  cache: Map<string, MorphSnapshot>,
  cacheKey: string,
) {
  const cached = cache.get(cacheKey);
  if (cached === undefined) {
    return null;
  }

  cache.delete(cacheKey);
  cache.set(cacheKey, cached);
  return cached;
}

export function rememberCachedMorphSnapshot(
  cache: Map<string, MorphSnapshot>,
  cacheKey: string,
  snapshot: MorphSnapshot,
) {
  cache.delete(cacheKey);
  cache.set(cacheKey, snapshot);

  if (cache.size > 8) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
}

function assertMeasurementLayer(layer: HTMLElement | null) {
  if (layer === null) {
    throw new Error("Torph measurement layer is missing.");
  }

  return layer;
}

function readMeasuredGlyphLayouts(
  layer: HTMLElement,
  layerRect: DOMRect,
  segments: readonly MorphSegment[],
) {
  const measuredGlyphs: MeasuredGlyphLayout[] = [];
  const textNode = readFirstTextNode(layer);
  if (textNode === null) {
    throw new Error("Torph measurement layer text node is missing.");
  }

  const range = document.createRange();
  let offset = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const nextOffset = offset + segment.glyph.length;
    range.setStart(textNode, offset);
    range.setEnd(textNode, nextOffset);
    const rect = range.getBoundingClientRect();
    measuredGlyphs.push({
      glyph: segment.glyph,
      key: segment.key,
      left: rect.left - layerRect.left,
      top: rect.top - layerRect.top,
      width: rect.width,
      height: rect.height,
    } satisfies MeasuredGlyphLayout);
    offset = nextOffset;
  }

  return measuredGlyphs;
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

  const measurementLayer = assertMeasurementLayer(layer);
  const layerRect = measurementLayer.getBoundingClientRect();
  const measuredGlyphs = readMeasuredGlyphLayouts(measurementLayer, layerRect, segments);

  let width = 0;
  const graphemes = measuredGlyphs.map((glyph) => {
    width = Math.max(width, glyph.left + glyph.width);

    return {
      glyph: glyph.glyph,
      key: glyph.key,
      left: glyph.left,
      top: glyph.top,
      width: glyph.width,
      height: glyph.height,
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
  service.host.textContent = renderText;
  return measureMorphSnapshotFromLayer(text, renderText, segments, service.host);
}

export function readRootOrigin(node: HTMLElement) {
  const rect = node.getBoundingClientRect();
  return { left: rect.left, top: rect.top };
}

export function measureLiveFlowSnapshot(
  root: HTMLElement,
  flowTextNode: HTMLSpanElement,
): MorphSnapshot | null {
  const textNode = readFirstTextNode(flowTextNode);
  if (textNode === null) {
    return null;
  }

  const text = textNode.data;
  const renderText = text;
  if (renderText.length === 0) {
    return {
      text,
      renderText,
      width: 0,
      height: 0,
      graphemes: [],
    };
  }

  const rootRect = root.getBoundingClientRect();
  const range = document.createRange();
  const graphemes: MorphCharacterLayout[] = [];
  let width = 0;
  let height = 0;
  let offset = 0;
  const segments = readCachedMorphSegments(renderText);

  for (const segment of segments) {
    const nextOffset = offset + segment.glyph.length;
    range.setStart(textNode, offset);
    range.setEnd(textNode, nextOffset);
    const rect = range.getBoundingClientRect();
    graphemes.push({
      glyph: segment.glyph,
      key: segment.key,
      left: rect.left - rootRect.left,
      top: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
    });
    width = Math.max(width, rect.right - rootRect.left);
    height = Math.max(height, rect.bottom - rootRect.top);
    offset = nextOffset;
  }

  return {
    text,
    renderText,
    width,
    height,
    graphemes,
  };
}

export function measureSnapshotDrift(expected: MorphSnapshot, actual: MorphSnapshot): SnapshotDrift {
  const comparedGlyphs = Math.min(expected.graphemes.length, actual.graphemes.length);
  const mismatches: SnapshotDrift["mismatches"] = [];
  let maxAbsLeftDelta = 0;
  let maxAbsTopDelta = 0;
  let maxAbsWidthDelta = 0;
  let maxAbsHeightDelta = 0;

  for (let index = 0; index < comparedGlyphs; index += 1) {
    const expectedGlyph = expected.graphemes[index]!;
    const actualGlyph = actual.graphemes[index]!;
    const leftDelta = actualGlyph.left - expectedGlyph.left;
    const topDelta = actualGlyph.top - expectedGlyph.top;
    const widthDelta = actualGlyph.width - expectedGlyph.width;
    const heightDelta = actualGlyph.height - expectedGlyph.height;

    maxAbsLeftDelta = Math.max(maxAbsLeftDelta, Math.abs(leftDelta));
    maxAbsTopDelta = Math.max(maxAbsTopDelta, Math.abs(topDelta));
    maxAbsWidthDelta = Math.max(maxAbsWidthDelta, Math.abs(widthDelta));
    maxAbsHeightDelta = Math.max(maxAbsHeightDelta, Math.abs(heightDelta));

    if (
      mismatches.length < 8 &&
      (Math.abs(leftDelta) > MORPH.geometryEpsilon ||
        Math.abs(topDelta) > MORPH.geometryEpsilon ||
        Math.abs(widthDelta) > MORPH.geometryEpsilon ||
        Math.abs(heightDelta) > MORPH.geometryEpsilon)
    ) {
      mismatches.push({
        index,
        glyph: expectedGlyph.glyph,
        leftDelta,
        topDelta,
        widthDelta,
        heightDelta,
      });
    }
  }

  return {
    comparedGlyphs,
    expectedGlyphs: expected.graphemes.length,
    actualGlyphs: actual.graphemes.length,
    maxAbsLeftDelta,
    maxAbsTopDelta,
    maxAbsWidthDelta,
    maxAbsHeightDelta,
    snapshotWidthDelta: actual.width - expected.width,
    snapshotHeightDelta: actual.height - expected.height,
    mismatches,
  };
}

export function measureOverlayBoxSnapshot(
  root: HTMLElement,
  overlayRoot: HTMLElement,
  role: "live" | "exit",
): MorphSnapshot | null {
  const nodes = overlayRoot.querySelectorAll<HTMLElement>(`[data-morph-role='${role}']`);
  if (nodes.length === 0) {
    return null;
  }

  const rootRect = root.getBoundingClientRect();
  const graphemes: MorphCharacterLayout[] = [];
  let width = 0;
  let height = 0;
  let renderText = "";

  for (const node of nodes) {
    const key = node.dataset.morphKey;
    const glyph = node.dataset.morphGlyph;
    if (key === undefined || glyph === undefined) {
      return null;
    }

    const rect = node.getBoundingClientRect();
    const left = rect.left - rootRect.left;
    const top = rect.top - rootRect.top;
    const boxWidth = rect.width;
    const boxHeight = rect.height;
    graphemes.push({
      glyph,
      key,
      left,
      top,
      width: boxWidth,
      height: boxHeight,
    });
    renderText += glyph;
    width = Math.max(width, left + boxWidth);
    height = Math.max(height, top + boxHeight);
  }

  return {
    text: renderText,
    renderText,
    width,
    height,
    graphemes,
  };
}

export function measureFromNodes({
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
  const useContentInlineSize = shouldMeasureUsingContentInlineSize(
    layoutContext,
    layoutHint,
  );
  let measurementLayoutContext = layoutContext;
  if (useContentInlineSize && layoutContext.whiteSpace !== "nowrap") {
    measurementLayoutContext = {
      ...layoutContext,
      width: Number.MAX_SAFE_INTEGER / 4,
    };
  }

  const snapshot = assertSingleLineSnapshot(
    snapshotOverride ??
    (() => {
      let pretextSnapshot: MorphSnapshot | null = null;
      if (measurementBackend !== "dom") {
        pretextSnapshot = measureMorphSnapshotWithPretext(text, measurementLayoutContext);
      }

      let domSnapshot: MorphSnapshot | null = null;
      if (measurementBackend !== "pretext") {
        if (layer !== null) {
          domSnapshot = measureMorphSnapshotFromLayer(text, renderText, segments, layer);
        } else {
          domSnapshot = measureMorphSnapshotWithDomService({
            root,
            layoutContext,
            text,
            renderText,
            segments,
            useContentInlineSize,
          });
        }
      }

      if (measurementBackend === "probe" && pretextSnapshot !== null && domSnapshot !== null) {
        const trusted = areSnapshotsEquivalentForPretextTrust(
          pretextSnapshot,
          domSnapshot,
        );
        rememberPretextMeasurementTrust({
          renderText,
          layoutContext,
          useContentInlineSize,
          trusted,
        });
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
    })(),
  );

  let layoutInlineSize = layoutContext.width;
  if (useContentInlineSize) {
    layoutInlineSize = snapshot.width;
  }

  let reservedInlineSize: number | null = null;
  if (supportsIntrinsicWidthLock(layoutContext.display, layoutContext.parentDisplay)) {
    reservedInlineSize = snapshot.width;
  }

  let flowInlineSize: number | null = null;
  if (useContentInlineSize) {
    flowInlineSize = snapshot.width;
  }

  return {
    snapshot,
    layoutInlineSize,
    reservedInlineSize,
    flowInlineSize,
    rootOrigin: readRootOrigin(root),
  };
}
