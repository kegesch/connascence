// Same shape as `helper` in basic.ts under a different name: the identity hash
// abstracts identifiers, so both must share it (rename stability, and the
// documented clone-collision limitation).
export function renamedHelper(a: number, b: number): number {
  return a + b;
}
