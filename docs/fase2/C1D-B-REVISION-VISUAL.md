# C1d-B · Revisión visual del cuadro de mando y propuesta de ajustes

> **Estado (22-10-2026):** los **bloques 1 y 2** están implementados. El bloque 1 cubre la corrección C1c-1, el aviso de origen calculado y Comparar descriptivo entre ámbitos (secciones 6.C.1 y 6.C.2). El bloque 2 es el rediseño del Resumen: sección 6.A con su cabecera compacta, más los puntos de legibilidad y rampas de 6.D aplicados al Resumen. Quedan pendientes 6.B (exportar, copiar, imprimir), 6.C.3 y 6.D–E en las demás pestañas.
>
> **Estado inicial:** evaluación y propuesta, **sin implementar**. Diseño evaluado: commit `df1b6fe`, con capturas a 1365 px. Datos ficticios: el escenario C1d y la campaña de demostración Medina 2025.
>
> **Pendiente:** la captura del dashboard anterior de la Cátedra **no ha llegado** al entorno de trabajo. La comparación con él se basa en su contenido descrito (total de locales, ocupación, grupos de actividad, calles con más comercio, servicios, hostelería y vacíos, digitalización y mapas) y en las dos ventajas que hay que conservar: **el protagonismo del mapa** y **los cuatro rankings simultáneos**. Cuando llegue la imagen, se completará la comparación punto por punto.

## 1. Método y herramientas utilizadas

- **Skill `impeccable`, modo crítica** (`critique`). Combina dos evaluaciones independientes:
  - **A, revisión de diseño:** heurísticas de Nielsen, carga cognitiva y personas;
  - **B, evidencia automática:** el detector `impeccable detect` y la inyección de `detect.js` en el navegador.
- **Guía de visualización de datos (`dataviz`):** antipatrones, elección de la forma de cada gráfico, marcas y anatomía, y validación de paletas para daltonismo.
- **Capturas con Playwright a 1365 px:** página completa de las nueve pestañas y primera pantalla visible (1365×768).
- **Medición en el navegador:** qué queda por encima del pliegue, la altura de cada pestaña y los desbordamientos.

## 2. Diagnóstico general

**Nota en las heurísticas de Nielsen: 23 sobre 40 (aceptable).** El rigor de los datos es alto, pero la lectura rápida y la utilidad para informes son bajas.

| Criterio | Valoración | Lo esencial |
|---|---|---|
| **Composición** | Correcta, pero genérica | La retícula y las tarjetas son ordenadas, pero la estructura es la de cualquier panel administrativo. El elemento más propio de un censo comercial, el mapa, es el más relegado |
| **Aprovechamiento de pantalla** | Bajo | A 1365×768, la barra de la app, la cabecera, los filtros, el aviso de histórico y las pestañas ocupan unos **470 de 768 px**. En el primer pliegue no hay **ningún gráfico, ninguna calle ni el mapa**, solo cifras. El mapa empieza hacia los **1500 px** y el Resumen mide unos **2000 px** |
| **Jerarquía visual** | Invertida | El bloque azul de «Establecimientos observados» y los 6 KPI dominan. El análisis (rankings y mapa) tiene el mismo peso que indicadores de oficina como «Correspondencias pendientes». El 579 o el 860 aparece tres veces en el pliegue |
| **Legibilidad** | Mejorable | Textos de 10,5 a 11,5 px en filtros, cabeceras de tabla y notas. Algunos grises no alcanzan el contraste AA (`#97a3b5` sobre blanco: 2,6:1; `#6b7a90`: 4,0–4,4:1). El encabezado salta de `h1` a `h3` |
| **Filtros** | Buenos en lógica | Una sola barra gobierna toda la página y el contador «N de M» es claro. En contra: el desplegable de 53–90 calles no tiene búsqueda, los filtros activos no se ven como etiquetas que se puedan quitar y la URL no conserva la vista |
| **Información disponible** | Rica y rigurosa | Hay denominadores en todas partes, umbrales explicados y fuentes separadas. Pero se repite: la distribución por sectores aparece **cuatro veces** en el Resumen (anillo, tabla, perfil y barra apilada) |
| **Utilidad para informes** | Baja | No se puede exportar (CSV/XLSX), copiar una tabla, imprimir (no hay estilos `@media print`) ni enlazar una vista con sus filtros, y los gráficos no llevan pie de cita. Para el apartado de calles comerciales hay que hacer cuatro capturas con el conmutador |

