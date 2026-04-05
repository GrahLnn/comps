import { describe, expect, test } from "bun:test";
import {
  doesTransitionTargetAffectNode,
  isFontMetricTransitionProperty,
  notifyMorphMeasurementInvalidationSubscribers,
  readFont,
  subscribeMorphMeasurementInvalidation,
} from "../torph/src/core/layout-observer";

describe("readFont", () => {
  test("prefers the browser font shorthand when it is available", () => {
    const styles = {
      font: "600 24px / 32px Test Sans",
      fontStyle: "normal",
      fontVariant: "normal",
      fontWeight: "600",
      fontSize: "24px",
      lineHeight: "32px",
      fontFamily: "\"Ignored\"",
    } as CSSStyleDeclaration;

    expect(readFont(styles)).toBe("600 24px / 32px Test Sans");
  });

  test("reconstructs a shorthand when the browser leaves styles.font empty", () => {
    const styles = {
      font: "",
      fontStyle: "italic",
      fontVariant: "small-caps",
      fontWeight: "700",
      fontSize: "20px",
      lineHeight: "28px",
      fontFamily: "\"Noto Sans\"",
    } as CSSStyleDeclaration;

    expect(readFont(styles)).toBe(
      'italic small-caps 700 20px / 28px "Noto Sans"',
    );
  });
});

describe("morph measurement invalidation subscribers", () => {
  test("notifies every active subscriber", () => {
    const calls: string[] = [];
    const unsubscribeA = subscribeMorphMeasurementInvalidation(() => {
      calls.push("a");
    });
    const unsubscribeB = subscribeMorphMeasurementInvalidation(() => {
      calls.push("b");
    });

    try {
      notifyMorphMeasurementInvalidationSubscribers();
    } finally {
      unsubscribeA();
      unsubscribeB();
    }

    expect(calls).toEqual(["a", "b"]);
  });

  test("stops notifying subscribers after unsubscribe", () => {
    const calls: string[] = [];
    const unsubscribe = subscribeMorphMeasurementInvalidation(() => {
      calls.push("live");
    });

    unsubscribe();
    notifyMorphMeasurementInvalidationSubscribers();

    expect(calls).toEqual([]);
  });
});

describe("font metric transition helpers", () => {
  type FakeNode = {
    parent: FakeNode | null;
    contains: (node: unknown) => boolean;
  };

  function readFakeNode(node: unknown): FakeNode | null {
    if (typeof node !== "object" || node === null) {
      return null;
    }

    if (!("parent" in node) || !("contains" in node)) {
      return null;
    }

    return node as FakeNode;
  }

  function createNode(parent: FakeNode | null) {
    return {
      parent,
      contains(node: unknown) {
        let current = readFakeNode(node);

        while (current !== null) {
          if (current === this) {
            return true;
          }

          current = current.parent;
        }

        return false;
      },
    } satisfies FakeNode;
  }

  test("treats inherited font metric transitions as relevant", () => {
    expect(isFontMetricTransitionProperty("font-weight")).toBe(true);
    expect(isFontMetricTransitionProperty("font-variation-settings")).toBe(true);
    expect(isFontMetricTransitionProperty("letter-spacing")).toBe(true);
  });

  test("ignores unrelated transition properties", () => {
    expect(isFontMetricTransitionProperty("opacity")).toBe(false);
    expect(isFontMetricTransitionProperty("transform")).toBe(false);
    expect(isFontMetricTransitionProperty("width")).toBe(false);
  });

  test("matches the observed node and its ancestors only", () => {
    const root = createNode(null);
    const child = createNode(root);
    const sibling = createNode(root);
    const descendant = createNode(child);

    expect(
      doesTransitionTargetAffectNode(descendant as unknown as Node, descendant as unknown as EventTarget),
    ).toBe(true);
    expect(
      doesTransitionTargetAffectNode(descendant as unknown as Node, child as unknown as EventTarget),
    ).toBe(true);
    expect(
      doesTransitionTargetAffectNode(descendant as unknown as Node, root as unknown as EventTarget),
    ).toBe(true);
    expect(
      doesTransitionTargetAffectNode(child as unknown as Node, sibling as unknown as EventTarget),
    ).toBe(false);
    expect(doesTransitionTargetAffectNode(child as unknown as Node, null)).toBe(false);
  });
});
