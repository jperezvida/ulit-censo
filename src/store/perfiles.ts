import { createStore, entries, set as idbSet, type UseStore } from 'idb-keyval';
import { firmaPerfil, validarPerfil } from '../domain/xlsx/correspondencia';
import type { PerfilImportacion } from '../domain/xlsx/perfilesImportacion';

/**
 * G1 · Perfiles de importación GUARDADOS en este navegador. Un perfil solo describe la ESTRUCTURA de
 * un Excel (cabeceras y su campo de ULIT): no contiene ningún dato del censo. Se guardan en una base
 * propia, separada de la demostración y de los espacios de ensayo y de datos reales.
 * Cada cambio de correspondencia con el mismo nombre crea una VERSIÓN nueva; las anteriores se conservan.
 */
export const BASE_PERFILES = 'ulit-censo-perfiles';
let almacen: UseStore | null = null;
const st = () => (almacen ??= createStore(BASE_PERFILES, 'perfiles'));

/** Última versión de cada perfil guardado. */
export async function listarPerfiles(): Promise<PerfilImportacion[]> {
  const ultimos = new Map<string, PerfilImportacion>();
  for (const [, v] of await entries(st())) {
    const r = validarPerfil(v);
    if (!r.ok) continue;
    const prev = ultimos.get(r.perfil.id);
    if (!prev || prev.version < r.perfil.version) ultimos.set(r.perfil.id, r.perfil);
  }
  return [...ultimos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Guarda el perfil. Si ya existe con otro contenido, como versión nueva; si es idéntico, no cambia nada. */
export async function guardarPerfil(p: PerfilImportacion): Promise<PerfilImportacion> {
  const v = validarPerfil(p);
  if (!v.ok) throw new Error(v.motivo);
  const previo = (await listarPerfiles()).find((x) => x.id === p.id);
  if (previo && firmaPerfil(previo) === firmaPerfil(p)) return previo;
  const guardado: PerfilImportacion = { ...v.perfil, formato: 'ulit-censo/perfil-importacion', version: previo ? previo.version + 1 : 1 };
  await idbSet(`${guardado.id}@${guardado.version}`, guardado, st());
  return guardado;
}
