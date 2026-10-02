/** Normalize a path to forward slashes (Windows-safe), for keys, diffing and URIs. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Last two path segments, forward-slash normalized — compact display form for reports. */
export function shortPath(p: string): string {
  return toPosix(p).split('/').slice(-2).join('/');
}
