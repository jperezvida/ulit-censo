import { DISCREPANCIAS_2026, EXCEPCIONES_ICM, HOJA1_ACTIVIDADES, HOJA1_SUBGRUPOS, ID_CATALOGO_2026, VARIANTES_NOMBRE } from './catalogo2026';
import { NODOS_2026, hijosDe, rutaActividad } from './taxonomy';
import { raiz } from './buscador';
import { normalizar } from './text';

/**
 * Informe verificable del catálogo 2026 (docs/fase2/CATALOGO-2026.md), generado desde los datos
 * del propio catálogo: `npx tsx scripts/informe-catalogo-2026.ts`. Una prueba comprueba que el
 * documento del repositorio coincide con lo generado.
 */
export function informeCatalogo2026(): string {
  const L: string[] = [];
  const clave = (t: string) => normalizar(t).split(' ').map(raiz).join(' ');
  const celda = (t?: string) => (t ?? '').replace(/\|/g, '\\|');
  const n = (nivel: number) => NODOS_2026.filter((x) => x.nivel === nivel).length;

  L.push('# Catálogo de clasificación 2026 (`' + ID_CATALOGO_2026 + '`)', '');
  L.push('> Documento GENERADO a partir de `src/domain/catalogo2026.ts` (`npx tsx scripts/informe-catalogo-2026.ts`). No editar a mano.');
  L.push('> Fuente: documento «Clasificación Censo 2026» de la Cátedra (no incluido en el repositorio). No procede de las clasificaciones del censo 2025.', '');
  L.push('## Resumen', '');
  L.push(`- Grupos de actividad: ${n(1)}`);
  L.push(`- Grupos de comercio (solo Comercio): ${n(2)}`);
  L.push(`- Subgrupos: ${n(3)}`);
  L.push(`- Actividades: ${n(4)}`);
  L.push(`- Ejemplos de Servicios (se guardan como descripción del subgrupo): ${NODOS_2026.reduce((s, x) => s + (x.nivel === 3 && x.id.startsWith('c26.S.') ? x.ejemplos?.length ?? 0 : 0), 0)}`);
  L.push(`- Excepciones ICM: ${EXCEPCIONES_ICM.length}`);
  L.push(`- Discrepancias pendientes de la Cátedra: ${DISCREPANCIAS_2026.length}`, '');
  L.push('Niveles: Comercio = grupo › grupo de comercio › subgrupo › actividad; Hostelería y Restauración = grupo › subgrupo › actividad; Servicios = grupo › subgrupo (+ descripción). Un subgrupo con actividades solo se admite sin actividad si se añade una breve descripción.', '');

  L.push('## Categorías extraídas', '');
  for (const g of hijosDe(undefined, ID_CATALOGO_2026)) {
    L.push(`### ${g.nombre} (${g.codigo})`, '');
    L.push('| Ruta | Id | Descripción / ejemplos del documento |', '|---|---|---|');
    const visitar = (id: string) => {
      for (const h of hijosDe(id)) {
        const extra = h.descripcion ?? (h.ejemplos?.length ? `Ejemplos: ${h.ejemplos.join('; ')}` : '');
        const exc = h.excepcion ? ` **Excepción ICM** — ${h.excepcion}` : '';
        L.push(`| ${celda(rutaActividad(h.id).map((x) => x.nombre).join(' › '))} | \`${h.id}\` | ${celda(extra + exc)} |`);
        visitar(h.id);
      }
    };
    visitar(g.id);
    L.push('');
  }

  L.push('## Excepciones ICM (productos en rojo del documento)', '');
  L.push('| Producto | Destino | Palabras clave | Nota |', '|---|---|---|---|');
  for (const e of EXCEPCIONES_ICM) L.push(`| ${e.producto} | ${e.destino.join(' › ')} | ${e.claves.join(', ')} | ${celda(e.nota)} |`);
  L.push('');

  L.push('## Variantes de nombre aceptadas al importar', '');
  for (const [k, v] of Object.entries(VARIANTES_NOMBRE)) L.push(`- ${k}: ${v.map((x) => `«${x}»`).join(', ')}`);
  L.push('');

  L.push('## Discrepancias pendientes de decisión de la Cátedra', '');
  L.push('| Id | Tema | Documento 2026 | Otra fuente | Decisión provisional |', '|---|---|---|---|---|');
  for (const d of DISCREPANCIAS_2026) L.push(`| ${d.id} | ${celda(d.tema)} | ${celda(d.documento)} | ${celda(d.otraFuente)} | ${celda(d.decisionProvisional)} |`);
  L.push('');

  // Diferencias calculadas entre las listas de Hoja1 (solo nombres) y el documento.
  const subDoc = NODOS_2026.filter((x) => x.nivel === 3).map((x) => x.nombre);
  const actDoc = [...NODOS_2026.filter((x) => x.nivel === 4).map((x) => x.nombre), ...NODOS_2026.flatMap((x) => (x.nivel === 3 ? x.ejemplos ?? [] : []))];
  const falta = (a: string[], b: string[]) => {
    const kb = new Set(b.map(clave));
    return [...new Set(a.filter((x) => !kb.has(clave(x))))].sort((x, y) => x.localeCompare(y, 'es'));
  };
  L.push('## Diferencias calculadas con `Hoja1`', '');
  L.push('Comparación sin mayúsculas, tildes ni plurales. Prevalece el documento; los casos relevantes figuran arriba como discrepancias.', '');
  L.push(`- Subgrupos de Hoja1 que no están en el documento: ${falta(HOJA1_SUBGRUPOS, subDoc).join(', ') || '—'}`);
  L.push(`- Subgrupos del documento que no están en Hoja1: ${falta(subDoc, HOJA1_SUBGRUPOS).join(', ') || '—'}`);
  L.push(`- Actividades de Hoja1 sin equivalente literal en el documento (actividades o ejemplos): ${falta(HOJA1_ACTIVIDADES, actDoc).join(', ') || '—'}`);
  L.push(`- Actividades del documento que no están en Hoja1: ${falta(NODOS_2026.filter((x) => x.nivel === 4).map((x) => x.nombre), HOJA1_ACTIVIDADES).join(', ') || '—'}`);
  L.push('');
  return L.join('\n');
}
