import { describe, expect, test } from "bun:test";
import {
  ensureTorphTraceApi,
  isTorphDebugEnabled,
  readTorphDebugConfig,
  shouldCaptureTorphTrace,
  shouldRunTorphInstrumentation,
} from "../torph/src/debug/trace";

describe("torph debug policy", () => {
  test("keeps trace disabled by default without console logging", () => {
    const scope = globalThis as typeof globalThis & {
      __TORPH_DEBUG__?: unknown;
    };
    const previous = scope.__TORPH_DEBUG__;

    try {
      delete scope.__TORPH_DEBUG__;
      const config = readTorphDebugConfig();
      expect(shouldCaptureTorphTrace(config)).toBe(false);
      expect(isTorphDebugEnabled(config)).toBe(false);
      expect(shouldRunTorphInstrumentation(config)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete scope.__TORPH_DEBUG__;
      } else {
        scope.__TORPH_DEBUG__ = previous;
      }
    }
  });

  test("allows an explicit global opt-out", () => {
    const scope = globalThis as typeof globalThis & {
      __TORPH_DEBUG__?: unknown;
    };
    const previous = scope.__TORPH_DEBUG__;

    try {
      scope.__TORPH_DEBUG__ = false;
      const config = readTorphDebugConfig();
      expect(shouldCaptureTorphTrace(config)).toBe(false);
      expect(isTorphDebugEnabled(config)).toBe(false);
      expect(shouldRunTorphInstrumentation(config)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete scope.__TORPH_DEBUG__;
      } else {
        scope.__TORPH_DEBUG__ = previous;
      }
    }
  });

  test("supports explicit trace capture without console logging", () => {
    expect(shouldCaptureTorphTrace({ capture: true, console: false })).toBe(true);
    expect(isTorphDebugEnabled({ capture: true, console: false })).toBe(false);
    expect(shouldRunTorphInstrumentation({ capture: true, console: false })).toBe(true);
  });

  test("can expose the trace api even before capture is enabled", () => {
    const api = ensureTorphTraceApi();
    expect(typeof api.download).toBe("function");
    expect(typeof api.text).toBe("function");
  });
});
