// True negative under default options: trivial single-char literals are skipped.
export function joinPath(a: string, b: string): string {
  return a + '/' + b;
}

export function rootOf(p: string): string {
  return p.split('/')[0] + '/';
}
