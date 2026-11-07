/**
 * Lectura LOCAL de un archivo elegido por la persona (nunca se envía a ningún servidor). Usa
 * `File.arrayBuffer`/`File.text` y, si el entorno no los tiene, `FileReader`.
 */
export function leerBytes(f: File): Promise<Uint8Array> {
  if (typeof f.arrayBuffer === 'function') return f.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => mal(r.error ?? new Error('No se ha podido leer el archivo.'));
    r.readAsArrayBuffer(f);
  });
}

export function leerTexto(f: File): Promise<string> {
  if (typeof f.text === 'function') return f.text();
  return new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(r.error ?? new Error('No se ha podido leer el archivo.'));
    r.readAsText(f, 'utf-8');
  });
}
