# C1b · Interpretación de valores e incidencias

> **Alcance autorizado:** solo C1b. **No** se han implementado C1c, C1d, C2 ni C3.
> - La interpretación es de solo lectura: no importa registros al modelo operativo, no crea locales, no modifica campañas y no guarda el archivo.
> - Todo procede de **libros ficticios y pruebas sintéticas**. Los Excel reales no están en el repositorio.
> - Las decisiones pendientes de la Cátedra **no se resuelven**: las reglas que dependen de ellas no se aplican salvo autorización expresa.

## 1. Qué se ha construido

| Pieza | Archivo | Función |
|---|---|---|
| Interpretación | `src/domain/xlsx/interpretacion.ts` | Capa original, capa interpretada, intérpretes por tipo y coherencias entre campos. |
| Reglas e incidencias | `src/domain/xlsx/reglasInterpretacion.ts` | Catálogo versionable de reglas (con su respaldo) y de tipos de incidencia (gravedad, quién decide y propuesta). |
| Clasificación histórica | `src/domain/xlsx/clasificacionHistorica.ts` | Diagnóstico de coherencia de GrActividad, Gr Comercio, Subgrupo, Actividad y Descripción. No asigna nada al catálogo 2026. |
| Informe agregado | `src/domain/xlsx/informeInterpretacion.ts` | Recuentos por estado, columna, regla e incidencia, y registro de transformaciones. No reproduce ningún texto libre de las celdas (sección 7 bis). |
| Interfaz | Datos → Análisis previo → **Interpretar valores (C1b)** | Resumen e incidencias por tipo; descarga del informe en JSON. Opcional: año de la campaña para comprobar las fechas. |
| Línea de órdenes | `npm run interpretar -- archivo.xlsx --municipio=mun-medina --anio=2025` | Mismo informe; deja `<archivo>.informe-interpretacion.json` junto al Excel, ignorado por git y por el control de datos reales. |
| Pruebas | `src/domain/xlsx/c1b.test.ts` (51) y `analisis-previo.test.tsx` (+1) | Batería sintética, incluidas 10.000 filas. |

C1b reutiliza el **lector seguro** de C1a (mismos límites de tamaño y descompresión) y su análisis estructural. El libro se lee una sola vez: `analizarLibroLeido` permite reutilizar la lectura.

## 2. Tres capas separadas

1. **Original** (`CapaOriginal`). Cada celda tal como la leyó C1a, con:
   - tipo: vacía, número, fecha, texto, booleano o error;
   - valor y formato de número;
   - si viene de una fórmula.

   Se conservan también el archivo con su SHA-256, la hoja, la fila de cabecera, el perfil y la cabecera exacta de cada columna. Las celdas vacías no se guardan.
2. **Interpretada** (`FilaInterpretada`). Por cada celda:
   - estado y valor interpretado;
   - regla aplicada;
   - propuesta, cuando la hay;
   - incidencias;
   - si requiere revisión.

   Por fila:
   - estado del local;
   - Nº redes calculado;
   - diagnóstico de la clasificación, siempre con `confirmada: false`;
   - grupo de dirección repetida;
   - `verificado2026: false`.
3. **Modelo operativo**: no se toca. Lo hará C1c con aplicación atómica y C1d con la pantalla de decisiones.

`interpretarCapa` es una función pura. Una prueba comprueba que la capa original queda idéntica después de interpretar.

## 3. Estados de una celda

| Estado | Significado | Ejemplo |
|---|---|---|
| `valido` | El valor ya tiene la forma esperada | `1` en Instagram → Sí |
| `transformado` | Cambia la representación con una regla explícita e inequívoca | `"16 B"` → número 16, sufijo B |
| `vacio` | No hay información; nunca pasa a No, 0 ni a una fecha | Binario en blanco en un ocupado |
| `no-aplica` | El campo no corresponde | Nombre en un local vacío; Distrito en Medina |
| `pendiente` | Hay una propuesta, pero requiere una decisión | `«3,5 m»` → 3,5, si se autoriza |
| `invalido` | El valor no puede interpretarse | `83` en una columna 0/1 |

