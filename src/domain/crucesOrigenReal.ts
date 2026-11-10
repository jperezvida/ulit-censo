import type { BaseDatos } from './db';
import type { Id } from './types';
import { claveCalle, normalizar } from './text';
import { localizacionDe, type FilaInterpretada, type Portal } from './xlsx/interpretacion';

export interface CruceOrigenReal {
  fila: number;
  tipo: 'posible-duplicado' | 'contradiccion' | 'portal-compartido';
  itinerario: string;
  detalle: string;
}

/** Compara fuentes de itinerarios sin exigir localización en callejero.
 * Solo detección documental: NO asocia calle/local, ni modifica registros anteriores.
 * Las filas que ya tienen observación corresponden al detector de cruces habitual.
 */
export function crucesDeOrigenSinCalle(
  db: BaseDatos, campanaId: Id, itinerarioId: Id | undefined,
  filas: { fi: FilaInterpretada; calleId?: Id; portal?: Portal }[],
): CruceOrigenReal[] {
  const lectura = (datos: Record<string, string>, nombre: string): string => {
    const clave = Object.keys(datos).find((k) => normalizar(k) === nombre);
    return clave ? String(datos[clave] ?? '').trim() : '';
  };
  const observados = new Set(Object.values(db.observaciones)
    .filter((o) => o.campanaId === campanaId && o.registroId).map((o) => o.registroId));
  const porPortal = new Map<string, { nombre: string; vacio: boolean; it: string }[]>();
  for (const r of Object.values(db.registros)) {
    if (!r.itinerarioId || r.itinerarioId === itinerarioId || observados.has(r.id)) continue;
    const it = db.itinerarios[r.itinerarioId];
    if (!it || it.campanaId !== campanaId) continue;
    const calle = lectura(r.datos, 'direccion');
    const numeroTexto = lectura(r.datos, 'num');
    const match = /^(\d{1,5})(?:\s*([a-z]))?$/i.exec(numeroTexto);
    const vacioTexto = lectura(r.datos, 'local vacio');
    if (!calle || !match || !['0', '1'].includes(vacioTexto)) continue;
    const key = [claveCalle(calle), Number(match[1]), (match[2] ?? '').toUpperCase()].join('|');
    const xs = porPortal.get(key) ?? [];
    xs.push({ nombre: lectura(r.datos, 'nombre del negocio'), vacio: vacioTexto === '1', it: it.codigo });
    porPortal.set(key, xs);
  }
  const cruces: CruceOrigenReal[] = [];
  for (const { fi, calleId, portal } of filas) {
    if (calleId || portal?.tipo !== 'numero' || fi.local === 'desconocido') continue;
    const calle = localizacionDe(fi).calle;
    if (!calle) continue;
    const key = [claveCalle(calle), portal.numero, (portal.sufijo ?? '').toUpperCase()].join('|');
    const coincidencias = porPortal.get(key) ?? [];
    if (!coincidencias.length) continue;
    const nombre = fi.celdas.nombre?.valor != null && ['valido', 'transformado'].includes(fi.celdas.nombre.estado)
      ? String(fi.celdas.nombre.valor).trim() : '';
    const igual = nombre ? coincidencias.find((o) => !!o.nombre && normalizar(o.nombre) === normalizar(nombre)) : undefined;
    const contrario = coincidencias.find((o) => o.vacio !== (fi.local === 'vacio'));
    const elegido = igual ?? contrario ?? coincidencias[0];
    const tipo: CruceOrigenReal['tipo'] = igual ? 'posible-duplicado' : contrario ? 'contradiccion' : 'portal-compartido';
    const detalle = tipo === 'posible-duplicado'
      ? 'Coincidencia documental: «' + nombre + '», ' + calle + ', ' + portal.numero + ', también en ' + elegido.it
      : tipo === 'contradiccion'
        ? 'Posible contradicción de estado en ' + calle + ', ' + portal.numero + ' frente a ' + elegido.it + '; podría haber varios locales'
        : 'Portal compartido en ' + calle + ', ' + portal.numero + ' con ' + elegido.it + '; no acredita que sea el mismo local';
    cruces.push({ fila: fi.fila, tipo, itinerario: elegido.it, detalle });
  }
  return cruces;
}
