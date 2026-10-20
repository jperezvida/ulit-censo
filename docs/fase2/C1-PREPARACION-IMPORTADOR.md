# C1 · Preparación del importador de censos históricos

> **Estado:** análisis previo. **No** se ha programado C1, C2 ni C3, ni se ha modificado el exportador provisional.
>
> **Revisión tras las observaciones de la Cátedra (C1a autorizado):**
> 1. Los originales de Medina 2025, Valladolid 2024 y Medina 2026 usan etiquetas OOXML **sin prefijo**. El prefijo `x:` procede del libro ficticio de pruebas. El lector de C1a usa ExcelJS y solo adapta, de forma acotada y probada, el XML válido con prefijo. Véase [`C1A-COMPATIBILIDAD.md`](C1A-COMPATIBILIDAD.md).
> 2. Las cifras de clasificaciones del libro ficticio son de una **simulación**: no se extrapolan al censo real.
> 3. Una dirección repetida con negocios distintos **no demuestra** que existan dos locales físicos. Se conservan todas las filas y la correspondencia física queda pendiente de conciliación cuando no sea inequívoca (sección 8 corregida).
> 4. La conservación de los archivos originales queda sin implementar hasta aprobar una propuesta (sección 10 de `C1A-COMPATIBILIDAD.md`).
>
> **Fuentes:**
> - `CENSO_MEDINA_2025_FICTICIO_PARA_CLAUDE.xlsx`: 889 registros **ficticios**, analizado fuera del repositorio y no incorporado a él.
> - El perfil estructural sin registros del Excel real de Medina 2025 y de un itinerario de Medina 2026, ya aportado en la fase 2.
> - La descripción del itinerario 10 de Valladolid (2024) que ha facilitado la Cátedra. El archivo **no** se ha recibido.
>
> Las filas citadas (p. ej. «fila 11») son del libro ficticio.

## 1. Resumen

1. El libro tiene tres hojas:
   - **Datos**: 889 filas y 27 columnas, con cabecera en la fila 1 y paneles inmovilizados en G2.
   - **Hoja1**: 6 listas independientes.
   - **Tablas Dinámicas**: resumen estático, sin fórmulas ni caché de tabla dinámica.

   Solo «Datos» es fuente de registros.
2. **El lector de B0 no abría el libro ficticio** (corregido en C1a). ExcelJS falla con «Cannot read properties of undefined (reading 'sheets')».
   - La causa comprobada es el XML de SpreadsheetML con **prefijo de espacio de nombres** (`<x:worksheet>`, `<x:workbook>`). Es válido en OOXML y lo generan herramientas como Open XML SDK.
   - Si se quitan los prefijos (sobre una copia), ExcelJS lo lee. Las rutas absolutas de las relaciones (`/xl/workbook.xml`) no son el problema.
   - Las cadenas están como `t="str"` y no como cadenas compartidas.
   - **Los originales de la Cátedra no usan prefijo** (comprobado por la Cátedra): el prefijo procede del libro ficticio. C1a mantiene ExcelJS con una adaptación acotada para el XML con prefijo.
3. **El libro reproduce las anomalías del perfil real.** Los mismos valores imposibles en campos 0/1 (4, 23, 247, 379) y las mismas variantes de escritura indican que es un buen banco de pruebas.
4. **En el libro FICTICIO (simulación, no extrapolable al censo real), de los 609 locales ocupados unos 232 tienen una clasificación directamente válida en el catálogo 2026.**
   - Otros 178 son diferencias de estructura, no errores: en Servicios, la «Actividad» de 2025 corresponde a un ejemplo o descripción en 2026.
   - Unos 199 tienen errores o lagunas reales.
5. **El importador CSV provisional (B0/B2) no debe reutilizarse tal cual.** Hay tres problemas:
   - `valorBooleano` convierte cualquier número distinto de 0 en «Sí», de modo que 83 pasaría a ser 1.
   - Convierte el vacío en «No».
   - Asigna la columna «Franquicia» al campo de texto «cadena».
