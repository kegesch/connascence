import { ConnascenceType } from '../ir.js';

/**
 * Static strength lookup per connascence type, weakest (1) to strongest (9),
 * following the connascence.io ranking. Static types rank weaker than dynamic ones.
 * This is a fixed table — no computation.
 */
export const STRENGTH: Readonly<Record<ConnascenceType, number>> = {
  name: 1,
  type: 2,
  meaning: 3,
  position: 4,
  algorithm: 5,
  execution: 6,
  timing: 7,
  value: 8,
  identity: 9,
};

export function strengthOf(type: ConnascenceType): number {
  return STRENGTH[type];
}
