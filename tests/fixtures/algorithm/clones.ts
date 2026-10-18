// True positive: two structurally identical function bodies (names differ).
export function sumCents(a: number, b: number): number {
  const total = a + b;
  const rounded = Math.round(total);
  return rounded;
}

export function addMinutes(x: number, y: number): number {
  const total = x + y;
  const rounded = Math.round(total);
  return rounded;
}

// True negative: unique structure.
export function distinct(words: string[]): number {
  return new Set(words).size;
}
