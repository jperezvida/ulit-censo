# ULIT Censo en el Supabase compartido `censo-comercios` · Diseño técnico (propuesta)

**Estado:** propuesta. **No se ha aplicado nada en Supabase.** Las migraciones de `docs/persistencia/sql/` se
han validado solo en un PostgreSQL 16 local y desechable que emula los roles de Supabase. Están en `docs/`, y
no en `supabase/migrations/`, para que ninguna herramienta pueda aplicarlas por error.

## 1. Punto de partida

### Modelo actual
- `BaseDatos` contiene 20 colecciones `Record<id, entidad>` (municipios, calles, campañas, itinerarios,
  locales, negocios, ocupaciones, observaciones, registros, vínculos, importaciones, revisiones, digital,
  clasificaciones, franquicias, oficinaItinerarios, personas…) y unos pocos valores escalares (`version`,
  `secuencia`, `meta`, `colaSync`…).
- El dominio es puro y **comparte estructura**: una operación devuelve una base nueva en la que solo cambian
  las entidades afectadas.
- `useEspacios.modificar` guarda la base entera en IndexedDB con **escritura verificada**: comprueba una
  huella SHA-256, escribe y vuelve a leer.

### ULIT base en el mismo proyecto
- Usa `public.perfiles` y `public.es_admin_base_catedra()`.
- Tiene un esquema privado `ulit_go`, sin privilegios para los roles de la API, al que se accede mediante
  funciones `public.ulit_go_*`.
- ULIT Censo sigue ese mismo patrón y **no depende** de `perfiles` ni de las funciones de ULIT base.

## 2. Medición con datos sintéticos (Medina 2025 sintético C1e + IT1 2026 sintético)

| Medida | Resultado |
|---|---|
| Espacio tras 2025 (889 filas, 704 locales) | 5,0 MB en JSON (446 KB comprimido) |
| Incorporación de IT1 (105 filas) | 411 entidades cambiadas, 0,5 MB |
| Conciliación y revisión de Oficina (418 operaciones) | media de 1,2 KB y 2–3 entidades por operación |
| **Si cada operación guardase el espacio entero** | **2,3 GB** (198 MB comprimido) solo para IT1 |
| PostgreSQL con este diseño, tras 2025 + IT1 completos | **17 MB** (entidad 7,7 MB · historial 8,5 MB · copia 1,1 MB) |
| Una copia de seguridad | 6,2 MB en JSON, 1 MB en disco (TOAST) |
| 422 operaciones dentro del servidor | 1,5 s (sin contar la red) |

**Conclusión:** guardar la versión completa del espacio en cada cambio no es viable. Se guarda **una fila
por entidad** y un **historial por entidad**.

**Crecimiento previsto:**
- cada itinerario de 2026 añade 1–2 MB (el estado y su historial);
- cada copia añade unos 1 MB en disco;
- con 5 itinerarios y 30 copias, ULIT Censo quedaría por debajo de 60 MB al año.

El historial de la carga inicial duplica el tamaño del censo. Si hiciera falta, se puede dejar de registrar
el historial de esa primera carga y conservarla solo como copia.

## 3. Esquema `ulit_censo` (migración 0001)

| Tabla | Contenido |
|---|---|
| `espacio` | `ensayo-*` o `real-*`, versión global y `escritura_habilitada` (desactivada en el real; una restricción la obliga en el ensayo) |
| `miembro` | cuenta de Auth, espacio, rol (`administrador`, `coordinador`, `revisor`, `investigador`, `lector`), persona ULIT, alta y baja |
| `entidad` | una fila por entidad (`coleccion`, `id`, `valor` jsonb con el mismo formato de la aplicación) y columnas derivadas indexadas (`campana_id`, `itinerario_id`, `local_id`) |
| `operacion` | cada guardado: versión, etiqueta, autor, persona, número de cambios y tipo (cambio, carga inicial o restauración) |
| `entidad_historial` | valor anterior y nuevo de cada cambio |
| `copia` | copias propias de ULIT Censo: contenido, SHA-256, tamaño y motivo |

**Protección del esquema:**
- `revoke all` del esquema y de las tablas a `public`, `anon`, `authenticated` y `service_role`;
- **RLS activado sin políticas**, como defensa en profundidad;
- el historial y las operaciones solo admiten añadir, y las copias no se modifican (lo garantizan disparadores);
- la lista de colecciones admitidas es cerrada.

**Qué se conserva y dónde:**
- campañas, locales, negocios, itinerarios, ocupaciones, observaciones y registros, en `entidad`, con el
  mismo formato que hoy;
- las conciliaciones, en `vinculos`, con sus decisiones, su autoría y la posibilidad de deshacer;
- las revisiones de Oficina, en `revisiones`, `digital`, `clasificaciones` y `franquicias`;
- el historial completo, en `operacion` y `entidad_historial`.

