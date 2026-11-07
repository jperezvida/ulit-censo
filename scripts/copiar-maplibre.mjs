#!/usr/bin/env node
/**
 * Copia el worker de MapLibre (módulo ES) y su módulo compartido a public/maplibre/,
 * para servirlos tal cual en desarrollo y en la compilación.
 */
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('public/maplibre', { recursive: true });
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  await copyFile(`node_modules/maplibre-gl/dist/${f}`, `public/maplibre/${f}`);
}
