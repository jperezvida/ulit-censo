import { describe, expect, it, vi } from 'vitest';
import { conTiempoMaximo } from './conTiempoMaximo';

describe('Protección contra el bloqueo en la carga real', () => {
  it('resuelve normalmente y cancela el temporizador', async () => {
    vi.useFakeTimers();
    try {
      await expect(conTiempoMaximo(() => Promise.resolve('ok'), 1000, 'Tardó demasiado')).resolves.toBe('ok');
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('rechaza una lectura colgada, aborta su señal y deja el acceso recuperable', async () => {
    vi.useFakeTimers();
    try {
      let control: AbortSignal | undefined;
      const lectura = conTiempoMaximo((signal) => {
        control = signal;
        return new Promise<string>(() => {});
      }, 3000, 'Lectura bloqueada');
      const resultado = expect(lectura).rejects.toThrow('Lectura bloqueada');
      await vi.advanceTimersByTimeAsync(3000);
      await resultado;
      expect(control?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('propaga errores originales sin convertirlos en una sesión ficticia', async () => {
    await expect(conTiempoMaximo(() => Promise.reject(new Error('Sin permisos')), 3000, 'Tiempo agotado'))
      .rejects.toThrow('Sin permisos');
  });
});
