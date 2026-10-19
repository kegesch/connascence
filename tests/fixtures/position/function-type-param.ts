// A function *type* parameter (`item` in `(item: string) => string`) belongs to
// the contract description, not to the enclosing function's positional
// signature. Before the fix, `item` was attributed to `applyAll`, making a
// three-parameter function look like four and inventing Position edges.
export function applyAll(
  value: string,
  transform: (item: string) => string,
  fallback: string,
): string {
  return transform(value) + fallback;
}

applyAll('a', (item) => item, 'b');
