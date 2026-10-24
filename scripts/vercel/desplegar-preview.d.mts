export interface Evaluacion { ok: boolean; motivo: string; produccion?: boolean }
export declare function extraerDespliegue(salida: string): { id: string; url: string | null; targetCli: string | null };
export declare function evaluarDespliegueCreado(dep: unknown, projectId: string): Evaluacion;
export declare function evaluarRetirable(dep: unknown, o: { id: string; projectId: string }): Evaluacion;
export declare function evaluarDominioProduccion(r: { status: number; location?: string | null; server?: string | null; cuerpo?: string }): Evaluacion;
