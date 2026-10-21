# C1d-A · Incorporación controlada y revisión de incidencias

> **Alcance:** interfaz de oficina para preparar, analizar, decidir, confirmar, incorporar y deshacer, **solo con datos ficticios**.
> - La incorporación de censos reales **no está habilitada**.
> - No se conecta Supabase ni ningún servicio externo.
> - No se incluye ningún archivo real.
> - No se ha empezado C2 ni C3. El dashboard (C1d-B) se documenta aparte, en `C1D-B-VISUALIZACION.md`.

## 1. Dónde está

- **Datos → «Incorporación controlada · demostración»** abre el asistente (ruta `#/datos/incorporar`).
- **Datos → lista de importaciones:** cada incorporación controlada muestra:
  - su traza: perfil, año, persona y algoritmo de huellas;
  - el botón **«Deshacer la incorporación…»**.
- El análisis previo de archivos de C1a y C1b sigue disponible y es de **solo lectura**.

## 2. Solo escenarios ficticios (límite técnico)

- **El asistente no tiene ningún selector de archivos.** El origen es un **escenario generado por la aplicación**: «Censo histórico ficticio de Medina del Campo 2025», con 889 registros en 93 «VÍA FICTICIA nnn» y una fila de totales.
- **El libro es determinista:** cada generación da el mismo SHA-256.
- **Comprobaciones de `aplicarEscenario` antes de incorporar:**
  1. El SHA-256 del plan es **exactamente** el del libro que genera la aplicación. Renombrar o manipular un archivo no sirve: no hay vía para que llegue a la aplicación.
  2. El destino es el **municipio ficticio** del escenario.
  3. Después, `aplicarIncorporacion` (C1c) recalcula el plan y exige su **firma**.
- **Municipio ficticio aislado:** «Medina del Campo (escenario ficticio)», `mun-demo-medina`.
  - Tiene las reglas territoriales de Medina: sin Distrito ni Zona y CP 47400.
  - Su callejero es propio: 90 vías ficticias sin geometría; las 3 restantes quedan sin correspondencia a propósito.
  - Tiene dos locales previos, para mostrar candidatos.
  - No comparte nada con Medina ni con Valladolid.
- **«Reiniciar escenario»** elimina todo lo del municipio ficticio. Se niega si algo de otro municipio depende de él; una prueba comprueba que la base queda idéntica a la anterior.
- En la etapa 1, los municipios reales aparecen **deshabilitados**, con la nota «incorporación real no habilitada».

## 3. El asistente (cinco etapas)

Se puede volver a cualquier etapa anterior sin perder el trabajo. El estado vive en memoria durante la sesión; no se guarda en el navegador ni contiene bytes de archivos.

| Etapa | Qué se hace | Detalle |
|---|---|---|
| **1. Origen y destino** | Preparar el escenario y elegir el año histórico; opcionalmente, el nombre de la campaña | Muestra:<br>• municipio, archivo, SHA-256 y perfil detectado;<br>• comprobación de duplicados;<br>• identificador de la campaña nueva;<br>• aviso «Histórico, no campaña actual». |
| **2. Diagnóstico** | **Analizar** (C1a + C1b + plan de C1c) | Muestra:<br>• filas, ocupados, vacíos y estado desconocido;<br>• celdas válidas, vacías, pendientes e inválidas;<br>• incidencias por gravedad;<br>• filas sin correspondencia territorial y posibles totales;<br>• **revisión por grupos**. |
| **3. Decisiones** | **Resolver** | Pestañas:<br>• Interpretaciones;<br>• Correspondencias;<br>• Exclusiones;<br>• Clasificación histórica;<br>• Pendiente de la Cátedra. |
| **4. Confirmación** | **Confirmar** | Al entrar, el plan se recalcula. Muestra:<br>• entidades que se crearían;<br>• cambios sobre datos existentes (ninguno);<br>• lo que quedará pendiente;<br>• la persona que confirma.<br>Exige una casilla de confirmación expresa. |
| **5. Resultado** | **Incorporado** | Muestra:<br>• registros, locales, negocios, correspondencias pendientes, incidencias conservadas e identificador;<br>• estado del guardado;<br>• botón para deshacer. |

