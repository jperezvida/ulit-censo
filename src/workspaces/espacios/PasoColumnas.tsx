import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Save, XCircle } from 'lucide-react';
import { leerLibro, type LibroLeido } from '../../domain/xlsx/lector';
import { analizarLibroLeido, type InformeEstructural } from '../../domain/xlsx/analisis';
import { muestraFilas } from '../../domain/xlsx/interpretacion';
import { CAMPOS, CAMPO_POR_CLAVE, GRUPOS_CAMPO } from '../../domain/xlsx/camposImportacion';
import { asignarColumna, ESTADO_COLUMNA_TXT, evaluarCorrespondencia, perfilDesdeCorrespondencia, type ColumnaCorrespondencia } from '../../domain/xlsx/correspondencia';
import { PERFILES_REFERENCIA, referenciaAplicable } from '../../domain/xlsx/referencias';
import type { PerfilImportacion } from '../../domain/xlsx/perfilesImportacion';
import { guardarPerfil, listarPerfiles } from '../../store/perfiles';
import { useAsistenteEspacio, type LecturaArchivo } from './estadoAsistenteEspacio';

const AUTO = 'auto';
const errorTexto = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * G1 · Paso «Columnas»: cómo se lee el Excel. Se elige (o se deja reconocer) el perfil, la hoja y la
 * fila de títulos; se ve qué columna corresponde a cada campo de ULIT, se relacionan a mano las que
 * falten y se previsualizan las primeras filas. El perfil puede guardarse para reutilizarlo.
 * Las columnas sin campo se conservan tal cual. Nada se inventa para los campos sin columna.
 */