Una celda **requiere revisión** si cumple alguna de estas condiciones:
- es inválida;
- es pendiente;
- tiene una incidencia de error o de aviso.

Las incidencias informativas no cuentan.

## 4. Reglas por columna

Las reglas dependen del **tipo** declarado en el perfil y de la **clave** de la columna. Por eso valen igual para los perfiles de 27 y 28 columnas; una prueba lo verifica con ambos.

| Columna | Regla |
|---|---|
| **Fecha censo** | Válida si es una fecha de Excel. Transformada si es texto `dd/mm/aaaa` (también con `-` o `.`) o `aaaa-mm-dd`, comprobando que existe (31/02 no existe). Pendiente si es un número sin formato de fecha o tiene año de dos cifras. Inválida si es otro texto («FECHA PENDIENTE»). Vacía: ausente con aviso. Fuera del periodo de la campaña: pendiente. **Nunca se usa la fecha actual.** |
| **Distrito / Zona** | Según el municipio. Medina, `no-se-usa`: no aplica, y si traen valor se conserva sin usarlo. Valladolid: se conserva el código. Vacíos: en el histórico se conservan; en una campaña actual son error si son obligatorios. **No se deducen de la calle.** |
| **CP** | 5 cifras, guardado como texto. Si tiene 4 cifras: pendiente, con la propuesta del cero inicial. Si es distinto del CP fijo del municipio (Medina 47400): pendiente. Si está vacío: igual que Distrito y Zona. **Nunca se rellena con 47400.** |
| **Dirección** | Texto literal, sin recortar. Vacía: error. |
| **Num** | Un entero es válido. «S/N» es válido como **sin número**. «16 B» se transforma en número y sufijo, y «12» en texto se transforma en número. Vacío: **desconocido**, con aviso, y distinto de S/N. 12,5, 0 u otros textos son inválidos. |
| **Local Vacío** | 0/1. «0»/«1» como texto se transforman. Vacío u otro valor: error, y el local queda «desconocido». **No se deduce de la falta de nombre.** |
| **Long fachada** | Número ≥ 0. «3,5» como texto se transforma. **«3,5 m» queda pendiente** (decisión 2) y solo se transforma si se autoriza. En un ocupado: vacía, no aplica; con valor, aviso. |
| **Nombre del negocio** | Literal, incluidos los espacios. En un ocupado sin nombre: error. En un vacío con nombre: incidencia de fila. |
| **Clasificación** (5 columnas) | Cada una se guarda por separado y literalmente. Gr Comercio vacío fuera de Comercio: no aplica. Diagnóstico por fila (sección 6). |
| **Binarios** (Franquicia, web, Google, Vende internet, Responde reseñas, IG, FB, X) | Solo 0/1 y «0»/«1» o «1,0» como texto. Cualquier otro número (4, 23, 83, 226, 247, 379, 3001…) es **inválido y nunca pasa a Sí**. «Sí»/«No» como texto o VERDADERO/FALSO: inválido. En un ocupado: vacío = sin información, con aviso. En un vacío: no aplica. |
| **Seguidores, Nº reseñas** | Entero ≥ 0, incluido el cero. «120» como texto se transforma. Negativos, decimales y otros textos son inválidos. Si la red o Google es No, la cifra vacía no aplica. |
| **Nº redes** | Se calcula **solo** IG + FB + X cuando las tres respuestas son válidas. Si coincide con el original: válido. Si difiere: inválido; se conserva el original y se informa del calculado. Si alguna red es desconocida o inválida: no se inventa el total, y el original queda pendiente. |
| **Municipio, itinerario, Orden Par** (28 columnas) | Texto literal y enteros, respectivamente. |

**«sin dato» y «s/i»**: se reconocen como posibles «sin información» (diccionario propuesto), pero quedan **pendientes** hasta que la Cátedra apruebe el diccionario (decisión 1). Con la opción `diccionarioAprobado` pasan a vacío, conservando el original. Una prueba lo comprueba.