**Lo que funciona y hay que conservar:**
- los denominadores explícitos («58 de 619 con respuesta · 1 pendiente»);
- los umbrales con asterisco;
- la barra de filtros única y vinculada;
- la honestidad cuando no hay geometría (no se inventan coordenadas);
- la trazabilidad del registro al establecimiento en Cobertura y calidad.

## 3. El Resumen frente al dashboard anterior

| Aspecto | Dashboard anterior | Resumen actual (`df1b6fe`) | Valoración |
|---|---|---|---|
| Total de locales y ocupación | Sí | Sí, con denominadores | **Mejor** el nuevo |
| Distribución por grupos | Sí | Anillo + tabla + perfil + barra (redundante) | Más riguroso, menos conciso |
| Calles con más **comercio / servicios / hostelería / vacíos** | **Los cuatro a la vez** | **Uno cada vez** (conmutador de 5 opciones, top 8) | **Retroceso** |
| **Mapa** | **Protagonista** | Último bloque, a unos 1500 px. Sin geometría, lo sustituye un histograma de 5 barras titulado «Vista territorial» | **Retroceso** |
| Digitalización | Visible | Solo una frase en «Datos destacados» y columnas del perfil | Igual |

- **Rankings:** el conmutador convierte una comparación en un ejercicio de memoria. La pregunta típica de un informe, «¿las calles con más hostelería son también las que tienen más vacíos?», hoy no se responde de un vistazo. Además, la vista por defecto («Ocupados») no estaba entre los cuatro rankings del dashboard anterior, y su barra apilada de cuatro colores se lee mal en filas pequeñas.
- **Mapa:**
  - la rampa de color va de 0 a 100 %, así que en ocupación (valores entre 70 y 100 %) todas las calles salen azul oscuro, y en vacíos (10 a 30 %) casi desaparecen sobre el fondo;
  - no hay nombres de calle ni resaltado al pasar el cursor, y no está conectado con los rankings;
  - hoy es un adorno, no la pieza central.

## 4. Errores de visualización (guía `dataviz`)

1. **El mismo color con dos significados.**
   - Azul es Comercio y también «Sí», «confirmada» y el acento.
   - Naranja es Servicios y también «No».

   En «Respuestas por canal» o en Comparar se confunde identidad con estado. Sí/No necesita una pareja propia: azul oscuro y gris claro.
2. **Gráficos de una sola barra al 100 %:** «Fuente de la clasificación», «Estado de la revisión digital» y «Completitud» (seis barras al 99,8 %). Deben ser una frase o un indicador.
3. **Rampa del mapa y de las tablas de calor mal ajustada.** Hay que:
   - ajustar el dominio a los datos (o usar cortes por cuantiles);
   - que el tono más claro se vea sobre el fondo;
   - distinguir bien el gris de «pocos datos».

   Además, el texto oscuro sobre azul medio (40–55 %) no garantiza contraste 4,5:1.
4. **Histogramas con intervalos desiguales dibujados con el mismo ancho:** la fachada (<3, 3–5, 5–8, 8–12, 12–20, ≥20 m) y las reseñas (0, 1–10, … >500). Deben usar intervalos iguales o presentarse como tabla de frecuencias.
5. **Anillo que mezcla bases:** los sectores son una parte de los ocupados, pero los vacíos son una parte de los observados. Mejor una barra horizontal «ocupados por sector | vacíos» con su tabla.
6. **Diagrama de caja de seguidores ilegible** con mediana 0. Mejor el «% con seguidores registrados» y la mediana entre quienes los tienen.

## 5. Observaciones por pestaña

