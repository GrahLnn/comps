import { describe, expect, test } from "bun:test";
import { needsMeasurementLayer } from "../torph/src/core/measurement-policy";

describe("needsMeasurementLayer", () => {
  test("requests the in-tree measurement layer for cold probe runs", () => {
    expect(needsMeasurementLayer("probe", "alpha beta")).toBe(true);
  });

  test("skips the measurement layer on the pure pretext fast path", () => {
    expect(needsMeasurementLayer("pretext", "alpha beta")).toBe(false);
  });

  test("does not request a measurement layer for empty content", () => {
    expect(needsMeasurementLayer("dom", "")).toBe(false);
  });
});