### Revisión por grupos (etapa 2)

No obliga a recorrer las 889 filas:
- **Filtros:** gravedad (error, aviso, información, pendiente) y estado.
- **Grupos:** por tipo de incidencia o de correspondencia, ordenados por gravedad, con el recuento por estado.
- **Búsqueda:** por calle, número, negocio o número de fila.
- **Tabla paginada** (25 filas por página) con fila, calle y número, negocio, columna, **valor original**, **interpretación** (estado, valor o propuesta) y **regla**, con su descripción.
- **Estados diferenciados por color y por texto:**
  - Resuelto;
  - Pendiente de revisar;
  - Pendiente de la Cátedra;
  - No aplicable;
  - **Bloqueante** (bloqueos del plan, como una reimportación).

### Decisiones (etapa 3)

Cada decisión registra **persona** (la del contexto), **fecha** y **motivo o referencia**, que es obligatorio. Registrar o confirmar requiere el rol de **coordinación o administración**.

- **Interpretaciones:**
  - cada regla pendiente («3,5 m»…) y cada texto del diccionario («sin dato», «s/i») se autoriza **por separado**, con su lista de filas afectadas;
  - autorizar una regla **no autoriza ninguna otra**;
  - se puede retirar.
- **Correspondencias:** por motivo.
  - **Decidibles:**
    - misma dirección en varias filas, con el aviso de que «crear un local para cada fila» afirma que son dos locales físicos;
    - local existente en la dirección, con las alternativas a la vista;
    - S/N.
  - **No decidibles en esta fase** (quedan sin vínculo): número desconocido, calle sin correspondencia o ambigua, y estado del local desconocido.
  - **Nunca se elige automáticamente.**
- **Exclusiones:**
  - las posibles filas de totales (heurística), con un resumen de sus celdas;
  - cualquier otra fila, por número.

  La fila excluida conserva su registro de origen con la exclusión.
- **Clasificación histórica:**
  - las combinaciones de 2025 (cuatro niveles y cuántas filas tienen descripción) con su diagnóstico;
  - **«Conservar no es confirmar»**: una equivalencia autorizada solo crea una propuesta 2026 **sin confirmar**;
  - los nodos afectados por **D01–D14** o por **excepciones ICM** no admiten equivalencia hasta que la Cátedra decida.
- **Pendiente de la Cátedra:**
  - reglas y textos sin autorizar;
  - correspondencias 2025 → 2026 (decisión 3);
  - direcciones repetidas (decisión 5);
  - estado de revisión de los históricos (decisión 6);
  - D01–D14 y excepciones ICM.

## 4. Aplicación, guardado y deshacer

- **Funciones de C1c:** se reutilizan sin cambios (`prepararIncorporacion`, `planificarIncorporacion`, `aplicarIncorporacion` y `deshacerIncorporacion`). No hay un importador paralelo ni se usan las conversiones del importador CSV provisional.
- **Guardado comprobado** (`aplicarConGuardado`, en el almacén):
  - aplica la operación como una unidad;
  - **guarda de inmediato** en IndexedDB y **comprueba** el resultado;
  - si el almacenamiento falla, lo dice claramente («los datos siguen en memoria: no cierres la pestaña») y ofrece un botón **«Reintentar guardado»**.
- **Reintentar guardado** (`reintentarGuardado`): solo vuelve a escribir en el navegador la versión que ya está en memoria. **Nunca repite la operación** (incorporar, deshacer, preparar o reiniciar). Está en:
  - la etapa 5 (el botón «Deshacer la incorporación…» espera a que esté guardada);
  - el cuadro «Deshacer la incorporación», que no se cierra hasta guardar;
  - el cuadro «Reiniciar el escenario», que **no se cierra ni anuncia el reinicio como guardado** mientras falle; solo ofrece reintentar;
  - «Preparar escenario ficticio».
