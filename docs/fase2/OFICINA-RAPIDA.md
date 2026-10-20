# ULIT Censo · Oficina rápida (B2, B3 y B4)

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

## 4. Ficha del establecimiento

- **Ficha lateral compacta** (Ctrl+Enter o el icono ⓘ de la fila):
  - nombre y botón **Ampliar ficha** en la primera línea;
  - en la segunda, indicadores compactos de Campo, Categoría, Digital y Revisión, junto con la dirección y la última observación;
  - pestañas Ficha, Digital, Histórico y Conciliación.
- **Ficha ampliada:** ocupa el área central de Oficina y oculta las pestañas de tarea y los filtros para ganar altura. **Reducir ficha** (o Esc fuera de un campo) vuelve a la tabla con el cursor donde estaba.
- **Pie siempre visible**, a la izquierda:
  - anterior / siguiente (Alt+↑ / Alt+↓);
  - **Siguiente pendiente** (Alt+P);
  - la posición en la vista.
- **Pie siempre visible**, a la derecha:
  - **Devolver**;
  - **Aprobar registro**, que es la revisión general del registro.
- **Presencia digital** en dos grupos:
  - **Web y Google:** web, venta por internet, Google Business Profile, nº de reseñas, responde reseñas y valoración;
  - **Redes sociales:** Instagram, Facebook y Twitter / X con sus seguidores, otras redes y **Nº redes**, calculado como Instagram + Facebook + Twitter.
  - El botón **Verificar presencia digital · «nombre»** está en la barra de la pestaña. Solo verifica lo digital de ese establecimiento y es distinto de «Aprobar registro».
- **Tras verificar** la ficha permanece en el mismo establecimiento, aunque salga del filtro «Pendientes». Para avanzar se usa «Siguiente pendiente».
- **Nada se pierde** al ampliar, reducir o cambiar de ficha: lo tecleado se guarda aunque no se haya pulsado Enter. La pestaña activa se conserva.
- **En móvil** la ficha ocupa toda la pantalla, con el pie por encima de la barra de navegación.

## 5. Reglas que se respetan

- **Ámbito efectivo del itinerario.** La pertenencia se calcula por calle, acera según el número y segmento. Desde un itinerario no se puede modificar un registro de otro: el dominio lo rechaza aunque la interfaz lo intentara.
- **Seguimiento completo.** Los locales de la campaña anterior todavía no visitados aparecen como «Sin visitar» con sus datos de referencia. Las calles sin locales conservan su cobertura.
- **Cierre provisional.** Registra quién y cuándo, y bloquea la edición en esa campaña. **No** es apto para la exportación municipal: la validación definitiva sigue rechazándose hasta el bloque C.
- **Sin separación obligatoria de funciones.** Quien categoriza puede hacer también la revisión final.
- **Solo lectura en campañas cerradas.** Las campañas históricas o validadas se consultan, pero no se editan desde Oficina.

## 6. Selector de actividades (B4 · catálogo 2026)

Las campañas de 2026 usan el catálogo oficial `clasificacion-2026@v1`, transcrito del documento «Clasificación Censo 2026» (no de las clasificaciones de 2025). La lista completa de categorías y las discrepancias pendientes están en [`CATALOGO-2026.md`](CATALOGO-2026.md), generado desde el código.

- **Niveles según el grupo.** Comercio: grupo › grupo de comercio › subgrupo › actividad. Hostelería y Restauración: grupo › subgrupo › actividad. Servicios: grupo › subgrupo y, si procede, una descripción. No se fuerzan cuatro niveles.
- **Buscar.** En la columna «Actividad», escribe parte del nombre, una palabra clave del documento («kebab», «bisutería», «tabaco») o un ejemplo («fisio»). No distingue mayúsculas, tildes ni singular/plural. Cada sugerencia muestra la ruta completa.
- **Teclado.** ↑/↓ recorre · Enter elige y baja · Tab elige y avanza · Esc cancela. Sin ratón.
- **Nombres ambiguos** («Otros», «Mascotas»): ninguna opción queda marcada; hay que elegir con ↑/↓.
- **Descripción libre.** Si eliges un subgrupo con actividades (p. ej. «Carnes») se pide una breve descripción, que se guarda dentro del subgrupo. Los ejemplos de Servicios se guardan como descripción del subgrupo.
- **Propuestas por el nombre** («Estanco nº 9» → Estancos; «Hotel San Antón» → Hotel). Aparecen con una bombilla y **no se aplican solas**. «Parafarmacia» no se equipara a Farmacias.
- **Recientes y frecuentes.** Con el editor vacío aparecen las últimas usadas (reloj). Solo desempatan: nunca adelantan a una coincidencia mejor.
- **Copiar y pegar.** Se copia el nombre, o la ruta completa si es ambiguo, más « · descripción». Un valor ambiguo o inexistente rechaza el pegado completo.
- **Ficha.** Muestra los niveles según el grupo, el estado (confirmada o propuesta) y las propuestas por el nombre. «Partir de 2025» solo propone un equivalente de nombre idéntico y único, sin confirmar.
- **Histórico.** 2025 conserva su catálogo y sus valores. Los datos guardados en el navegador (versión 9) se migran: una clasificación 2026 del catálogo anterior pasa a **propuesta sin confirmar con traza**, o se señala como incidencia si no hay equivalente. Nada confirmado se reasigna en silencio.

## 7. Pendiente

- **Decisiones de la Cátedra** sobre las discrepancias D01–D14 de `CATALOGO-2026.md`.
- **Avisos de clasificación sospechosa** (previstos en el diseño de B4): no implementados en este bloque.
- **B5 · Operaciones rápidas.**
  - Teclas de respuesta inmediata (1/0/N/?) sin abrir el editor y edición múltiple con acciones masivas.
  - «Partir de 2025» por filas y columnas «2025» de solo lectura.
  - **Estado independiente de franquicias**: hoy se muestra «pendiente de B5» y no se inventa progreso.

La tabla ya está preparada para ello: un nuevo editor o una nueva columna se añaden en `src/workspaces/office/tabla/columnas.tsx` sin tocar la navegación, el pegado ni el deshacer.
