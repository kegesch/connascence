export interface Chord {
  root: string;
  quality: string;
}

export const defaultChord: Chord = { root: 'C', quality: 'maj' };

export function makeChord(root: string, quality: string): Chord {
  return { root, quality };
}
