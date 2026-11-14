import type { BaseDatos } from './db';
import type { LngLat } from './types';
import type { FilaRevisionGeneral } from './revisionGeneral';

/** Enlace directo a la panorámica, NO a una búsqueda ni a la vista de mapa. */
export interface EnlaceStreetView {
  url: string;
  precision: 'verificada' | 'aproximada';
  origen: 'local-verificado' | 'local-sin-verificar' | 'calle';
  aviso: string;
}

function coordenadaValida(coord?: LngLat): coord is LngLat {
  return !!coord && coord.length === 2
    && Number.isFinite(coord[0]) && Number.isFinite(coord[1])
    && coord[0] >= -180 && coord[0] <= 180
    && coord[1] >= -90 && coord[1] <= 90;
}

function enlacePano(coord: LngLat): string {
  // El perfil URL documentado por Google abre directamente un visor panorámico.
  // Street View elige el panorama disponible más cercano, no necesariamente la puerta exacta.
  const [lng, lat] = coord;
  const params = new URLSearchParams({
    api: '1',
    map_action: 'pano',
    viewpoint: `${lat},${lng}`,
  });
  return `https://www.google.com/maps/@?${params.toString()}`;
}

function normalizarCalle(calle: string): string {
  return calle.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,/]/g, ' ')
    .replace(/\b(calle|cl|c|plaza|pl|avenida|avda|av|paseo|ronda|travesia|carretera)\b/g, ' ')
    .replace(/\b(de|del|la|las|los|el)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Denominación alternativa de calle documentada en Medina; no es una interpolación de portal. */
function aliasDocumentado(nombre: string, municipio: string): string {
  if (normalizarCalle(municipio) === 'medina campo' && nombre === 'dona leonor') {
    return 'leonor aragon';
  }
  return nombre;
}

function posicionMediaTramo(coords: LngLat[]): LngLat | undefined {
  if (!coords.length || !coords.every(coordenadaValida)) return undefined;
  if (coords.length === 1) return coords[0];
  // Centro geométrico de la polilínea, sin extrapolar números de portal.
  const longitudes = coords.slice(1).map((c, i) =>
    Math.hypot((c[0] - coords[i][0]) * Math.cos(c[1] * Math.PI / 180), c[1] - coords[i][1]));
  const mitad = longitudes.reduce((a, b) => a + b, 0) / 2;
  if (mitad <= 0) return coords[0];
  let acumulada = 0;
  for (let i = 0; i < longitudes.length; i++) {
    if (acumulada + longitudes[i] >= mitad) {
      const t = (mitad - acumulada) / longitudes[i];
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
      ];
    }
    acumulada += longitudes[i];
  }
  return coords[coords.length - 1];
}

/**
 * Usa una coordenada del local si está disponible. Cuando la fila todavía no
 * está vinculada (frecuente en IT 2026), solo permite un trazado OSM de calle
 * inequívocamente identificado dentro del municipio, y lo etiqueta aproximado.
 * Nunca se inventa la coordenada de una fachada a partir del número de portal.
 */
export function streetViewParaRevision(
  db: BaseDatos, campanaId: string, fila: FilaRevisionGeneral,
): EnlaceStreetView | null {
  const campana = db.campanas[campanaId];
  const municipio = campana && db.municipios[campana.municipioId];
  if (!campana || !municipio || !fila.direccion.trim() || fila.direccion === 'Sin calle consignada') return null;

  const vinculados = Object.values(db.vinculos)
    .filter((v) => v.origen.tipo === 'registro' && v.origen.id === fila.id && v.localId)
    .flatMap((v) => {
      const local = db.locales[v.localId!];
      return local ? [local] : [];
    })
    .filter((l) => l.municipioId === municipio.id && l.procedencia !== 'simulado'
      && coordenadaValida(l.coord));
  const verificado = vinculados.find((l) => !!l.coordVerificada);
  if (verificado?.coord) {
    return {
      url: enlacePano(verificado.coord), precision: 'verificada', origen: 'local-verificado',
      aviso: 'Coordenada del local verificada. Street View muestra el panorama disponible más cercano; comprueba la fecha de la fotografía.',
    };
  }
  if (vinculados.length === 1 && vinculados[0].coord) {
    return {
      url: enlacePano(vinculados[0].coord!), precision: 'aproximada', origen: 'local-sin-verificar',
      aviso: 'Posición del local sin verificar. Comprueba el portal y la fecha de la fotografía en Street View.',
    };
  }

  const buscada = normalizarCalle(fila.direccion);
  const corregida = aliasDocumentado(buscada, municipio.nombre);
  const calles = Object.values(db.calles).filter((calle) =>
    calle.municipioId === municipio.id && calle.procedencia !== 'simulado'
    && [calle.nombre, ...(calle.alias ?? []).map((alias) => alias.nombre)]
      .some((nombre) => normalizarCalle(nombre) === corregida),
  );
  if (calles.length !== 1) return null; // No inventar el punto si hay calles homónimas.
  const segmentos = calles[0].segmentos
    .filter((seg) => seg.tipo !== 'area' && seg.coords.length && seg.coords.every(coordenadaValida))
    .sort((a, b) => b.longitudM - a.longitudM);
  const coord = segmentos[0] && posicionMediaTramo(segmentos[0].coords);
  if (!coord) return null;

  return {
    url: enlacePano(coord), precision: 'aproximada', origen: 'calle',
    aviso: 'Punto aproximado de la calle, NO del portal ' + fila.numero
      + '. Desplázate por Street View hasta localizar la fachada y comprueba la fecha de la imagen.',
  };
}