- **Estados del guardado:** «pendiente» mientras se escribe; «guardado» solo cuando lo escrito es exactamente la versión vigente en memoria; «error» si falla. Una operación en curso o un fallo nunca se muestran como guardado correcto.
- **Escrituras serializadas:** todas las escrituras en IndexedDB (las diferidas de la edición normal y las inmediatas) pasan por una única cola. Nunca hay dos a la vez, y cada una escribe la versión **vigente** al ejecutarse, no la que la programó. Así, aunque se crucen dos operaciones, lo último guardado nunca es una versión anterior.
- **Historial de Ctrl+Z:** incorporar, deshacer y reiniciar **vacían** el historial. Así un Ctrl+Z no puede revertir una incorporación sin sus comprobaciones; se deshace con su botón propio.
- **Deshacer:**
  - antes de nada, muestra **qué se eliminará** (por tipo de entidad) y **qué trazabilidad permanece**:
    - la importación marcada como «deshecha»;
    - la secuencia de orden;
    - todo lo ajeno, intacto;
  - después **ensaya** la operación;
  - si hay cambios posteriores, o la campaña está revisada o validada, se bloquea y lista los conflictos sin tocar nada.

## 5. Refuerzos de seguridad de C1c

- **Huellas de integridad SHA-256** (traza versión 2):
  - cubren las entidades creadas, las filas de origen y la firma del plan;
  - el SHA-256 es síncrono y propio, válido en navegador y Node, y está contrastado con los vectores oficiales y con `node:crypto`;
  - las trazas de versión 1 (32 bits) se siguen comprobando, deshaciendo y reconociendo al reimportar, sin migraciones.
- **Identificador de importación:** `imp-c1-<municipio>-<año>-<sha16>`. El mismo archivo en dos municipios del mismo año no colisiona ni sobrescribe registros (probado).

## 6. Resultados esperados con el escenario (probados)

| Concepto | Valor |
|---|---|
| Filas (889 registros + 1 posible fila de totales, que se conserva) | 890 |
| Locales: ocupados / vacíos / sin estado | 641 / 246 / 3 |
| Celdas | 24.030 |
| Incidencias | 298 (15 error · 145 aviso · 138 información) |
| Correspondencias: inequívocas / ambiguas / sin vínculo | 842 / 16 / 32 |
| Motivos | S/N 6 · local existente 4 · número desconocido 4 · estado desconocido 2 · dirección repetida 4 · calle sin correspondencia 28 |
| Entidades nuevas | 890 registros · 842 locales · 620 negocios · 860 observaciones · 841 ocupaciones · 0 clasificaciones 2026 |

> **Corrección pendiente C1c-1** (ver `C1C-INCORPORACION.md`, sección 12.1): las 4 filas con «dirección repetida» son locales físicos distintos del mismo portal, no una ambigüedad. Cuando se corrija, cambiarán las cifras de locales, ambiguas y correspondencias de esta tabla.

Con las decisiones de la prueba de interfaz (autorizar «3,5 m», crear un local para una fila S/N y excluir la fila de totales) se crean 843 locales y se incorporan 890 registros, uno de ellos con la exclusión. La campaña 2026 no cambia y el deshacer deja la base como estaba.

El **Excel ficticio de Medina 2025** que facilitasteis, comprobado fuera del repositorio con `npm run interpretar` y `npm run simular-incorporacion`, conserva los resultados de C1b y C1c:
- 889 registros, 24.003 celdas y 452 incidencias;
- 852 locales, 6 ambiguas y 31 sin vínculo;
- reimportación idéntica y deshacer completo.

## 7. Cómo probarlo en Codespaces

