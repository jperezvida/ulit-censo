# G1 · Perfiles de importación configurables

**Objetivo:** que ULIT Censo reciba Excel de cualquier municipio, año o formato **sin cambiar el código**.

## Cómo funciona

1. **Catálogo común de campos** (`src/domain/xlsx/camposImportacion.ts`): los datos que ULIT sabe interpretar.
   - **Obligatorios:** calle y número de portal.
   - **Recomendados:** fecha, local vacío y nombre.
   - **Opcionales:** clasificación, presencia digital, territorio e itinerario.
   - Cada campo tiene su tipo y sus sinónimos para reconocerlo.
2. **Perfil de importación = datos, no código** (`PerfilImportacion`). Indica:
   - qué cabecera del Excel corresponde a cada campo;
   - en qué hoja y en qué fila están los títulos;
   - qué columnas **adicionales** se conservan.

   Los perfiles tienen versión: si se cambia una correspondencia y se guarda con el mismo nombre, se crea la versión siguiente y las anteriores se conservan.
3. **Correspondencia de columnas** (`src/domain/xlsx/correspondencia.ts`):
   - **Automática solo si es fiable:** la cabecera coincide con un perfil compatible, o con un sinónimo del catálogo, y **ninguna otra columna compite** por ese campo.
   - **Dudosa:** si dos columnas pueden ser el mismo dato («Dirección» y «Dirección fiscal») no se asigna ninguna; decide la persona.
   - **Adicional:** las columnas que no son datos de ULIT se conservan tal cual (en la capa original y en el registro de origen) y no se interpretan.
   - **Sin columna:** si un campo no tiene columna, no se inventa ningún valor.
4. **Detección de la hoja y de la fila de títulos.** Se hace con los perfiles y con el catálogo común. Si no basta, la persona elige ambas.

## Perfiles de referencia (incluidos)

| Perfil | Uso |
|---|---|
| Censo municipal histórico · 27 columnas | Formato de la Cátedra, para cualquier municipio |
| Itinerario Medina 2026 · 28 columnas | Formato de los itinerarios 2026 (no se importa como histórico) |
| **Medina del Campo 2025 · censo de referencia** | Formato de 27 columnas **más** el informe agregado (889 registros…) y la huella SHA-256 del archivo auténtico |

Los indicadores y la huella de Medina 2025 son **opcionales** y se comparan **solo** si se elige ese perfil y además:
- el archivo es ese censo (misma huella), o
- la persona marca «Comparar con el informe de referencia».

Con cualquier otro archivo, el diagnóstico muestra los recuentos del archivo **sin compararlos**, y solo los de las columnas que tiene.

## En pantalla: paso «Columnas»

Etapas del asistente: Archivo → **Columnas** → Diagnóstico → Decisiones → Vista previa → Resultado.

1. **Perfil:** «Reconocer automáticamente», uno incluido o uno guardado.
2. **Hoja con los datos** y **fila de títulos**, por si la detección no basta.
3. **Tabla de columnas:** cada columna del Excel con un ejemplo, el **dato de ULIT** (desplegable) y su estado:
   - reconocida;
   - elegida a mano;
   - dudosa;
   - adicional (se conserva).
4. **Obligatorios:** se marca si falta alguno (calle y número). Un dato ya asignado a otra columna no se puede volver a elegir.
5. **«Así se leerán las primeras filas»:** vista previa con los datos elegidos.
6. **Guardar para la próxima vez** (opcional). Guarda solo los títulos de las columnas y su dato, **ningún dato del censo**, en una base del navegador separada de los espacios (`ulit-censo-perfiles`).
7. **«Analizar con estas columnas»:** solo se activa con los obligatorios asignados y sin columnas dudosas.

## Garantías que se mantienen

- No se usa ni se sube el Excel auténtico. Los casos de prueba son sintéticos.
- La confirmación definitiva de datos reales sigue **bloqueada** (`CONFIRMACION_REAL_HABILITADA = false`).
- **Aislamiento** entre la demostración, el ensayo y los datos reales. Los perfiles no contienen datos.
- La campaña operativa de Medina 2026 no se toca. El requisito de incorporación ya no exige un perfil concreto: admite cualquier censo histórico y sigue rechazando los itinerarios 2026.

## Pruebas

- `src/domain/generalidad.test.ts`:
  - los casos A, B y C y las tres variantes del formato Medina, que antes fallaban (G0) y ahora funcionan;
  - columnas dudosas que no se asignan solas;
  - correspondencia manual;
  - perfil guardado y reutilizado con una hoja de otro nombre;
  - hoja y fila elegidas a mano;
  - referencia de Medina aplicada solo cuando corresponde;
  - incorporación en el ensayo con las columnas adicionales en el registro de origen.
- `src/workspaces/espacios/columnas.test.tsx`: el paso «Columnas» en pantalla con los casos C (manual, guardar y reutilizar) y A (cabecera en la fila 3).
- Las pruebas de C1e siguen pasando: el análisis del Excel real usa el perfil de referencia de Medina 2025 y su comparación expresa.

## Corrección visual

La barra superior era más ancha que la ventana (hasta 1595 px en una de 1440). Por eso toda la página se desplazaba en horizontal y los paneles parecían descolocarse.

Corregido:
- **Barra superior:** la navegación cede espacio, los botones pasan a solo icono en pantallas medianas y los textos largos se acortan.
- **Cabecera de Espacios y menús desplegables:** se adaptan al ancho y no salen de la ventana.
- **Etiquetas y pestañas:** en pantallas estrechas pasan a la línea siguiente en vez de salirse.
- **Indicador de etapas:** ya no se parte en dos líneas.

**Comprobación:** con un navegador, ninguna ruta ni vista interactiva desborda a 1440, 1366, 1024, 768 ni 390 px. Se comprobaron la ficha abierta, el menú de rol y los pasos del asistente.
