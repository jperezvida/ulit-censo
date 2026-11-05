import { describe, expect, it } from 'vitest';
import type { PlanIncorporacion } from './incorporacion';
import { CANDIDATO_MEDINA_2025 as c, comprobarCandidatoMedina2025 } from './comprobarCandidatoMedina2025';

/** Solo metadatos ficticios: nunca incluir el Excel auténtico en el repositorio. */
const planValido = (): PlanIncorporacion => ({
  municipio: { id: c.municipioId, nombre: 'Medina del Campo' },
  destino: { campanaId: 'campana-historica-prueba', importacionId: 'importacion-prueba', anio: 2025, nombre: 'Histórico 2025', nueva: true },
  archivo: { nombre: 'copia-para-prueba.xlsx', sha256: c.sha256 },
  // El planificador omite modo cuando es histórico; lo reserva para 'operativo'.
  aplicable: true,
  bloqueos: [],
  registros: { previstos: 889, excluidos: 0, candidatasExcluir: [] },
  filas: Array.from({ length: 889 }, (_, i) => ({ fila: i + 2 })),
  nuevas: { registros: 889 },
  correspondencias: { excluida: 0 },
  decisiones: { exclusiones: 0, periodo: { desde: '2024-01-01', hasta: '2025-12-31' } },
} as unknown as PlanIncorporacion);

const examinar = (p = planValido(), espacio: string = c.espacioId, lectura = { filas: 889, columnas: 27 }) =>
  comprobarCandidatoMedina2025(espacio, p, lectura);

describe('Preparación sin autorización de Medina 2025', () => {
  it('acepta el contrato documental de 889 filas y 27 columnas, sin conceder permisos', () => {
    expect(examinar()).toEqual([]);
  });

  it('rechaza espacio o municipio ajeno', () => {
    expect(examinar(planValido(), 'ensayo-catedra-2026').join(' ')).toMatch(/espacio/);
    const p = planValido();
    p.municipio.id = 'otro-municipio';
    expect(examinar(p).join(' ')).toMatch(/municipio/);
  });

  it('rechaza un SHA distinto aunque los agregados parezcan correctos', () => {
    const p = planValido();
    p.archivo.sha256 = '645179a850474ab92bc54c9ed4e6e2f300790f62081fb0ea02d3999e3c4cb67a';
    expect(examinar(p).join(' ')).toMatch(/huella/);
  });

  it('no convierte un itinerario 2026 en histórico 2025', () => {
    const p = planValido();
    p.modo = 'operativo';
    p.destino.anio = 2026;
    p.destino.itinerario = { id: 'it1', codigo: 'IT1' };
    expect(examinar(p).join(' ')).toMatch(/histórica 2025/);
  });

  it('no permite excluir filas, omitir registros ni cambiar el periodo', () => {
    const p = planValido();
    p.registros.excluidos = 1;
    p.decisiones.exclusiones = 1;
    p.nuevas.registros = 888;
    p.decisiones.periodo = { desde: '2025-01-01', hasta: '2025-12-31' };
    const texto = examinar(p).join(' ');
    expect(texto).toMatch(/889 registros/);
    expect(texto).toMatch(/excluir/);
    expect(texto).toMatch(/2024 y 2025/);
  });

  it('rechaza lectura con 28 columnas y plan con bloqueos', () => {
    const p = planValido();
    p.aplicable = false;
    p.bloqueos = [{ codigo: 'destino-invalido', mensaje: 'prueba', detalles: [] }];
    const texto = examinar(p, c.espacioId, { filas: 889, columnas: 28 }).join(' ');
    expect(texto).toMatch(/bloqueos/);
    expect(texto).toMatch(/27 columnas/);
  });
});
