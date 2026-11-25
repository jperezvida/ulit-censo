import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import PantallaAcceso from './PantallaAcceso';
import { clienteServidor } from '../../store/clienteSupabase';
import { AlmacenSupabase } from '../../store/almacenSupabase';
import { conTiempoMaximo } from '../../store/conTiempoMaximo';
import { leerEspacioPaginado, LecturaPaginadaNoDisponible } from '../../store/lecturaPaginada';
import type { CambioRevisionGeneralReal } from '../../store/revisionGeneralReal';
import { guardarCategoriaIT1, type CambioCategoriaIT1 } from '../../store/categoriaIT1Real';
import { crearColaCategoriaIT1, type DecisionCategoriaIT1,
  type EstadoColaCategoriaIT1 } from '../../store/colaCategoriaIT1';
import { crearColaFranquiciaIT1, type EstadoColaFranquiciaIT1 } from '../../store/colaFranquiciaIT1';
import { guardarFranquiciaIT1, type CambioFranquiciaIT1 } from '../../store/franquiciaIT1Real';
import type { DecisionFranquiciaIT1 } from '../../domain/revisionFranquiciaIT1';
import { verificarEspacio, personaEspacio } from '../../domain/espacios';
import type { BaseDatos } from '../../domain/db';
import type { Rol } from '../../domain/types';

const ESPACIO_REAL = 'real-medina-del-campo-2026';

interface Lectura {
  db: BaseDatos;
  personaId: string;
  rol: Rol;
  version: number;
}

/**
 * ÚNICA aplicación de usuario: provee datos auténticos a TODOS los componentes
 * originales (Campañas, Territorio, Oficina, Datos, Análisis, Visualización).
 * No inicializa nunca la base ficticia ni copia datos del servidor a la demo.
 */
