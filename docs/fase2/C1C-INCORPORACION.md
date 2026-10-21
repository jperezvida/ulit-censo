# C1c · Incorporación atómica y reversible del censo histórico

> **Alcance autorizado:** solo C1c, con datos ficticios.
> - **No** se han implementado C1d (interfaz de decisiones), C2 ni C3.
> - No hay ninguna pantalla para importar archivos: el núcleo se usa desde pruebas y desde una simulación en memoria.
> - No se conecta Supabase ni ningún servicio remoto.
> - No se guardan los bytes del XLSX, en ningún almacenamiento.
> - No se modifica la campaña 2026.

## 1. Principio

El censo histórico es una **referencia**. Incorporarlo:
- crea una **campaña histórica nueva** (`tipo: 'historico-importado'`);
- **nunca** sobrescribe 2026 ni ninguna otra campaña;
- **nunca** convierte datos históricos en verificaciones actuales.

Nada queda revisado, verificado, validado ni confirmado.

| Concepto | Entidad | Cómo se crea |
|---|---|---|
| Fila original del Excel | `RegistroOrigen` | **Siempre**, una por fila, también con celdas inválidas o si se excluye por decisión |
| Registro histórico incorporado | `Observacion` de la campaña histórica | Si la calle tiene correspondencia segura y se sabe si el local está vacío u ocupado; `verificacion: 'pendiente'` |
| Local físico | `LocalFisico` | **Solo** si la dirección es inequívoca (sección 3) o lo decide una persona |
| Negocio | `Negocio` | Si el local está ocupado, tiene nombre y su calle es conocida. Nombre literal, **sin** cadena |
| Ocupación en la campaña | `Ocupacion` | Solo con local. Se abre y se **cierra** en la campaña histórica, con la fecha real si consta |
| Correspondencia registro ↔ local | `VinculoHistorico` | Una por fila no excluida, con su confianza: `probable`, `confirmada` (decisión humana), `dudosa` o `sin-vinculo` |
| Huella, perfil, resultado y traza | `Importacion` (+ `c1`) | SHA-256, perfil y versión, columnas exactas, decisiones, firma del plan y entidades creadas |
| Franquicia 2025 | `FranquiciaCampana` | Solo valores 0/1 válidos, `origen: 'importado'`, en la campaña histórica |
| Presencia digital 2025 | `RevisionDigital` | Solo celdas válidas sin incidencias; `estado: 'borrador'` y cada dato con `origen: 'importado'` |
| Clasificación 2025 | Texto literal en `RegistroOrigen.original` | `ClasificacionCampana` **solo** con una equivalencia aprobada, y siempre `confirmada: false` |

No se crean `Revision` para la campaña histórica. La revisión de 2026 sigue pendiente en todos sus ejes.

## 2. `RegistroOrigen.datos`: análisis y ampliación compatible

`datos: Record<string, string>` **pierde información**:
- el tipo: 4 y «4» se confunden, y una fecha se guarda como texto;
- el formato: `dd/mm/yyyy`;
- la diferencia entre vacío y texto de espacios;
- los errores de Excel y las fórmulas.

Por eso se ha ampliado el tipo con **campos opcionales**. Las importaciones anteriores siguen siendo válidas, no cambia `VERSION_DATOS` y no hay migración:
- `original`: cada celda como `CeldaOriginal` (tipo, valor, formato y si procede de una fórmula), por clave del perfil. Es la misma capa original de C1b, sin pérdidas; una prueba la compara celda a celda.
- `interpretacion`: la interpretación de C1b sin confirmar nada:
  - celdas no triviales (estado, regla y valor), estado del local, Nº redes calculado y diagnóstico de clasificación;
  - las celdas válidas por lectura directa no se repiten: se deducen del original con la misma regla.
- `huellaFila`: huella del contenido original, para detectar cambios al reimportar.
- `exclusion`: persona, fecha y motivo, si una persona la excluyó. La fila se conserva igualmente.
- `datos` se mantiene para la vista «Fila original» existente: cabecera → texto.

`Importacion.c1` (`TrazaIncorporacion`) guarda:
- SHA-256, perfil y versión, hoja y año;
- columnas con su cabecera exacta;
- quién la aplicó y las decisiones recibidas;
- firma del plan;
- las entidades **creadas**, con la huella de su contenido;
- las entidades **modificadas** (ninguna);
- la marca de deshecha.

## 3. Correspondencias (nunca se inventan)

La calle solo se reconoce por **coincidencia exacta y única** del nombre normalizado con el callejero del municipio. No hay aproximaciones.

