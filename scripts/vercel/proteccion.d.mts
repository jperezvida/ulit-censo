export interface Evaluacion { ok: boolean; motivo: string }
export declare const INICIO_SESION_VERCEL: { host: string; rutas: string[] };
export declare const RUTAS_COMPROBADAS: string[];
export declare const AMBITOS_VALIDOS: string[];
export declare function evaluarRespuestaSinSesion(r: { status: number; location?: string | null; server?: string | null; cuerpo?: string }): Evaluacion;
export declare function comprobarRuta(url: string): Promise<Evaluacion>;
export declare function comprobarDireccion(base: string): Promise<{ ok: boolean; resultados: (Evaluacion & { url: string })[] }>;
export declare function evaluarConfiguracion(proyecto: unknown): Evaluacion;