export default function AplicacionUnica() {
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [cargando, setCargando] = useState(true);
  const [faseCarga, setFaseCarga] = useState('Verificando sesión…');
  const [error, setError] = useState<string | null>(null);
  const [sinSesion, setSinSesion] = useState(false);
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [campanaId, setCampanaId] = useState('');
  const colaCategoriaRef = useRef<ReturnType<typeof crearColaCategoriaIT1> | null>(null);
  const [estadoColaCategoriaIT1, setEstadoColaCategoriaIT1] = useState<EstadoColaCategoriaIT1>({
    pendientes: [], error: '',
  });
  const colaFranquiciaRef = useRef<ReturnType<typeof crearColaFranquiciaIT1> | null>(null);
  const [estadoColaFranquiciaIT1, setEstadoColaFranquiciaIT1] = useState<EstadoColaFranquiciaIT1>({ pendientes:[], error:'' });

  // No permitir cerrar o recargar la pestaña con operaciones todavía sin verificar.
  useEffect(() => {
    const aviso = (event: BeforeUnloadEvent) => {
      if (!colaCategoriaRef.current?.consultar().pendientes.length &&
          !colaFranquiciaRef.current?.consultar().pendientes.length) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, []);

  const recargar = useCallback(async () => {
    if (colaCategoriaRef.current?.consultar().pendientes.length ||
        colaFranquiciaRef.current?.consultar().pendientes.length) {
      throw new Error('Hay decisiones pendientes de guardar. No recargues hasta confirmarlas.');
    }
    const cliente = clienteServidor();
    if (!cliente) throw new Error('No está configurada la conexión institucional a Supabase.');
    setFaseCarga('Comprobando sesión segura…');
    const { data, error: falloSesion } = await conTiempoMaximo(
      () => cliente.auth.getSession(), 12000,
      'La comprobación de la sesión ha superado el tiempo de espera. Prueba a acceder de nuevo.',
    );
    if (falloSesion) throw new Error('No se ha podido validar la sesión.');
    if (!data.session?.user) { setSinSesion(true); throw new Error('Inicie sesión para entrar en ULIT Censo.'); }
    setSinSesion(false);
    setFaseCarga('Cargando el censo real por bloques seguros…');
    const { db, info } = await conTiempoMaximo(
      async (signal) => {
        try {
          return await leerEspacioPaginado(cliente, ESPACIO_REAL, signal, (n) =>
            setFaseCarga(`Cargando el censo real… ${n.toLocaleString('es-ES')} entidades comprobadas`));
        } catch (e) {
          // Compatibilidad temporal: si 0011 no está instalado se intenta la RPC
          // original UNA sola vez, también con un límite global de tiempo.
          if (!(e instanceof LecturaPaginadaNoDisponible) || signal.aborted) throw e;
          setFaseCarga('Lectura por bloques pendiente de instalar. Probando conexión anterior…');
          return await new AlmacenSupabase(cliente, ESPACIO_REAL).leer(signal);
        }
      }, 32000,
      'El servidor tardó demasiado en entregar el censo. La sesión sigue protegida. Pulsa «Comprobar acceso de nuevo»; no se ha modificado ningún dato.',
    );
    if (!db || info.tipo !== 'real' || info.espacioId !== ESPACIO_REAL ||
        db.meta.espacioId !== ESPACIO_REAL || verificarEspacio(db, 'real').length ||
        personaEspacio(db)?.id !== info.personaId ||
        !['administrador','coordinador','revisor','investigador'].includes(info.rol)) {
      throw new Error('La cuenta no tiene acceso a un espacio auténtico verificable.');
    }
    colaCategoriaRef.current?.sincronizarVersion(info.version);
    colaFranquiciaRef.current?.sincronizarVersion(info.version);
    setLectura({ db, rol: info.rol as Rol, personaId: info.personaId, version: info.version });
  }, []);

  useEffect(() => {
    let vigente = true;
    void recargar().catch((e) => { if (vigente) { setLectura(null); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [recargar]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    const cliente = clienteServidor();
    if (!cliente || !correo || !contrasena) return;
    setCargando(true); setError(null); setFaseCarga('Iniciando sesión segura…');
    try {
      const { error: fallo } = await conTiempoMaximo(
        () => cliente.auth.signInWithPassword({ email: correo, password: contrasena }), 15000,
        'El servicio de autenticación no ha respondido a tiempo. Prueba de nuevo.',
      );
      if (fallo) throw new Error('No se ha podido iniciar sesión con esa cuenta.');
      await recargar();
      setContrasena('');
    } catch (e) { setLectura(null); setError(e instanceof Error ? e.message : String(e)); }
    finally { setCargando(false); }
  };

  const reintentar = async () => {
    setCargando(true); setError(null); setFaseCarga('Verificando sesión…');
    try { await recargar(); }
    catch (e) { setLectura(null); setError(e instanceof Error ? e.message : String(e)); }
    finally { setCargando(false); }
  };

  // La respuesta de la RPC aporta la entidad completa, versión y auditoría.
  // No disparar otra lectura de ~9.000 entidades al terminar cada guardado.
  const aplicarCorreccionReal = useCallback((cambio: CambioRevisionGeneralReal) => {
    setLectura((anterior) => {
      if (!anterior || anterior.version + 1 !== cambio.version
        || !anterior.db.registros[cambio.registroId]) return anterior;
      const correcciones = { ...(anterior.db.correccionesRegistros ?? {}) };
      if (cambio.correccion === null) {
        // Deshacer una primera limpieza: no guardar objetos null en la base local.
        delete correcciones[cambio.registroId];
      } else {
        correcciones[cambio.registroId] = cambio.correccion;
      }
      return {
        ...anterior, version: cambio.version,
        db: { ...anterior.db, correccionesRegistros: correcciones },
      };
    });
  }, []);

  const aplicarRevisionCategoriaReal = useCallback((cambio: CambioCategoriaIT1) => {
    setLectura((anterior) => {
      if (!anterior || anterior.version + 1 !== cambio.version
        || !anterior.db.registros[cambio.registroId]) return anterior;
      return {
        ...anterior, version: cambio.version,
        db: {
          ...anterior.db,
          revisionesCategoriaRegistros: {
            ...(anterior.db.revisionesCategoriaRegistros ?? {}),
            [cambio.registroId]: cambio.revision,
          },
        },
      };
    });
  }, []);

  const encolarCategoriaIT1 = useCallback((decision: DecisionCategoriaIT1): boolean => {
    if (!lectura || !['administrador', 'coordinador'].includes(lectura.rol) ||
      colaFranquiciaRef.current?.consultar().pendientes.length) return false;
    if (!colaCategoriaRef.current) {
      colaCategoriaRef.current = crearColaCategoriaIT1(
        lectura.version, guardarCategoriaIT1, aplicarRevisionCategoriaReal, setEstadoColaCategoriaIT1,
      );
    }
    return colaCategoriaRef.current.encolar(decision);
  }, [lectura, aplicarRevisionCategoriaReal]);

  const reintentarColaCategoriaIT1 = useCallback(() => {
    colaCategoriaRef.current?.reintentar();
  }, []);

  // Las dos RPC comparten una versión global. Nunca permitir colas paralelas en esta pestaña.
  const aplicarRevisionFranquiciaReal = useCallback((cambio: CambioFranquiciaIT1) => {
    setLectura((anterior) => {
      if (!anterior || anterior.version + 1 !== cambio.version ||
          !cambio.revisiones.every((r) => !!anterior.db.registros[r.registroId])) return anterior;
      const revisiones = { ...(anterior.db.revisionesFranquiciaRegistros ?? {}) };
      for (const r of cambio.revisiones) revisiones[r.registroId] = r;
      return { ...anterior, version: cambio.version,
        db: { ...anterior.db, revisionesFranquiciaRegistros: revisiones } };
    });
  }, []);

  const encolarFranquiciaIT1 = useCallback((decision: DecisionFranquiciaIT1): boolean => {
    if (!lectura || !['administrador','coordinador'].includes(lectura.rol) ||
        colaCategoriaRef.current?.consultar().pendientes.length) return false;
    if (!colaFranquiciaRef.current) {
      colaFranquiciaRef.current = crearColaFranquiciaIT1(
        lectura.version, guardarFranquiciaIT1, aplicarRevisionFranquiciaReal, setEstadoColaFranquiciaIT1);
    }
    return colaFranquiciaRef.current.encolar(decision);
  }, [lectura, aplicarRevisionFranquiciaReal]);

  const reintentarColaFranquiciaIT1 = useCallback(() => { colaFranquiciaRef.current?.reintentar(); }, []);

  // Sincronizar una cola inactiva cuando la otra obtiene una nueva versión del servidor.
  useEffect(() => {
    if (!lectura) return;
    if (!colaCategoriaRef.current?.consultar().pendientes.length)
      colaCategoriaRef.current?.sincronizarVersion(lectura.version);
    if (!colaFranquiciaRef.current?.consultar().pendientes.length)
      colaFranquiciaRef.current?.sincronizarVersion(lectura.version);
  }, [lectura?.version]);

  const actual = lectura?.db.campanas[campanaId] ? campanaId :
    Object.values(lectura?.db.campanas ?? {}).sort((a,b) => b.anio - a.anio)[0]?.id ?? '';
  const fuente = useMemo(() => lectura && actual ? ({
    db: lectura.db, campanaId: actual, personaId: lectura.personaId,
    roles: [lectura.rol] as Rol[], soloLectura: true as const,
    versionReal: lectura.version, elegirCampana: setCampanaId, recargarReal: recargar, aplicarCorreccionReal, aplicarRevisionCategoriaReal,
    estadoColaCategoriaIT1, encolarCategoriaIT1, reintentarColaCategoriaIT1,
    estadoColaFranquiciaIT1, encolarFranquiciaIT1, reintentarColaFranquiciaIT1,
    // Ninguna escritura genérica sobre datos auténticos. IT1/2026 utiliza RPC específica.
    aplicar: () => false,
  }) : null, [lectura, actual, recargar, aplicarCorreccionReal, aplicarRevisionCategoriaReal,
    estadoColaCategoriaIT1, encolarCategoriaIT1, reintentarColaCategoriaIT1,
    estadoColaFranquiciaIT1, encolarFranquiciaIT1, reintentarColaFranquiciaIT1]);

  if (cargando || !fuente) return <PantallaAcceso
    cargando={cargando} faseCarga={faseCarga} sinSesion={sinSesion} error={error}
    correo={correo} contrasena={contrasena}
    onCorreo={setCorreo} onContrasena={setContrasena}
    onEntrar={(evento) => void entrar(evento)}
    onReintentar={() => void reintentar()}
  />;
  return <FuenteOficinaContext.Provider value={fuente}><Outlet /></FuenteOficinaContext.Provider>;
}
