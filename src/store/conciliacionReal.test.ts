import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { conciliacionDisponible, guardarDecisionIt1 } from './conciliacionReal';

function cliente(respuesta: { data?: unknown; error?: { code?: string; message: string } | null }) {
  const rpc = vi.fn(async () => ({ data: respuesta.data ?? null, error: respuesta.error ?? null }));
  return { c: { rpc } as unknown as SupabaseClient, rpc };
}

describe('Conciliación real: contrato de seguridad del cliente', () => {
  it('sin función SQL desplegada mantiene consulta sin controles de escritura', async () => {
    const { c, rpc } = cliente({ error: { code: 'PGRST202', message: 'not found' } });
    expect(await conciliacionDisponible(c, 4)).toBe(false);
    expect(rpc).toHaveBeenCalledWith('ulit_censo_conciliar_it1_2026', expect.objectContaining({
      p_accion: 'estado', p_espacio: 'real-medina-del-campo-2026',
    }));
  });

  it('solo habilita si el servidor afirma expresamente su capacidad', async () => {
    const enabled = cliente({ data: { habilitada: true, version: 4 } });
    const closed = cliente({ data: { habilitada: false, version: 4 } });
    expect(await conciliacionDisponible(enabled.c, 4)).toBe(true);
    expect(await conciliacionDisponible(closed.c, 4)).toBe(false);
  });

  it('rechaza decisiones sin versión, motivo o destino adecuado antes de contactar con el servidor', async () => {
    const { c, rpc } = cliente({});
    await expect(guardarDecisionIt1(c, { versionEsperada: 3, registroId: 'r15', accion: 'mantener-pendiente', motivo: 'Por comprobar en campo' })).rejects.toThrow(/Versión/);
    await expect(guardarDecisionIt1(c, { versionEsperada: 4, registroId: 'r15', accion: 'vincular', motivo: 'Por comprobar en campo' })).rejects.toThrow(/Selección/);
    await expect(guardarDecisionIt1(c, { versionEsperada: 4, registroId: 'r15', accion: 'local-nuevo', localId: 'otro', motivo: 'Por comprobar en campo' })).rejects.toThrow(/Selección/);
    await expect(guardarDecisionIt1(c, { versionEsperada: 4, registroId: 'r15', accion: 'mantener-pendiente', motivo: 'duda' })).rejects.toThrow(/motivo/);
    await expect(guardarDecisionIt1(c, { versionEsperada: 4, registroId: 'r15', accion: 'deshacer' })).rejects.toThrow(/motivo/);
    await expect(guardarDecisionIt1(c, { versionEsperada: 4, registroId: 'r15', accion: 'vincular', localId: 'loc25', motivo: 'Confirmado en campo', localDistintoConfirmado: true })).rejects.toThrow(/Confirmación/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('envía una sola decisión acotada sin enviar las colecciones de la base', async () => {
    const { c, rpc } = cliente({ data: { version: 5, accion: 'vincular', registroId: 'r15', localId: 'loc25' } });
    const res = await guardarDecisionIt1(c, { versionEsperada: 4, registroId: 'r15', accion: 'vincular', localId: 'loc25', motivo: 'Misma entrada, comprobado en campo' });
    expect(res.version).toBe(5);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('ulit_censo_conciliar_it1_2026', {
      p_espacio: 'real-medina-del-campo-2026', p_version_esperada: 4,
      p_registro_id: 'r15', p_accion: 'vincular', p_local_id: 'loc25',
      p_motivo: 'Misma entrada, comprobado en campo', p_confirmar_distinto: false,
    });
  });

  it('anota confirmación explícita cuando se crea otro local físico', async () => {
    const { c, rpc } = cliente({ data: { version: 5, accion: 'local-nuevo', registroId: 'r15', localId: 'loc-g5-r15' } });
    await guardarDecisionIt1(c, { versionEsperada: 4, registroId: 'r15', accion: 'local-nuevo', motivo: 'Local independiente observado en campo', localDistintoConfirmado: true });
    expect(rpc).toHaveBeenCalledWith('ulit_censo_conciliar_it1_2026', expect.objectContaining({ p_confirmar_distinto: true, p_motivo: 'Local independiente observado en campo' }));
  });

  it('el deshacer exige motivo firmado y lo envía al servidor', async () => {
    const { c, rpc } = cliente({ data: { version: 5, accion: 'deshacer', registroId: 'r15', localId: null } });
    await guardarDecisionIt1(c, { versionEsperada: 4, registroId: 'r15', accion: 'deshacer', motivo: 'Error detectado en revisión humana' });
    expect(rpc).toHaveBeenCalledWith('ulit_censo_conciliar_it1_2026', expect.objectContaining({ p_accion: 'deshacer', p_motivo: 'Error detectado en revisión humana' }));
  });

  it('el conflicto de versión no desencadena reintentos automáticos', async () => {
    const { c, rpc } = cliente({ error: { code: 'PT409', message: 'conflict' } });
    await expect(guardarDecisionIt1(c, { versionEsperada: 4, registroId: 'r15', accion: 'mantener-pendiente', motivo: 'Pendiente revisar datos' })).rejects.toThrow(/Otra pestaña/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('si no hay confirmación verificable no se afirma que haya guardado', async () => {
    const { c } = cliente({ data: { version: 6, accion: 'local-nuevo', registroId: 'r15', localId: 'nuevo' } });
    await expect(guardarDecisionIt1(c, { versionEsperada: 4, registroId: 'r15', accion: 'local-nuevo', motivo: 'Nuevo local comprobado' })).rejects.toThrow(/sin confirmación/);
  });
});
