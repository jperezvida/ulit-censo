import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Ban, CheckCircle2, ChevronLeft, ChevronRight, ClipboardPaste, Download, ExternalLink,
  LoaderCircle, RefreshCw, ScanSearch, ShieldCheck, Undo2, Upload, XCircle,
} from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { clienteServidor } from '../../store/clienteSupabase';
import { enlacesBusquedaRadar, negociosPilotoRadar, type NegocioPiloto } from '../../domain/radarDigitalIT1';
import {
  CAMPOS_RADAR, TEXTO_BANDEJA, TEXTO_CRITERIO, TEXTO_ESTADO, TEXTO_FUENTE,
  bandejaDe, campoDeEnlace, camposExcelSinEnlace, medirPiloto, confirmarRelacionadas, csvRadar, discrepaExcel, emparejarOSM,
  fusionarTrabajos, guardarResultadosAuto, guardarTrabajos, huellaNegocio,
  investigarNegocio, leerResultadosAuto, causaFallo, completarConOSM, continuarSinOSM, esFalloOSM, leerTrabajos, nivelEvidencia, resultadoVigente,
  sanearResultado, trabajosDesdeTexto, turnosEspaciados, trabajoVacio, unirEvidencias, vistaCampo,
  type BandejaRadar, type CampoRadar, type EvidenciaRadar, type LugarOSM, type MarcaWikidata,
  type PaginaRadar, type ResultadoAuto, type ResultadosAuto, type ServiciosRadar, type TrabajoRadar, type TrabajosRadar,
} from '../../domain/radarInvestigacion';
import '../../styles/radar-digital.css';

type Filtro = 'todos' | BandejaRadar;
const FILTROS: Filtro[] = ['todos', 'intervencion', 'listo', 'sin-evidencias', 'incompleta', 'sin-investigar', 'revisado'];
const ORDEN_BANDEJA: BandejaRadar[] = ['intervencion', 'listo', 'sin-evidencias', 'incompleta', 'sin-investigar', 'revisado'];
const BUSQUEDA: Record<CampoRadar, 'web' | 'google' | 'instagram' | 'facebook' | 'twitter'> = {
  web: 'web', googleBusiness: 'google', instagram: 'instagram', facebook: 'facebook', twitter: 'twitter', ventaOnline: 'web',
};
const TECLA_BUSQUEDA: Record<string, 'web' | 'google' | 'instagram' | 'facebook'> = { w: 'web', g: 'google', i: 'instagram', f: 'facebook' };

/** Solo enlaces HTTPS; el resto se muestra como texto. */
function Enlace({ url, children, titulo }: { url: string; children: ReactNode; titulo?: string }) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) throw Error('inseguro');
    return <a href={u.toString()} target="_blank" rel="noopener noreferrer" title={titulo ?? u.toString()}>
      {children}<ExternalLink size={12} aria-hidden="true"/></a>;
  } catch { return <span className="radar-falta">{children} (enlace descartado por seguridad)</span>; }
}
const corta = (url: string) => {
  try { const u = new URL(url); return (u.hostname.replace(/^www\./, '') + u.pathname + u.search).replace(/\/$/, ''); }
  catch { return url; }
};
const excelTexto = (v: string) => v.trim() === '1' ? 'Sí' : v.trim() === '0' ? 'No' : '—';
function descargar(nombre: string, contenido: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
/**
 * Enfriamiento de OpenStreetMap: tras un error no se insiste (política de uso del proveedor).
 * Se guarda en el navegador para que una recarga no reinicie los reintentos.
 */
const CLAVE_PAUSA_OSM = 'ulit-censo-radar-osm-pausa';
const PAUSA_OSM_MS = 10 * 60_000;
const pausaOSMHasta = () => { try { return Number(localStorage.getItem(CLAVE_PAUSA_OSM)) || 0; } catch { return 0; } };
const pausarOSM = () => { try { localStorage.setItem(CLAVE_PAUSA_OSM, String(Date.now() + PAUSA_OSM_MS)); } catch { /* solo afecta al enfriamiento */ } };
/** Un fallo de nuestro servidor no es un 429 de Nominatim: no debe bloquear reintentos diez minutos. */
const esFalloInternoRadar = (e: unknown): boolean => typeof e === 'object' && e !== null
  && 'status' in e && e.status === 500;
const CLAVE_REPARACION_500 = 'ulit-censo-radar-servidor-500-recuperado-v1';
/** Una única vez, recuperar la pausa antigua provocada por el 500 de la función en Vercel.
 * Se preservan pausas por 429 u otros fallos reales de OSM, así como todas las decisiones.
 */
const recuperarPausaDel500 = (datos: Record<string, ResultadoAuto>) => {
  try {
    if (localStorage.getItem(CLAVE_REPARACION_500)) return;
    const fallos = Object.values(datos).flatMap((r) => r.incompleto ?? []);
    if (!fallos.some((x) => x.startsWith('OpenStreetMap') && x.includes('servidor del Radar (500)'))) return;
    if (fallos.some((x) => x.startsWith('OpenStreetMap') && /429|límite de uso del proveedor/i.test(x))) return;
    localStorage.removeItem(CLAVE_PAUSA_OSM);
    localStorage.setItem(CLAVE_REPARACION_500, '1');
  } catch { /* solo desbloqueo local de un fallo interno conocido */ }
};
const horaCorta = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/** El ratón no deja el foco en botones: Enter sigue sirviendo para confirmar y avanzar. */
const SIN_FOCO = { onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() };
const enCampoDeTexto = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('input,textarea,select,[contenteditable="true"]');

async function llamarRadar<T>(cuerpo: unknown): Promise<T> {
  const sesion = await clienteServidor()?.auth.getSession();
  const jwt = sesion?.data.session?.access_token;
  if (!jwt) throw Error('La sesión no está disponible; vuelve a iniciar sesión.');
  const r = await fetch('/api/radar-web', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt },
    body: JSON.stringify(cuerpo),
  });
  const datos = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw Object.assign(Error(datos.error || 'El servicio del Radar no respondió.'), { status: r.status });
  return datos;
}
const SERVICIOS = (municipio: string, provincia?: string): ServiciosRadar => ({
  lugares: async (nombre) => (await llamarRadar<{ lugares: LugarOSM[] }>({ accion: 'osm', nombre, municipio, provincia })).lugares ?? [],
  marcas: async (ids) => (await llamarRadar<{ marcas: MarcaWikidata[] }>({ accion: 'marcas', ids })).marcas ?? [],
  paginas: async (urls, contexto) => {
    const r = await llamarRadar<{ resultados: { url: string; pagina?: PaginaRadar; error?: string }[] }>({ accion: 'paginas', urls, contexto });
    const lista = r.resultados ?? [];
    return {
      paginas: lista.flatMap((x) => x.pagina ? [x.pagina] : []),
      fallos: lista.flatMap((x) => x.error ? [{ url: x.url, error: x.error }] : []),
    };
  },
});

