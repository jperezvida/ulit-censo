# G0 · Pruebas de generalidad (situación ANTES de G1)

**Objetivo.** Comprobar si ULIT Censo recibe censos distintos del de Medina del Campo 2025 sin cambiar el código.

**Datos.** Todos los archivos son **sintéticos** (municipios, calles y negocios inventados) y llevan la marca de archivo generado por la aplicación. El espacio de datos reales los rechaza.

**Archivos:**
- Generador: `src/data/xlsxGeneralidad.ts`.
- Pruebas: `src/domain/generalidad.test.ts`.

## Censos sintéticos

| Caso | Municipio · año | Características |
|---|---|---|
| **A** | Villa Sintética de Arriba · 2023 (40 filas) | **Hojas:** una portada antes de los datos; títulos en las filas 1–2 y cabecera en la **fila 3**. **Columnas:** otros nombres y otro orden («Nombre comercial», «Calle», «Nº», «Local vacío», «Fecha de visita», «Sector»…); **dos columnas desconocidas** («Observaciones del censista», «Código interno»); **sin** CP, Distrito, Zona ni redes. **Formatos:** fechas como **texto** (dd-mm-aaaa y aaaa-mm-dd); portales como texto; franquicia «Sí»/«No» |
| **B** | Pueblo Sintético del Río · 2024 (60 filas) | **Hojas:** la de datos se llama «Hoja1» y **no es la primera**; además, hoja de listas y hoja de **resumen**. **Columnas:** cabeceras en **MAYÚSCULAS sin tildes**; presencia digital **parcial** (web, Instagram, Facebook); una columna desconocida («SUPERFICIE M2»). **Formatos:** fechas de Excel con formato **dd/mm/aa**; portales con sufijo y «S/N»; 0/1 guardados como texto |
| **C** | Aldea Sintética · 2022 (12 filas) | **Cabeceras ambiguas:** dos posibles nombres («Nombre comercial», «Nombre del local») y dos posibles direcciones («Dirección», «Dirección fiscal») |
| Variantes del formato Medina | — | Mismo formato de 27 columnas con: una **columna adicional**; **sin** las columnas de redes sociales; «Dirección» **renombrada** como «Calle» |

## Resultado actual

| Comprobación | Resultado |
|---|---|
| Lectura segura (límites, ZIP, XML) de los tres casos | ✅ Funciona |
| Inventario de hojas y detección de la hoja de **resumen** | ✅ Funciona |
| Formato de referencia de Medina (27 columnas exactas) | ✅ Funciona |
| A: detectar la hoja «Censo 2023» y la cabecera en la fila 3 | ❌ **Falla**: «No se ha encontrado ninguna hoja cuyas cabeceras coincidan con un perfil conocido» |
| B: detectar «Hoja1» como hoja de datos | ❌ **Falla**: igual que A (cobertura del 26 % del perfil) |
| A y B: interpretar sus filas | ❌ **Falla**: «El archivo no es compatible con ningún perfil conocido» |
| Formato Medina con una columna adicional | ❌ **Falla**: una columna que sobra hace el archivo incompatible |
| Formato Medina sin redes sociales | ❌ **Falla**: las 27 columnas son obligatorias |
| Formato Medina con una cabecera renombrada | ❌ **Falla**: no hay forma de relacionarla a mano |
| C: no asignar automáticamente las cabeceras ambiguas | — No llega a evaluarse: el archivo ni siquiera se reconoce |

**Causas:**
1. Los perfiles son **constantes en el código** y solo hay dos, ambos de Medina.
2. La hoja y la cabecera se detectan **solo** comparando con esos perfiles.
3. Un archivo es incompatible si **sobra** cualquier columna o **falta** cualquiera de las 27.
4. **No existe correspondencia manual** de columnas en el importador.

## En la integración continua

Las 7 limitaciones están escritas como el comportamiento **deseado** y marcadas con `it.fails`:
- La CI **pasa mientras fallen**: documentan la limitación sin bloquear.
- Si una empieza a funcionar, la CI **avisa**, para convertirla en una prueba normal.

G1 las convierte en pruebas normales.