6. **El libro ficticio no contiene direcciones repetidas.** Valladolid sí las tiene, así que habrá que fabricar ese caso en las pruebas.

## 2. Esquema de las 27 columnas (hoja «Datos»)

La cabecera **original exacta** se conserva siempre. «Clave» es la forma normalizada que sirve para reconocerla. «Destino» indica dónde iría el dato en el modelo interno; no es una columna de salida.

| # | Cabecera original | Tipo esperado | Observado en el ficticio | Destino interno propuesto |
|---|---|---|---|---|
| 1 | `Fecha censo` | Fecha (número de serie de Excel con formato `dd/mm/yyyy`) | 888 fechas (05/01/2025–20/11/2025, sin hora); 1 texto «FECHA PENDIENTE» (fila 24) | `Observacion.fecha`; si es texto o vacío, queda ausente con incidencia (nunca se inventa) |
| 2 | `Distrito` | Código territorial (entero o texto, según municipio) | 889 vacías | Atributo territorial de la dirección, según la configuración municipal |
| 3 | `Zona` | Código territorial | 889 vacías | Ídem |
| 4 | `CP` | Código postal de 5 dígitos | 889 = 47400 (numérico) | Atributo territorial; se guarda como texto de 5 dígitos para no perder ceros iniciales en otros municipios |
| 5 | `Dirección` | Texto (nombre de vía) | 93 vías ficticias, sin espacios sobrantes | `Calle` por correspondencia con el callejero; se conserva el texto original |
| 6 | `Num` | Entero o texto con sufijo | 873 enteros; 6 «S/N»; 6 «N B» («6 B»…); 4 vacías (filas 193, 384, 575, 766) | `Direccion.numero` + `sufijo`; «S/N» y vacío pasan a `null` con motivo distinto |
| 7 | `Local Vacío` | 0/1 | 609 ceros, 280 unos; ninguna vacía (el perfil real tiene 1) | `Ocupacion.negocioId = null` si es 1; vacío o inválido: incidencia, sin deducirlo |
| 8 | `Long fachada` | Decimal en metros | Solo en vacíos: 265 numéricos + 1 texto «3,5 m» (fila 6); 14 vacíos sin dato; nunca en ocupados | `Ocupacion.metrosFachada` |
| 9 | `Nombre del negocio` | Texto | 609 nombres en ocupados; vacío en todos los vacíos | `Negocio.nombre` |
| 10 | `GrActividad` | Lista (Hoja1) | Comercio 242 · Servicios 277 · Hostelería y Restauración 90 | Clasificación histórica (texto original) |
| 11 | `Gr Comercio` + **56 espacios finales** | Lista, solo en Comercio | 7 variantes por mayúsculas («Otros Equipamientos» 74 / «Otros equipamientos» 21…); 14 de Comercio sin valor | Ídem |
| 12 | `Subgrupo de actividad` | Lista | 63 valores distintos; 16 ocupados sin subgrupo | Ídem |
| 13 | `Actividad` | Lista | 114 valores distintos; 91 ocupados sin actividad | Ídem |
| 14 | `Descripción` | Texto libre: descripción **de la actividad**, no del negocio | 256 (203 con actividad, 53 sin ella) | Descripción de la clasificación histórica |
| 15 | `Franquicia` | 0/1 | 0: 542 · 1: 67 | `FranquiciaCampana` (origen «importado») |
| 16 | `web` | 0/1 | 1 valor **4** (fila 11) | `RevisionDigital.datos.web` |
| 17 | `Google My Bussines` (sic) | 0/1 | 1 valor **4** (fila 58) | `googleBusiness` |
| 18 | `Vende internet` | 0/1 | 1 valor **4** (fila 109) | `ventaOnline` |
| 19 | `Nº reseñas Google` | Entero ≥ 0 | 0–620; 4 casos con Google = 1 y 0 reseñas (admisible) | `numResenas` |
| 20 | `Responde reseñas G` | 0/1 | 1 valor **23** (fila 161) | `respondeResenas` |
| 21 | `Instagram` | 0/1 | Correcto | `instagram` |
| 22 | `segu Insta` | Entero ≥ 0 | 0–11.452; 1 texto «sin dato» | `seguidoresInstagram` |
| 23 | `Facebook` | 0/1 | 1 valor **247** (fila 214) | `facebook` |
| 24 | `Segu F` | Entero ≥ 0 | 0–7.945; 1 texto «s/i» | `seguidoresFacebook` |
| 25 | `Twitter` | 0/1 | 1 valor **379** (fila 273) | `twitter` |
| 26 | `Segu T` | Entero ≥ 0 | 0–2.999 | `seguidoresTwitter` |
| 27 | `Nº redes` | Entero calculado (IG + FB + X) | **380** en la fila 332; incalculable en las filas 214 y 273 por binarios inválidos | **No se importa como dato**: se guarda el valor original y se recalcula, con aviso de discrepancia |