| Pestaña | Observaciones |
|---|---|
| **Resumen** | • El 579/860 se repite (bloque azul y «Locales físicos identificados»).<br>• «Correspondencias pendientes» en ámbar es una tarea de oficina, no un resultado: debe ir a Cobertura.<br>• «Cómo leer estas cifras» queda al final. |
| **Comercio** | • «Peso en ocupados» y «Peso en observados» confunden; basta con una cifra y su denominador.<br>• La tabla por CP no informa cuando un CP reúne casi todo (859 frente a 1).<br>• Hay categorías «Sin detalle» u «Ocio» que revisar en la taxonomía histórica. |
| **Servicios** | • En la barra «resto de la calle» se ven segmentos grises sin leyenda.<br>• Muchos empates sin criterio visible de desempate. |
| **Hostelería** | • «Tipos de establecimiento» y «Actividades más frecuentes» casi se duplican.<br>• Cifras con muestras pequeñas (17 de 45) con el mismo peso que otras con n = 474: hay que marcarlas. |
| **Locales vacíos** | • «Fachada media» con mediana en el subtítulo: elegir una medida.<br>• El ranking ordena por número de vacíos y el indicador destacado es por tasa: falta un conmutador entre recuento y tasa.<br>• La «relación vacíos/total» muestra filas «0 / 10», que no dicen nada.<br>• El mapa queda al final y casi invisible. |
| **Digitalización 1** | • La tabla de calor por calle colorea con fuerza porcentajes con n de 8 a 10 y tiene columnas de ancho desigual.<br>• La fila no se puede pulsar («pulse en el filtro superior»).<br>• Queda un hueco bajo el mapa estrecho de Medina. |
| **Digitalización 2** | • «Seguidores Instagram: 0» (mediana con muchos ceros) es engañoso.<br>• La «Lectura ejecutiva», lo más útil para un informe, va al final. |
| **Cobertura y calidad** | • La trazabilidad es excelente, pero los pasos solo se distinguen por el color del borde.<br>• En correspondencias, «Confirmada» y «Probable» son tonos casi iguales. |
| **Comparar** | • Calcula diferencias («+702») entre ámbitos distintos, aunque el aviso diga que no son comparables: con ámbitos distintos hay que ocultar la diferencia.<br>• La identidad de cada campaña se codifica de forma incoherente (gris frente a colores de sector). |

**Problema transversal de credibilidad.** El aviso «Histórico importado» es un texto fijo («sin convertir al catálogo 2026», «origen importado»). En la campaña Medina 2025 de la demostración, la misma pantalla muestra «Clasificación 2026 confirmada 100 %» y revisiones digitales «verificadas». El aviso tiene que generarse a partir de las fuentes reales de cada campaña.

## 6. Propuesta concreta de ajustes

### A. Resumen: el mapa y los cuatro rankings como protagonistas (prioridad 1)

Esquema de la primera pantalla a 1365 px:

```
┌ Barra compacta: Ámbito ▾ · Año [2026|2025] · Franquicia · Sector · CP · Calle (con búsqueda) · Limpiar · 579 de 579 ┐
│ (aviso de histórico como marca de una línea junto al año, con su texto real)                                        │
├ Pestañas ──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ KPI en una sola tira: Locales observados · Ocupación % · Vacíos (tasa) · Negocios · Franquicia %                       │
├──────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────┤
│                                              │  Comercio (top 5)        │  Servicios (top 5)                      │
│   MAPA (≈7 columnas, ≈420 px de alto)        │  ───────────────         │  ───────────────                        │
│   Capa: Ocupación | Comercio | Servicios |   │                          │                                         │
│         Hostelería | Vacíos                  ├──────────────────────────┼─────────────────────────────────────────┤
│   Leyenda con cortes ajustados a los datos   │  Hostelería (top 5)      │  Locales vacíos (top 5)                 │
│   Pasar el cursor por una calle → resaltado  │  ───────────────         │  ───────────────                        │
│   en el mapa y en los 4 rankings             │                          │                                         │
└──────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────┘
  Debajo: distribución por grupos (una barra + tabla) · datos destacados · perfil de sectores · cómo leer las cifras
```

1. **Barra superior compacta** (de unos 470 a unos 200 px):
   - ámbito y años en línea, sin el párrafo descriptivo;
   - el aviso de histórico, de una línea;
   - el desplegable de calles con búsqueda.
2. **Tira de 5 KPI** en lugar del bloque azul con 6 tarjetas. «Correspondencias pendientes» y «Cobertura del ámbito» pasan a Cobertura y calidad.
3. **Mapa grande**, de unas 7 columnas y unos 420 px de alto:
   - selector de capa (ocupación, comercio, servicios, hostelería, vacíos);
   - rampa con cortes ajustados a los datos;
   - nombres de las calles destacadas y resaltado al pasar el cursor;
   - grosor del trazo según el número de establecimientos.
4. **Cuatro rankings simultáneos (top 5)** en una rejilla de 2×2, todos con el mismo esquema de fila: calle, barra en el color del sector y «n · % de la calle». Sincronizados con el mapa: al pasar el cursor por una calle, se resalta en todos.
5. **Sin geometría** (como en el escenario ficticio), el hueco del mapa lo ocupa una **matriz calle × sector**: 15 o 20 calles con comercio, servicios, hostelería y vacíos como tabla de calor. Es territorial y mantiene la comparación simultánea. No se inventa ningún mapa.
6. **Sin redundancias:**
   - una sola representación de la distribución por grupos (barra «ocupados por sector | vacíos» con su tabla);
   - se retiran el anillo y la barra «Peso de cada sector».

