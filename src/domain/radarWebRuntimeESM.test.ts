import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as ts from 'typescript';

/** Vercel transpila api/radar-web.ts a ESM sin resolver imports relativos sin extensión. */
describe('Radar: módulos ESM ejecutables en Vercel', () => {
  it('todos los imports relativos de ejecución llevan .js y apuntan a un archivo real', () => {
    const pendientes = [resolve('api/radar-web.ts')];
    const revisados = new Set<string>();
    while (pendientes.length) {
      const archivo = pendientes.pop()!;
      if (revisados.has(archivo)) continue;
      revisados.add(archivo);
      const fuente = readFileSync(archivo, 'utf8');
      const arbol = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.Latest, true);
      for (const declaracion of arbol.statements) {
        if (!ts.isImportDeclaration(declaracion) || declaracion.importClause?.isTypeOnly ||
            !ts.isStringLiteral(declaracion.moduleSpecifier)) continue;
        const ruta = declaracion.moduleSpecifier.text;
        if (!ruta.startsWith('.')) continue;
        expect(ruta, archivo).toMatch(/\\.js$/);
        const destino = resolve(dirname(archivo), ruta.replace(/\\.js$/, '.ts'));
        expect(existsSync(destino), archivo + ' -> ' + ruta).toBe(true);
        pendientes.push(destino);
      }
    }
    expect(revisados.size).toBeGreaterThan(1);
  });
});