| Situación de la fila | Correspondencia | Resultado |
|---|---|---|
| Calle única, número concreto, dirección única en el archivo y sin locales previos en ella | **inequívoca** | Local nuevo, observación, ocupación cerrada en 2025 y vínculo `probable`, pendiente de conciliar con otras campañas |
| Calle sin correspondencia en el callejero | sin vínculo | Solo registro y vínculo `sin-vinculo`. No se crea calle, local, observación ni negocio |
| Nombre de calle que coincide con varias calles | sin vínculo | Ídem |
| Número desconocido | sin vínculo | Registro, observación sin local y vínculo `sin-vinculo` |
| «S/N» | ambigua | Registro, observación **sin local** y vínculo `dudosa` |
| Misma calle y número en varias filas del archivo | ambigua | **No** se crean ni uno ni dos locales: observaciones y negocios sin local, vínculo `dudosa`. No se decide si son dos locales |
| Ya existe un local en esa dirección | ambigua | **No** se reutiliza automáticamente: vínculo `dudosa` con el local como candidato |
| «Local Vacío» inválido o vacío | ambigua | Registro y vínculo `dudosa`, sin observación ni ocupación: no se deduce si está vacío |
| Decisión humana firmada | decidida | `local-nuevo` o `local-existente`; vínculo `confirmada` con `revisadoPorId` |

Las ocupaciones importadas se **cierran en la propia campaña histórica** (`hastaCampanaId`). La consulta de ocupaciones del modelo es por año, así que una ocupación abierta de 2025 podría alterar la vista de 2026 o de otra campaña de 2025. Por la misma razón:
- se rechaza vincular por decisión a un local que ya tenga una ocupación de otra campaña del mismo año, hasta conciliarlas;
- una prueba compara la vista completa de 2026 antes y después: filas de Oficina, referencia 2025, ocupaciones, revisiones, digital, clasificaciones, franquicias, itinerarios y observaciones.

## 4. Plan de incorporación

`planificarIncorporacion(db, interpretacion, destino, decisiones)` no modifica nada. Devuelve:
- **origen:** archivo, SHA-256, perfil, hoja y municipio;
- **destino:** la campaña histórica nueva (id, año y nombre);
- **registros:** previstos, excluidos por decisión y filas candidatas a excluir (decididas o no);
- **entidades nuevas** por colección;
- **correspondencias:** inequívocas, decididas, ambiguas, sin vínculo y excluidas, con sus motivos y un detalle por fila;
- **incidencias pendientes:** de C1b, por gravedad y tipo;
- **decisiones aplicadas** y lista de **pendientes:**
  - reglas no autorizadas;
  - posibles totales sin decidir;
  - ambiguas y sin vínculo;
  - clasificaciones sin equivalencia;
- **reimportación**, si la hay: filas iguales, cambiadas, nuevas y desaparecidas;
- **bloqueos** y **firma** del plan.

`prepararIncorporacion(db, bytes, nombre, destino, decisiones)`:
- lee con el lector seguro (límites de C1a);
- interpreta con C1b usando **solo** las decisiones recibidas;
- planifica.

Si la interpretación se hizo con otras reglas, el plan se bloquea (`interpretacion-incoherente`).

## 5. Decisiones (resueltas fuera de C1c)

C1c **recibe** decisiones; no las toma ni las inventa, y por defecto no aplica ninguna. Cada una exige una persona existente y una fecha; si no, el plan queda bloqueado (`decision-invalida`).

| Decisión | Efecto |
|---|---|
| `reglasAutorizadas` | Reglas de clase «propuesta» de C1b (p. ej. «3,5 m» → 3,5). Rechaza reglas de otra clase |
| `diccionarioAprobado` | Textos «sin información» aprobados («sin dato», «s/i») |
| `exclusiones` | Fila, motivo, persona y fecha. Excluye la fila de la aplicación operativa; su registro de origen se conserva con la exclusión |
| `correspondencias` | `local-nuevo` o `local-existente` por fila (conciliación de direcciones) |
| `equivalenciasClasificacion` | Combinación histórica → nodo existente del catálogo; crea una `ClasificacionCampana` importada y **sin confirmar** |

Sin decisiones:
- «3,5 m», «sin dato» y «s/i» quedan en el registro y no llegan al modelo;
- las posibles filas de totales se incorporan como registros;
- las direcciones ambiguas quedan sin local;
- ninguna clasificación 2025 se asigna al catálogo 2026.

## 6. Transacción atómica