### B. Utilidad para informes de la Cátedra (prioridad 1)

1. En cada bloque, un menú **«⋯»** con «Copiar tabla», «Descargar CSV» y «Descargar imagen (PNG/SVG)».
2. Un **pie de cita** automático en cada bloque: «Fuente: ULIT Censo · Medina del Campo · Censo 2025 · n = 579 observados · filtros: … · fecha».
3. **Versión imprimible** (`@media print`): A4 apaisado, sin la cabecera oscura, con los bloques sin cortar entre páginas y los filtros activos impresos.
4. **La URL conserva la vista** (pestaña y filtros) para enlazarla o volver a ella.
5. **Los filtros activos se muestran como etiquetas** que se pueden quitar una a una.

### C. Credibilidad y coherencia (prioridad 1)

1. El aviso de histórico se **calcula** con las fuentes reales: clasificación (texto histórico, propuesta o confirmada) y origen o estado de la franquicia y de la presencia digital.
2. En Comparar, con **ámbitos distintos** se ocultan las diferencias aritméticas y se pide confirmarlo.
3. Las **muestras pequeñas** se marcan visualmente (n por debajo del umbral, en gris y con la n visible).

### D. Visualización y legibilidad (prioridad 2)

1. **Paletas:**
   - Sí/No con colores propios, distintos de los de los sectores;
   - «Confirmada» y «Probable» claramente distintas;
   - se validan otra vez con `validate_palette.js`.
2. **Rampa secuencial:** el tono más claro visible sobre el fondo, cortes ajustados a los datos y texto con contraste garantizado.
3. **Barras de un solo valor** sustituidas por frases o indicadores.
4. **Histogramas** con intervalos iguales o como tabla de frecuencias.
5. **Seguidores:** el «% con seguidores» y la mediana entre quienes los tienen; el diagrama de caja solo si la distribución lo permite.
6. **Tamaño mínimo de texto:** 12 px en el contenido, 11 px solo en rótulos en mayúsculas. Corregir los grises que no llegan a AA y la jerarquía de encabezados (h1 → h2 → h3).

### E. Por pestaña (prioridad 2–3)

- **Sectores:** un solo «peso» con su denominador; ocultar el desglose por CP si un CP reúne más del 95 %; fusionar los dos niveles cuando casi coinciden (hostelería).
- **Vacíos:**
  - conmutador recuento/tasa en el ranking;
  - mapa de vacíos arriba (o la matriz si no hay geometría);
  - una sola medida de fachada;
  - retirar las filas «0 / n».
- **Digitalización 1:** filas de la tabla de calor que se puedan pulsar, columnas de ancho uniforme, celdas con poca n atenuadas y mapa a todo el ancho.
- **Digitalización 2:** «Lectura ejecutiva» arriba; seguidores como proporción y mediana condicionada.
- **Cobertura:** trazabilidad como flujo con flechas y texto (no solo con el color).
- **Comparar:** colores de campaña coherentes («antes» en gris y «ahora» en color, siempre); avisar en lugar de dibujar comparaciones vacías («Sin clasificar 100 %»).

### F. Fuera de este cuadro de mando

- La **barra superior de la aplicación** desborda a 1365 px: la página llega a 1418 px de ancho y el nombre del municipio se parte en tres líneas. Es de la estructura general de la app; conviene arreglarlo en una tarea propia.

## 7. Orden de implementación recomendado (cuando se autorice)

1. **A + C:** Resumen con el mapa y los cuatro rankings, barra compacta, aviso calculado y Comparar con ámbitos distintos.
2. **B:** exportar, copiar, imprimir, URL y etiquetas de filtros.
3. **D:** paletas, rampa, histogramas y legibilidad.
4. **E:** ajustes por pestaña.

Cada paso con sus pruebas, capturas a 1365×768 de la primera pantalla y de la página completa, y revisión con el detector de `impeccable`.

## 8. Capturas de referencia (diseño actual, 1365 px)

Generadas con Playwright fuera del repositorio:
- `escenario2025-*`: escenario ficticio sin geometría;
- `medina2025-*`: demostración con geometría;
- para cada pestaña, la página completa (`1-resumen` … `9-comparar`) y la primera pantalla (`0-pliegue-resumen`).

No se suben al repositorio porque son imágenes de trabajo. Se entregan aparte en la conversación de revisión.

## 9. Relacionado

- **Corrección pendiente C1c-1** (varios locales en el mismo portal): `C1C-INCORPORACION.md`, sección 12.1. Cambiará las cifras de locales, establecimientos sin local y correspondencias que muestra este cuadro de mando.
