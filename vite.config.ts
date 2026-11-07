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
/**
 * Rama de origen. Solo se muestra si está verificada:
 *  1. GITHUB_REF_NAME (GitHub Actions: la rama que disparó la compilación);
 *  2. RAMA_COMPILACION (compilaciones manuales), solo si `origin/<rama>` contiene el commit;
 *  3. la rama local de git, con la misma condición.
 * Si no se puede verificar (p. ej., una copia local llamada «master» que no existe en el remoto),
 * se indica «sin verificar»: nunca se muestra una rama que no conste en el repositorio.
 */
const gitOk = (cmd: string) => {
  try {
    execSync(`git ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const enRemoto = (rama: string) => /^[\w./-]+$/.test(rama) && /^[0-9a-f]{40}$/.test(COMMIT) && gitOk(`merge-base --is-ancestor ${COMMIT} refs/remotes/origin/${rama}`);
const ramaVerificada = () => {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  const pedida = process.env.RAMA_COMPILACION?.trim();
  if (pedida) return enRemoto(pedida) ? pedida : 'sin verificar';
  const local = git('rev-parse --abbrev-ref HEAD');
  return local && local !== 'HEAD' && enRemoto(local) ? local : 'sin verificar';
};
const RAMA = ramaVerificada();

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
