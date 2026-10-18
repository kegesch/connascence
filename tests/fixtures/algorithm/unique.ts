// True negative: all functions have distinct structure.
export function one(n: number): number {
  return n * 2;
}

export function two(words: string[]): string {
  return words.join('-');
}

export function three(flag: boolean): number {
  if (flag) {
    return 1;
  }
  return 0;
}