export default function RadarDigitalIT1() {
  const { db, campana } = useContexto();
  const fuente = useFuenteOficina();
  const negocios = useMemo(() => campana ? negociosPilotoRadar(db, campana.id) : [], [db, campana?.id]);
  const municipio = (campana && db.municipios[campana.municipioId]?.nombre) || 'Medina del Campo';
  const provincia = (campana && db.municipios[campana.municipioId]?.provincia) || undefined;
  const [trabajos, setTrabajos] = useState<TrabajosRadar>(() => campana ? leerTrabajos(campana.id) : {});
  const [resultados, setResultados] = useState<ResultadosAuto>(() => campana ? leerResultadosAuto(campana.id) : {});
  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [errorGuardado, setErrorGuardado] = useState(false);
  const [deshacer, setDeshacer] = useState<{ id: string; previo: TrabajoRadar; texto: string } | null>(null);
  const [pegado, setPegado] = useState('');
  const importar = useRef<HTMLInputElement>(null);
  const zonaFoco = useRef<HTMLElement>(null);
  /** En pantallas estrechas la lista está encima: al elegir un negocio se lleva la vista a su ficha. */
  const elegir = (id: string) => {
    setSeleccionId(id);
    if (window.matchMedia?.('(max-width: 980px)').matches) requestAnimationFrame(() => zonaFoco.current?.scrollIntoView?.({ block: 'start' }));
  };

  useEffect(() => {
    if (!campana) return;
    setTrabajos(leerTrabajos(campana.id));
    setResultados(leerResultadosAuto(campana.id));
  }, [campana?.id]);

  // Solo se usan resultados del MISMO negocio (nombre y dirección); los antiguos se muestran como tales.
  const resultadoDe = useCallback((n: NegocioPiloto): ResultadoAuto | undefined => {
    const r = resultados[n.id];
    return r && r.huella === huellaNegocio(n) ? r : undefined;
  }, [resultados]);
  const filas = useMemo(() => negocios.map((n, i) => {
    const t = trabajos[n.id] ?? trabajoVacio();
    return { n, i, t, r: resultadoDe(n), bandeja: bandejaDe(n, resultadoDe(n), t) };
  }), [negocios, trabajos, resultadoDe]);
  const cuenta = (b: BandejaRadar) => filas.filter((f) => f.bandeja === b).length;
  const visibles = useMemo(() => (filtro === 'todos'
    ? [...filas].sort((a, b) => ORDEN_BANDEJA.indexOf(a.bandeja) - ORDEN_BANDEJA.indexOf(b.bandeja) || a.i - b.i)
    : filas.filter((f) => f.bandeja === filtro)), [filas, filtro]);
  const actual = filas.find((f) => f.n.id === seleccionId) ?? visibles[0] ?? filas[0];
  const porInvestigar = negocios.filter((n) => !resultadoVigente(resultados[n.id], n));

  const actualizar = useCallback((id: string, cambio: (t: TrabajoRadar) => TrabajoRadar) => {
    setTrabajos((prev) => {
      const siguiente = { ...prev, [id]: { ...cambio(prev[id] ?? trabajoVacio()), actualizado: new Date().toISOString() } };
      if (campana) setErrorGuardado(!guardarTrabajos(campana.id, siguiente));
      return siguiente;
    });
  }, [campana]);

  /** `webs`: web conocida por negocio (p. ej. recién pegada) para analizarla aunque el estado aún no la refleje. */
  const investigar = async (lista: NegocioPiloto[], webs: Record<string, string> = {}) => {
    if (!campana || progreso || !lista.length) return;
    recuperarPausaDel500(resultados);
    const servicios = SERVICIOS(municipio, provincia);
    const nuevosAvisos: string[] = [];
    setMensaje('');
    setProgreso({ hechos: 0, total: lista.length });
    // Política de Nominatim: como máximo una consulta por segundo.
    const esperarTurno = turnosEspaciados();
    // Consultas a OSM en serie: si una falla, las siguientes ven la pausa y no se lanzan.
    let colaOSM: Promise<unknown> = Promise.resolve();
    let falloServidorEnLote = false;
    const consultarOSM = (nombre: string) => {
      const p = colaOSM.then(async () => {
        if (falloServidorEnLote) throw Object.assign(Error('servidor'), { servidor: true });
        await esperarTurno();
        if (Date.now() < pausaOSMHasta()) throw Object.assign(Error('pausa'), { pausa: true });
        return servicios.lugares(nombre);
      });
      colaOSM = p.catch(() => undefined);
      return p;
    };
    const marcas = new Map<string, MarcaWikidata>();
    const avisar = (a: string) => { if (!nuevosAvisos.includes(a)) nuevosAvisos.push(a); };
    // Dos negocios a la vez: rápido sin saturar las webs ni la función del servidor.
    const cola = [...lista];
    let hechos = 0;
    const trabajar = async () => {
      for (let n = cola.shift(); n; n = cola.shift()) {
        try {
          // Al pegar una web, analizar SOLO esa web: no repetir OSM/Wikidata ni bloquearse por ellas.
          const soloWeb = !!webs[n.id];
          const fallidas: string[] = [];
          let lugares: LugarOSM[] = [];
          if (!soloWeb) {
            try { lugares = await consultarOSM(n.nombre); }
            catch (e) {
              if ((e as { pausa?: boolean }).pausa) fallidas.push(`OpenStreetMap — en pausa hasta las ${horaCorta(pausaOSMHasta())} tras un error`);
              else if ((e as { servidor?: boolean }).servidor) {
                fallidas.push('OpenStreetMap — fallo interno del servidor del Radar (500), no de OpenStreetMap');
              } else if (esFalloInternoRadar(e)) {
                falloServidorEnLote = true;
                fallidas.push(`OpenStreetMap — ${causaFallo(e)}`);
                avisar('Servidor del Radar: error interno (500). OSM se omite para el resto del lote; no se activa la pausa de Nominatim.');
              } else {
                fallidas.push(`OpenStreetMap — ${causaFallo(e)}`);
                avisar(`OpenStreetMap: ${causaFallo(e)}. No se insiste hasta las ${horaCorta(Date.now() + PAUSA_OSM_MS)}.`);
                pausarOSM();
              }
            }
          }
          const ids = [...new Set(emparejarOSM(n, lugares).flatMap((c) => c.lugar.marcaWd && !marcas.has(c.lugar.marcaWd) ? [c.lugar.marcaWd] : []))];
          if (ids.length) {
            try { for (const m of await servicios.marcas(ids)) marcas.set(m.id, m); }
            catch (e) { fallidas.push(`Wikidata — ${causaFallo(e)}`); avisar(`Wikidata: ${causaFallo(e)}`); }
          }
          const web = webs[n.id] ?? trabajos[n.id]?.decisiones.web?.url ?? trabajos[n.id]?.manuales.web;
          const r = sanearResultado(await investigarNegocio(n, municipio, lugares, marcas, servicios, web, fallidas));
          if (r) setResultados((prev) => {
            const anterior = prev[n!.id];
            // Al aportar una web nueva, acumular sus evidencias sin perder las obtenidas antes;
            // reanalizar la URL incluso si ya constaba en la caché.
            const conservar = soloWeb && anterior?.huella === r.huella;
            const incompleto = conservar
              ? [...new Set([...(anterior.incompleto ?? []).filter((x) =>
                  esFalloOSM(x) || x.startsWith('Wikidata')), ...(r.incompleto ?? [])])]
              : r.incompleto ?? [];
            const resultado = conservar ? {
              ...r,
              evidencias: unirEvidencias([...anterior.evidencias, ...r.evidencias]),
              avisos: [...new Set([...anterior.avisos, ...r.avisos])].slice(0, 8),
              analizadas: [...new Set([...(anterior.analizadas ?? []), ...(r.analizadas ?? [])])].slice(0, 12),
              ...(incompleto.length ? { incompleto } : {}),
            } : r;
            const sig = { ...prev, [n!.id]: resultado };
            guardarResultadosAuto(campana.id, sig);
            return sig;
          });
        } catch (e) {
          nuevosAvisos.push(`${n.nombre}: ${e instanceof Error ? e.message : 'no se pudo investigar'}`);
        }
        setProgreso({ hechos: ++hechos, total: lista.length });
      }
    };
    await Promise.all([trabajar(), trabajar()]);
    setAvisos(nuevosAvisos);
    setProgreso(null);
    setMensaje(`Investigación terminada: ${hechos} negocios. Revisa primero los que requieren intervención.`);
  };

  const guardarResultado = (id: string, r: ResultadoAuto | null) => {
    if (!campana || !r) return;
    setResultados((prev) => { const sig = { ...prev, [id]: r }; guardarResultadosAuto(campana.id, sig); return sig; });
  };
  /** Solo OpenStreetMap: no repite webs ni Wikidata ya obtenidos ni toca las decisiones. */
  const reintentarOSM = async (n: NegocioPiloto, r: ResultadoAuto) => {
    if (progreso) return;
    recuperarPausaDel500(resultados);
    if (Date.now() < pausaOSMHasta()) return setMensaje(`OpenStreetMap en pausa hasta las ${horaCorta(pausaOSMHasta())} para no saturar el servicio. Puedes continuar sin OSM.`);
    const servicios = SERVICIOS(municipio, provincia);
    setProgreso({ hechos: 0, total: 1 });
    try {
      const lugares = await servicios.lugares(n.nombre);
      const marcas = new Map<string, MarcaWikidata>();
      const ids = [...new Set(emparejarOSM(n, lugares).flatMap((c) => c.lugar.marcaWd ? [c.lugar.marcaWd] : []))];
      if (ids.length) { try { for (const m of await servicios.marcas(ids)) marcas.set(m.id, m); } catch { /* se conserva lo previo */ } }
      guardarResultado(n.id, sanearResultado(await completarConOSM(r, n, municipio, lugares, marcas, servicios)));
      setMensaje('OpenStreetMap consultado de nuevo; se conserva todo lo anterior.');
    } catch (e) {
      if (!esFalloInternoRadar(e)) pausarOSM();
      guardarResultado(n.id, sanearResultado({ ...r, fecha: new Date().toISOString(),
        incompleto: [...(r.incompleto ?? []).filter((x) => !esFalloOSM(x)), `OpenStreetMap — ${causaFallo(e)}`] }));
      setMensaje(`OpenStreetMap sigue sin responder (${causaFallo(e)}). Puedes continuar sin OSM y buscar a mano.`);
    } finally { setProgreso(null); }
  };

  const siguientePendiente = useCallback((desdeId: string) => {
    const orden = visibles.map((f) => f.n.id);
    const i = orden.indexOf(desdeId);
    const resto = [...orden.slice(i + 1), ...orden.slice(0, Math.max(0, i))];
    return resto.find((id) => filas.find((f) => f.n.id === id)?.bandeja !== 'revisado') ?? null;
  }, [visibles, filas]);
  const mover = (paso: number) => {
    if (!actual || !visibles.length) return;
    const i = visibles.findIndex((f) => f.n.id === actual.n.id);
    const j = Math.min(visibles.length - 1, Math.max(0, (i < 0 ? 0 : i) + paso));
    setSeleccionId(visibles[j].n.id);
  };

  /**
   * Enter: confirma SOLO lo «probablemente relacionado». Si quedan coincidencias por comprobar,
   * se queda en el negocio (nunca se dan por revisadas sin decidir); si no, lo marca revisado y avanza.
   */
  const confirmarYAvanzar = () => {
    if (!actual) return;
    const { n, t, r } = actual;
    const decisiones = confirmarRelacionadas(r, t, new Date().toISOString());
    const nuevas = Object.keys(decisiones).length - Object.keys(t.decisiones).length;
    const porComprobar = CAMPOS_RADAR.filter((c) => vistaCampo(c.clave, r?.evidencias ?? [], { ...t, decisiones }).estado === 'encontrado').length;
    if (porComprobar) {
      if (nuevas) {
        actualizar(n.id, (x) => ({ ...x, decisiones, estado: 'pendiente' }));
        setDeshacer({ id: n.id, previo: t, texto: `${n.nombre}: ${nuevas} propuestas confirmadas.` });
      }
      setMensaje(`Quedan ${porComprobar} coincidencias por comprobar: pulsa su número para aceptarlas o «No es» para descartarlas.`);
      return;
    }
    actualizar(n.id, (x) => ({ ...x, decisiones, estado: 'revisado' }));
    setDeshacer({ id: n.id, previo: t, texto: `${n.nombre}: ${nuevas} propuestas confirmadas y marcado como revisado.` });
    setMensaje('');
    const sig = siguientePendiente(n.id);
    if (sig) setSeleccionId(sig);
  };
  const deshacerUltimo = () => {
    if (!deshacer) return;
    actualizar(deshacer.id, () => deshacer.previo);
    setSeleccionId(deshacer.id);
    setMensaje('Acción deshecha.');
    setDeshacer(null);
  };
  /** Tecla 1–6: confirma una propuesta o abre la búsqueda; «No tiene» requiere pulsación expresa. */
  const resolverCampo = (campo: CampoRadar) => {
    if (!actual) return;
    const v = vistaCampo(campo, actual.r?.evidencias ?? [], actual.t);
    if (!v.propuesta && !v.decision) {
      window.open(enlacesBusquedaRadar(actual.n)[BUSQUEDA[campo]], '_blank', 'noopener,noreferrer');
      setMensaje(`${CAMPOS_RADAR.find((c) => c.clave === campo)?.etiqueta}: sin propuesta que confirmar. Comprueba los resultados; «No tiene» solo se marca expresamente.`);
      return;
    }
    actualizar(actual.n.id, (t) => {
      const decisiones = { ...t.decisiones };
      if (decisiones[campo]) delete decisiones[campo];
      else decisiones[campo] = v.propuesta
        ? { valor: 'si', url: v.propuesta.url, fecha: new Date().toISOString(), ...(deTi(v.propuesta) ? { manual: true } : {}) }
        : { valor: 'no', fecha: new Date().toISOString() };
      return { ...t, decisiones, estado: 'pendiente' };
    });
  };
  const decidirNo = (campo: CampoRadar) => actual && actual.n && actualizar(actual.n.id, (t) => ({
    ...t, estado: 'pendiente', decisiones: { ...t.decisiones, [campo]: { valor: 'no', fecha: new Date().toISOString() } },
  }));
  const deTi = (e: EvidenciaRadar) => e.procedencias.some((p) => p.fuente === 'manual');
  const aceptar = (e: EvidenciaRadar) => actual && actualizar(actual.n.id, (t) => ({
    ...t, estado: 'pendiente', decisiones: { ...t.decisiones, [e.campo]: { valor: 'si', url: e.url, fecha: new Date().toISOString(), ...(deTi(e) ? { manual: true } : {}) } },
  }));
  const descartar = (e: EvidenciaRadar) => actual && actualizar(actual.n.id, (t) => ({
    ...t, estado: 'pendiente', descartadas: [...t.descartadas, `${e.campo}|${e.url}`],
  }));
  const anular = (campo: CampoRadar) => actual && actualizar(actual.n.id, (t) => {
    const decisiones = { ...t.decisiones };
    delete decisiones[campo];
    return { ...t, decisiones, estado: 'pendiente' };
  });
  /**
   * Un enlace pegado (perfil, ficha o web) se asigna a su campo como CANDIDATO PENDIENTE: hay que
   * comprobar que la cuenta es la del local y confirmarlo con su número o «Sí».
   */
  const usarEnlace = (texto: string): boolean => {
    if (!actual) return false;
    const destino = campoDeEnlace(texto);
    if (!destino) { setMensaje('Ese texto no es un enlace HTTPS de web, Instagram, Facebook, X/Twitter o Google Maps.'); return false; }
    const i = CAMPOS_RADAR.findIndex((c) => c.clave === destino.campo);
    actualizar(actual.n.id, (t) => {
      const decisiones = { ...t.decisiones };
      delete decisiones[destino.campo];
      return { ...t, estado: 'pendiente', decisiones, manuales: { ...t.manuales, [destino.campo]: destino.url },
        descartadas: t.descartadas.filter((k) => k !== `${destino.campo}|${destino.url}`) };
    });
    // Una web pegada se analiza al momento: sus redes y su ficha aparecen sin más pasos.
    if (destino.campo === 'web' && !progreso) void investigar([actual.n], { [actual.n.id]: destino.url });
    setMensaje(`${CAMPOS_RADAR[i].etiqueta}: enlace añadido como candidato sin validar. Comprueba la cuenta y pulsa ${i + 1} o «Sí» para confirmarlo${destino.campo === 'web' ? '; analizando sus enlaces…' : '.'}`);
    return true;
  };

  // Atajos globales (nunca mientras se escribe en un campo).
  useEffect(() => {
    const teclado = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && deshacer && !enCampoDeTexto(ev.target)) { ev.preventDefault(); deshacerUltimo(); }
        return;
      }
      if (enCampoDeTexto(ev.target) || ev.repeat || !actual) return;
      const k = ev.key.toLowerCase();
      if (ev.key === 'Enter') {
        if (ev.isComposing || (ev.target instanceof HTMLElement && ev.target.closest('button,a,summary'))) return;
        ev.preventDefault(); confirmarYAvanzar();
      } else if (/^[1-6]$/.test(ev.key)) { ev.preventDefault(); resolverCampo(CAMPOS_RADAR[Number(ev.key) - 1].clave); }
      else if (ev.key === 'ArrowDown' || k === 'j') { ev.preventDefault(); mover(1); }
      else if (ev.key === 'ArrowUp' || k === 'k') { ev.preventDefault(); mover(-1); }
      else if (k === 'z' && deshacer) { ev.preventDefault(); deshacerUltimo(); }
      else if (TECLA_BUSQUEDA[k]) {
        ev.preventDefault();
        window.open(enlacesBusquedaRadar(actual.n)[TECLA_BUSQUEDA[k]], '_blank', 'noopener,noreferrer');
      }
    };
    const pegar = (ev: ClipboardEvent) => {
      if (enCampoDeTexto(ev.target)) return;
      const texto = ev.clipboardData?.getData('text') ?? '';
      if (texto.trim()) { ev.preventDefault(); usarEnlace(texto); }
    };
    document.addEventListener('keydown', teclado);
    document.addEventListener('paste', pegar);
    return () => { document.removeEventListener('keydown', teclado); document.removeEventListener('paste', pegar); };
  });

  if (!campana || campana.anio !== 2026 || !fuente?.soloLectura)
    return <main className="pagina"><p>El Radar Digital solo está disponible en la Oficina real de 2026.</p></main>;

  const exportarCSV = () => descargar('ulit-radar-digital-it1.csv', csvRadar(negocios, trabajos), 'text/csv;charset=utf-8');
  const exportarCopia = () => descargar('ulit-radar-digital-it1-copia.json', JSON.stringify({
    formato: 'ulit-radar-trabajo-v2', campanaId: campana.id, exportado: new Date().toISOString(), medicion: medida, trabajos,
  }, null, 2), 'application/json;charset=utf-8');
  const importarCopia = async (archivo: File | undefined) => {
    if (!archivo || archivo.size > 1_000_000) return setMensaje('Elige una copia JSON del Radar (máximo 1 MB).');
    try {
      const datos = JSON.parse(await archivo.text()) as { formato?: string; campanaId?: string; trabajos?: unknown };
      if (datos.formato !== 'ulit-radar-trabajo-v2' || datos.campanaId !== campana.id) throw Error('formato');
      const importados = trabajosDesdeTexto(JSON.stringify(datos.trabajos ?? {}));
      setTrabajos((prev) => {
        const sig = fusionarTrabajos(prev, importados);
        setErrorGuardado(!guardarTrabajos(campana.id, sig));
        return sig;
      });
      setMensaje(`Copia importada: ${Object.keys(importados).length} negocios (prevalece lo más reciente).`);
    } catch { setMensaje('La copia no es válida o pertenece a otra campaña.'); }
  };

  const camposExcelPendientes = actual ? camposExcelSinEnlace(actual.n, actual.r, actual.t) : [];
  const primerCampoExcel = CAMPOS_RADAR.find((c) => c.clave === camposExcelPendientes[0]);
  const vistas = actual ? CAMPOS_RADAR.map((c) => vistaCampo(c.clave, actual.r?.evidencias ?? [], actual.t)) : [];
  const relacionadasSinDecidir = vistas.filter((v) => v.estado === 'relacionado').length;
  const porComprobar = vistas.filter((v) => v.estado === 'encontrado').length;
  const busqueda = actual ? enlacesBusquedaRadar(actual.n) : null;
  const revisados = cuenta('revisado');
  // Medida del piloto: cuántos campos llegan con propuesta automática y cuántos ya están decididos.
  const medida = medirPiloto(filas);
  const antiguo = actual?.r && !resultadoVigente(actual.r, actual.n);

  return <main className="pagina radar">
    <header className="radar-cab">
      <Link className="btn s fantasma" to="/oficina"><ArrowLeft size={15}/> Oficina</Link>
      <div className="radar-titulo">
        <h1><ScanSearch size={24} aria-hidden="true"/> Radar Digital <small>IT1 · piloto de {negocios.length} negocios</small></h1>
        <p className="radar-nota"><ShieldCheck size={14} aria-hidden="true"/>Borrador en este navegador. No modifica el censo ni el Excel; «sin coincidencias» nunca significa «No».</p>
      </div>
      <div className="radar-acciones-cab">
        <button type="button" className="btn primario" disabled={!!progreso || !porInvestigar.length}
          onClick={() => void investigar(porInvestigar)}>
          {progreso ? <LoaderCircle size={16} className="radar-giro"/> : <ScanSearch size={16}/>}
          {progreso ? `Investigando ${progreso.hechos}/${progreso.total}…`
            : porInvestigar.length ? `Investigar ${porInvestigar.length} automáticamente` : 'Todo investigado'}
        </button>
        <button type="button" className="btn s" onClick={exportarCSV}><Download size={14}/> CSV</button>
        <button type="button" className="btn s" onClick={exportarCopia} title="Copia para continuar en otro navegador"><Download size={14}/> Guardar copia</button>
        <button type="button" className="btn s" onClick={() => importar.current?.click()}><Upload size={14}/> Importar</button>
        <input ref={importar} type="file" accept="application/json,.json" hidden aria-label="Importar copia del Radar"
          onChange={(e) => { void importarCopia(e.target.files?.[0]); e.target.value = ''; }}/>
      </div>
    </header>

    {progreso && <div className="radar-barra" role="progressbar" aria-label="Investigación automática"
      aria-valuemin={0} aria-valuemax={progreso.total} aria-valuenow={progreso.hechos}>
      <span style={{ width: `${(progreso.hechos / Math.max(1, progreso.total)) * 100}%` }}/></div>}
    <p className="radar-fuentes">
      Fuentes automáticas: OpenStreetMap (Nominatim; datos <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© colaboradores de OpenStreetMap</a>, ODbL), Wikidata (marcas)
      {' '}y las webs encontradas. Sin APIs de pago; resultados guardados 30 días.
      {!progreso && Object.keys(resultados).length > 0 && <button type="button" className="btn-enlace" onClick={() => void investigar(negocios)}>
        <RefreshCw size={12} aria-hidden="true"/> Reinvestigar todo</button>}
    </p>
    {avisos.length > 0 && <details className="radar-avisos"><summary>{avisos.length} avisos de la última investigación</summary>
      <ul>{avisos.map((a) => <li key={a}>{a}</li>)}</ul></details>}

    <div className="radar-bandeja" role="group" aria-label="Bandejas de trabajo">
      {FILTROS.map((f) => {
        const n = f === 'todos' ? filas.length : cuenta(f);
        return <button key={f} type="button" aria-pressed={filtro === f} {...SIN_FOCO}
          className={`radar-filtro f-${f}${filtro === f ? ' activo' : ''}`} onClick={() => setFiltro(f)}>
          <b>{n}</b> {f === 'todos' ? 'Todos' : TEXTO_BANDEJA[f]}</button>;
      })}
      <span className="radar-avance" role="status" aria-label="Progreso del piloto">{revisados} de {negocios.length} revisados ·
        {' '}{medida.conPropuesta} de {medida.campos} campos con propuesta automática ({medida.relacionadas} relacionadas) ·
        {' '}correctas {medida.correctas} · incorrectas {medida.incorrectas} · sin revisar {medida.sinRevisar}
        {medida.negociosIncompletos ? ` · ${medida.negociosIncompletos} incompletos` : ''}</span>
    </div>

    <div className="radar-disposicion">
      <nav className="radar-lista" aria-label="Negocios del piloto">
        {visibles.map((f) => <button type="button" key={f.n.id} data-id={f.n.id} {...SIN_FOCO}
          className={`radar-fila b-${f.bandeja}${actual?.n.id === f.n.id ? ' activo' : ''}`}
          aria-current={actual?.n.id === f.n.id ? 'true' : undefined} onClick={() => elegir(f.n.id)}>
          <span className="radar-fila-nombre">{f.n.nombre}<small>{f.n.direccion}, {f.n.numero}</small></span>
          <span className="radar-puntos" aria-label={TEXTO_BANDEJA[f.bandeja]}>
            {CAMPOS_RADAR.map((c) => {
              const e = vistaCampo(c.clave, f.r?.evidencias ?? [], f.t).estado;
              return <i key={c.clave} className={`p-${e}`} title={`${c.etiqueta}: ${TEXTO_ESTADO[e]}`}/>;
            })}
          </span>
        </button>)}
        {!visibles.length && <p className="radar-vacio">No hay negocios en esta bandeja.</p>}
      </nav>

      {actual ? <section ref={zonaFoco} className="radar-foco" aria-label="Investigación del establecimiento">
        <div className="radar-negocio">
          <div>
            <span className="rotulo">Fila {actual.n.fila} · {TEXTO_BANDEJA[actual.bandeja]}</span>
            <h2>{actual.n.nombre}</h2>
            <p>{actual.n.direccion}, {actual.n.numero} · {municipio}</p>
          </div>
          <div className="radar-nav">
            <button type="button" {...SIN_FOCO} className="btn s icono" aria-label="Negocio anterior" onClick={() => mover(-1)}><ChevronLeft size={16}/></button>
            <button type="button" {...SIN_FOCO} className="btn s icono" aria-label="Negocio siguiente" onClick={() => mover(1)}><ChevronRight size={16}/></button>
          </div>
        </div>
        {!actual.r && <p className="radar-sin-investigar">Aún sin investigar. Pulsa «Investigar» arriba, o busca a mano con los enlaces de cada fila y pega aquí lo que encuentres.</p>}
        {actual.r?.incompleto?.length ? <div className="radar-sin-investigar" role="status" aria-label="Estado de las fuentes">
          <b>Investigación incompleta.</b> No se pudo consultar: {actual.r.incompleto.join(' · ')}. Último intento: {horaCorta(Date.parse(actual.r.fecha))}.
          {' '}Puedes revisar y decidir igualmente; «sin evidencia» no significa «no tiene».
          <span className="radar-acciones-fuente">
            {actual.r.incompleto.some(esFalloOSM) ? <>
              <button type="button" {...SIN_FOCO} className="btn s" disabled={!!progreso || Date.now() < pausaOSMHasta()}
                onClick={() => void reintentarOSM(actual.n, actual.r!)}><RefreshCw size={13} aria-hidden="true"/>
                {Date.now() < pausaOSMHasta() ? `Reintentar OpenStreetMap (desde las ${horaCorta(pausaOSMHasta())})` : 'Reintentar OpenStreetMap'}</button>
              <button type="button" {...SIN_FOCO} className="btn s" onClick={() => guardarResultado(actual.n.id, continuarSinOSM(actual.r!))}>
                Continuar sin OSM y buscar a mano</button>
            </> : <button type="button" {...SIN_FOCO} className="btn s" disabled={!!progreso} onClick={() => void investigar([actual.n])}>
              <RefreshCw size={13} aria-hidden="true"/>Reintentar</button>}
          </span></div>
        : antiguo && <p className="radar-sin-investigar">Resultados del {new Date(actual.r!.fecha).toLocaleDateString('es-ES')}: pueden estar desactualizados.
          {' '}<button type="button" className="btn-enlace" disabled={!!progreso} onClick={() => void investigar([actual.n])}><RefreshCw size={12} aria-hidden="true"/> Reinvestigar</button></p>}

        {actual.r && !actual.r.incompleto?.length && camposExcelPendientes.length > 0 && <div
          className="radar-prioridad-excel" role="note">
          <div>
            <b>{camposExcelPendientes.length} {camposExcelPendientes.length === 1 ? 'dato pendiente' : 'datos pendientes'} del Excel</b>
            <p>El Excel indica «Sí» en {camposExcelPendientes.map((campo) =>
              CAMPOS_RADAR.find((c) => c.clave === campo)?.etiqueta).join(', ')},
              pero el Radar no ha localizado sus enlaces. Son prioritarios para comprobar, no ausencias confirmadas.</p>
          </div>
          {primerCampoExcel && busqueda && <button type="button" className="btn s"
            onClick={() => window.open(busqueda[BUSQUEDA[primerCampoExcel.clave]], '_blank', 'noopener,noreferrer')}>
            <ExternalLink size={14} aria-hidden="true"/>
            Buscar siguiente: {primerCampoExcel.etiqueta}
          </button>}
        </div>}
        <div className="radar-campos" role="table" aria-label="Presencia digital">
          <div className="radar-campo cab" role="row">
            <span role="columnheader">Campo</span><span role="columnheader" title="Dato recogido en el Excel original; no está verificado por el Radar">Excel original</span>
            <span role="columnheader">Propuesta y procedencia</span><span role="columnheader">Decisión</span>
          </div>
          {vistas.map((v, i) => {
            const meta = CAMPOS_RADAR[i];
            const excel = actual.n.datosExcel[v.campo];
            const discrepa = discrepaExcel(v, excel);
            return <div key={v.campo} role="row" className={`radar-campo e-${v.estado}${discrepa ? ' discrepa' : ''}`}>
              <span role="cell" className="radar-campo-nombre"><kbd>{i + 1}</kbd>{meta.etiqueta}</span>
              <span role="cell" className="radar-excel" title="Valor original del Excel (no se modifica)">{excelTexto(excel)}</span>
              <span role="cell" className="radar-propuesta">
                <span className={`radar-estado s-${v.estado}`}>{v.estado === 'confirmado'
                  ? (v.decision!.valor === 'si' ? 'Confirmado por ti: Sí' : 'Confirmado por ti: No tiene') : TEXTO_ESTADO[v.estado]}</span>
                {v.decision?.url && <Enlace url={v.decision.url}>{corta(v.decision.url)}</Enlace>}
                {v.decision?.manual && <span className="radar-chip">Pegado por ti</span>}
                {!v.decision && v.propuesta && <Evidencia e={v.propuesta}/>}
                {!v.decision && v.alternativas.slice(0, 2).map((a) => <span key={a.url} className="radar-alternativa">
                  Otra coincidencia: <Enlace url={a.url}>{corta(a.url)}</Enlace>
                  <button type="button" {...SIN_FOCO} className="btn-enlace" onClick={() => aceptar(a)}>Usar esta</button></span>)}
                {!v.decision && busqueda && <span className="radar-manual">
                  {!v.propuesta && 'Sin coincidencias automáticas. '}
                  <Enlace url={busqueda[BUSQUEDA[v.campo]]} titulo="Búsqueda amplia: nombre y plataforma">{v.campo === 'googleBusiness' ? 'Buscar en Maps' : `Buscar ${v.campo === 'twitter' ? 'X' : meta.etiqueta.split(' ')[0]}`}</Enlace>
                  {v.campo !== 'googleBusiness' && v.campo !== 'ventaOnline' && <>{' · '}
                    <Enlace url={busqueda.especifica[v.campo]} titulo="Solo en la plataforma, con el municipio">específica</Enlace></>}
                  {!v.propuesta && excel.trim() === '1' && <em> · El Excel indica Sí</em>}</span>}
                {discrepa && <span className="radar-discrepa">Discrepa del Excel</span>}
              </span>
              <span role="cell" className="radar-decision">
                {v.decision ? <button type="button" {...SIN_FOCO} className="btn s" onClick={() => anular(v.campo)}><Undo2 size={14}/> Deshacer</button> : <>
                  {v.propuesta && <button type="button" {...SIN_FOCO} className="btn s ok" onClick={() => aceptar(v.propuesta!)}
                    aria-label={`${meta.etiqueta}: confirmar propuesta`}><CheckCircle2 size={14}/> Sí</button>}
                  {v.propuesta && <button type="button" {...SIN_FOCO} className="btn s" onClick={() => descartar(v.propuesta!)}
                    aria-label={`${meta.etiqueta}: la coincidencia no corresponde`}><XCircle size={14}/> No es</button>}
                  <button type="button" {...SIN_FOCO} className="btn s" onClick={() => decidirNo(v.campo)}
                    aria-label={`${meta.etiqueta}: comprobado que no tiene`}><Ban size={14}/> No tiene</button>
                </>}
              </span>
            </div>;
          })}
        </div>

        <label className="radar-pegar">
          <ClipboardPaste size={16} aria-hidden="true"/>
          <span className="visualmente-oculto">Pegar enlace encontrado</span>
          <input type="url" value={pegado} placeholder="Pega aquí (o Ctrl+V en cualquier parte) un enlace de web, Instagram, Facebook, X/Twitter o Google Maps: queda como candidato para confirmar"
            onChange={(e) => setPegado(e.target.value)}
            onPaste={(e) => { const t = e.clipboardData.getData('text'); if (usarEnlace(t)) { e.preventDefault(); setPegado(''); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (usarEnlace(pegado)) setPegado(''); } }}/>
        </label>

        <div className="radar-pie">
          <button type="button" {...SIN_FOCO} className="btn primario" onClick={confirmarYAvanzar}>
            <CheckCircle2 size={16}/>{porComprobar
              ? (relacionadasSinDecidir ? `Confirmar ${relacionadasSinDecidir} relacionadas · quedan ${porComprobar} por comprobar` : `Quedan ${porComprobar} por comprobar`)
              : relacionadasSinDecidir ? `Confirmar ${relacionadasSinDecidir} relacionadas y siguiente` : 'Marcar revisado y siguiente'} <kbd>Enter</kbd>
          </button>
          {actual.t.estado === 'revisado' && <button type="button" className="btn s" onClick={() => actualizar(actual.n.id, (t) => ({ ...t, estado: 'pendiente' }))}>Reabrir</button>}
          {deshacer && <button type="button" className="btn s" onClick={deshacerUltimo}><Undo2 size={14}/> Deshacer <kbd>Z</kbd></button>}
          <span className="radar-atajos"><kbd>1</kbd>–<kbd>6</kbd> confirmar o buscar · <kbd>↑</kbd><kbd>↓</kbd> negocio · <kbd>G</kbd> Maps · <kbd>W</kbd> web · <kbd>I</kbd> Instagram · <kbd>F</kbd> Facebook · <kbd>Ctrl</kbd>+<kbd>V</kbd> pegar</span>
        </div>
        <p className="radar-mensaje" role="status" aria-live="polite">{deshacer?.texto ?? ''} {mensaje}</p>
        {actual.r?.avisos.length ? <p className="radar-falta">Avisos: {actual.r.avisos.join(' · ')}</p> : null}
      </section> : <p>No hay negocios ocupados para este piloto.</p>}
    </div>
    {errorGuardado && <p role="alert" className="radar-error">El navegador impidió guardar el borrador. Exporta una copia antes de cerrar.</p>}
  </main>;
}

function Evidencia({ e }: { e: EvidenciaRadar }) {
  return <span className="radar-evidencia">
    <Enlace url={e.url}>{corta(e.url)}</Enlace>
    {e.detalle && <span className="radar-detalle">{e.detalle}</span>}
    <span className="radar-criterios">
      {/* «Declarado en OpenStreetMap» ya se ve en el enlace de procedencia. */}
      {e.criterios.filter((c) => c !== 'osm').map((c) => <span key={c} className={`radar-chip c-${c}`}>{TEXTO_CRITERIO[c]}</span>)}
      {e.procedencias.map((p) => <span key={p.fuente + p.origen} className="radar-procedencia">
        <Enlace url={p.origen} titulo={`Comprobar en la fuente: ${p.origen}`}>{TEXTO_FUENTE[p.fuente]}</Enlace></span>)}
    </span>
    {nivelEvidencia(e) === 'encontrado' && e.campo !== 'ventaOnline' && !e.criterios.includes('marca') &&
      <span className="radar-por-que">Falta {e.criterios.includes('nombre') ? 'la calle o el municipio' : 'el nombre'} para considerarlo relacionado.</span>}
  </span>;
}
