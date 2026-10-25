# UX1 · Experiencia simplificada

**Objetivo:** que cualquier integrante de la Cátedra pueda trabajar con pocas instrucciones, sin perder comprobaciones ni trazabilidad. No cambia ningún dato ni ninguna regla: es otra forma de presentar lo mismo.

## Pantalla de inicio (`/espacios/<espacio>`)

- **Arriba:** municipio y campaña. Las campañas se agrupan en «En curso (operativas)» y «Censos anteriores (históricas)», con una etiqueta de color distinta para cada una. Desde aquí también se crean campañas y municipios.
- **Cuatro accesos con cifras reales** (`src/domain/resumenCampana.ts`). Todas salen de los datos guardados; no se inventa ninguna:
  1. **Itinerarios:** número de itinerarios y cuántos no tienen Excel. Permite crearlos, consultarlos, incorporar su Excel e ir a sus incidencias.
  2. **Incorporar Excel:** el asistente de siempre en modo sencillo.
  3. **Incidencias:** solo lo que necesita intervención, es decir, filas sin local y locales con datos que no coinciden y sin decidir. Las decisiones tomadas quedan plegadas, con «Deshacer» y «Retirar».
  4. **Censo:** locales únicos con su estado (ocupado, vacío o sin estado seguro), búsqueda y, plegado, el desglose por itinerario y los cruces.
- **Abajo:** «Copia de seguridad» (respaldo) y **«Vista completa»** (`/espacios/<espacio>/avanzado`), que es la interfaz anterior íntegra.
- **Memoria de la elección:** el municipio, la campaña y el acceso elegidos se recuerdan en este navegador. Es solo comodidad; si no está disponible, no pasa nada.

## Asistente en modo sencillo

Los mismos seis pasos, agrupados en cuatro:

1. **Archivo.** El destino lo fija la campaña elegida; en una campaña operativa solo se elige el itinerario.
2. **Comprobar.** Columnas y diagnóstico. Si las columnas se reconocen, el detalle queda plegado.
3. **Decidir.** Si no hay nada pendiente se indica; si lo hay, las decisiones se muestran abiertas.
4. **Confirmar.** Muestra un resumen y solo los requisitos que faltan. El respaldo se puede hacer ahí mismo, sin la opción de restaurar.

Todas las validaciones, bloqueos, decisiones, el respaldo comprobado obligatorio y la confirmación son los mismos (`requisitosIncorporacion`). El detalle completo sigue accesible en cada paso con «Ver…».

## Pruebas

- **`src/workspaces/espacios/inicio.test.tsx`:** recorre los cuatro accesos con sus cifras, crea un itinerario e incorpora IT1 e IT2 desde el inicio, con el respaldo exigido. Después vincula una incidencia, consulta el censo con búsqueda, comprueba la persistencia al volver a abrir y el acceso a la vista completa. También comprueba que una campaña histórica se distingue.
- Las pruebas de interfaz anteriores siguen pasando contra la vista completa.
