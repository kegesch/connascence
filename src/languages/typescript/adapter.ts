import { Symbol as TsSymbol } from 'ts-morph';
import { SymbolTable } from './symbolTable.js';
import { SemanticAdapter } from '../../core/adapter.js';

/**
 * TypeScript semantic adapter backed by ts-morph's TypeChecker.
 * Its only job is to answer semantic queries over the IR nodes built by
 * buildSymbolTable; nothing in core may depend on this file.
 */

/** Strip module paths so types compare by their name; keep typeof markers. */
function normalizeType(type: string): string {
  return type.replace(/import\("[^"]*"\)\./g, '').replace(/\s+/g, ' ').trim();
}

function typeOfSymbol(symbol: TsSymbol): string | undefined {
  const decl = symbol.getDeclarations()?.[0];
  if (!decl) return undefined;
  try {
    return normalizeType(symbol.getTypeAtLocation(decl).getText());
  } catch {
    return undefined;
  }
}

export class TypeScriptAdapter implements SemanticAdapter {
  private readonly types = new Map<string, string>();

  constructor(symbolTable: SymbolTable) {
    for (const [refId, symbol] of symbolTable.refIdToSymbol) {
      const t = typeOfSymbol(symbol);
      if (t) this.types.set(refId, t);
    }
    for (const [defId, symbol] of symbolTable.defIdToSymbol) {
      const t = typeOfSymbol(symbol);
      if (t) this.types.set(defId, t);
    }
  }

  resolveType(nodeId: string): string | undefined {
    return this.types.get(nodeId);
  }
}
