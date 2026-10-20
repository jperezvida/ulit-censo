# C1a · Lector XLSX, perfiles e informe estructural previo

> **Alcance autorizado:** C1a únicamente. **No** se han implementado C1b, C1c, C1d, C2 ni C3.
> El análisis es de solo lectura:
> - no importa negocios, no crea locales ni modifica campañas;
> - no guarda el archivo ni lo envía a ningún servidor.
>
> Todo lo que figura aquí procede de **libros ficticios y pruebas sintéticas**. Los Excel reales no están en el repositorio ni en el Codespace.

## 1. Qué se ha construido

| Pieza | Archivo | Función |
|---|---|---|
| Lector | `src/domain/xlsx/lector.ts` | ExcelJS como motor. Adaptación acotada y en memoria solo para XML de SpreadsheetML con prefijo. Diagnóstico del paquete. |
| Perfiles | `src/domain/xlsx/perfilesImportacion.ts` | `censo-municipal-27` v1 y `itinerario-medina-2026-28` v1, con las cabeceras originales exactas, el tipo esperado y la clave interna. |
| Análisis | `src/domain/xlsx/analisis.ts` | Informe estructural: hojas y su papel, hoja de datos, columnas, tipos, formatos, filas, perfiles compatibles y diferencias. |
| Territorio | `src/domain/territorio.ts` | Reglas de Distrito, Zona y CP por municipio. Solo informan: nunca completan valores. |
| Interfaz | Datos → **Análisis previo de importación** | Se elige el municipio de destino y el .xlsx; se ve el informe y se puede descargar en JSON. |
| Línea de órdenes | `npm run analizar -- archivo.xlsx --municipio=mun-medina` | Mismo informe; deja `<archivo>.informe-estructural.json` junto al Excel, ignorado por git. |
| Libros ficticios | `npm run xlsx-ficticio -- <carpeta>` | Genera 4 libros de demostración (27 columnas, con prefijo, 28 columnas y estilo Valladolid). |

El inspector estructural de B0 usa ahora el mismo lector, de modo que también abre libros con prefijo.

## 2. ExcelJS y los dos formatos XML (verificado con pruebas)

Según tu comprobación, los originales de Medina 2025, Valladolid 2024 y Medina 2026 usan **etiquetas OOXML sin prefijo**, como las guarda Excel. El prefijo `x:` procede del libro ficticio de pruebas.

| Caso | ExcelJS 4.4.0 directamente | Lector de C1a |
|---|---|---|
| SpreadsheetML **sin prefijo** (Excel) | Lee correctamente | ExcelJS sin adaptar nada (`motor: exceljs`) |
| SpreadsheetML **con prefijo** `x:` | Falla: «Cannot read properties of undefined (reading 'sheets')» | Adaptación en memoria y ExcelJS. **Mismos valores, formatos y hojas** que la versión sin prefijo (prueba de equivalencia). El original no cambia. |
| Relaciones con ruta absoluta (`/xl/…`) | Lee correctamente | Solo se informa |
| Prefijo con CDATA, atributos prefijados o redeclaraciones | — | **Rechazado**: no se adapta sin garantías y se explica el motivo |
| Prefijo ligado a otro espacio de nombres | — | No se toca |
| OOXML «Strict» | No compatible | Rechazado con instrucciones (guardar como .xlsx) |
| .xls antiguo o .xlsx con contraseña | — | Rechazado con instrucciones |
| Archivo que no es .xlsx (CSV…) | — | Rechazado |

La adaptación solo actúa en partes `xl/**.xml` cuyo **elemento raíz** lleva un prefijo ligado exactamente al espacio de nombres principal de SpreadsheetML. Hace dos cosas y nada más:
- quita ese prefijo de las etiquetas;
- declara el espacio de nombres como predeterminado.

El resto del paquete queda byte a byte igual.

## 3. Perfiles y reconocimiento de cabeceras