## 5. Coherencias entre campos

Ninguna corrige un valor; solo generan incidencias:

| Coherencia | Incidencia |
|---|---|
| Local vacío con campos de negocio rellenos | `vacio-con-datos-negocio` (error), con la lista de columnas |
| Ocupado sin nombre | `ocupado-sin-nombre` (error) |
| Seguidores > 0 con la red en No | `seguidores-con-red-no` (aviso); se conservan ambos valores |
| Reseñas > 0 o «Responde» = Sí con Google en No | `resenas-sin-google`, `responde-sin-google` |
| Nº redes distinto del calculado | `redes-discrepa` |
| Nº redes incalculable | `redes-no-calculable` |
| Misma calle y número | `direccion-repetida` (info, **informativa**). Se conservan todas las filas y cada una es un local físico distinto del mismo portal; no se fusiona nada (corrección C1c-1) |
| Fila idéntica a otra | `fila-duplicada-exacta` (aviso); se conservan ambas |

Franquicia y presencia digital: los valores de 2025 se interpretan como respuestas **históricas**. Cada fila lleva `verificado2026: false`: no verifican la franquicia ni la revisión digital de 2026.

## 6. Clasificación histórica

Se diagnostica cada combinación usando la **estructura** del catálogo 2026 solo como referencia:
- no se asignan nodos 2026;
- no se confirma nada;
- no se reasigna una combinación incoherente.

El paso a 2026 sigue siendo «Partir de 2025» (B5) con una equivalencia aprobada o una elección humana.

| Categoría | Diagnósticos |
|---|---|
| Coherente | `coherente`, `coherente-subgrupo-sin-actividades`, `coherente-con-descripcion` |
| Estructura de Servicios (no es error) | `servicios-actividad-ejemplo` (info), `servicios-actividad-no-prevista` (aviso, decisión 3) |
| Incompleta | `sin-grupo`, `sin-subgrupo`, `incompleta-sin-actividad`, `comercio-sin-grupo-comercio` |
| Incoherente | `subgrupo-de-otro-grupo`, `actividad-no-pertenece`, `grupo-comercio-no-corresponde`, `grupo-comercio-fuera-de-comercio`, `subgrupo-inexistente-2026`, `grupo-desconocido` |

Además se señala, como información, lo que está fuera de las listas de Hoja1. La comparación tolera mayúsculas, tildes y plurales simples.

## 7. Incidencias y trazabilidad

Cada incidencia indica:
- **ubicación**: archivo, hoja, fila, columna (letra y cabecera) y campo;
- **clasificación**: tipo, gravedad y quién decide (Cátedra, revisión o nadie);
- **contenido**: mensaje, propuesta de actuación, regla aplicada, valor original y columnas relacionadas.

El origen nunca se modifica.

Cada regla del catálogo indica su **respaldo**:
- `especificacion-c1b`: se aplica;
- `pendiente-catedra` o `pendiente-informatica`: no se aplica sin autorización expresa en `reglasAutorizadas`.

El informe agregado:
- lista cuántas veces se aplicó cada regla;
- recoge el **registro de cada transformación** (fila, columna, regla, original y resultado);
- resume las decisiones pendientes con el número de celdas afectadas.

En los campos identificativos (nombre, dirección y descripción) se omiten los valores.

## 7 bis. Privacidad del informe exportable

Un nombre comercial o personal puede estar, por error, en **cualquier** columna, no solo en «Nombre del negocio». Por eso el informe exportable (JSON y pantalla) no reproduce texto libre de ninguna celda.

- **Valores íntegros:** siguen en la capa original y en los mensajes internos de las incidencias. No se exportan.
- **Mensaje de cada incidencia exportada:** se forma con el **título fijo** del tipo más un **detalle seguro**. El detalle solo contiene:
  - números ya validados (seguidores, Nº redes, CP de 5 cifras);
  - fechas;
  - cabeceras del perfil;
  - números de fila;
  - descripciones fijas de los diagnósticos de clasificación («el subgrupo pertenece a otro grupo de actividad»), sin los textos de las celdas.