export function PasoColumnas({ onContinuar }: { onContinuar: (l: LecturaArchivo) => void }) {
  const archivo = useAsistenteEspacio((s) => s.archivo)!;
  const [leido, setLeido] = useState<LibroLeido | null>(null);
  const [guardados, setGuardados] = useState<PerfilImportacion[]>([]);
  const [perfilId, setPerfilId] = useState(AUTO);
  const [hoja, setHoja] = useState<string | null>(null);
  const [fila, setFila] = useState<number | null>(null);
  const [informe, setInforme] = useState<InformeEstructural | null>(null);
  const [corr, setCorr] = useState<ColumnaCorrespondencia[]>([]);
  const [tocada, setTocada] = useState(false);
  const [nombre, setNombre] = useState('');
  const [comparar, setComparar] = useState<boolean | undefined>(undefined);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    leerLibro(archivo.bytes).then((l) => vivo && setLeido(l), (e) => vivo && setAviso({ ok: false, texto: errorTexto(e) }));
    listarPerfiles().then((p) => vivo && setGuardados(p), () => undefined);
    return () => { vivo = false; };
  }, [archivo]);

  const perfiles = useMemo(() => [...PERFILES_REFERENCIA, ...guardados], [guardados]);
  const perfil = perfiles.find((p) => p.id === perfilId);

  useEffect(() => {
    if (!leido) return;
    let vivo = true;
    analizarLibroLeido(leido, archivo.bytes, archivo.nombre, { ...(perfil ? { perfiles: [perfil] } : {}), ...(hoja ? { hoja, ...(fila ? { filaCabecera: fila } : {}) } : {}) })
      .then((inf) => {
        if (!vivo) return;
        setInforme(inf);
        setCorr(inf.correspondencia);
        setTocada(false);
      }, (e) => vivo && setAviso({ ok: false, texto: errorTexto(e) }));
    return () => { vivo = false; };
  }, [leido, archivo, perfil, hoja, fila]);

  const ev = useMemo(() => evaluarCorrespondencia(corr), [corr]);
  const hojaActual = hoja ?? informe?.hojaDatos ?? null;
  const filaActual = fila ?? informe?.filas.filaCabecera ?? null;
  const muestra = useMemo(() => (leido && hojaActual && filaActual ? muestraFilas(leido.libro, hojaActual, filaActual, corr.map((c) => c.indice), 5) : []), [leido, hojaActual, filaActual, corr]);
  const asignadas = corr.filter((c) => c.clave);
  const usaPerfilTalCual = !!perfil && !tocada && ev.lista;
  const referencia = usaPerfilTalCual ? referenciaAplicable(perfil, archivo.sha256, comparar) : undefined;
  const conReferencia = usaPerfilTalCual && !!perfil?.referencia?.indicadores;

  const elegir = (indice: number, clave: string) => {
    try {
      setCorr(asignarColumna(corr, indice, clave || null));
      setTocada(true);
      setAviso(null);
    } catch (e) {
      setAviso({ ok: false, texto: errorTexto(e) });
    }
  };
  const perfilFinal = (): PerfilImportacion | null => {
    if (!ev.lista || !hojaActual || !filaActual) return null;
    if (usaPerfilTalCual) return perfil!;
    const base = perfil?.origen === 'usuario' ? perfil : undefined;
    return perfilDesdeCorrespondencia(corr, { nombre: nombre.trim() || base?.nombre || `Columnas de ${archivo.nombre}`, ...(base ? { id: base.id, version: base.version } : {}), hoja: hojaActual, filaCabecera: filaActual });
  };
  const guardar = async () => {
    const p = perfilFinal();
    if (!p || !nombre.trim()) return;
    try {
      const g = await guardarPerfil(perfilDesdeCorrespondencia(corr, { nombre: nombre.trim(), hoja: hojaActual!, filaCabecera: filaActual! }));
      setGuardados(await listarPerfiles());
      setPerfilId(g.id);
      setAviso({ ok: true, texto: `Perfil «${g.nombre}» guardado (versión ${g.version}). Solo contiene los títulos de las columnas, ningún dato.` });
    } catch (e) {
      setAviso({ ok: false, texto: errorTexto(e) });
    }
  };
  const continuar = () => {
    const p = perfilFinal();
    if (p) onContinuar({ perfil: p, hoja: hojaActual!, filaCabecera: filaActual!, ...(referencia ? { referencia } : {}) });
  };

  if (!leido || !informe) return <div className="t-info inc-progreso" role="status"><span className="inc-spinner" /> Leyendo el Excel en este navegador…</div>;
  const hojasDatos = informe.hojas;

  return (
    <div className="col" style={{ gap: 12 }}>
      <section className="tarjeta inc-bloque" aria-label="Columnas del archivo">
        <h3>¿Cómo se lee este Excel?</h3>
        <p className="muted" style={{ margin: 0 }}>Compruebe que cada columna corresponde al dato correcto. Si alguna no está reconocida, elija su dato en la lista. Las columnas que no son datos de ULIT se conservan tal cual.</p>
        <div className="col-ctrl">
          <label className="campo">
            <span>Perfil</span>
            <select className="input" aria-label="Perfil de importación" value={perfilId} onChange={(e) => { setPerfilId(e.target.value); setHoja(null); setFila(null); setComparar(undefined); }}>
              <option value={AUTO}>Reconocer automáticamente</option>
              <optgroup label="Incluidos en ULIT">{PERFILES_REFERENCIA.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</optgroup>
              {guardados.length > 0 && <optgroup label="Guardados">{guardados.map((p) => <option key={p.id} value={p.id}>{p.nombre} (v{p.version})</option>)}</optgroup>}
            </select>
          </label>
          <label className="campo">
            <span>Hoja con los datos</span>
            <select className="input" aria-label="Hoja con los datos" value={hojaActual ?? ''} onChange={(e) => { setHoja(e.target.value || null); setFila(null); }}>
              {!hojaActual && <option value="">— Elija la hoja —</option>}
              {hojasDatos.map((h) => <option key={h.nombre} value={h.nombre}>{h.nombre}{h.rol === 'resumen' ? ' (resumen)' : h.rol === 'listas' ? ' (listas)' : ''}</option>)}
            </select>
          </label>
          <label className="campo">
            <span>Fila de títulos</span>
            <input className="input" type="number" min={1} max={50} aria-label="Fila de títulos" value={filaActual ?? ''} disabled={!hojaActual}
              onChange={(e) => { const n = Number(e.target.value); if (n >= 1) { setHoja(hojaActual); setFila(n); } }} />
          </label>
        </div>

        <div className="col-resumen" aria-label="Resumen de columnas">
          <span className={`chip ${ev.faltaLocalizacion ? 'error' : 'ok'}`}>{ev.faltaLocalizacion ? <XCircle size={13} /> : <CheckCircle2 size={13} />} Calle o dirección completa</span>
          <span className={`chip ${asignadas.some((a) => a.clave === 'numero') ? 'ok' : ''}`}>{asignadas.some((a) => a.clave === 'numero') ? <CheckCircle2 size={13} /> : null} Número (opcional)</span>
          <span className="muted">{asignadas.length} reconocidas · {ev.adicionales - ev.dudosas.length} adicionales{ev.dudosas.length ? ` · ${ev.dudosas.length} por decidir` : ''}</span>
        </div>
        {ev.faltaLocalizacion && <div className="t-info error" role="alert"><XCircle size={15} /> Falta indicar qué columna es la calle o la dirección completa.</div>}
        {ev.sinNumero && <p className="muted" style={{ margin: 0 }}>Sin columna de número: los registros se importan igualmente y su vínculo con el portal queda pendiente. No se inventan números.</p>}
        {ev.obligatoriosFaltan.length > 0 && <div className="t-info error" role="alert"><XCircle size={15} /> Falta indicar qué columna es: {ev.obligatoriosFaltan.map((c) => c.etiqueta).join(', ')}.</div>}
        {ev.dudosas.length > 0 && <div className="t-info aviso" role="alert"><AlertTriangle size={15} /> {ev.dudosas.length} columna(s) podrían ser el mismo dato que otra: elija cuál es cuál (o «no es un dato de ULIT»).</div>}
        {ev.recomendadosFaltan.length > 0 && <p className="muted" style={{ margin: 0 }}>Sin columna para: {ev.recomendadosFaltan.map((c) => c.etiqueta).join(', ')}. Esos datos quedarán vacíos; no se inventan.</p>}

        <div className="tabla-scroll">
          <table className="tabla ap-tabla col-tabla" aria-label="Correspondencia de columnas">
            <thead><tr><th>Columna del Excel</th><th>Ejemplo</th><th>Dato de ULIT</th><th>Estado</th></tr></thead>
            <tbody>
              {corr.map((c) => (
                <tr key={c.indice} className={c.estado === 'ambigua' ? 'aviso' : ''}>
                  <td><span className="mono muted">{c.letra}</span> {c.cabecera}</td>
                  <td className="col-ejemplo">{muestra.find((m) => m[c.indice])?.[c.indice] ?? <span className="muted">—</span>}</td>
                  <td>
                    <select className="input" aria-label={`Dato de ULIT para «${c.cabecera}»`} value={c.clave ?? ''} onChange={(e) => elegir(c.indice, e.target.value)}>
                      <option value="">— No es un dato de ULIT (se conserva) —</option>
                      {GRUPOS_CAMPO.map((g) => (
                        <optgroup key={g} label={g}>
                          {CAMPOS.filter((f) => f.grupo === g).map((f) => {
                            const otra = corr.find((x) => x.clave === f.clave && x.indice !== c.indice);
                            return <option key={f.clave} value={f.clave} disabled={!!otra}>{f.etiqueta}{f.obligatorio || f.localizacion ? ' *' : ''}{otra ? ` (ya en ${otra.letra})` : ''}</option>;
                          })}
                        </optgroup>
                      ))}
                    </select>
                    {c.estado === 'ambigua' && c.candidatos?.length ? <div className="muted col-nota">¿{c.candidatos.map((k) => CAMPO_POR_CLAVE[k].etiqueta).join(' o ')}?</div> : null}
                  </td>
                  <td><span className={`chip col-est-${c.estado}`}>{ESTADO_COLUMNA_TXT[c.estado]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ margin: 0 }}>* Basta con una de las dos: la calle o la dirección completa.</p>
      </section>

      <section className="tarjeta inc-bloque" aria-label="Vista previa de los datos">
        <h3>Así se leerán las primeras filas</h3>
        {asignadas.length === 0 ? <p className="muted">Todavía no hay ninguna columna relacionada.</p> : (
          <div className="tabla-scroll">
            <table className="tabla ap-tabla" aria-label="Primeras filas">
              <thead><tr>{asignadas.map((c) => <th key={c.indice}>{CAMPO_POR_CLAVE[c.clave!].etiqueta}</th>)}</tr></thead>
              <tbody>{muestra.map((m, i) => <tr key={i}>{asignadas.map((c) => <td key={c.indice}>{m[c.indice] || <span className="muted">—</span>}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ margin: 0 }}>Valores tal como están en el Excel. Las comprobaciones (fechas, 0/1, números) se hacen en el paso siguiente.</p>
      </section>

      <section className="tarjeta inc-bloque" aria-label="Guardar el perfil">
        <h3>Guardar para la próxima vez <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></h3>
        <div className="fila col-guardar">
          <input className="input" placeholder="Nombre del perfil (p. ej. «Censo de mi municipio»)" aria-label="Nombre del perfil" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <button className="btn" disabled={!ev.lista || !nombre.trim()} onClick={guardar}><Save size={15} /> Guardar perfil</button>
        </div>
        <p className="muted" style={{ margin: 0 }}>Solo se guardan los títulos de las columnas y su dato de ULIT, en este navegador. Ningún dato del censo.</p>
        {conReferencia && (
          <label className="fila" style={{ gap: 8 }}>
            <input type="checkbox" aria-label="Comparar con el informe de referencia" checked={!!referencia} onChange={(e) => setComparar(e.target.checked)} />
            <span>Comparar con el informe de referencia de este censo ({perfil!.referencia!.descripcion}).{perfil!.referencia!.sha256 === archivo.sha256 ? ' El archivo es ese censo (misma huella).' : ' El archivo no tiene la huella de ese censo.'}</span>
          </label>
        )}
        {aviso && <div className={`t-info ${aviso.ok ? 'ok' : 'error'}`} role={aviso.ok ? 'status' : 'alert'}>{aviso.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {aviso.texto}</div>}
      </section>

      <div className="inc-nav fila">
        <span className="muted esp">{ev.lista ? 'Todo listo para analizar los datos.' : 'Indique la calle (o la dirección completa) y resuelva las columnas dudosas para continuar.'}</span>
        <button className="btn primario" disabled={!ev.lista} onClick={continuar}>Analizar con estas columnas <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}
