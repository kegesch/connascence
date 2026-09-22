// Magic literal repeated across files (cross-file usage via export).
export function openTab(name: string): string {
  return `tab:${name}`;
}

export function closeTab(name: string): string {
  return `closed:${name}`;
}

export const defaultTab = openTab('home');