- **`censo-municipal-27`** (Medina 2025; Valladolid 2024, itinerario 10):

  > Fecha censo · Distrito · Zona · CP · Dirección · Num · Local Vacío · Long fachada · Nombre del negocio · GrActividad · Gr Comercio␣×56 · Subgrupo de actividad · Actividad · Descripción · Franquicia · web · Google My Bussines · Vende internet · Nº reseñas Google · Responde reseñas G · Instagram · segu Insta · Facebook · Segu F · Twitter · Segu T · Nº redes

- **`itinerario-medina-2026-28`** (hoja habitual «Datos 25»): cambia Distrito y Zona por **Municipio · itinerario** y añade **Orden Par** tras «Num». «Gr Comercio» va sin espacios finales.

Cómo se compara cada cabecera, del caso más estricto al más tolerante:

| Coincidencia | Ejemplo | Efecto |
|---|---|---|
| `exacta` | — | — |
| `espacios` | «Gr Comercio» frente a la versión con 56 espacios | Se informa |
| `mayusculas` | «WEB» | Se informa |
| `alias` | Solo los declarados en el perfil, p. ej. «Google My Business», «Twiter» | Se informa |
| `tildes` | «Direccion» | Se informa como **revisar** |

- Nunca hay coincidencia aproximada: «Cadena» **no** se confunde con «Franquicia».
- La **cabecera original se conserva siempre tal cual**; el informe muestra los espacios sobrantes.
- Un perfil solo es **compatible** si no falta ninguna columna obligatoria, no sobra ninguna y no hay cabeceras repetidas.

## 4. Hoja de datos por su estructura

- Cada hoja se clasifica como **datos**, **listas** (Hoja1), **resumen** (rótulos de tabla dinámica: «Etiquetas de fila», «Cuenta de…», «Total general») u **otra**.
- La hoja de datos es la que mejor cubre un perfil en sus 10 primeras filas, **cualquiera que sea su nombre o posición**.
- Si dos hojas empatan, el informe pide elegir (`eleccionHoja: ambigua`).
- Hoja1 y los resúmenes **nunca** se usan como origen de registros.

## 5. Contenido del informe estructural

1. **Archivo y lectura:** nombre, tamaño, SHA-256, motor de lectura y adaptaciones aplicadas.
2. **Hojas:** posición, visibilidad, filas, columnas, papel y motivo.
3. **Datos:** hoja de datos y modo de elección; perfil propuesto y compatibilidad con cada perfil (faltan, sobran, repetidas, diferencias de cabecera, orden).
4. **Columnas:** cabecera original, columna del perfil, tipo esperado, tipos detectados (fecha, entero, decimal, texto, texto numérico…), formatos de número, celdas vacías y fórmulas.
   - **No encajan**: celdas cuyo tipo no corresponde al esperado, por categoría (p. ej. «número distinto de 0 y 1»).
   - **Variantes**: «S/N», «número con sufijo», «0/1 guardado como texto».
5. **Filas:** fila de cabecera, filas con datos, filas en blanco intercaladas y posibles filas de totales.
6. **Estructura:** paneles inmovilizados, filtro, filas y columnas ocultas, celdas combinadas, validaciones y fórmulas.
7. **Territorio:** evaluación de Distrito, Zona y CP según el municipio de destino (sección 7).
8. **Direcciones repetidas:** recuento, sin deduplicar (sección 8).
9. **Avisos y garantías.**

El informe **no contiene valores**: ni nombres de negocio, ni direcciones, ni los números anómalos. Solo recuentos y categorías. Los valores anómalos (83, 226, 3001…) se cuentan como «número distinto de 0 y 1» y **no se convierten**: su tratamiento corresponde a C1b.

## 6. Demostración con libros ficticios

`CENSO_MEDINA_2025_FICTICIO_PARA_CLAUDE.xlsx` se analizó desde una carpeta temporal fuera del repositorio. Las cifras son de una **simulación** y no se extrapolan al censo real.