Coherencias que sí se cumplen en el ficticio:
- Ningún vacío tiene nombre ni datos de negocio, y ningún ocupado carece de nombre.
- Ninguna red con valor 0 tiene seguidores mayores que 0.
- Ningún negocio sin Google tiene reseñas.

El importador debe comprobarlas igualmente, porque el perfil real muestra filas con vacíos sueltos en los binarios (607, 606 y 605 rellenos frente a 609 ocupados).

## 3. Hoja1 y Tablas Dinámicas

- **Hoja1** contiene 6 columnas independientes:

  | Columna | Contenido |
  |---|---|
  | `NÚMERO` | 1–200, numeración auxiliar |
  | `LOCAL VACÍO` | 0/1 |
  | `GR ACTIVIDAD` | 3 valores |
  | `GR COMERCIO` | 4 valores |
  | `SUBGRUPO ACTIVIDAD` | 53 entradas, 52 distintas: «Bazar y Menaje» repetido |
  | `ACTIVIDAD` | 156 entradas, 153 distintas: «Calzado», «Electrodomésticos» y «Otros» repetidos |

  - **Las celdas de una misma fila no forman una jerarquía.** La fila 2 es «Comercio · Alimentación · Agencias de Viajes · Academias».
  - Las listas coinciden exactamente con las de `Hoja1` ya registradas en el repositorio (`HOJA1_SUBGRUPOS`, `HOJA1_ACTIVIDADES`).
  - Uso propuesto: **vocabulario histórico** para reconocer y señalar valores (p. ej. «fuera de lista»). Nunca sirve como jerarquía ni como catálogo 2026.
- **Tablas Dinámicas**: el título indica que es una simulación. Sus totales cuadran con «Datos» (Comercio 242 con 29 franquicias; Servicios 277 con 32…).
  - Se excluye siempre como origen.
  - En los archivos reales puede contener cachés desactualizadas: como mucho se cita en el informe de importación como «hoja de resumen ignorada».

## 4. Clasificaciones de 2025 frente al catálogo 2026 (609 ocupados del libro ficticio)

> Cifras de una **simulación**: sirven para diseñar las reglas, no para estimar la calidad del censo real.

| Situación | Locales | Tratamiento |
|---|---:|---|
| Válida en 2026 tal cual (sin distinguir mayúsculas ni tildes) | 185 | Propuesta directa |
| Subgrupo sin actividades (Servicios, Discotecas), válido | 39 | Propuesta directa |
| Válida, pero falta el «Gr Comercio» (deducible del subgrupo) | 8 | Propuesta con aviso |
| **Servicios: la «Actividad» 2025 es un ejemplo del documento 2026** (Fisioterapia, Gimnasios…) | 128 | Pasa a descripción del subgrupo (diferencia de estructura, no error) |
| Servicios: la «Actividad» 2025 no figura entre los ejemplos 2026 (Residencias de ancianos, Asesorías…) | 50 | Descripción del subgrupo; revisión humana |
| Subgrupo de **otro grupo de actividad** (p. ej. «Servicios › Bares y Cafeterías › Bar») | 87 | Incoherente: se señala |
| Actividad que **no pertenece** al subgrupo (p. ej. «Restaurantes › Bar», «Bares y Cafeterías › Bancos») | 49 | Incoherente: se señala |
| Grupo de comercio que no corresponde al subgrupo | 15 | Incoherente: se señala |
| Subgrupo con actividades, pero sin actividad ni descripción | 31 | Incompleta |
| Sin subgrupo | 16 | Incompleta |
| Subgrupo inexistente en 2026 | 1 | Se señala |

