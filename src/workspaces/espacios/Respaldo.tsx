import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileCheck2, Lock, Upload } from 'lucide-react';
import { useEspacios } from '../../store/espacios';
import { ESPACIO_TXT, type TipoEspacio } from '../../domain/espacios';
import { leerTexto } from './leerArchivo';

/** Descarga un archivo generado en el navegador (respaldo o archivo sintético). */
export function descargar(nombre: string, datos: BlobPart, tipo: string) {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([datos], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Respaldo externo del espacio: descargar, comprobar y restaurar (compartido por la vista completa y la sencilla). */
export function RespaldoTarjeta({ tipo, compacto = false }: { tipo: TipoEspacio; compacto?: boolean }) {
  const esp = useEspacios();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const actual = !!esp.respaldoVerificado && esp.respaldoVerificado.huella === esp.huella;
  return (
    <section className="tarjeta inc-bloque" aria-label="Respaldo">
      <h3><FileCheck2 size={16} /> Respaldo externo</h3>
      <p>{actual ? <span className="chip ok">Respaldo comprobado del estado actual</span> : <span className="chip aviso">Sin respaldo comprobado del estado actual</span>}</p>
      <ol className="inc-lista">
        <li><button className="btn s" onClick={() => { const r = esp.prepararRespaldo(); descargar(r.nombreArchivo, r.texto, 'application/json'); setMsg({ ok: true, texto: `Descargado ${r.nombreArchivo}. Guárdelo fuera del navegador y compruébelo en el paso 2.` }); }}><Download size={14} /> 1. Descargar respaldo</button></li>
        <li>
          <label className="btn s"><Upload size={14} /> 2. Comprobar un respaldo
            <input type="file" accept=".json,application/json" hidden aria-label="Comprobar un respaldo" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const r = await esp.verificarRespaldo(await leerTexto(f), f.name);
              setMsg(!r.ok ? { ok: false, texto: r.error! } : r.coincide ? { ok: true, texto: `Respaldo correcto y completo: coincide con el estado actual (${f.name}).` } : { ok: false, texto: 'Respaldo correcto, pero de un estado anterior: no sirve como respaldo del estado actual.' });
            }} />
          </label>
        </li>
        {!compacto && <li>
          <label className="btn s peligro"><Lock size={14} /> Restaurar desde un respaldo
            <input type="file" accept=".json,application/json" hidden aria-label="Restaurar desde un respaldo" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (!confirm(`Se sustituirá el contenido del ${ESPACIO_TXT[tipo].nombre.toLowerCase()} por el del respaldo «${f.name}». Antes se guarda una copia interna del estado actual. ¿Continuar?`)) return;
              const r = await esp.restaurar(await leerTexto(f));
              setMsg(r.ok ? { ok: true, texto: 'Respaldo restaurado y verificado.' } : { ok: false, texto: r.error! });
            }} />
          </label>
        </li>}
      </ol>
      {msg && <div className={`t-info ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.texto}</div>}
    </section>
  );
}
