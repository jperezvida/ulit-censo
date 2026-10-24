# G1 · Perfiles de importación configurables

**Objetivo:** que ULIT Censo reciba Excel de cualquier municipio, año o formato **sin cambiar el código**.

## Cómo funciona

1. **Catálogo común de campos** (`src/domain/xlsx/camposImportacion.ts`): los datos que ULIT sabe interpretar.
   - **Obligatorio:** una columna de localización, la **calle** o la **dirección completa** (calle y número en una sola celda). El número de portal es **opcional**. Detalles en «Localización incompleta».
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
4. **Obligatorio:** se marca si falta la calle o la dirección completa. Si falta la columna del número, solo se avisa. Un dato ya asignado a otra columna no se puede volver a elegir.
5. **«Así se leerán las primeras filas»:** vista previa con los datos elegidos.
6. **Guardar para la próxima vez** (opcional). Guarda solo los títulos de las columnas y su dato, **ningún dato del censo**, en una base del navegador separada de los espacios (`ulit-censo-perfiles`).
7. **«Analizar con estas columnas»:** solo se activa con la calle o la dirección completa asignada y sin columnas dudosas.

## Localización incompleta

Antes, la calle y el número de portal eran columnas obligatorias. Por eso no se podían importar censos sin número, con «S/N» o con la dirección completa en una sola celda. Ahora:

| Caso del archivo | Qué se hace |
|---|---|
| Calle y número en columnas propias | Igual que antes |
| Sin columna de número | Se importa. La calle se reconoce, pero **no se crea ningún local físico**: el vínculo con el portal queda pendiente (motivo «Número desconocido») |
| Número «S/N» | Se importa. Queda como «Dirección S/N», pendiente de una decisión |
| Dirección completa en una celda («Domicilio completo», «Dirección completa»…) | El texto se conserva **literal**. Sin más, todos esos registros quedan pendientes de vínculo (motivo «Dirección completa sin separar») |

**Separar la dirección completa.** Solo se hace con la regla `direccion-completa-coma`, de clase *propuesta*: no se aplica si no la autoriza una persona en «Decisiones». Es deliberadamente estricta y separa solo:
- una **única coma**;
- la calle **sin cifras**;
- y, tras la coma, **solo** un número de portal: «12», «12 B», «12 bis» o «S/N».

| Ejemplo | Resultado con la regla autorizada |
|---|---|
| «Calle Mayor, 12» · «Calle Mayor, 3 B» | Calle Mayor + número |
| «Plaza Mayor, S/N» | Calle + «S/N» (pendiente, como cualquier S/N) |
| «Calle Mayor 12» (sin coma) | No se separa |
| «Calle Mayor, 12, 2º B» · «Calle Mayor, 12 izq.» · «Calle Mayor, 12-14» | No se separa |
| «Calle 2 de Mayo, 5» (la calle tiene cifras) | No se separa (se concilia a mano) |

Lo que no se separa se conserva igual y queda pendiente. Nunca se inventa un número ni se adivina dónde termina la calle.

**Siempre:**
- **Registro original:** cada fila conserva su registro de origen con las celdas tal como venían en el Excel, aunque no tenga ningún vínculo.
- **Locales físicos:** solo se crean, como antes, con estas tres condiciones:
  - una calle con correspondencia **única** en el callejero (o conciliada por una persona);
  - un número de portal;
  - el estado del local (vacío u ocupado) conocido.

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
- `src/domain/localizacion.test.ts`, con los casos sintéticos:
  - **D**, «Lugar Sintético del Valle 2021», sin columna de número;
  - **E**, «Monte Sintético 2020», con la dirección completa en una celda.

  Comprueba:
  - la correspondencia;
  - la regla de separación, con 12 ejemplos válidos y no válidos;
  - que, sin autorizar la regla, todo queda pendiente;
  - que, con la regla autorizada, solo se crean locales con calle única y número, cada uno con exactamente el portal escrito;
  - que el registro original se conserva íntegro;
  - que los formatos actuales (Medina, A, B) siguen leyendo calle y número de sus columnas.
- `src/workspaces/espacios/columnas.test.tsx`: el paso «Columnas» en pantalla con los casos:
  - C: correspondencia manual, guardar y reutilizar el perfil;
  - A: cabecera en la fila 3;
  - D: sin número, y la misma columna relacionada a mano como dirección completa.
- Las pruebas de C1e siguen pasando: el análisis del Excel real usa el perfil de referencia de Medina 2025 y su comparación expresa.

## Corrección visual

La barra superior era más ancha que la ventana (hasta 1595 px en una de 1440). Por eso toda la página se desplazaba en horizontal y los paneles parecían descolocarse.

Corregido:
- **Barra superior:** la navegación cede espacio, los botones pasan a solo icono en pantallas medianas y los textos largos se acortan.
- **Cabecera de Espacios y menús desplegables:** se adaptan al ancho y no salen de la ventana.
- **Etiquetas y pestañas:** en pantallas estrechas pasan a la línea siguiente en vez de salirse.
- **Indicador de etapas:** ya no se parte en dos líneas.

**Comprobación:** con un navegador, ninguna ruta ni vista interactiva desborda a 1440, 1366, 1024, 768 ni 390 px. Se comprobaron la ficha abierta, el menú de rol y los pasos del asistente.