Además aparecen variantes de escritura («Mobilario», «Frutas y verduras», «Peluquerias», «fisioterapia»). El perfil real añade valores fuera de lista como «Bancas y finanzas», «Asesorias» o «Veterinario».

**Propuesta:**
- Importar la clasificación de 2025 **como texto histórico** (los cuatro niveles más la descripción, con su estado de coherencia), separada de `ClasificacionCampana`.
- **No** forzarla a nodos de ningún catálogo.
- El paso a 2026 solo se produce con «Partir de 2025» (B5): una equivalencia aprobada por la Cátedra o una elección humana. Nunca se reasigna automáticamente una combinación incoherente.

## 5. Medina del Campo frente a Valladolid

| Aspecto | Medina 2025 (municipal) | Medina 2026 (itinerario, perfil real) | Valladolid 2024 (itinerario 10) |
|---|---|---|---|
| Hoja de datos | «Datos» | «Datos 25» | «Datos» |
| Columnas | 27 | **28**: «Municipio», «itinerario», «Orden Par» en lugar de «Distrito»/«Zona» | 27, mismo contenido que Medina |
| Cabecera «Gr Comercio» | Con 56 espacios finales | Sin espacios | Por confirmar (texto exacto) |
| Otras hojas | Hoja1, Tablas Dinámicas | Por confirmar | Hoja1, «Tablas dinamicas» (otra grafía) |
| Registros | 889 | 105 | 362 |
| Distrito / Zona | Vacíos **por regla** municipal | No existen como columnas | Vacíos en el archivo **por falta de dato**, aunque hoy son necesarios |
| CP | 47400 en todas las filas | Relleno | Vacío en las 362 filas |
| Calle + número repetidos | Ninguno en el ficticio | — | Sí (no autoriza a deduplicar) |
| Binarios con valores imposibles | Sí (4, 23, 247, 379) | No en el perfil | Sí (texto u otros números) |
| Aceras | Ambas en cada calle del itinerario | — | Por confirmar |
| Resultado | Un único Excel municipal | Seguimiento por itinerario, consolidado después | Por confirmar (¿un Excel municipal?) |

Conclusión: el importador necesita **perfiles de estructura versionados** para el histórico municipal de 27 columnas y para el itinerario de 2026 de 28 columnas, además de **reglas territoriales por municipio**. No basta con un único juego de cabeceras.

## 6. Reglas territoriales configurables por municipio

Se propone una configuración por municipio y campaña (con versión, autor y fecha), por ejemplo:

```ts
interface ConfigTerritorial {
  cp:       { uso: 'fijo' | 'por-direccion' | 'manual'; valor?: string; obligatorio: boolean };
  distrito: { uso: 'no-se-usa' | 'tabla-verificada' | 'manual'; obligatorio: boolean; dominio?: string[] };
  zona:     { uso: 'no-se-usa' | 'tabla-verificada' | 'manual'; obligatorio: boolean; dominio?: string[] };
  aceras:   'ambas' | 'segun-itinerario';
  resultado: 'excel-unico-municipal';
}
```

- **Medina:**
  - Distrito y Zona: `no-se-usa`. Quedan vacíos sin incidencia y nunca se rellenan con un valor ficticio.
  - CP: `fijo` 47400.
  - Aceras: ambas.
- **Valladolid:**
  - Distrito y Zona: `tabla-verificada` o `manual`, y obligatorios en las campañas actuales.
  - CP: `por-direccion`.
