import { describe, expect, test } from "bun:test";
import {
  assertSingleLineSnapshot,
  isSingleLineSnapshot,
} from "../torph/src/core/snapshot";

describe("torph single-line contract", () => {
  test("accepts a single-line snapshot", () => {
    const snapshot = {
      text: "Open Window",
      renderText: "Open Window",
      width: 102,
      height: 24,
      graphemes: [
        { glyph: "O", key: "O:0", left: 0, top: 0, width: 10, height: 24 },
        { glyph: "p", key: "p:1", left: 10, top: 0, width: 8, height: 24 },
        { glyph: "e", key: "e:2", left: 18, top: 0, width: 8, height: 24 },
      ],
    };

    expect(isSingleLineSnapshot(snapshot)).toBe(true);
    expect(assertSingleLineSnapshot(snapshot)).toBe(snapshot);
  });

  test("rejects a wrapped snapshot", () => {
    const snapshot = {
      text: "Golden Hour",
      renderText: "Golden Hour",
      width: 52,
      height: 48,
      graphemes: [
        { glyph: "G", key: "G:0", left: 0, top: 0, width: 10, height: 24 },
        { glyph: "o", key: "o:1", left: 10, top: 0, width: 8, height: 24 },
        { glyph: "H", key: "H:7", left: 0, top: 24, width: 10, height: 24 },
      ],
    };

    expect(isSingleLineSnapshot(snapshot)).toBe(false);
    expect(() => assertSingleLineSnapshot(snapshot)).toThrow(
      'Torph only supports single-line text layout. Received wrapped text: "Golden Hour"',
    );
  });
});