`aplicarIncorporacion(db, interpretacion, destino, decisiones, planAprobado, { porId })`:
1. **Valida.** Recalcula el plan sobre la base actual y exige que su **firma** coincida con la del plan aprobado. Si la base o el archivo cambiaron, se rechaza. Si el plan tiene bloqueos, no aplica nada.
2. **Aplica sobre una copia de trabajo.** Solo copia las colecciones afectadas. La base original nunca se modifica, y un identificador duplicado aborta.
3. **Comprueba la integridad referencial** de todo lo creado:
   - registros de la importación;
   - local → municipio y calle;
   - observación → campaña, calle, local y negocio;
   - ocupación → local, negocio, campañas y observación;
   - vínculo → registro, local y candidatos;
   - franquicia, digital y clasificación → negocio y campaña.

   Además exige que ninguna clasificación esté confirmada y ningún dato digital esté verificado. Si falla, no se publica nada.
4. **Registra la traza** (`Importacion.c1`) con las entidades creadas y la huella de cada una.

Las pruebas provocan un fallo a mitad (tras 30 filas) y comprueban dos cosas:
- la base queda idéntica;
- el almacén de la aplicación (`store.aplicar`) no cambia.

## 7. Deshacer

`deshacerIncorporacion(db, importacionId, porId)` retira **exactamente** lo creado. Se **bloquea**, sin tocar nada y listando los motivos, si:
- alguna entidad creada **ha cambiado** (su huella no coincide) o **ya no existe**;
- otra entidad **posterior** referencia lo importado:
  - observaciones, ocupaciones, vínculos, revisiones, franquicias, datos digitales o clasificaciones sobre locales o negocios importados;
  - itinerarios, coberturas u otras importaciones en la campaña histórica;
  - una campaña que la use como referencia.

Al deshacer:
- todas las colecciones vuelven a su estado anterior; una prueba lo compara por JSON;
- la `Importacion` se conserva como `descartada`, con quién y cuándo la deshizo;
- se puede volver a incorporar el archivo, con otro identificador de importación.

**La secuencia global no retrocede.** Deshacer restaura las colecciones afectadas, pero **no** devuelve `db.secuencia` (el contador global de orden de observaciones y ocupaciones) a su valor anterior. Es la opción más segura por tres motivos:
- **Ningún número de orden se reutiliza.** Los números ya emitidos pueden seguir existiendo fuera de la base: en la pila de deshacer de la aplicación, en otra copia o en la cola de sincronización. Reutilizarlos haría ambiguo el desempate.
- **Lo que se registre después ordena siempre detrás.** Esto vale tanto para un trabajo posterior como para una nueva incorporación del mismo archivo.
- **El hueco que queda es inocuo.** El orden solo desempata cuando la fecha real no decide, y nunca sustituye a la cronología.

Una prueba lo comprueba en tres pasos:
1. Tras deshacer, la secuencia conserva su valor.
2. La siguiente incorporación empieza en el número siguiente.
3. No reutiliza ningún número ya emitido.

## 8. Reimportación

**Ámbito** de una incorporación: municipio, año de destino (y campaña, si se indica expresamente) y perfil. **Identidad**: ámbito, SHA-256 del archivo y **versión** del perfil. Las referencias de fila (`huellaFila`) detallan las diferencias.

| Caso | Resultado |
|---|---|
| Mismo ámbito, mismo SHA-256 y misma versión del perfil | **Reimportación idéntica**: resultado controlado (`sinCambios: true`, la base no cambia) y el plan informa de la importación existente. No duplica nada |
| Mismo ámbito con **otro archivo** o con **otra versión del perfil** | Bloqueo `archivo-distinto`, «exige una nueva conciliación», con filas iguales, cambiadas, nuevas y desaparecidas. No sobrescribe el histórico |
| **Mismo archivo en otro año** histórico | **No** es la misma incorporación: se puede aplicar, con otra campaña y otro identificador de importación. El plan lo avisa entre los pendientes para comprobar que el año es correcto |

El identificador de la importación incluye el año (`imp-c1-<año>-<sha>`), de modo que dos años no colisionan.

## 9. Simulación con el Excel ficticio de Medina 2025

```
npm run simular-incorporacion -- CENSO_MEDINA_2025_FICTICIO.xlsx [--calles=90]
```
- Funciona en memoria, sobre la base de demostración más un callejero **ficticio** «VÍA FICTICIA 001…090».
- El libro tiene 93 vías: 3 se dejan sin correspondencia a propósito.
- No guarda nada.

**Resultado:**

| Concepto | Resultado |
|---|---|
| Registros de origen | **889** (todas las filas; ninguna exclusión) |
| Correspondencias inequívocas → locales nuevos | **852** |
| Ambiguas (sin local) | **6** «S/N» |
| Sin vínculo | **31**: 30 en las 3 vías sin correspondencia y 1 con número desconocido |
| Observaciones | 859: 852 con local y 7 sin local |
| Ocupaciones (cerradas en 2025) | 852 |
| Negocios | 588 (ocupados con nombre y calle conocida) |
| Franquicias importadas / revisiones digitales en borrador | 588 / 588 |
| Clasificaciones 2026 | **0**: no hay equivalencias aprobadas; los textos de 2025 se conservan |
| Incidencias de C1b pendientes | 452 |
| Pendientes sin aplicar | «3,5 m», «sin dato»/«s/i», 6 ambiguas, 31 sin vínculo y 588 clasificaciones sin equivalencia |
| Entidades existentes modificadas | **ninguna** |
| Campaña 2026 | intacta |
| Reimportación idéntica | `reimportacion-identica`, sin cambios, 889 filas iguales |
| Deshacer | todas las colecciones vuelven a su estado anterior; la importación queda `descartada` |

