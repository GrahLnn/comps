import { MORPH, type MorphSnapshot } from "./types";
import { nearlyEqual } from "./math";

export function isSingleLineSnapshot(snapshot: MorphSnapshot) {
  if (snapshot.graphemes.length <= 1) {
    return true;
  }

  const firstTop = snapshot.graphemes[0]!.top;
  return snapshot.graphemes.every((grapheme) =>
    nearlyEqual(grapheme.top, firstTop, MORPH.lineGroupingEpsilon),
  );
}

export function assertSingleLineSnapshot(snapshot: MorphSnapshot) {
  if (isSingleLineSnapshot(snapshot)) {
    return snapshot;
  }

  throw new Error(
    `Torph only supports single-line text layout. Received wrapped text: "${snapshot.renderText}"`,
  );
}
