import { Project, SyntaxKind, Symbol as TsSymbol } from 'ts-morph';
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
  /** filePath -> set of line / "line:column" keys holding string literals typed as string-literal-union members */
  private readonly unionLinesByFile = new Map<string, Set<string>>();

  constructor(symbolTable: SymbolTable) {
    this.tsProject = symbolTable.tsProject;
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

  isStringUnionMember(filePath: string, startLine: number, startColumn?: number): boolean {
    const positions = this.unionPositions(filePath);
    if (startColumn === undefined) return positions.has(String(startLine));
    return positions.has(`${startLine}:${startColumn}`);
  }

  private tsProject: Project;

  /**
   * Lazily compute, per source file, the string literals that are members of a
   * union of string literals. Keyed by exact line (and "line:column" when the
   * caller supplies a column, so multiple literals on one line are told apart).
   */
  private unionPositions(filePath: string): Set<string> {
    const cached = this.unionLinesByFile.get(filePath);
    if (cached) return cached;
    const positions = new Set<string>();
    const sourceFile = this.tsProject.getSourceFile(filePath);
    if (sourceFile) {
      const checker = this.tsProject.getTypeChecker();
      for (const lit of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
        let contextual;
        try {
          contextual = checker.getContextualType(lit);
        } catch {
          continue;
        }
        if (!contextual?.isUnion()) continue;
        const union = contextual.getUnionTypes();
        if (!union.every((u) => u.isStringLiteral())) continue;
        // the literal must actually be one of the union's members ('MAGIC' against
        // FileMode = 'read' | 'write' shares the contextual union but isn't assignable)
        try {
          if (checker.isTypeAssignableTo(lit.getType(), contextual)) {
            const lc = sourceFile.getLineAndColumnAtPos(lit.getStart());
            positions.add(`${lc.line}`);
            positions.add(`${lc.line}:${lc.column}`);
          }
        } catch {
          continue;
        }
      }
    }
    this.unionLinesByFile.set(filePath, positions);
    return positions;
  }
}
