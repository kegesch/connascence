import { FileMode } from './types';

declare function open(path: string, mode: FileMode): void;

export function saveAll(): void {
  open('g.txt', 'read');
  open('h.txt', 'read');
  open('i.txt', 'read');
  open('j.txt', 'MAGIC');
  open('k.txt', 'MAGIC');
  open('l.txt', 'MAGIC');
}
