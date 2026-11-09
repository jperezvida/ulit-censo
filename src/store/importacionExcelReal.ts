import type { SupabaseClient } from '@supabase/supabase-js';
import type { BaseDatos } from '../domain/db';
import { AlmacenSupabase, ConflictoRemoto, diferencia, jsonCanonico, reconstruir, type Cambio } from './almacenSupabase';

export const ESPACIO_EXCEL_REAL = 'real-medina-del-campo-2026';
export const MAX_CAMBIOS_EXCEL_REAL = { entidades: 1500, bytes: 1800000 } as const;
const CAMPAÑA_2026 = 'real-camp-medina-2026-censo-medina-del-campo-2026';

export interface CapacidadExcelReal {
  habilitada: boolean;
  version: number;
  rol: string;
  maxBytesCambios: number;
  maxEntidades: number;
}

export interface GuardadoExcelReal {
  version: number;
  filas: number;
  itinerario: string;
  importacionId: string;
  copia: string;
}

/** No interpreta un error de red, permisos o RPC ausente como autorización. */
export async function consultarCapacidadExcel(cliente: SupabaseClient): Promise<CapacidadExcelReal | null> {
  const { data, error } = await cliente.rpc('ulit_censo_estado_excel_2026', { p_espacio: ESPACIO_EXCEL_REAL });
  if (error || !data || typeof data !== 'object') return null;
  const x = data as Partial<CapacidadExcelReal>;
  if (x.habilitada !== true || !Number.isSafeInteger(x.version) ||
      !['coordinador', 'administrador'].includes(x.rol ?? '')) return null;
  return x as CapacidadExcelReal;
}

/**
 * La operación solo puede CREAR entidades del nuevo Excel.
 * No se reutiliza guardar(), no se modifican filas anteriores ni se permiten
 * cambios invisibles a otras campañas o personas.
 */
export function prepararCambiosExcel(
  antes: BaseDatos, despues: BaseDatos, codigo: string, sha: string, parteAdicional: boolean,
): Cambio[] {
  if (!/^IT[1-9]\d{0,2}$/.test(codigo) || !/^[a-f0-9]{64}$/.test(sha))
    throw new Error('Itinerario o huella SHA-256 no válidos.');
  if (jsonCanonico(antes) === jsonCanonico(despues))
    throw new Error('El Excel no genera ninguna incorporación.');
  const cambios = diferencia(antes, despues);
  const permitido = new Set(['itinerarios','importaciones','registros','vinculos',
    'locales','negocios','observaciones','ocupaciones','digital','franquicias','clasificaciones']);
  const raizAntes = { version: antes.version, generado: antes.generado,
    secuencia: antes.secuencia, colaSync: antes.colaSync, meta: antes.meta };
  const raizDespues = { version: despues.version, generado: despues.generado,
    secuencia: despues.secuencia, colaSync: despues.colaSync, meta: despues.meta };
  if (raizDespues.secuencia <= raizAntes.secuencia ||
      jsonCanonico({...raizAntes,secuencia:raizDespues.secuencia}) !== jsonCanonico(raizDespues))
    throw new Error('El plan intenta cambiar la configuración real, no solo la secuencia.');
  if (cambios.some((x) => x.c === '_raiz'
    ? x.id !== 'raiz' || !x.v
    : !permitido.has(x.c) || !x.v ||
      Object.hasOwn((antes as unknown as Record<string, Record<string, unknown>>)[x.c] ?? {},x.id))) {
    throw new Error('El plan modifica datos anteriores o colecciones ajenas al nuevo Excel.');
  }
  const nuevas = cambios.filter((x) => x.c === 'importaciones');
  const imp = nuevas[0]?.v as { huella?: string; campanaId?: string; filas?: number;
    c1?: { sha256?: string; itinerario?: { id?: string; codigo?: string } } } | undefined;
  const its = cambios.filter((x) => x.c === 'itinerarios');
  const it = imp?.c1?.itinerario?.id;
  if (nuevas.length !== 1 || its.length > 1 || imp?.huella !== sha ||
      imp.c1?.sha256 !== sha || imp.campanaId !== CAMPAÑA_2026 ||
      imp.c1?.itinerario?.codigo !== codigo || !it ||
      (its.length === 1 && (its[0].v as {id?: string}).id !== it) ||
      (its.length===0 && antes.itinerarios[it]?.codigo !== codigo) ||
      (its.length===0 && !parteAdicional && Object.values(antes.importaciones).some(
        (i)=>i.c1?.itinerario?.id===it && i.campanaId===CAMPAÑA_2026 && i.estado==='confirmada')) ||
      cambios.filter((x)=>x.c==='registros').length !== imp.filas) {
    throw new Error('El plan no corresponde a un único Excel y al itinerario indicado.');
  }
  if (Object.values(antes.importaciones).some((i) => i.campanaId===CAMPAÑA_2026 && i.huella===sha))
    throw new Error('Ese Excel ya se encuentra incorporado.');
  if (cambios.length>MAX_CAMBIOS_EXCEL_REAL.entidades ||
      new TextEncoder().encode(JSON.stringify(cambios)).length>MAX_CAMBIOS_EXCEL_REAL.bytes)
    throw new Error('El Excel es demasiado grande para una operación atómica; no se ha enviado.');
  return cambios;
}

