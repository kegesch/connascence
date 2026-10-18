// more single-char literal uses so the value passes minCount/minFiles when not skipped
export function splitPath(p: string): string[] {
  return p.split('/');
}

export function stripSlash(p: string): string {
  return p.endsWith('/') ? p.slice(0, -1) : p + '/';
}