| Elemento | Resultado |
|---|---|
| Lector | ExcelJS con adaptación de 6 partes (el libro de pruebas usa el prefijo `x:`) |
| Hojas | «Datos» = datos (100 % del perfil de 27) · «Hoja1» = listas · «Tablas Dinámicas» = resumen |
| Hoja de datos | «Datos», elegida automáticamente · 889 filas · cabecera en la fila 1 · paneles inmovilizados (1 fila, 6 columnas) |
| Perfil compatible | `censo-municipal-27` (27/27, mismo orden) |
| Perfil de 28 columnas | No compatible: faltan Municipio, itinerario y Orden Par; sobran Distrito y Zona |
| Territorio (Medina) | Distrito y Zona vacíos, conformes (el municipio no los usa) · CP 47400 en 889 filas |
| Columnas que no encajan | Fecha (1 texto) · Long fachada (1 texto) · web, Google, Vende internet, Responde reseñas, Facebook y Twitter (1 número distinto de 0 y 1 cada una) · segu Insta y Segu F (1 texto cada una) |
| Variantes | Num: 6 «S/N» y 6 con sufijo |
| Direcciones repetidas | 0 |
| Tiempo | ≈ 0,4 s |

Los otros tres libros ficticios generados (`npm run xlsx-ficticio`) muestran:
- El itinerario de 28 columnas se reconoce en la hoja «Datos 25», sin Distrito ni Zona.
- Un libro de estilo Valladolid, con la hoja de datos en la 2.ª posición y el CP vacío:
  - se identifica por su estructura;
  - Distrito, Zona y CP quedan **ausentes** con incidencia futura, sin rellenarse;
  - se cuentan 4 grupos de direcciones repetidas.

**Capturas:** se adjuntan en la conversación. No se guardan en el repositorio.

### Cómo reproducirlo en Codespaces (solo libros ficticios)

```bash
npm ci
npm run xlsx-ficticio -- /tmp/ficticios          # genera 4 libros ficticios fuera del repositorio
npm run analizar -- /tmp/ficticios/ficticio-censo-27-con-prefijo.xlsx --municipio=mun-medina
npm run analizar -- /tmp/ficticios/ficticio-estilo-valladolid.xlsx --municipio=mun-valladolid
npm run dev -- --host                             # Datos → «Análisis previo de importación»
```

En la interfaz se puede descargar un libro de `/tmp/ficticios` desde el explorador de Codespaces y seleccionarlo. Los `.xlsx` y los informes `*.informe-estructural.json` están excluidos por `.gitignore` y por la comprobación `npm run comprobar-datos`.

## 7. Territorio por municipio

| Municipio | Distrito | Zona | CP | Aceras | Resultado |
|---|---|---|---|---|---|
| Medina del Campo | No se usa | No se usa | Fijo 47400 | Ambas | Excel municipal único |
| Valladolid | Tabla verificada, obligatorio | Tabla verificada, obligatorio | Por dirección, obligatorio | Por confirmar | Por confirmar |

- Nunca se deduce un campo de otro ni del nombre de la calle.
- Un campo vacío en un histórico se conserva **ausente**. Si es obligatorio en las campañas actuales, el informe anticipa la incidencia que registrará C1b.
- Si Medina recibe valores de Distrito o Zona, se informa y se conservarán como originales, sin usarse.
- La configuración no se guarda en la base de datos (C1a no modifica el modelo).

## 8. Direcciones repetidas

Una misma calle y número en varias filas puede corresponder a:
- **locales distintos**;
- una **sustitución de actividad**;
- un **duplicado**.

C1a solo las cuenta. El plan para C1b y C1c es:
- **conservar todas las filas de origen**;
- no deduplicar;
- dejar la correspondencia física **pendiente de conciliación** cuando no sea inequívoca.

## 9. Pruebas

- **`src/domain/xlsx/c1a.test.ts`** (20 pruebas):
  - capacidades de ExcelJS con y sin prefijo;
  - equivalencia exacta tras la adaptación;
  - rechazo de casos no seguros;
  - archivos no válidos, cifrados o .xls;
  - inspector B0 con prefijo;
  - cabeceras con espacios, mayúsculas, tildes y alias;
  - perfiles 27 y 28;
  - columnas que faltan, sobran o se repiten;
  - hoja con otro nombre o posición, empate y libro desconocido;
  - tipos y valores imposibles contados sin convertir;
  - filas en blanco y totales;
  - direcciones repetidas;
  - territorio de Medina y de Valladolid;
  - solo lectura;
  - 10.000 filas.
