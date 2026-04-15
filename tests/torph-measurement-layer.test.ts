import { describe, expect, test } from "bun:test";
import { needsMeasurementLayer } from "../torph/src/core/measurement-policy";
import { FlowTextLayer } from "../torph/src/components/Torph";

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
  test("keeps layoutId unset by default", () => {
    const element = FlowTextLayer({
      flowText: "alpha beta",
      flowTextRef: { current: null },
      layoutId: null,
      shouldHideFlowText: false,
    });

    expect(element.props.children.props.layoutId).toBeUndefined();
    expect(element.props.children.props.children).toBe("alpha beta");
  });

  test("passes layoutId to the stable flow text node", () => {
    const element = FlowTextLayer({
      flowText: "alpha beta",
      flowTextRef: { current: null },
      layoutId: "shared-text",
      shouldHideFlowText: true,
    });

    expect(element.props.style.visibility).toBe("hidden");
    expect(element.props.children.props.layoutId).toBe("shared-text");
    expect(element.props.children.props.children).toBe("alpha beta");
  });
});