1. Abre el Codespace de la rama `claude/fase2-oficina-itinerarios`.
2. En el terminal: `npm ci` y después `npm run dev`.
3. Abre el puerto **5173** cuando Codespaces lo ofrezca: pestaña «Puertos» → icono del globo.
4. Arriba, pulsa **Datos**.
5. Pulsa **«Incorporación controlada · demostración»**.
6. **Etapa 1:**
   - pulsa **«Preparar escenario ficticio»**;
   - deja el año en 2025;
   - pulsa **«Analizar el archivo»**.
7. **Etapa 2:**
   - comprueba los recuentos (890 filas, 298 incidencias);
   - prueba los filtros de gravedad, el desplegable de estado y el buscador (por ejemplo, `332` o `VÍA FICTICIA 091`);
   - pulsa un grupo de la izquierda, por ejemplo «Long fachada con unidad».
8. Pulsa **«Siguiente: Decisiones»**:
   - **Interpretaciones** → «Registrar autorización de la Cátedra» → escribe una referencia → «Registrar». El diccionario sigue pendiente.
   - **Correspondencias** → en la fila 120, elige «Crear un local para esta fila», escribe el motivo y pulsa «Guardar».
   - **Exclusiones** → «Excluir esta fila» en la fila 891 → motivo → «Registrar».
   - **Clasificación histórica** → revisa los diagnósticos. Para registrar una equivalencia, «Registrar equivalencia autorizada…»; por ejemplo, «Pan y Lácteos › Panadería». Los nodos de Servicios están bloqueados por D11.
9. Pulsa **«Siguiente: Confirmación»**. Revisa «Se crearía» y «Quedará pendiente», marca la casilla y pulsa **«Incorporar al modelo»**.
10. **Etapa 5:**
    - comprueba los recuentos y el identificador;
    - **«Ver en el historial de Datos»** muestra la importación con su traza;
    - **«Deshacer la incorporación…»** muestra la vista previa; marca la casilla y deshaz.
11. **Bloqueo del deshacer:** la interfaz no ofrece ninguna forma de modificar los datos importados, porque la campaña histórica es de solo lectura en Oficina. Por eso el bloqueo por cambios posteriores, o por campaña revisada o validada, se comprueba en las pruebas automáticas (`src/domain/c1d.test.ts` y `src/domain/c1c.test.ts`). En la interfaz se ve otro bloqueo: si se analiza de nuevo el mismo escenario y año sin deshacer, la etapa 2 muestra **«Bloqueante: este archivo ya se incorporó…»** y la confirmación no se puede aplicar.
12. **Para empezar de cero:** etapa 1 → «Reiniciar escenario».

**Roles:** el botón de rol de la barra superior permite quitar «Coordinador» para comprobar que entonces no se pueden registrar decisiones ni confirmar.

## 8. Pruebas

| Archivo | Pruebas | Qué cubre |
|---|---:|---|
| `src/domain/c1d.test.ts` | 12 | Escenario determinista y resultados esperados; aislamiento y reinicio; límite técnico (otro archivo, SHA-256 manipulado, escenario desconocido); estados y filtros de revisión; reglas independientes; nodos con D01–D14 o ICM; vista previa y bloqueo del deshacer |
| `src/store/guardado.test.ts` | 7 | Guardado inmediato; fallo informado; operación fallida sin cambios; reintento que falla y luego guarda sin repetir la operación; «pendiente» durante la escritura; dos escrituras cruzadas sin dejar guardada la versión anterior; una escritura diferida no sobrescribe un guardado posterior |
| `src/workspaces/imports/incorporacion/incorporacion.test.tsx` | 2 | Asistente completo con el escenario: etapas, roles, decisiones trazadas, volver atrás, confirmación, incorporación, 2026 intacto, deshacer. Reinicio con guardado fallido: el cuadro sigue abierto, sin repetir la operación, y se cierra al reintentar con éxito |
| `src/domain/c1c.test.ts` | +4 | SHA-256 (vectores y node:crypto), traza v2, compatibilidad v1, mismo archivo en dos municipios |
