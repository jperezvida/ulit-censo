/**
 * Evita que el acceso a datos auténticos deje la aplicación en un indicador
 * de carga eterno por una petición o bloqueo de sesión que no finaliza.
 * Un error NUNCA habilita datos demo ni escrituras.
 */
export async function conTiempoMaximo<T>(
  operacion: (signal: AbortSignal) => PromiseLike<T>,
  milisegundos: number,
  mensaje: string,
): Promise<T> {
  const control = new AbortController();
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const vencimiento = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      control.abort();
      rechazar(new Error(mensaje));
    }, milisegundos);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operacion(control.signal)), vencimiento]);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }
}
