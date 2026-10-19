import path from 'node:path';

/** Separator for composite string keys built from two ids (never appears in real ids). */
export const KEY_SEP = '\u0000';

/** Normalize a path to forward slashes (Windows-safe), for keys, diffing and URIs. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Last two path segments, forward-slash normalized — compact display form for reports. */
export function shortPath(p: string): string {
  return toPosix(p).split('/').slice(-2).join('/');
}

/** Directory portion of a path (posix, as it appears in file paths). */
export function dirOf(filePath: string): string {
  return path.posix.dirname(toPosix(filePath));
}

/** Simple glob match: ** crosses directories (including zero), * within one segment, ? one char. */
export function globMatch(pattern: string, pathValue: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        // `**/` matches zero or more directories, so src/**/*.ts also matches
        // src/a.ts (git and ts-morph glob semantics, not shell globbing)
        .replace(/\*\*\//g, '\u0001')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
        .replace(/\u0000/g, '.*')
        .replace(/\u0001/g, '(?:.*/)?') +
      '$',
  );
  return re.test(pathValue.replace(/\\/g, '/'));
}
