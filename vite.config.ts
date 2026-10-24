/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Versión de la compilación: commit y rama de los que procede (en GitHub Actions, GITHUB_SHA y
 * GITHUB_REF_NAME; en local, git). Se incrusta en la aplicación y se publica en `version.json`, con la
 * huella SHA-256 de cada archivo compilado: así la aplicación puede comprobar que lo que sirve el
 * alojamiento es exactamente lo que se compiló a partir de ese commit.
 */
function git(cmd: string) {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}
const COMMIT = process.env.GITHUB_SHA || git('rev-parse HEAD') || 'desconocido';
const RAMA = process.env.GITHUB_REF_NAME || git('rev-parse --abbrev-ref HEAD') || 'desconocida';

function versionJson(): Plugin {
  let salida = 'dist';
  return {
    name: 'ulit-version-json',
    apply: 'build',
    configResolved(c) {
      salida = c.build.outDir;
    },
    closeBundle() {
      const archivos: Record<string, string> = {};
      const recorrer = (dir: string) => {
        for (const n of readdirSync(dir).sort()) {
          const p = join(dir, n);
          if (statSync(p).isDirectory()) recorrer(p);
          else if (n !== 'version.json') archivos[relative(salida, p).split('\\').join('/')] = createHash('sha256').update(readFileSync(p)).digest('hex');
        }
      };
      recorrer(salida);
      writeFileSync(join(salida, 'version.json'), JSON.stringify({ formato: 'ulit-censo/version', commit: COMMIT, rama: RAMA, archivos }, null, 1));
    },
  };
}

// Prototipo estático: base relativa para poder abrirse desde cualquier ruta de previsualización.
export default defineConfig({
  base: './',
  plugins: [react(), versionJson()],
  define: {
    'import.meta.env.VITE_COMMIT': JSON.stringify(COMMIT),
    'import.meta.env.VITE_RAMA': JSON.stringify(RAMA),
  },
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
