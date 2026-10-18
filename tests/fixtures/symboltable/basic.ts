export function helper(a: number, b: number): number {
  return a + b;
}

export function outer(): () => number {
  function inner(): number {
    return helper(1, 2);
  }
  return inner;
}

export class Widget {
  method(): number {
    return helper(3, 4);
  }
}