export async function descargarCopiaPreviaExcel(
  cliente: SupabaseClient, antes: BaseDatos, versionEsperada: number, codigo: string,
): Promise<{nombre:string;contenido:string;id:string}> {
  const almacen = new AlmacenSupabase(cliente,ESPACIO_EXCEL_REAL);
  const {db,info} = await almacen.leer();
  if (!db || info.version !== versionEsperada || info.escrituraHabilitada ||
      jsonCanonico(db)!==jsonCanonico(antes)) throw new ConflictoRemoto();
  const id = await almacen.crearCopia(`Previa a importar Excel ${codigo}: respaldo externo verificado`);
  const copia = await almacen.descargarCopia(id);
  const baseCopia = (copia.contenido as {version?:number;entidades?:Record<string,Record<string,unknown>>}|null);
  const reconstruida = baseCopia?.entidades ? reconstruir(baseCopia.entidades) : null;
  if (!baseCopia || baseCopia.version!==versionEsperada || !reconstruida ||
      jsonCanonico(reconstruida)!==jsonCanonico(antes) ||
      typeof copia.sha256!=='string' || !/^[a-f0-9]{64}$/.test(copia.sha256))
    throw new Error('La copia no coincide con el estado anterior. No debe importarse.');
  return { id, nombre:`ULIT-Censo-ANTES-${codigo}-v${versionEsperada}.json`,
    contenido:JSON.stringify(copia,null,2) };
}

export async function guardarExcelReal(
 cliente:SupabaseClient, antes:BaseDatos, despues:BaseDatos, versionEsperada:number,
 codigo:string, sha:string, parteAdicional:boolean,
):Promise<GuardadoExcelReal>{
  const cambios=prepararCambiosExcel(antes,despues,codigo,sha,parteAdicional);
  const almacen=new AlmacenSupabase(cliente,ESPACIO_EXCEL_REAL);
  const {db,info}=await almacen.leer();
  if (!db || info.tipo!=='real' || info.version!==versionEsperada ||
      info.escrituraHabilitada || info.preparacionHabilitada ||
      jsonCanonico(db)!==jsonCanonico(antes))
    throw new ConflictoRemoto();
  const {data,error}=await cliente.rpc('ulit_censo_importar_excel_2026',{
    p_espacio:ESPACIO_EXCEL_REAL, p_version_esperada:versionEsperada,
    p_codigo:codigo, p_sha:sha, p_parte_adicional:parteAdicional, p_cambios:cambios,
  });
  if(error){
    if(error.code==='PT409')throw new ConflictoRemoto();
    throw new Error(error.message.replace(/^ULIT Censo:\s*/,''));
  }
  const r=data as GuardadoExcelReal;
  if (!r || r.version!==versionEsperada+1 || r.itinerario!==codigo ||
      !r.copia || r.filas!==cambios.filter((x)=>x.c==='registros').length)
    throw new Error('El servidor respondió con una confirmación inesperada. No repita la importación.');
  const {db:actual,info:verificado}=await almacen.leer();
  if (!actual || verificado.version!==r.version || verificado.escrituraHabilitada ||
      jsonCanonico(actual)!==jsonCanonico(despues))
    throw new Error('El servidor guardó la operación, pero la verificación posterior no coincide. NO repita la importación; revise Supabase.');
  return r;
}
