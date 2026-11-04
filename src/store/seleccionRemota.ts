import type { TipoEspacio } from '../domain/espacios';

/**
 * Espacio del SERVIDOR elegido en esta pestaña. Solo se guarda su identificador (nunca datos), en
 * `sessionStorage`, para que al recargar la página se vuelva a abrir ese espacio desde el servidor y nunca
 * se confunda con el espacio de IndexedDB del mismo tipo.
 */
export interface SeleccionRemota { espacioId: string; tipo: TipoEspacio }
const CLAVE = 'ulit-censo-espacio-remoto';

export function leerSeleccionRemota(): SeleccionRemota | null {
  try {
    const x = JSON.parse(globalThis.sessionStorage?.getItem(CLAVE) ?? 'null') as SeleccionRemota | null;
    return x && typeof x.espacioId === 'string' && (x.tipo === 'ensayo' || x.tipo === 'real') ? x : null;
  } catch {
    return null;
  }
}
export function guardarSeleccionRemota(s: SeleccionRemota) {
  try { globalThis.sessionStorage?.setItem(CLAVE, JSON.stringify(s)); } catch { /* sin almacenamiento de sesión */ }
}
export function borrarSeleccionRemota() {
  try { globalThis.sessionStorage?.removeItem(CLAVE); } catch { /* sin almacenamiento de sesión */ }
}
