# C1e · Diagnóstico corregido, conciliación supervisada de calles y revisión por clases

Ajustes tras analizar el Excel **auténtico** de Medina del Campo 2025 en la vista previa (C1e-B, sin guardar). El archivo auténtico **no** se ha usado ni está en el repositorio. Los casos se reproducen con el archivo **sintético** (`npm run sintetico-c1e`).

La confirmación definitiva sigue **bloqueada** (`CONFIRMACION_REAL_HABILITADA = false`) y 2026 no se modifica.

## 1. Diagnóstico corregido

| Indicador | Antes | Ahora | Referencia |
|---|---|---|---|
| Pares calle + número distintos | 630 | **625** | 625 |
| Registros en direcciones compartidas (recuento textual) | 440 | **445** | 445 |
| · de ellos, «S/N» agrupados por calle | — | **3** | — |
| · de ellos, en portales **numéricos** compartidos (regla de C1b) | (442 en las señales) | **442** | — |
| Pares sin normalizar la calle (informativo) | — | 630 | — |

Las cifras de «Ahora» son las del archivo sintético, que reproduce los casos del auténtico. En el auténtico deben salir las mismas; está pendiente de que lo compruebes en la vista previa.

**Causa.** El auténtico tiene dos grafías de la misma calle, «Calle de las Angustias» y «Calle de las angustias», en los portales 37, 39, 42, 46 y 48.

**Calle normalizada.** Los pares se cuentan ahora con la calle normalizada (sin distinguir mayúsculas ni espacios) y el número tal como figura. Es el mismo criterio que usa C1b para agrupar locales del mismo portal (`claveDenominacion`). Los valores originales **no se modifican**: las dos grafías se conservan tal cual en cada registro.

**Dos conceptos distintos:**
- **Recuento textual** (445, el del diagnóstico de referencia): agrupa también los «S/N» de una misma vía. En el auténtico son 3 registros, «Carretera de Peñaranda, S/N» (filas 750, 752 y 753).
- **Portales numéricos compartidos** (442, regla informativa de C1b «Varios establecimientos en el mismo portal numérico»): solo números de portal. Un «S/N» no identifica un portal y no se agrupa.

En los dos casos cada registro es un **local independiente**: nunca se fusionan.

## 2. Conciliación supervisada de calles (Decisiones → **Calles**)

Para cada denominación que no coincide con el callejero se muestran la denominación del archivo, el número de registros afectados, las propuestas de calle del callejero con su **fuente** y la decisión.

**Fuentes de propuesta** (`src/domain/conciliacionCalles.ts`):

| Fuente | Ejemplo | ¿Basta por sí sola? |
|---|---|---|
| La denominación incluye el nombre actual y el antiguo | «Calle de las Farolas Antigua Ángel Molina» → Calle de las Farolas | Orienta; requiere confirmación |
| La denominación contiene el nombre completo de una calle | «Calle X (tramo…)» → Calle X | Orienta; requiere confirmación |
| Abreviatura de tipo de vía no reconocida automáticamente | «Rda. de Gracia» → Ronda de Gracia | Orienta; requiere confirmación |
| Mismo nombre con otro tipo de vía | «Gracia» → Ronda de Gracia | Débil: se avisa |
| Referencia comunicada por la Cátedra | «Plaza Mayor» → Plaza Mayor de la Hispanidad | Solo si existe en el callejero |
| Solo parecido del texto | «Calle de las Farolaz» → Calle de las Farolas | **No**: se avisa y se pide la fuente que lo confirma |

**Reglas:**
- **Nada se aplica solo.** Cada decisión la toma una persona con rol de coordinación o administración, con fecha y **justificación obligatoria**. Vincula **todos** los registros de esa denominación.
- **Opciones:** confirmar una propuesta, elegir otra calle del callejero o dejar constancia de que la denominación **no tiene correspondencia**.
- **Trazabilidad:** las decisiones (`decisiones.calles`) se validan en el plan (persona, fecha, justificación, calle del municipio, denominación presente en el archivo) y se guardan en la traza de la incorporación. Las filas vinculadas así figuran como correspondencia **decidida**, no inequívoca.
- **El texto original** de la dirección se conserva siempre.
- **Plaza Mayor de la Hispanidad no está en la instantánea OSM actual**: comprobado por prueba automática, ni con otro tipo de vía. No se crean calles, geometrías ni coordenadas. «Plaza Mayor» solo puede quedar pendiente o marcada como «sin correspondencia»; sus registros se conservan sin vínculo territorial.
- **Prioridad:** la lista se ordena por número de registros y marca como «Prioritaria» las cuatro primeras. En el auténtico son Plaza Mayor (45), Calle de las Farolas Antigua Ángel Molina (42), Ronda de Gracia (19) y Ronda de las Flores (13).

## 3. Revisión de incidencias por clases

Los elementos de revisión (978 en el auténtico) se separan en tres clases, con tarjetas que filtran el visor:

- **Errores efectivos:** valores imposibles en el origen («Local Vacío» sin valor, fecha que no es fecha, 0/1 con otro número…). El original se conserva y la celda queda sin valor interpretado.
- **Pendientes de comprobar:** avisos, conciliaciones de calle o número y reglas pendientes de la Cátedra.
- **Informativos:** se registran sin exigir acción. Incluyen los portales numéricos compartidos y la **clasificación histórica 2025**, que se conserva literalmente y **no** tiene que equivaler a la de 2026 (la equivalencia, si se quiere, se registra aparte como propuesta sin confirmar).

**Revisión en bloque (Decisiones → «Revisión en bloque»).** Un grupo del mismo tipo que solo requiere revisión humana se puede dar por revisado de una vez, con justificación obligatoria:
- **No cambia ningún dato** ni ninguna interpretación. El plan es idéntico; solo queda constancia trazada (`decisiones.revisionesBloque`).
- **No se puede** para lo que depende de la Cátedra, ni para las posibles filas de totales o los duplicados exactos, que se deciden fila a fila.

## 4. Pruebas (todas con datos sintéticos)

- `src/domain/c1e-medina-diagnostico.test.ts`:
  - 625 / 186 / 445 frente a 630 / 440 sin normalizar; 3 «S/N» y 442 portales numéricos;
  - las dos grafías y los «S/N» se conservan, sin fusionar locales; 889 filas y sus fechas;
  - 21 denominaciones y 177 registros pendientes; propuestas y fuentes de las cuatro prioritarias; ausencia de Plaza Mayor de la Hispanidad en OSM;
  - la similitud textual nunca vincula sola;
  - una decisión vincula los 42 registros sin alterar el original y queda en la traza; las decisiones no válidas bloquean el plan;
  - clases de revisión y revisión en bloque, que no cambia el plan.
- `src/workspaces/espacios/analisis.test.tsx`: flujo en pantalla del análisis **sin guardar**. Incluye diagnóstico corregido, clases, conciliación de «Farolas» con justificación y revisión en bloque. No se escribe nada en IndexedDB.