- **Valor original:** solo se exporta su clase (texto, número, fecha…). El valor en sí solo aparece en estos casos:
  - números de hasta 5 cifras enteras; uno más largo podría ser un teléfono;
  - fechas;
  - VERDADERO/FALSO;
  - códigos de error de Excel.

  En nombre, dirección y descripción nunca se exporta.
- **Registro de transformaciones:** el original y el resultado solo se exportan en reglas cuyo original es un patrón estricto (dígitos, «16 B», fechas…).
- **Lo único textual que procede del usuario** es el **nombre del archivo**, necesario como referencia.

Las pruebas colocan nombres, personas, calles y un teléfono ficticios en columnas equivocadas:
- Fecha, Distrito, CP, Num, Local Vacío y Long fachada;
- las cinco columnas de clasificación;
- web, Google y las de seguidores;
- Nº redes.

Comprueban tres cosas:
- ninguno de esos textos aparece en el JSON exportado, ni desde una capa sintética ni desde un XLSX;
- las incidencias siguen localizadas por tipo, columna y fila;
- los valores íntegros siguen en la capa original.

## 7 ter. Posibles filas de totales

C1a marca como posible total una fila cuya primera celda de texto empieza por «Total», «Suma» o «Subtotal». Es una **heurística** y puede equivocarse: por ejemplo, con una calle llamada «Total…».

- La fila **se conserva íntegra** en la capa original, con su número de fila, y se interpreta como cualquier otra.
- Se registra en `candidatasExcluir` (origen `heuristica-c1a`). La fila interpretada lleva `exclusion: { propuesta: 'excluir', confirmada: false }` y una incidencia `posible-fila-de-totales` para revisión.
- Solo podrá excluirse de la aplicación operativa con una **decisión humana explícita y trazada** en C1d. C1b no excluye nada.

Una prueba coloca «TOTAL VÍA FICTICIA» en la dirección de un ocupado válido y comprueba lo siguiente:
- la fila se conserva;
- su interpretación es idéntica a la que tendría sin la marca;
- queda pendiente de confirmación.

## 8. Simulación con el Excel ficticio de Medina 2025

> Cifras de un archivo **ficticio**: sirven para comprobar las reglas, **no** para estimar la calidad del censo real.

Ejecución:
```
npm run interpretar -- CENSO_MEDINA_2025_FICTICIO.xlsx --municipio=mun-medina --anio=2025
```
El archivo estaba fuera del repositorio. Tardó unos 350 ms.

| Concepto | Resultado |
|---|---|
| Registros | 889 (609 ocupados, 280 vacíos, ninguno desconocido) |
| Celdas interpretadas | 24.003 (889 × 27) |
| **Sin revisión** | **23.729 (98,86 %)** |
| **Requieren revisión** | **274 (1,14 %)**: 257 por la clasificación histórica y 17 por valores |
| Por estado | válido 15.418 · transformado 6 · vacío 492 · no aplica 8.074 · pendiente 5 · inválido 8 |
| Incidencias | 452: 7 de error, 267 de aviso y 178 informativas; la Cátedra decide 180 y la revisión 222 |

Incidencias de **valores**, todas en las filas previstas por el estudio de C1:

| Fila | Columna | Valor original | Resultado |
|---:|---|---|---|
| 6 | Long fachada | «3,5 m» | Pendiente (propuesta 3,5; decisión 2) |
| 11, 58, 109 | web, Google My Bussines, Vende internet | 4 | Inválido; no pasa a Sí |
| 161 | Responde reseñas G | 23 | Inválido |
| 214 | Facebook | 247 | Inválido; Nº redes no calculable (original 2, pendiente) |
| 273 | Twitter | 379 | Inválido; Nº redes no calculable |
| 332 | Nº redes | 380 | Inválido: el calculado es 1; el original se conserva |
| 24 | Fecha censo | «FECHA PENDIENTE» | Inválido: fecha ausente, sin sustituir |
| 385, 435 | segu Insta, Segu F | «sin dato», «s/i» | Pendientes del diccionario (decisión 1) |
| 193, 384, 575, 766 | Num | (vacía) | Número desconocido (aviso), distinto de S/N |

