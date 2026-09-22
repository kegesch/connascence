import { Chord, defaultChord, makeChord } from './types';

export function displayName(chord: Chord): string {
  return `${chord.root}${chord.quality}`;
}

export const label = displayName(defaultChord);
export const another = makeChord('D', 'min');
