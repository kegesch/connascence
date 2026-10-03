import { FileMode } from './types';

declare function open(path: string, mode: FileMode): void;

export function loadAll(): void {
  open('a.txt', 'read');
  open('b.txt', 'read');
  open('c.txt', 'read');
  open('d.txt', 'MAGIC');
  open('e.txt', 'MAGIC');
  open('f.txt', 'MAGIC');
}
