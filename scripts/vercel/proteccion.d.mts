export interface Evaluacion { ok: boolean; motivo: string }
export declare const INICIO_SESION_VERCEL: { host: string; rutas: string[] };
export declare const RUTAS_COMPROBADAS: string[];
export declare const AMBITOS_VALIDOS: string[];
export declare function evaluarRespuestaSinSesion(r: { status: number; location?: string | null; server?: string | null; cuerpo?: string; error?: string | null }): Evaluacion;
export declare function comprobarRuta(url: string): Promise<Evaluacion & { status?: number }>;
export interface ComprobacionDireccion { ok: boolean; resultados: (Evaluacion & { url: string; status?: number })[] }
export declare function comprobarDireccion(base: string): Promise<ComprobacionDireccion>;
export declare function esperarProteccion(base: string, o?: {
  limiteMs?: number; intervaloMs?: number; comprobar?: (base: string) => Promise<ComprobacionDireccion>;
  dormir?: (ms: number) => Promise<void>; ahora?: () => number; informar?: (intento: number, r: ComprobacionDireccion) => void;
}): Promise<ComprobacionDireccion & { intentos: number; motivo?: string }>;
export declare function evaluarConfiguracion(proyecto: unknown): Evaluacion;
