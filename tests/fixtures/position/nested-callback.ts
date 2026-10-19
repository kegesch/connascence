// True negative for parameter ownership: a narrow function that contains a
// wide callback must not look wide. Before the fix, the callback's parameters
// were attributed to the enclosing function, so `configure(1)` was reported as
// positional coupling into a 5-parameter signature.
export function configure(enabled?: boolean): boolean {
  return [1, 2, 3].some((value, index, array, extra) => value + index + array.length + Number(extra) > 0 && enabled !== false);
}

export const ok = configure(true);
