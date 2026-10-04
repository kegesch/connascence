import { buildSymbolTable } from './symbolTable.js';
import { TypeScriptAdapter } from './adapter.js';
import { ScanBackend, ScanContext } from '../../core/scan.js';

/**
 * Concrete ScanBackend for TypeScript. This is the only place where the
 * symbol table and semantic adapter are wired together; the composition
 * root (src/cli.ts) injects it into core's scan().
 */
export const typescriptBackend: ScanBackend = {
  build(files: string[]): ScanContext {
    const table = buildSymbolTable(files);
    return {
      project: table.project,
      refIdToDefId: table.refIdToDefId,
      adapter: new TypeScriptAdapter(table),
    };
  },
};
