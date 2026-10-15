# ULIT Censo · diseño del prototipo (fase 1)

## Principios

1. **Calle, itinerario, local, negocio, ocupación y observación son entidades distintas.**
   - Una fila de Excel (`RegistroOrigen`) nunca es el local.
   - El vínculo entre la fila y el local es una entidad propia (`VinculoHistorico`) con un nivel de confianza: confirmada, probable, dudosa o sin vínculo.
2. **La cobertura se declara, no se deduce.** Una calle se cierra con «Finalizar calle», indicando las aceras recorridas y el resultado:
   - completada con locales;
   - completada sin locales;
   - parcial o con incidencias.
3. **Sin relaciones inventadas.**
   - Una fila que desaparece no es un cierre.
   - Una «posible desaparición» queda pendiente de revisión.
   - Aperturas y cierres solo cuentan con correspondencia confirmada; el resto aparece como *indeterminado*.
4. **Lo digital pertenece al negocio y a la campaña.**
   - `MetricaDigital` se guarda por negocio y campaña, con fecha y estado de verificación.
   - Un negocio nuevo en un local no hereda perfiles.
   - Un dato de 2025 solo se puede copiar como borrador **sin verificar**.
5. **Cuatro estados de revisión independientes** por registro: campo, categorización, digital y validación. Un campo terminado no es un censo terminado.
6. **Planificar no toca el histórico.** Las operaciones de itinerario solo cambian itinerarios y ámbito; locales y observaciones no se modifican (está cubierto por pruebas).

## Modelo de datos (`src/domain/types.ts`)

```
Municipio · Calle (segmentos[]) · Campaña (ámbito, ampliación, referencia, 4 estados)
Itinerario → TramoPlan (calle, segmentos?, acera, orden, responsable, etiqueta)
Cobertura (campaña × calle × acera)  ·  SituacionPrevia (manual, opcional)
LocalFisico (direcciones[] con historial de numeración, estado, relaciones)
Negocio · Ocupacion (local × negocio|vacío × periodo) · Observacion (fuente, investigador, verificación)
RegistroOrigen (fila inmutable) · VinculoHistorico (confianza, candidatos) · Importacion
Revision (campaña × local: campo, categorización, digital, validación) · MetricaDigital (negocio × campaña)
Persona (roles[]) · NodoActividad (4 niveles) · PendienteSync (simulado)
```

**Tramos.** Por defecto, una calle es un único tramo con todos sus segmentos y ambas aceras. La división por segmentos o aceras es una opción avanzada; los solapes se detectan por acera y por segmento.

**Situación previa de una calle sin registros:**

- con registros;
- no censada;
- censada sin locales;
- sin información;
- pendiente de relacionar.

En un censo importado sin itinerarios, la ausencia de filas da «sin información», nunca «sin locales».

## Arquitectura técnica

- **Herramientas:** Vite, React 18 y TypeScript estricto. Pruebas con Vitest y Testing Library.
- **Estado:** Zustand, persistido en IndexedDB.
  - Todas las operaciones de dominio son **funciones puras `BaseDatos → BaseDatos`** (`src/domain/*`).
  - Esto permite deshacer y, más adelante, reproducir esas mismas operaciones en un motor de sincronización.
- **Mapa:** MapLibre GL.
  - Teselas vectoriales y estilo propio desaturado.
  - Las capas del censo son GeoJSON y se pintan aunque no cargue el mapa base.
  - Los números de calle se dibujan como marcadores HTML, así que no dependen de fuentes remotas.
- **Tabla de oficina:** virtualizada con `@tanstack/react-virtual`.
- **Callejero:** `src/data/callejero.ts`. Prueba, por orden: instantánea OSM, Overpass desde el navegador y callejero simulado.
- **Datos de demostración:** `src/data/semilla.ts`, con un generador de semilla fija.
  - El campo de IT-C y el progreso de IT-A se producen con las mismas funciones de dominio que usa la app.

## Decisiones que conviene validar en la fase siguiente

| Decisión | Motivo |
|---|---|
| Estructura real del Excel 2025 y taxonomía de 4 niveles | Hasta ahora se usan columnas y literales provisionales. |
| Identificación de los cuatro itinerarios reales (KML) e `IT 2 MEDINA.pdf` | Permitirá sustituir IT-A a IT-D. |
| Criterios de carga de trabajo | La estimación actual es orientativa: 2,5 km/h, 1,5 min por local y 4 min por cada 100 m sin registros. |
| Proveedor de cartografía offline | Debe tener una licencia que permita el uso sin conexión. |
| Motor de sincronización y resolución de conflictos | Hasta ahora es una simulación. |