- Reglas comunes:
  - **Distrito, Zona y CP son independientes.** Ninguno se deduce de otro ni del nombre de la calle.
  - Una tabla de correspondencia solo vale si está **verificada**: con fuente, fecha y versión, y definida por tramo de vía, paridad y rango de números cuando haga falta.
  - La asignación manual queda trazada (persona, fecha, motivo).
  - En una importación histórica, la ausencia se conserva como **ausente**. Solo se abre incidencia en las campañas donde el campo es obligatorio.
  - Se guardan como atributos de la dirección con vigencia por campaña, del mismo modo que la numeración (`Direccion.desdeCampanaId`), y con su origen (importado, tabla o manual).

## 7. Problemas que el importador debe detectar

- **Libro y hoja:**
  - XML con prefijos de espacio de nombres o rutas absolutas;
  - archivo dañado o protegido;
  - varias hojas candidatas o ninguna;
  - hojas de resumen o tablas dinámicas;
  - filas o columnas ocultas, celdas combinadas, filtros, fórmulas, valores de error (`#N/A`).
- **Cabeceras:**
  - faltantes, sobrantes, duplicadas o en otro orden;
  - espacios finales o dobles, mayúsculas, tildes;
  - alias conocidos («Bussines» / «Business»).

  Se tolera lo irrelevante, pero se informa de cada diferencia y **no** se altera la cabecera original guardada.
- **Valores:**
  - fecha en texto o fuera del periodo de la campaña;
  - `Num` «S/N», con sufijo, decimal (`12.0`) o vacío;
  - medidas con unidad («3,5 m»);
  - binarios fuera de {0, 1}, incluidas las variantes `0.0/1.0` y `"0"/"1"`;
  - seguidores o reseñas en texto o negativos;
  - `Nº redes` distinto de IG + FB + X;
  - seguidores mayores que 0 con la red a 0;
  - reseñas sin Google;
  - local vacío con datos de negocio, u ocupado sin nombre;
  - `Local Vacío` en blanco.
- **Clasificación:** los casos de la sección 4 y los valores fuera de las listas de Hoja1.
- **Territorio:** Distrito, Zona o CP ausentes cuando son obligatorios; CP distinto del fijo del municipio; códigos fuera del dominio configurado.
- **Duplicados aparentes:** véase la sección 8.
- **Final del bloque:** filas en blanco intercaladas y filas de totales al final de «Datos».

## 8. Tratamiento propuesto

**Principios:**
- No se descarta ninguna fila.
- No se convierte ningún valor sin una regla explícita.
- Todo queda trazado.
- Las decisiones las toma una persona.

- **Campos vacíos:**
  - En un **local vacío**, las columnas del negocio vacías significan «no aplica».
  - En un **ocupado**, un binario vacío significa «sin dato», es decir, pendiente. **Nunca** es 0.
  - Distrito, Zona y CP siguen la configuración territorial (sección 6).
  - Una fecha vacía queda ausente.
- **Valores inválidos:**
  - Un 0/1 con 4, 23, 83, 226, 247, 379 o 3001 se guarda como **valor original con estado «inválido»**. En el modelo queda sin respuesta, con una incidencia por fila y campo. **Nunca** pasa a 1.
  - Los textos de seguidores («sin dato», «s/i») solo se interpretan como «sin información» mediante un **diccionario explícito** aprobado por la Cátedra. Cualquier otro texto se trata como inválido.
  - «3,5 m» se interpreta con un patrón explícito (número y unidad «m»), dejando constancia de la transformación.
  - `Nº redes` se recalcula y se conserva el original. Si difieren, se señala.
- **Duplicados aparentes:**
  - **Nunca** hay deduplicación automática.
  - Misma calle y número **con nombres distintos**: pueden ser locales distintos, una sustitución de actividad o un duplicado. **No demuestra que haya dos locales físicos.** Se conservan ambas filas de origen y la correspondencia física queda **pendiente de conciliación** cuando no sea inequívoca.
  - Misma calle, número y nombre: «posible duplicado». Se conservan ambas filas y lo resuelve la conciliación de B2.
  - Fila idéntica en las 27 columnas: «duplicado exacto probable», con decisión humana antes de aplicar.
  - Se conserva siempre el número de fila de origen y el orden.

## 9. Propuesta técnica para C1 (compatible con B0–B5)