**Normalización futura:** las columnas derivadas permiten consultar y filtrar por campaña o itinerario. En
2027 se podrán crear tablas tipadas o vistas a partir de `entidad` sin migrar los datos.

## 4. Operaciones (migración 0002)

Todas están en `public`, son `security definer`, tienen `search_path` vacío y solo las puede ejecutar
`authenticated`.

| Función | Quién puede usarla | Qué hace |
|---|---|---|
| `ulit_censo_mis_espacios()` | cualquier miembro | espacios, rol y persona de la cuenta |
| `ulit_censo_leer(espacio)` | lector o superior | versión y entidades, en el formato de `BaseDatos` |
| `ulit_censo_historial(espacio, n)` | lector o superior | últimas operaciones |
| `ulit_censo_aplicar(espacio, version_esperada, etiqueta, cambios)` | investigador o superior | aplica todos los cambios o ninguno, bloqueando la fila del espacio; si la versión no es la esperada, rechaza con SQLSTATE `40001` |
| `ulit_censo_crear_copia`, `listar_copias`, `descargar_copia` | coordinación o administración | copias propias y su exportación |
| `ulit_censo_restaurar_copia(espacio, copia, version_esperada, motivo)` | administración | comprueba el SHA-256, crea una copia automática previa y aplica la restauración como **operación nueva**, con su historial |
| `ulit_censo_alta_miembro`, `ulit_censo_baja_miembro` | administración del espacio | gestiona miembros; la cuenta debe existir ya en Auth |

**Reglas comprobadas en el servidor:**
- el espacio real no se escribe mientras `escritura_habilitada = false`;
- la raíz (`_raiz.meta.espacio`) debe coincidir con el tipo de espacio;
- no se admiten colecciones fuera de la lista ni entidades repetidas en una misma operación;
- como máximo 20.000 cambios por operación.

## 5. Autenticación y permisos
- **Cuentas:** se usa Supabase Auth del proyecto compartido, sin cambiar su configuración. **Una cuenta de
  ULIT base no entra en ULIT Censo si no figura en `ulit_censo.miembro`**, aunque sea administradora de ULIT
  base (lo comprueba la prueba 2).
- **Alta inicial:** el primer espacio de ensayo y su administradora se dan de alta a mano, una sola vez
  (plantilla 0003, tras autorización). Después, la administración del espacio gestiona los miembros.
- **Credenciales en el navegador:** solo la clave pública (`anon`) y la sesión de la persona. **Nunca la
  clave `service_role`**, que además no tiene permisos sobre ULIT Censo.
- **Permisos por itinerario (2027):** políticas o comprobaciones con `itinerario_id` y `campana_id` en
  `ulit_censo_aplicar`, junto a una asignación de miembros a itinerarios.

