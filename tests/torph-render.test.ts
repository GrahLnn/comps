import { describe, expect, test } from "bun:test";
import {
  getExitTransform,
  getExitTransition,
  getLiveTransform,
  getLiveTransition,
} from "../torph/src/core/render";
import type { MorphLiveItem } from "../torph/src/core/types";

function createMoveItem(): MorphLiveItem {
  return {
    glyph: "a",
    key: "a-0",
    left: 20,
    top: 8,
    width: 10,
    height: 18,
    kind: "move",
    fromLeft: 6,
    fromTop: 2,
  };
}

function createEnterItem(): MorphLiveItem {
  return {
    glyph: "b",
    key: "b-0",
    left: 32,
    top: 8,
    width: 11,
    height: 18,
    kind: "enter",
    fromLeft: null,
    fromTop: null,
  };
}

describe("getLiveTransform", () => {
  test("keeps move glyphs on the shared bridge path during prepare", () => {
    expect(
      getLiveTransform(createMoveItem(), "prepare", {
        offsetX: 3,
        offsetY: 4,
      }),
    ).toBe("translate(-11px, -2px)");
  });

  test("keeps enter glyphs pinned to their target coordinates", () => {
    expect(
      getLiveTransform(createEnterItem(), "prepare", {
        offsetX: 30,
        offsetY: -12,
      }),
    ).toBe("translate(0px, 0px)");
  });
});

describe("non-move glyph transitions", () => {
  test("enter glyphs fade without transform animation", () => {
    expect(getLiveTransition(createEnterItem(), "animate")).toContain("opacity");
    expect(getLiveTransition(createEnterItem(), "animate")).not.toContain("transform");
  });

  test("exit glyphs fade without transform animation", () => {
    expect(getExitTransition("animate")).toContain("opacity");
    expect(getExitTransition("animate")).not.toContain("transform");
  });

  test("exit glyphs stay pinned to the source root while fading", () => {
    expect(
      getExitTransform({
        offsetX: -108.7,
        offsetY: 0,
      }),
    ).toBe("translate(-108.7px, 0px)");
  });
});