1. **Lector (solo lectura).** *Decidido en C1a tras comprobar ExcelJS:* se mantiene ExcelJS, con una adaptación acotada y probada solo para el XML con prefijo. Lo que sigue era la alternativa inicial, que ya no se aplica. Lector propio basado en `jszip` o `fflate` y un análisis XML que respete los espacios de nombres. Debe leer:
   - valores, tipos y formatos de número;
   - hojas visibles u ocultas y celdas combinadas.

   ExcelJS se mantiene para escribir (C3). Alternativa: normalizar los prefijos en memoria sobre una copia antes de ExcelJS, que es más frágil. Se descarta SheetJS por su distribución fuera de npm.
2. **Archivo original intacto.** Se registran nombre, tamaño y SHA-256, nunca en el repositorio. *Revisado:* no se guardan los bytes hasta aprobar una propuesta de capacidad, seguridad, conservación y recuperación (sección 10 de `C1A-COMPATIBILIDAD.md`; `localStorage` no es adecuado).
3. **Detección de la hoja por estructura.**
   - Se puntúa cada hoja según cuántas cabeceras normalizadas del perfil aparecen en sus primeras 10 filas.
   - No depende del nombre ni de la posición.
   - Las hojas de resumen («Etiquetas de fila», «Total general», «Cuenta de…») se descartan con motivo.
   - Si hay empate o dudas, la persona elige.
4. **Perfiles de estructura versionados** (`censo-municipal-27@v1`, `itinerario-2026-28@v1`).
   - Cada columna lleva: cabecera original, clave normalizada (recorte, espacios, NFC, mayúsculas), alias explícitos, tipo, reglas y destino.
   - No hay coincidencia aproximada: un alias nuevo exige una nueva versión del perfil.
5. **Tres capas separadas:**
   - **Original**: `RegistroOrigen`, inmutable, con el valor bruto, su tipo y su formato.
   - **Interpretado**: por campo, el valor, su estado (`ok · vacío · no-aplica · inválido · transformado`), el original y la regla aplicada.
   - **Modelo ULIT**: Local, Negocio, Ocupación, Observación, clasificación histórica, `FranquiciaCampana` y `RevisionDigital` con origen «importado».

   El exportador (C3) partirá del modelo, nunca del archivo importado.
6. **Simulación previa y aplicación atómica.**
   - Antes de aplicar se muestra un informe: recuentos por tipo de problema, ejemplos citados por número de fila y decisiones pendientes.
   - La aplicación es atómica, con un único deshacer, como las acciones masivas de B5.
7. **Compatibilidad con B1–B5:**
   - las clasificaciones de 2025 siguen siendo de solo referencia;
   - «Partir de 2025» solo copia valores válidos del mismo negocio;
   - las franquicias y los datos digitales importados entran con origen «importado».

   Una importación histórica **no** marca registros como revisados por la Cátedra salvo que se decida lo contrario (decisión 6).
8. **Piezas actuales a sustituir, no reutilizar:**
   - `valorBooleano`: convierte números distintos de 0 en «Sí» y el vacío en «No».
   - `CAMPOS.cadena`: incluye «franquicia».
   - La deducción de «vacío» a partir del nombre en `interpretarFilas`.
9. **Pruebas.** Casos sintéticos generados en las propias pruebas, sin archivos reales:
   - XML con prefijos;
   - cabecera con espacios;
   - hoja en otra posición;
   - los valores imposibles de la sección 2;
   - direcciones repetidas al estilo de Valladolid;
   - territorio obligatorio frente a no usado;
   - rendimiento con más de 10.000 filas.

## 10. Franquicia y «Nombre de cadena»: dependencias

La variable binaria **Franquicia** se conserva (`FranquiciaCampana`, B5). «Nombre de cadena» (`Negocio.cadena`) **no figura en los Excel históricos** y hoy se usa en:

| Ámbito | Uso |
|---|---|
| Modelo | `Negocio.cadena` (types.ts); `editarNegocio` (oficina.ts); `FilaOficina.cadena` |
| Oficina | Columna «Nombre de cadena» (tabla; visible por defecto en «Franquicias»); campo en la ficha; búsqueda en EspacioOficina |
| Importador provisional | `CAMPOS.cadena` reconoce también «Franquicia» (**error**: asigna un binario a un campo de texto) |
| Exportador provisional | Columna «Cadena» (C3 decidirá) |
| Datos de demostración | `CADENAS_FICTICIAS`; registros 2025 simulados con columna «Cadena»; generación ficticia de franquicias 2025 |
| Pruebas | b1-correcciones, b5 (la cadena no decide la franquicia), xlsx (columna no autorizada) |

**Propuesta escalonada, sin migración destructiva:**
1. **Ahora, si se autoriza:**
   - Retirar «Nombre de cadena» de la tabla, la ficha y la búsqueda.
   - Mantener `Negocio.cadena` como dato heredado de solo lectura, visible en el Histórico.
   - Corregir el importador para que «Franquicia» vaya a `FranquiciaCampana`.
   - No cambia la versión de datos.
2. **Con C3:** decidir si el exportador provisional deja de escribir «Cadena».
3. **Solo con autorización expresa:** eliminar el campo del modelo con una migración que lo archive. No es necesario ni se recomienda.

## 11. Excel definitivo para informática

- El modelo interno, con su auditoría, histórico, incidencias y relaciones, es **distinto** del contrato de salida.
- La estructura histórica de 27 columnas es la referencia, pero el itinerario de 2026 ya usa 28.
- No se ha tocado el exportador provisional y C3 sigue sin implementar.

Hay que confirmar con informática:
- nombre de la hoja y del archivo;
- cabeceras exactas, incluidos los 56 espacios de «Gr Comercio» y la grafía «Bussines»;
- tipos de cada columna (0/1 numérico o texto, CP numérico o texto, formato de fecha);
- cómo se escriben «pendiente», «sin información» y «no aplica»;
- si `Nº redes` se calcula;
- cómo representar «S/N» y los sufijos en `Num`;
- si deben acompañar Hoja1 o tablas de resumen;
- si entran campos adicionales (valoración, otras redes, itinerario).

## 12. Decisiones pendientes

**Cátedra:**
1. Diccionario de equivalencias de texto: qué expresiones valen como «sin información» («sin dato», «s/i»…) y cuáles se tratan como inválidas.
2. Tratamiento de las medidas con unidad («3,5 m») y de los valores de fachada en locales ocupados.
3. Correspondencias de clasificación 2025 → 2026: Servicios (actividad que pasa a descripción) y los 15 valores fuera de lista. Se suman a D01–D14, todavía sin resolver.
4. Valladolid:
   - fuente oficial y verificada de la correspondencia dirección → Distrito, Zona y CP (formato, versión, responsable);
   - si se censan las dos aceras;
   - si el resultado es un Excel municipal único.
5. Criterio para direcciones repetidas: ¿basta un nombre distinto para considerarlas unidades distintas, o hace falta confirmación en campo?
6. Estado de revisión de los registros históricos importados: ¿se consideran validados o quedan como importados sin revisar?
7. Retirada operativa de «Nombre de cadena» (fase 1 de la sección 10).
8. Un perfil estructural sin registros del itinerario de Valladolid (con nuestro inspector, una vez corregido el lector), para fijar sus cabeceras exactas.

**Informática:**
1. El contrato del Excel para Power BI (sección 11) y su versión para 2026.
2. Tipos y dominios de Distrito, Zona y CP en Valladolid (entero, texto, con o sin ceros).

## 13. Orden de trabajo propuesto (pendiente de autorización)

| Bloque | Contenido |
|---|---|
| **C1a** | Lector OOXML tolerante, detección de hoja, perfiles versionados e informe previo |
| **C1b** | Reglas de interpretación (vacíos, inválidos, transformaciones) e incidencias |
| **C1c** | Aplicación atómica al modelo, clasificación histórica y configuración territorial |
| **C1d** | Pantalla de importación (vista previa, decisiones, deshacer) |
| **C2 / C3** | Validación y exportación, después de cerrar el contrato con informática |
