import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase para ULIT Censo. Solo existe si la compilación lo configura con la URL del proyecto
 * y su clave PÚBLICA (`anon`/publishable): nunca una clave privilegiada. El acceso a los datos lo decide
 * el servidor con la sesión de Supabase Auth y la pertenencia al espacio.
 */
export function configServidor(): { url: string; clave: string; origen: string } | null {
  const url = import.meta.env.VITE_ULIT_CENSO_SUPABASE_URL as string | undefined;
  const clave = import.meta.env.VITE_ULIT_CENSO_SUPABASE_CLAVE_PUBLICA as string | undefined;
  if (!url || !clave) return null;
  if (esClavePrivilegiada(clave)) throw new Error('La clave configurada para ULIT Censo es privilegiada: no se usa en el navegador.');
  return { url, clave, origen: new URL(url).origin };
}

/** Clave secreta (sb_secret_…) o JWT con rol `service_role`. */
export function esClavePrivilegiada(clave: string): boolean {
  if (clave.startsWith('sb_secret_')) return true;
  const partes = clave.split('.');
  if (partes.length !== 3) return false;
  try {
    const carga = JSON.parse(atob(partes[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
    return carga.role !== 'anon';
  } catch {
    return true;
  }
}

let cliente: SupabaseClient | null = null;
export function clienteServidor(): SupabaseClient | null {
  const c = configServidor();
  if (!c) return null;
  cliente ??= createClient(c.url, c.clave, { auth: { persistSession: true, storageKey: 'ulit-censo-sesion' } });
  return cliente;
}
