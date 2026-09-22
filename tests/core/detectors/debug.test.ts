import { it } from 'vitest';
import { buildSymbolTable } from '../../../src/languages/typescript/symbolTable.ts';

it('debug', () => {
  const t = buildSymbolTable(['tests/fixtures/meaning/usage.ts']);
  console.log(t.project.nodes.filter((n) => n.kind === 'literal').map((n) => `${n.name}@${n.location.startLine}`).join(', ') || 'NO LITERALS');
});
