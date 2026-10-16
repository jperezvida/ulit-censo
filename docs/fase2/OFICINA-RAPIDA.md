# ULIT Censo · Oficina rápida (B2 y B3)

Guía para probar la Oficina organizada por itinerarios y la tabla de revisión rápida. **Todos los datos son ficticios**: la demostración de Medina del Campo es simulada y el escenario de rendimiento usa un municipio inventado (Villaficticia).

## 1. Abrir la demostración

### En GitHub Codespaces

1. En GitHub, abre la rama `claude/fase2-oficina-itinerarios` → botón **Code** → pestaña **Codespaces** → **Create codespace on claude/fase2-oficina-itinerarios**.
2. En la terminal del Codespace:

   ```bash
   npm ci
   npm run dev -- --host
   ```

3. Codespaces avisará de que el puerto **5173** está disponible: pulsa **Open in Browser** (o abre la pestaña **Ports** y el globo del puerto 5173).
4. En el navegador, ve a `…/#/oficina`.

El Codespace no necesita claves, Supabase ni servicios externos. Los cambios se guardan en el navegador (IndexedDB) y no salen de él.

### En local

```bash
npm ci
npm run dev        # http://localhost:5173/#/oficina
```

### Volver al estado inicial

Botón **Guion** (arriba a la derecha) → **Restablecer demo**.

## 2. Qué probar

| Escenario | Cómo |
|---|---|
| Itinerario con campo terminado y oficina pendiente | Oficina → tarjeta **IT-C** (Medina) o **IT-1** (Villaficticia) → «Categorización». |
| Filtrar por tarea | Pestañas **Categorización · Franquicias · Presencia digital · Incidencias y contradicciones · Todos**; filtros **Pendientes · Con errores · Con incidencias · Revisados · Sin visitar · Todos**; búsqueda instantánea. |
| Modificar varios negocios solo con el teclado | Flechas hasta la columna «Actividad» → empieza a escribir (o Enter/F2) → Enter confirma y baja. |
| Copiar y pegar | Mayús+flechas para seleccionar → Ctrl+C → mover → Ctrl+V. Un valor sobre un rango lo rellena entero. |
| Deshacer / rehacer | Ctrl+Z / Ctrl+Y (o los botones de la barra inferior). Una operación confirmada = un paso. |
| Cambiar de modo sin perder estados | Botón **Por tareas / Por establecimientos**. Se recuerda por persona: cámbiala en el menú de roles (arriba a la derecha) → «Persona de demostración». |
| Calles compartidas por aceras | Villaficticia: «Calle Ficticia Repartida» (pares en IT-1, impares en IT-2) y «Calle Ficticia por Segmentos». |
| Itinerario cerrado | **Cerrar revisión (provisional)** → la tabla pasa a solo lectura. **Reabrir** exige motivo. |
| Cronología incierta | Villaficticia, IT-1 → «Incidencias y contradicciones» → icono de reloj (o «Asignar fechas» en el modo por establecimientos). |
| Rendimiento | Guion → escenario 13 (unos 5.000 registros ficticios) → vista general municipal → «Todos los registros». |

## 3. Teclado de la tabla

| Tecla | Acción |
|---|---|
| ↑ ↓ ← → | Mover la celda activa |
| Mayús + flechas | Ampliar la selección |
| Tab / Mayús+Tab | Siguiente / anterior celda (también confirma la edición) |
| Enter o F2 | Editar la celda · Enter de nuevo confirma y baja |
| Escribir | Empieza a editar sustituyendo el contenido |
| Esc | Cancelar la edición |
| Supr | Vaciar las celdas seleccionadas |
| Ctrl+C / Ctrl+V | Copiar / pegar rangos (compatible con Excel) |
| Ctrl+Z / Ctrl+Y | Deshacer / rehacer |
| Ctrl+Enter | Abrir la ficha (con histórico y conciliación) |
| AvPág / RePág, Inicio / Fin | Saltos de página y de fila |

**Valores que admite cada columna:**

- Respuestas digitales: `sí`/`1`/`x`, `no`/`0`, `N/A`, `¿?` (sin información) y vacío (pendiente).
- Cantidades: `37`, `4,5`, `1.250`.
- Actividad: el nombre exacto del catálogo provisional, con la lista desplegable del navegador.

**Pegado atómico:** si alguna celda no es válida o no se puede editar (solo lectura, itinerario cerrado, local pendiente de visita), **no se aplica ninguna**. La barra inferior explica el motivo y marca la celda en rojo.

## 4. Reglas que se respetan

- **Ámbito efectivo del itinerario.** La pertenencia se calcula por calle, acera según el número y segmento. Desde un itinerario no se puede modificar un registro de otro: el dominio lo rechaza aunque la interfaz lo intentara.
- **Seguimiento completo.** Los locales de la campaña anterior todavía no visitados aparecen como «Sin visitar» con sus datos de referencia. Las calles sin locales conservan su cobertura.
- **Cierre provisional.** Registra quién y cuándo, y bloquea la edición en esa campaña. **No** es apto para la exportación municipal: la validación definitiva sigue rechazándose hasta el bloque C.
- **Sin separación obligatoria de funciones.** Quien categoriza puede hacer también la revisión final.
- **Solo lectura en campañas cerradas.** Las campañas históricas o validadas se consultan, pero no se editan desde Oficina.

## 5. Pendiente para B4 y B5

- **B4 · Catálogo 2026 y autocompletado.**
  - Catálogo depurado por estructura de grupo (Comercio, Hostelería y Restauración, Servicios), con excepciones y equivalencias.
  - Autocompletado avanzado con búsqueda por niveles y sugerencia por nombre del negocio.
  - Avisos de clasificación sospechosa.
  - Hoy la columna «Actividad» usa la lista provisional del navegador.
- **B5 · Operaciones rápidas.**
  - Teclas de respuesta inmediata (1/0/N/?) sin abrir el editor y edición múltiple con acciones masivas.
  - «Partir de 2025» por filas y columnas «2025» de solo lectura.
  - **Estado independiente de franquicias**: hoy se muestra «pendiente de B5» y no se inventa progreso.

La tabla ya está preparada para ello: un nuevo editor o una nueva columna se añaden en `src/workspaces/office/tabla/columnas.tsx` sin tocar la navegación, el pegado ni el deshacer.
