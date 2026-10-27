# ULIT Censo · Oficina rápida (B2, B3, B4 y B5)

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
| Filtrar por tarea | Pestañas **Categorización · Franquicias · Presencia digital · Incidencias y contradicciones · Todos**; filtros **Pendientes · Con errores · Con incidencias · Con avisos · Revisados · Sin visitar · Todos**; búsqueda instantánea. |
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
| Supr | Vaciar las celdas seleccionadas (en columnas Sí/No: pendiente) |
| 1 · 0 · N · ? | **Respuesta inmediata** en columnas Sí/No (B5): Sí · No · No aplicable · Sin información. Guarda y avanza |
| Espacio · Mayús+Espacio | Marcar / desmarcar la fila (o las del rango) para una acción masiva |
| Mayús+F10 | Acciones sobre las filas marcadas o el rango de filas |
| Ctrl+C / Ctrl+V | Copiar / pegar rangos (compatible con Excel) |
| Ctrl+Z / Ctrl+Y | Deshacer / rehacer |
| Ctrl+Enter | Abrir la ficha (con histórico y conciliación) |
| AvPág / RePág, Inicio / Fin | Saltos de página y de fila |

**Valores que admite cada columna:**

- Respuestas digitales: `sí`/`1`/`x`, `no`/`0`, `N/A`, `¿?` (sin información) y vacío (pendiente).
- Cantidades: `37`, `4,5`, `1.250`.
- Actividad: buscador del catálogo 2026 (véase la sección 6).

**Pegado atómico:** si alguna celda no es válida o no se puede editar (solo lectura, itinerario cerrado, local pendiente de visita), **no se aplica ninguna**. La barra inferior explica el motivo y marca la celda en rojo.

## 4. Ficha del establecimiento

- **Ficha lateral compacta** (Ctrl+Enter o el icono ⓘ de la fila):
  - nombre y botón **Ampliar ficha** en la primera línea;
  - en la segunda, indicadores compactos de Campo, Categoría, Franquicia, Digital y Revisión, junto con la dirección y la última observación;
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

## 7. Edición rápida, franquicias, acciones masivas y campaña anterior (B5)

### Respuestas inmediatas (1 / 0 / N / ? / Supr)

- En las columnas **Sí/No** (Franquicia y variables digitales Sí/No), sin abrir editor: `1` Sí · `0` No · `N` No aplicable (solo si la variable lo admite; Franquicia no) · `?` Sin información · `Supr` pendiente.
- Al responder se guarda y el cursor avanza:
  - en **Presencia digital**, a la siguiente variable **exigible y sin responder** (p. ej. tras `1` en Instagram, a «Seguidores Instagram»);
  - en el resto de tareas, a la misma columna del registro siguiente. Con «Pendientes», el registro respondido sale de la vista y el cursor queda en el siguiente.
- Con un rango de celdas Sí/No seleccionado, la tecla se aplica a todas a la vez (atómico, un solo Ctrl+Z).
- **No** se interceptan en el buscador, en los editores ni en la ficha, y **no** modifican nombres, actividades ni cantidades (en esas columnas la tecla empieza a escribir, como antes).
- Una respuesta guardada **no** verifica la presencia digital: hace falta «Verificar presencia digital».

### Franquicias (tarea independiente)

- Tres datos distintos:
  - **Franquicia** (Sí/No) comprobada en esta campaña.
  - **Nombre de cadena**: dato descriptivo del negocio. Tener cadena **no** implica franquicia; no tenerla **no** significa «No».
  - **Revisión de franquicias**: pendiente / revisada, con persona y fecha. Solo un Sí o un No registrado por una persona la deja revisada; «sin información» queda registrado pero sigue pendiente.
- Progreso **propio por itinerario** (tarjeta del panel de itinerarios y pestaña «Franquicias», con filtros Pendientes / Revisados).
- En la ficha: «Franquicia 2026» (Sí · No · ¿? · pendiente), estado con quién y cuándo, y el valor 2025 como **referencia**.
- Cambiar la respuesta tras revisarla conserva el historial y **devuelve a pendiente la aprobación general** del registro (con constancia de quién, cuándo y por qué). Lo mismo ocurre ahora al cambiar una clasificación confirmada o un dato digital ya verificado.
- «Aprobar registro» exige campo, categorización, **franquicia** y presencia digital, cada una por separado.

### Acciones masivas

1. Marca filas con **Espacio** (o la casilla de la fila) o selecciona varias filas con Mayús+↓.
2. **Mayús+F10** o el botón **Acciones…** de la barra inferior.
3. Elige la operación: **Respuesta Sí/No** (Franquicia o una variable digital Sí/No), **Marcar incidencia** (pendiente de comprobación con motivo), **Clasificación** (elegida explícitamente con el buscador) o **Preparar desde la campaña anterior**.
4. El diálogo muestra **cuántos registros se modificarán, la operación y los excluidos con su motivo** (vacíos, sin visitar, itinerario cerrado, fuera del itinerario…). Solo entonces **Aplicar a N registro(s)**.

