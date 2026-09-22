// True positive: a 5-parameter function called positionally.
export function connect(
  host: string,
  port: number,
  user: string,
  password: string,
  database: string,
): string {
  return `${host}:${port}/${database}`;
}

// True negative: small signature, calls are not flagged.
export function add(a: number, b: number): number {
  return a + b;
}

export const result = connect('localhost', 5432, 'admin', 'secret', 'appdb') + add(1, 2);