- **`src/workspaces/imports/analisis-previo.test.tsx`** (3 pruebas): informe en la interfaz con un libro con prefijo, base de datos sin cambios, Valladolid y archivo no válido.
- **Rendimiento:** 10.000 filas con prefijo en ≈ 3,7 s (adaptación más lectura más análisis).

## 10. Propuesta: conservación de los archivos originales (NO implementada)

C1a no guarda el archivo: solo calcula su **SHA-256**, que permite comprobar más adelante que un archivo es exactamente el analizado. Para conservar los originales hay que decidir antes:

| Opción | Capacidad | Seguridad | Conservación | Recuperación | Valoración |
|---|---|---|---|---|---|
| `localStorage` | ≈ 5 MB por origen; solo texto (Base64 +33 %); síncrono | Sin cifrar; accesible a cualquier script del origen | Se borra con los datos del navegador | Ninguna fuera del navegador | **No adecuado** para libros completos |
| IndexedDB (Blob) en el navegador | Cientos de MB, según la cuota del navegador; desalojable salvo con `navigator.storage.persist()` | Sin cifrar en disco; ligado a un navegador y un perfil | Frágil: limpieza del navegador, otro equipo, modo privado | Exportar e importar a mano; verificación por SHA-256 | Aceptable solo como **caché temporal**, con límites, cifrado opcional (WebCrypto) y borrado explícito |
| Carpeta local elegida por la persona (File System Access) | La del disco | Según el equipo | La decide la persona | Volver a elegir el archivo y comprobar el SHA-256 | Sencillo, pero no disponible en todos los navegadores |
| Almacenamiento institucional (servidor o Supabase Storage) | Amplia | Control de acceso, cifrado en reposo, auditoría | Política de retención definida | Copias de seguridad | **Recomendado** para conservar originales, pero **requiere autorización** (Supabase está fuera del alcance actual) |

**Propuesta escalonada:**
1. **C1b/C1c (sin almacenamiento):**
   - Se guarda en la importación solo la huella (SHA-256), el nombre, el tamaño, el perfil y el informe.
   - El original lo conserva la Cátedra en su repositorio documental.
   - Para reimportar o auditar, se vuelve a seleccionar el archivo y se verifica la huella.
2. **Opcional, con autorización:** caché temporal en IndexedDB con:
   - límite por archivo (p. ej. 50 MB) y total (p. ej. 500 MB);
   - persistencia solicitada al navegador;
   - borrado explícito y caducidad, p. ej. hasta la validación definitiva de la campaña.
3. **Conservación institucional:** solo con autorización y política de datos (responsable, plazos, acceso, RGPD). Los nombres comerciales pueden ser nombres de personas físicas (autónomos).

Decisiones necesarias:
- dónde se custodian los originales;
- plazo de conservación;
- quién puede acceder;
- si se cifran;
- cómo se recuperan tras un cambio de equipo.

## 11. «Franquicia» y «Nombre de cadena»

- Los perfiles tratan **«Franquicia» como variable binaria** (`binario-01`). Ninguna cabecera se interpreta como nombre de cadena.
- No se ha retirado «Nombre de cadena» de la interfaz ni se ha borrado ningún dato: queda pendiente de una autorización específica (fase 1 de la sección 10 del informe de preparación).
- El importador CSV provisional, que asigna «Franquicia» a la cadena, **no se ha tocado** y no se usa en C1a. Se sustituirá en C1b.

## 12. Pendiente (requiere autorización)

- **C1b:** interpretación por campo (vacíos, inválidos, transformaciones trazadas) e incidencias.
- **C1c:** aplicación atómica al modelo, clasificación histórica y configuración territorial persistente.
- **C1d:** pantalla de importación.
- **C2 y C3.**
- Decisión sobre la conservación de originales (sección 10).
- Retirada operativa de «Nombre de cadena».