- Es **atómica**: se aplica todo lo previsto o nada. Un único **Ctrl+Z** la deshace.
- **Nunca** verifica la presencia digital ni aprueba registros.

### Campaña anterior (comparación y «Partir de 2025»)

- **Comparar con 2025** (barra inferior de la tabla): junto a cada dato se muestra el de 2025 en columnas **sombreadas, en cursiva y de solo lectura**. «≠» y tachado = en 2025 el local lo ocupaba **otro negocio**.
- **Partir de 2025** en la ficha (un establecimiento) o como acción masiva (selección). Copia clasificación, franquicia y presencia digital:
  - solo si consta que es el **mismo negocio** confirmado en campo (no el mismo local ni un nombre parecido): un negocio nuevo, una conciliación pendiente o una cronología incierta lo impiden;
  - como **borrador** con origen y campaña: nada queda comprobado ni verificado en 2026;
  - **sin sobrescribir** nada ya registrado en 2026 y **sin modificar** 2025;
  - los datos de 2025 **inválidos o ambiguos** (p. ej. seguidores sin la red, números sin valor, clasificación sin equivalente único) se **señalan y no se copian**.

### Avisos de clasificación sospechosa (no bloqueantes)

- Columna «Avisos de clasificación» (tarea Categorización), filtro **Con avisos** y lista en la ficha.
- Casos: categoría de otro catálogo, combinación incoherente con el catálogo, ocupado sin clasificar y contradicción fuerte entre el nombre y la actividad (p. ej. «Farmacia …» clasificada como Bar).
- Son advertencias para revisión humana: **no cambian la actividad ni bloquean la aprobación**. La tarjeta del itinerario cuenta solo los sospechosos (los no clasificados ya figuran como categorización pendiente).
- En la ficha se distinguen **«Descripción del negocio»** (dato general) y **«Descripción de la actividad clasificada»**.

### Cómo probarlo en Codespaces (datos ficticios)

| Función | Pasos |
|---|---|
| Respuestas 1/0 en franquicias | Oficina → tarjeta **IT-C** → «Franquicias» → flechas hasta «Franquicia» → pulsa `1`, `0`, `0`… Cada fila desaparece de «Pendientes» y el contador de la pestaña baja. |
| Sin información / no aplicable | En «Franquicia» pulsa `?` (queda pendiente) y `N` (rechazado: Franquicia no admite «no aplicable»). |
| Presencia digital con teclado | «Presencia digital» → columna «Instagram» → `1`: el cursor salta a «Seguidores Instagram»; escribe el número y Enter. La revisión sigue en borrador hasta «Verificar digital». |
| Cadena ≠ franquicia | Ctrl+Enter en una fila → pestaña Ficha → escribe un «Nombre de cadena»: la franquicia sigue pendiente. |
| Acción masiva y deshacer | Marca 3–4 filas con Espacio → Mayús+F10 → «Respuesta Sí/No» → Franquicia = No → revisa el número de registros → Aplicar. Ctrl+Z las deshace todas a la vez. |
| Rechazo por bloqueo | «Cerrar revisión (provisional)» → selecciona filas → Mayús+F10: 0 registros afectados, todos excluidos. «Reabrir» con motivo para seguir. |
| Comparación 2025/2026 | «Comparar con 2025» en cualquier tarea. Busca filas con «≠» (otro negocio en 2025). |
| Partir de 2025 | Ficha de un establecimiento confirmado en campo → «Partir de 2025»: lo copiado aparece marcado como «heredado». En un local con negocio nuevo, la ficha explica por qué no se hereda. |
| Avisos | «Categorización» → filtro «Con avisos». Para provocar uno, clasifica una farmacia como «Bar». |
| Ficha a 1365 × 680 | «Ampliar ficha»: el pie (anterior/siguiente, Siguiente pendiente, Devolver, Aprobar registro) queda siempre visible. |
| Datos guardados de versiones anteriores | Si el navegador tenía la demo de B3/B4 (versión 9 o 10), se migra sola a la versión 11 al abrirla: se añade el almacén de franquicias vacío (no se deducen de la cadena) y se avisa de los registros aprobados con la franquicia pendiente. |

## 8. Pendiente

- **Decisiones de la Cátedra** sobre las discrepancias D01–D14 de `CATALOGO-2026.md` (no se han resuelto en código).
- Inclusión de la franquicia en la **exportación municipal**: depende de la plantilla acordada con informática (C3). El formato de exportación no cambia en B5.
- Bloques **C1, C2 y C3** (importación, validación y exportación definitiva): sin empezar.
