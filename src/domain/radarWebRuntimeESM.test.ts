import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as ts from 'typescript';

/** Vercel transpila api/radar-web.ts a ESM sin resolver imports relativos sin extensión. */
describe('Radar: módulos ESM ejecutables en Vercel', () => {
  it('todos los imports relativos de ejecución llevan .js y apuntan a un archivo real', () => {
    const pendientes = [resolve('api/radar-web.ts')];
    const revisados = new Set<string>();
    const salida = mkdtempSync(join(tmpdir(), 'ulit-radar-esm-'));
    writeFileSync(join(salida, 'package.json'), '{"type":"module"}');
    while (pendientes.length) {
      const archivo = pendientes.pop()!;
      if (revisados.has(archivo)) continue;
      revisados.add(archivo);
      const fuente = readFileSync(archivo, 'utf8');
      const relativo = relative(process.cwd(), archivo).replace(/\\.ts$/, '.js');
      const destinoJS = join(salida, relativo);
      mkdirSync(dirname(destinoJS), { recursive: true });
      writeFileSync(destinoJS, ts.transpileModule(fuente, {
        compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
      }).outputText);
      const arbol = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.Latest, true);
      for (const declaracion of arbol.statements) {
        if (!ts.isImportDeclaration(declaracion) || declaracion.importClause?.isTypeOnly ||
            !ts.isStringLiteral(declaracion.moduleSpecifier)) continue;
        const ruta = declaracion.moduleSpecifier.text;
        if (!ruta.startsWith('.')) continue;
        expect(ruta.endsWith('.js'), archivo + ' -> ' + ruta).toBe(true);
        const destino = resolve(dirname(archivo), ruta.slice(0, -3) + '.ts');
        expect(existsSync(destino), archivo + ' -> ' + ruta).toBe(true);
        pendientes.push(destino);
      }
    }
    expect(revisados.size).toBeGreaterThan(1);
    // Reproducir el cargador ESM de Node sin Vite: antes esto lanzaba ERR_MODULE_NOT_FOUND.
    try {
      const modulo = pathToFileURL(join(salida, 'api/radar-web.js')).href;
      const script = `const api = await import(${JSON.stringify(modulo)}); const r = await api.default(new Request('https://localhost/api/radar-web', {method:'GET'})); if(r.status!==405) process.exit(1); console.log('RADAR_ESM_OK');`;
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        timeout: 5000, encoding: 'utf8',
      });
      expect(out).toContain('RADAR_ESM_OK');
    } finally {
      rmSync(salida, { recursive: true, force: true });
    }
  });
});