Otros resultados:
- **Interpretado sin incidencia:**
  - 6 «N B» transformados en número y sufijo, con su registro de transformación;
  - 6 «S/N» válidos como sin número;
  - Distrito y Zona: 889 «no aplica» cada uno, como corresponde en Medina;
  - CP: 889 válidos con 47400;
  - 14 locales vacíos sin medida de fachada, que quedan vacíos.
- **Nº redes:** 606 coinciden, 1 discrepa y 2 no son calculables.
- **Clasificación histórica (609 ocupados, ninguno confirmado):**

  | Grupo | Locales | Desglose |
  |---|---:|---|
  | Coherentes | 224 | 185 + 39 sin actividades |
  | Diferencias de estructura de Servicios | 177 | 128 ejemplos 2026 + 49 no previstas |
  | Incompletas | 55 | 31 sin actividad ni descripción, 16 sin subgrupo, 8 sin Gr Comercio |
  | Incoherentes | 153 | 87 de otro grupo, 50 con la actividad fuera del subgrupo, 15 con el grupo de comercio equivocado, 1 inexistente |

  Las cifras coinciden con las del estudio de C1. La única diferencia es un caso que antes figuraba como «Servicios no prevista» y ahora se clasifica como «actividad que no pertenece» (49 + 50 en vez de 50 + 49).
- **Direcciones repetidas:** ninguna en este ficticio. En el libro ficticio de estilo Valladolid hay 4 grupos con 8 filas; se conservan todas.
- **Pendiente de decisión:**
  - decisión 1: 2 celdas;
  - decisión 2: 1 celda;
  - decisión 3: 177 combinaciones de Servicios.

## 9. Rendimiento

Prueba con un libro ficticio de 10.000 filas y anomalías (270.000 celdas):
- lectura segura, análisis estructural e interpretación: unos 2,1 s;
- solo la interpretación: unos 0,3 s.

La prueba exige menos de 5 s para la interpretación. El diagnóstico de clasificación se memoriza por combinación, porque los censos repiten mucho las mismas.

## 10. Garantías comprobadas por las pruebas

- Ninguna fila se excluye automáticamente: las posibles filas de totales se conservan y quedan pendientes de confirmación.
- El informe exportable no reproduce texto libre de ninguna celda.

- La capa original no cambia, y los textos se conservan literalmente, con espacios.
- Ninguna ausencia pasa a No, a 0 ni a una fecha.
- Ningún binario imposible pasa a Sí.
- Las reglas pendientes (diccionario, «3,5 m», número sin formato de fecha, año de dos cifras, CP de 4 cifras) solo se aplican con autorización expresa.
- Distrito, Zona y CP nunca se inventan.
- No se fusionan filas ni se crean locales.
- La base de datos de la aplicación no cambia al interpretar desde la interfaz.
- Se mantienen los límites de seguridad del lector.

## 11. Pendiente (no se ha resuelto aquí)

**Cátedra:**
- Decisiones 1 (diccionario), 2 (medidas con unidad y fachada en ocupados) y 3 (correspondencias 2025 → 2026 y Servicios).
- Decisión 5: criterio para las direcciones repetidas.
- Decisión 6: estado de revisión de los registros históricos.
- Reglas propuestas en este bloque y no aplicadas:
  - número sin formato en «Fecha censo»;
  - año de dos cifras.

**Informática:** tipo del CP y de los códigos territoriales (CP de 4 cifras).

**Bloques siguientes, que no se han empezado:**
- **C1c**: aplicación atómica al modelo;
- **C1d**: pantalla de importación con decisiones y deshacer;
- **C2 y C3**.
