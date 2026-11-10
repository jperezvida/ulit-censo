import { describe, expect, it } from 'vitest';
import { revisionDocumentalIt2 } from './incorporacion';

const SHA='37a6a1f6f201d8b9b9d7215a57b65f9f5b26af5cfa2157851ea575fc15384f64';
const FILAS=Array.from({length:34},(_,i)=>516+i);

describe('Revisión documental de IT2, sin modificar el XLSX original',()=>{
  it('reconoce solo las 34 filas del archivo cotejado con el PDF',()=>{
    expect(revisionDocumentalIt2(SHA,'IT2',FILAS)).toBe(true);
    expect(revisionDocumentalIt2(SHA,'IT3',FILAS)).toBe(false);
    expect(revisionDocumentalIt2('a'.repeat(64),'IT2',FILAS)).toBe(false);
    expect(revisionDocumentalIt2(SHA,'IT2',FILAS.slice(1))).toBe(false);
    expect(revisionDocumentalIt2(SHA,'IT2',[...FILAS.slice(0,33),550])).toBe(false);
  });
});
