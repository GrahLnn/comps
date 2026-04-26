import { describe, expect, test } from "bun:test";
import { getFallbackTextStyle } from "../torph/src/components/Torph.layers";

describe("getFallbackTextStyle", () => {
  test("keeps the fallback flow on a single line before measurement is ready", () => {
    const style = getFallbackTextStyle(false);

    expect(style.display).toBe("block");
    expect(style.gridArea).toBe("1 / 1");
    expect(style.whiteSpace).toBe("nowrap");
  });

  test("keeps the hidden fallback flow on a single line while glyph overlay is active", () => {
    const style = getFallbackTextStyle(true);

    expect(style.visibility).toBe("hidden");
    expect(style.pointerEvents).toBe("none");
    expect(style.whiteSpace).toBe("nowrap");
  });
});
