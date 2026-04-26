import { describe, expect, test } from "bun:test";
import { needsMeasurementLayer } from "../torph/src/core/measurement-policy";
import { FlowTextLayer } from "../torph/src/components/Torph.layers";

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

describe("FlowTextLayer", () => {
  test("renders the stable flow text with a plain span", () => {
    const element = FlowTextLayer({
      flowText: "alpha beta",
      flowTextRef: { current: null },
      shouldHideFlowText: false,
      debugInstanceId: 1,
    });

    expect(element.props.children.type).toBe("span");
    expect(element.props.children.props.children).toBe("alpha beta");
  });

  test("still hides the fallback flow text shell while preserving content", () => {
    const element = FlowTextLayer({
      flowText: "alpha beta",
      flowTextRef: { current: null },
      shouldHideFlowText: true,
      debugInstanceId: 1,
    });

    expect(element.props.style.visibility).toBe("hidden");
    expect(element.props.children.props.children).toBe("alpha beta");
  });
});