## 6. Concurrencia
- **Bloqueo optimista:** equivale a la huella actual de `escribirVerificado`, sustituida por la versión del
  espacio. Una pestaña con una versión antigua recibe `40001`, y la cola de `FuenteEspacio` (PR #11) se
  detiene y ofrece reintentar o recuperar lo guardado.
- **Varias personas (2027):** la versión es global y bastará con cambiar la comprobación a
  `entidad.version` de las entidades tocadas, sin tocar el formato de los datos.

## 7. Copias, restauración y exportación propias
- **Copias del proyecto compartido:** restauran **todo** el proyecto, incluido ULIT base. **No deben usarse
  para ULIT Censo.**
- **Copias de ULIT Censo:** se guardan en `ulit_censo.copia`, de forma manual o automática antes de cada
  incorporación o restauración.
- **Restaurar:** genera una operación nueva, con su historial y su copia previa; nunca borra versiones.
- **Exportar:**
  - `ulit_censo_descargar_copia` devuelve un JSON con su SHA-256, que la coordinación descarga y archiva en
    un **almacenamiento institucional** (nunca en GitHub, ni en Vercel, ni en otro servicio sin
    autorización);
  - para comprobar la exportación se vuelve a calcular la huella.
- **Retirada completa:** `9000_ulit_censo_retirada.sql` elimina solo los objetos de ULIT Censo.

## 8. Sustitución de IndexedDB en `useEspacios`

La interfaz de `useEspacios` (`abrir`, `modificar`, `crearCampana`…) **no cambia**. Lo que cambia es el
almacén:

1. **Interfaz `AlmacenEspacio`:** `leer() → {db, version}` y `guardar(antes, despues, etiqueta, version)`.
   Habrá dos implementaciones:
   - `AlmacenIndexedDB`, con el código actual de `escribirVerificado`;
   - `AlmacenSupabase`.
2. **`AlmacenSupabase.guardar`:**
   - calcula la **diferencia por referencia** entre la base anterior y la nueva (ya validada en
     `medir-almacenamiento.ts`), lo que da 2–3 entidades por operación;
   - llama a `ulit_censo_aplicar` con la versión esperada;
   - si recibe `40001`, avisa del conflicto y se detiene (sin reintentos automáticos).
3. **`leer`:** `ulit_censo_leer` reconstruye la `BaseDatos` (unos 6 MB en el caso de Medina) y después se
   ejecutan `verificarEspacio` y las migraciones del modelo, como ahora.
4. **IndexedDB pasa a ser caché local, no fuente de verdad.** La demostración (`useStore`) no cambia y el
   espacio de ensayo puede seguir en IndexedDB.
5. **Sesión:** la persona responsable sale de `ulit_censo_mis_espacios().persona_id`, ya no de una
   declaración en el dispositivo.
6. **`CONFIRMACION_REAL_HABILITADA` sigue en `false`.** Habilitar la escritura del espacio real exigirá dos
   cosas: esa constante y `espacio.escritura_habilitada`, que solo cambia un `update` manual autorizado.

## 9. Etapas de implantación

| Etapa | Contenido | Se hace en Supabase |
|---|---|---|
| 0 | Revisar este diseño y aprobar el tratamiento de datos | nada |
| 1 | `AlmacenEspacio` con IndexedDB (refactor sin cambios de comportamiento) y pruebas | nada |
| 2 | `AlmacenSupabase` contra PostgreSQL local y Supabase CLI local, con pruebas de conflicto, copia y restauración | nada |
| 3 | Comprobaciones previas (9100) en el proyecto compartido | **solo lectura** |
| 4 | Aplicar 0001 y 0002, comparar huellas (9100) y dar de alta el espacio de ensayo (0003) | **tras autorización expresa** |
| 5 | Ensayo con datos sintéticos de extremo a extremo: carga, IT1, conciliación, Oficina, copia, restauración y exportación | escritura solo en `ensayo-*` |
| 6 | Espacio real: alta con `escritura_habilitada = false` | tras autorización y aprobación de protección de datos |
| 7 | Medina 2025 real: copia previa, carga, verificación de recuentos y exportación institucional; después IT1 2026 | tras autorización |
| 8 (2027) | Varias personas: permisos por itinerario y concurrencia por entidad | — |

## 10. Verificaciones obligatorias antes de la primera migración en el Supabase compartido
1. **Revisión de 0001 y 0002** por la persona responsable de ULIT base: que no toquen nada suyo.
2. **9100 ejecutado en el proyecto, que debe confirmar:**
   - que no existe `ulit_censo` ni ninguna función `public.ulit_censo_*`;
   - los atributos del rol que aplicará la migración;
   - que `ulit_censo` no está entre los esquemas expuestos por la API;
   - que existen `auth.uid()`, `gen_random_uuid()` y `sha256()`;
   - las **huellas** de políticas, funciones y permisos de ULIT base, que deben guardarse.
3. **Copia de seguridad reciente del proyecto compartido**, confirmada y con su fecha.
4. **Prueba local superada:** `docs/persistencia/pruebas/ejecutar.sh` (8 bloques de seguridad, concurrencia,
   copia y restauración, más retirada completa con ULIT base intacto). Idealmente se repite también con
   Supabase CLI local.
5. **Espacio disponible en el plan** del proyecto frente al crecimiento previsto, inferior a 60 MB al año
   (consulta 9100 número 6).
6. **Límites de la API:** que el tiempo máximo de sentencia de `authenticated` (8 s por defecto en Supabase)
   y el tamaño de las peticiones admiten la carga inicial (6 MB y unas 5.600 entidades). Si no, la carga se
   divide en lotes.
7. **Plan de vuelta atrás aprobado:** 9000 y repetir 9100, cuyas huellas deben ser idénticas.
8. **Ventana acordada** y persona responsable presente. Después, 9100 otra vez: las huellas de ULIT base no
   deben haber cambiado.

## 11. Riesgos abiertos
- **Usuarios compartidos:** Auth es común a todo el proyecto. Si en ULIT base el registro está abierto,
  cualquiera puede crear una cuenta, aunque no tendrá acceso a ULIT Censo sin pertenencia.
- **Funciones en `public`:** las 10 funciones `ulit_censo_*` se añaden al esquema `public`, sin modificar
  nada existente. Es la alternativa a cambiar los esquemas expuestos por la API, que sí alteraría la
  configuración compartida.
- **Copias exportadas:** contienen el censo completo y deben guardarse en un almacenamiento institucional.
- **Propietario de las funciones:** las funciones `security definer` pertenecen al rol que aplica la
  migración. Hay que confirmar ese rol con 9100.
