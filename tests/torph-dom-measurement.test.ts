import { describe, expect, test } from "bun:test";
import {
  measureSnapshotDrift,
  readCachedMorphSnapshot,
  rememberCachedMorphSnapshot,
} from "../torph/src/core/dom-measurement";
import type { MorphSnapshot } from "../torph/src/core/types";

function createSnapshot(
  text: string,
  {
    width = text.length * 10,
    height = 24,
    leftOffset = 0,
    topOffset = 0,
    glyphWidth = 10,
    glyphHeight = 24,
  }: {
    width?: number;
    height?: number;
    leftOffset?: number;
    topOffset?: number;
    glyphWidth?: number;
    glyphHeight?: number;
  } = {},
): MorphSnapshot {
  return {
    text,
    renderText: text,
    width,
    height,
    graphemes: Array.from(text).map((glyph, index) => ({
      glyph,
      key: `${glyph}-${index}`,
      left: leftOffset + index * glyphWidth,
      top: topOffset,
      width: glyphWidth,
      height: glyphHeight,
    })),
  };
}

describe("torph dom measurement cache", () => {
  test("keeps cache hits hot and evicts the least recently used snapshot", () => {
    const cache = new Map<string, MorphSnapshot>();

    for (let index = 0; index < 8; index += 1) {
      rememberCachedMorphSnapshot(
        cache,
        `text-${index}`,
        createSnapshot(`Text ${index}`),
      );
    }

    expect(readCachedMorphSnapshot(cache, "text-0")?.text).toBe("Text 0");

    rememberCachedMorphSnapshot(cache, "text-8", createSnapshot("Text 8"));

    expect(cache.has("text-1")).toBe(false);
    expect(cache.has("text-0")).toBe(true);
    expect(cache.has("text-8")).toBe(true);
    expect(cache.size).toBe(8);
  });
});

describe("measureSnapshotDrift", () => {
  test("reports aggregate drift and caps stored mismatches", () => {
    const expected = createSnapshot("ABCDEFGHIJ");
    const actual = createSnapshot("ABCDEFGHIJ", {
      width: expected.width + 5,
      height: expected.height - 2,
      leftOffset: 1,
      topOffset: 2,
      glyphWidth: 11,
      glyphHeight: 22,
    });

    const drift = measureSnapshotDrift(expected, actual);

    expect(drift.expectedGlyphs).toBe(10);
    expect(drift.actualGlyphs).toBe(10);
    expect(drift.snapshotWidthDelta).toBe(5);
    expect(drift.snapshotHeightDelta).toBe(-2);
    expect(drift.maxAbsLeftDelta).toBe(10);
    expect(drift.maxAbsTopDelta).toBe(2);
    expect(drift.maxAbsWidthDelta).toBe(1);
    expect(drift.maxAbsHeightDelta).toBe(2);
    expect(drift.mismatches).toHaveLength(8);
    expect(drift.mismatches[0]).toMatchObject({
      index: 0,
      glyph: "A",
      leftDelta: 1,
      topDelta: 2,
      widthDelta: 1,
      heightDelta: -2,
    });
  });
});
