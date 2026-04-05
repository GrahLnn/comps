export function nearlyEqual(a: number, b: number, epsilon = 0.5) {
  return Math.abs(a - b) <= epsilon;
}
