import type {
  LayoutContext,
  MorphMeasurement,
  MorphSnapshot,
} from "../core/types";

export type TorphDebugConfig =
  | boolean
  | {
      enabled?: boolean;
      capture?: boolean;
      console?: boolean;
    };

type TorphTraceEntry = {
  source: "torph";
  instanceId: number;
  event: string;
  payload: Record<string, unknown>;
  performanceNow: number;
  seq: number;
  time: string;
};

type TorphTraceStore = {
  lines: string[];
  nextSeq: number;
  totalBytes: number;
};

type TorphTraceApi = {
  clear: () => void;
  count: () => number;
  download: (filename?: string) => string | null;
  text: () => string;
};

type TorphDebugScope = typeof globalThis & {
  __TORPH_DEBUG__?: TorphDebugConfig;
  __TORPH_TRACE__?: TorphTraceApi;
  __TORPH_TRACE_STORE__?: TorphTraceStore;
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

const TORPH_TRACE_MAX_BYTES = 4 * 1024 * 1024;
const TORPH_TRACE_MAX_LINES = 4000;
export const TORPH_TRACE_SCHEMA_VERSION = 10;
const DEFAULT_TORPH_DEBUG_CONFIG = {
  capture: false,
  console: false,
} satisfies Exclude<TorphDebugConfig, boolean>;

let torphDebugInstanceOrdinal = 0;

export function nextTorphDebugInstanceId() {
  torphDebugInstanceOrdinal += 1;
  return torphDebugInstanceOrdinal;
}

export function readTorphDebugConfig(): TorphDebugConfig | null {
  const scope = globalThis as TorphDebugScope;
  return scope.__TORPH_DEBUG__ ?? DEFAULT_TORPH_DEBUG_CONFIG;
}

export function shouldCaptureTorphTrace(config: TorphDebugConfig | null) {
  if (config === null) {
    return false;
  }

  if (typeof config === "boolean") {
    return config;
  }

  if (config.capture === true) {
    return true;
  }

  return false;
}

export function isTorphDebugEnabled(config: TorphDebugConfig | null) {
  if (config === null) {
    return false;
  }

  if (typeof config === "boolean") {
    return config;
  }

  if (config.console !== undefined) {
    return config.console;
  }

  if (config.enabled === true) {
    return true;
  }

  return false;
}

export function shouldRunTorphInstrumentation(config: TorphDebugConfig | null) {
  if (shouldCaptureTorphTrace(config)) {
    return true;
  }

  return isTorphDebugEnabled(config);
}

function getTorphTraceStore() {
  const scope = globalThis as TorphDebugScope;
  let store = scope.__TORPH_TRACE_STORE__;
  if (store !== undefined) {
    return store;
  }

  store = {
    lines: [],
    nextSeq: 1,
    totalBytes: 0,
  };
  scope.__TORPH_TRACE_STORE__ = store;
  return store;
}

function getTorphTraceText() {
  return getTorphTraceStore().lines.join("");
}

function clearTorphTrace() {
  const store = getTorphTraceStore();
  store.lines = [];
  store.nextSeq = 1;
  store.totalBytes = 0;
}

function downloadTorphTrace(filename?: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const text = getTorphTraceText();
  const blob = new Blob([text], { type: "application/x-ndjson;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  let resolvedFilename = filename;
  if (resolvedFilename === undefined) {
    resolvedFilename = `torph-trace-${new Date().toISOString().replaceAll(":", "-")}.jsonl`;
  }
  anchor.href = href;
  anchor.download = resolvedFilename;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 0);
  return resolvedFilename;
}

export function ensureTorphTraceApi() {
  const scope = globalThis as TorphDebugScope;
  if (scope.__TORPH_TRACE__ !== undefined) {
    return scope.__TORPH_TRACE__;
  }

  const api: TorphTraceApi = {
    clear: clearTorphTrace,
    count: () => getTorphTraceStore().lines.length,
    download: downloadTorphTrace,
    text: getTorphTraceText,
  };
  scope.__TORPH_TRACE__ = api;
  return api;
}

function appendTorphTrace(
  instanceId: number,
  event: string,
  payload: Record<string, unknown>,
) {
  ensureTorphTraceApi();
  const store = getTorphTraceStore();
  const entry: TorphTraceEntry = {
    source: "torph",
    instanceId,
    event,
    payload,
    performanceNow: performance.now(),
    seq: store.nextSeq,
    time: new Date().toISOString(),
  };
  store.nextSeq += 1;

  const line = `${JSON.stringify(entry)}\n`;
  store.lines.push(line);
  store.totalBytes += line.length;

  while (
    store.lines.length > TORPH_TRACE_MAX_LINES ||
    store.totalBytes > TORPH_TRACE_MAX_BYTES
  ) {
    const removed = store.lines.shift();
    if (removed === undefined) {
      break;
    }
    store.totalBytes = Math.max(0, store.totalBytes - removed.length);
  }
}

export function roundDebugValue(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return value;
  }

  return Math.round(value * 10000) / 10000;
}

export function summarizeDebugSnapshot(snapshot: MorphSnapshot | null) {
  if (snapshot === null) {
    return null;
  }

  return {
    text: snapshot.text,
    renderText: snapshot.renderText,
    width: roundDebugValue(snapshot.width),
    height: roundDebugValue(snapshot.height),
    graphemes: snapshot.graphemes.length,
  };
}

export function summarizeDebugGlyphs(snapshot: MorphSnapshot | null) {
  if (snapshot === null) {
    return null;
  }

  return snapshot.graphemes.map((grapheme, index) => ({
    index,
    glyph: grapheme.glyph,
    key: grapheme.key,
    left: roundDebugValue(grapheme.left),
    top: roundDebugValue(grapheme.top),
    width: roundDebugValue(grapheme.width),
    height: roundDebugValue(grapheme.height),
  }));
}

export function summarizeDebugMeasurement(measurement: MorphMeasurement | null) {
  if (measurement === null) {
    return null;
  }

  return {
    layoutInlineSize: roundDebugValue(measurement.layoutInlineSize),
    reservedInlineSize: roundDebugValue(measurement.reservedInlineSize),
    flowInlineSize: roundDebugValue(measurement.flowInlineSize),
    rootOrigin: {
      left: roundDebugValue(measurement.rootOrigin.left),
      top: roundDebugValue(measurement.rootOrigin.top),
    },
    snapshot: summarizeDebugSnapshot(measurement.snapshot),
  };
}

export function summarizeDebugMeasurementAnchors(measurement: MorphMeasurement | null) {
  if (measurement === null) {
    return null;
  }

  const anchors = [];
  const anchorIndices = collectDebugAnchorIndices(measurement.snapshot.graphemes.length);
  for (const index of anchorIndices) {
    const grapheme = measurement.snapshot.graphemes[index];
    if (grapheme === undefined) {
      continue;
    }

    anchors.push({
      index,
      glyph: grapheme.glyph,
      left: roundDebugValue(measurement.rootOrigin.left + grapheme.left),
      top: roundDebugValue(measurement.rootOrigin.top + grapheme.top),
      width: roundDebugValue(grapheme.width),
      height: roundDebugValue(grapheme.height),
    });
  }

  return anchors;
}

export function summarizeDebugLayoutContext(layoutContext: LayoutContext | null) {
  if (layoutContext === null) {
    return null;
  }

  return {
    display: layoutContext.display,
    parentDisplay: layoutContext.parentDisplay,
    whiteSpace: layoutContext.whiteSpace,
    width: roundDebugValue(layoutContext.width),
    measurementCause: layoutContext.measurementCause,
    measurementStability: layoutContext.measurementStability,
    measurementVersion: layoutContext.measurementVersion,
  };
}

export function summarizeDebugRect(rect: DOMRect | null) {
  if (rect === null) {
    return null;
  }

  return {
    left: roundDebugValue(rect.left),
    top: roundDebugValue(rect.top),
    width: roundDebugValue(rect.width),
    height: roundDebugValue(rect.height),
  };
}

function collectDebugAnchorIndices(length: number) {
  const indices = new Set<number>();
  if (length <= 0) {
    return [] as number[];
  }

  indices.add(0);
  if (length > 1) {
    indices.add(1);
    indices.add(length - 2);
  }

  if (length > 2) {
    indices.add(Math.floor((length - 1) / 2));
  }

  indices.add(length - 1);
  return Array.from(indices).sort((left, right) => left - right);
}

export function summarizeDebugViewportAnchors(
  snapshot: MorphSnapshot | null,
  rootRect: DOMRect | null,
) {
  if (snapshot === null || rootRect === null) {
    return null;
  }

  const anchors = [];
  const anchorIndices = collectDebugAnchorIndices(snapshot.graphemes.length);
  for (const index of anchorIndices) {
    const grapheme = snapshot.graphemes[index];
    if (grapheme === undefined) {
      continue;
    }

    anchors.push({
      index,
      glyph: grapheme.glyph,
      left: roundDebugValue(rootRect.left + grapheme.left),
      top: roundDebugValue(rootRect.top + grapheme.top),
      width: roundDebugValue(grapheme.width),
      height: roundDebugValue(grapheme.height),
    });
  }

  return anchors;
}

export function summarizeDebugRootOriginDrift(
  measurement: MorphMeasurement | null,
  rootRect: DOMRect | null,
) {
  if (measurement === null || rootRect === null) {
    return null;
  }

  return {
    expectedLeft: roundDebugValue(measurement.rootOrigin.left),
    expectedTop: roundDebugValue(measurement.rootOrigin.top),
    actualLeft: roundDebugValue(rootRect.left),
    actualTop: roundDebugValue(rootRect.top),
    deltaLeft: roundDebugValue(rootRect.left - measurement.rootOrigin.left),
    deltaTop: roundDebugValue(rootRect.top - measurement.rootOrigin.top),
  };
}

export function summarizeSnapshotDrift(drift: SnapshotDrift) {
  return {
    comparedGlyphs: drift.comparedGlyphs,
    expectedGlyphs: drift.expectedGlyphs,
    actualGlyphs: drift.actualGlyphs,
    snapshotWidthDelta: roundDebugValue(drift.snapshotWidthDelta),
    snapshotHeightDelta: roundDebugValue(drift.snapshotHeightDelta),
    maxAbsLeftDelta: roundDebugValue(drift.maxAbsLeftDelta),
    maxAbsTopDelta: roundDebugValue(drift.maxAbsTopDelta),
    maxAbsWidthDelta: roundDebugValue(drift.maxAbsWidthDelta),
    maxAbsHeightDelta: roundDebugValue(drift.maxAbsHeightDelta),
    mismatches: drift.mismatches.map((mismatch) => ({
      index: mismatch.index,
      glyph: mismatch.glyph,
      leftDelta: roundDebugValue(mismatch.leftDelta),
      topDelta: roundDebugValue(mismatch.topDelta),
      widthDelta: roundDebugValue(mismatch.widthDelta),
      heightDelta: roundDebugValue(mismatch.heightDelta),
    })),
  };
}

export function logTorphDebug(
  instanceId: number,
  event: string,
  payload: Record<string, unknown>,
) {
  const config = readTorphDebugConfig();
  const captureTrace = shouldCaptureTorphTrace(config);
  const logToConsole = isTorphDebugEnabled(config);

  if (!captureTrace && !logToConsole) {
    return;
  }

  if (captureTrace) {
    appendTorphTrace(instanceId, event, payload);
  }

  if (logToConsole) {
    console.log(`[Torph#${instanceId}] ${event}`, payload);
  }
}
