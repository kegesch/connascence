import { counter, increment } from './state';

export function show(): number {
  increment();
  return counter;
}

const FIXED = 10;
export const useFixed = (): number => FIXED;