Con el callejero real de la demostración, sin vías ficticias (`--calles=0`):
- las 889 filas quedan **sin vínculo**;
- solo se crean la campaña, 889 registros y 889 vínculos;
- no se inventa ninguna calle.

## 10. Rendimiento y persistencia (10.000 filas sintéticas)

Prueba automática, en Node con IndexedDB simulada:

| Paso | Tiempo |
|---|---|
| Lectura segura, interpretación y plan | ≈ 1,7 s |
| Aplicación atómica | ≈ 1,3 s |
| Guardado y lectura en IndexedDB de **toda** la base (70 MB en JSON, de los que unos 20 MB son la demostración) | ≈ 3,1 s |
| Deshacer | ≈ 0,5 s |

Una incorporación ocupa unos **5 KB por fila**. Un censo de unas 900 filas son unos 4,5 MB.

Los mayores consumidores son:
- el registro de origen fiel (original e interpretación);
- los datos digitales;
- la traza de huellas para deshacer.

Si los censos reales fueran mucho mayores, convendría:
- guardar `datos` solo en importaciones antiguas;
- comprimir la traza.

Queda como propuesta; no se ha aplicado.

## 11. Pruebas (`src/domain/c1c.test.ts`, 25)

- **Plan:**
  - no modifica la base;
  - contiene todos los apartados;
  - bloquea un año en curso y las decisiones sin firmar o inventadas;
  - exige coherencia con la interpretación.
- **Incorporación:**
  - 2026 y la referencia 2025 existente quedan intactas;
  - la campaña histórica es nueva;
  - las ocupaciones quedan cerradas.
- **Filas y originales:**
  - se conservan todas, con tipo y formato;
  - las celdas inválidas se conservan;
  - `datos` sigue siendo compatible.
- **Ocupados y vacíos:**
  - nombre literal, sin cadena;
  - ocupación con fecha real;
  - nada revisado, verificado ni confirmado.
- **Inválidos y pendientes:**
  - no llegan al modelo;
  - con una regla firmada sí llegan, y queda trazada;
  - una equivalencia aprobada crea la clasificación importada sin confirmar.
- **Correspondencias:**
  - una dirección repetida no crea locales; una decisión humana puede separarlos;
  - un local existente se propone como candidato, sin reutilizarlo; con decisión se vincula, salvo conflicto de año;
  - una calle sin correspondencia conserva solo el registro.
- **Posibles totales:** se incorporan por defecto; una exclusión firmada conserva el registro con la marca.
- **Reimportación:**
  - la idéntica es controlada;
  - la de un archivo modificado se bloquea, con la fila cambiada identificada;
  - el mismo archivo en dos años históricos son dos incorporaciones distintas, y cada año reconoce solo la suya como idéntica;
  - el mismo archivo con otra versión del perfil exige conciliación.
- **Atomicidad:** un fallo a mitad no deja cambios (tampoco en el almacén); un plan obsoleto se rechaza.
- **Integridad referencial** de todo lo creado y completitud de la traza.
- **Deshacer:**
  - completo, comparando por JSON, y repetible después;
  - bloqueado ante un negocio renombrado, una observación posterior, una clasificación manual o un registro borrado;
  - la secuencia global no retrocede ni se reutiliza.
- **Perfiles:** el de 28 columnas también funciona.
- **Volumen:** 10.000 filas, incluido el guardado en IndexedDB y el deshacer.

## 12. Pendiente

- **C1d:** pantalla del plan y de las decisiones (exclusiones, correspondencias, reglas, diccionario y equivalencias), aplicación y deshacer desde la interfaz.
- **Cátedra:**
  - decisiones 1, 2 y 3;
  - decisión 5 (direcciones repetidas);
  - decisión 6 (estado de revisión de los históricos; aquí todo queda pendiente).
- **Conciliación entre campañas:** relacionar los locales importados con los de otras campañas. Hoy los vínculos de las filas inequívocas quedan `probable`.
- **Valladolid:** sin correspondencia territorial verificada (Distrito, Zona y CP se conservan como dato original).
- **Almacenamiento de los archivos originales:** sigue sin decidir; C1c guarda solo la huella.
