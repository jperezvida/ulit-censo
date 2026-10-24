# Vista previa de ULIT Censo en Vercel (solo pruebas)

**Dirección fija (para favoritos):** https://ulit-censo-pruebas-vista.vercel.app

Cada vez que se publica en la rama `claude/fase2-oficina-itinerarios`, GitHub Actions pasa las comprobaciones y despliega **solo una PREVIEW** en el proyecto propio `ulit-censo-pruebas`. Después mueve la dirección fija a la versión nueva. Para probar cada entrega basta con abrir la dirección y recargar.

## Por qué GitHub Actions y no la integración nativa de Vercel

Al importar el repositorio en Vercel con la integración Git, Vercel despliega en **producción** la rama principal (`main`). No se puede evitar desde `vercel.json`, porque ese archivo no está en `main` y `main` no se toca. Así que no se podía **garantizar** que `main` no llegara a producción. Con GitHub Actions:

- solo se despliega al publicar en `claude/fase2-oficina-itinerarios` (una rama nueva de Claude no cambia la aplicación de pruebas);
- siempre como **preview** (`--target preview`, nunca `--prod`);
- `main` no se despliega nunca: el proyecto de Vercel no está conectado al repositorio;
- antes de publicar se ejecutan TypeScript, las pruebas, el control de datos reales y la compilación, y se publica **exactamente** lo compilado (Vercel no compila nada).

## Configuración inicial (una sola vez)

1. **Token de Vercel:** en vercel.com → *Account Settings* → *Tokens* → *Create Token*.
   - Nombre: `ulit-censo-pruebas (GitHub Actions)`.
   - Ámbito (*Scope*): la cuenta o el equipo donde quiera el proyecto.
   - Caducidad: por ejemplo, 90 días.

   Es la única credencial necesaria: Vercel no ofrece tokens limitados a un solo proyecto. El workflow solo actúa sobre `ulit-censo-pruebas`.
2. **Secreto en GitHub:** en el repositorio → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*.
   - Nombre: `VERCEL_TOKEN`.
   - Valor: el token.

   Los secretos no se muestran en los registros. Tampoco están disponibles para ramas ajenas, ni para PR de bifurcaciones.
3. **Primer despliegue:** avise a Claude para que relance el último workflow, o espere a la siguiente entrega. La primera ejecución:
   - crea el proyecto `ulit-censo-pruebas` (no modifica ningún otro);
   - desactiva su barra de herramientas;
   - activa **Vercel Authentication**;
   - despliega la preview y asigna la dirección fija;
   - **comprueba sin sesión** que tanto la dirección fija como el despliegue responden 401/403. Si alguna respondiera 200, retira la dirección fija y falla.
4. Abra la dirección fija, inicie sesión con su cuenta de Vercel y guárdela en favoritos.

Sin el secreto, el workflow pasa igualmente las comprobaciones, pero **no despliega**: lo indica con un aviso.

## Uso

- **Demostración y ensayo:** se guardan en el navegador, asociados a la dirección fija, que no cambia entre entregas.
- **Versión en ejecución:** se ve en la cabecera («v 1a2b3c4»). Compárela con el commit que indique Claude en cada entrega.
- **Espacio de datos reales (guardado):** está **desactivado** en la web. Aquí no se guardan datos reales.

## Analizar el Excel real sin guardar (C1e-B)

Vaya a `#/espacios` y entre en **«Analizar el Excel real SIN GUARDAR»**. Antes de permitir elegir el archivo, la aplicación comprueba en el navegador:

| Garantía | Cómo se comprueba |
|---|---|
| **Sitio protegido** | La misma petición **sin cookies** debe recibir 401/403 o una redirección a la autenticación |
| **Sin transmisión a terceros** | La política de seguridad (CSP) servida solo permite conectar con el propio sitio y con las teselas del mapa base (OpenFreeMap: coordenadas de tesela, nunca datos). Prohíbe scripts de terceros, `eval` y formularios. El navegador hace cumplir esa política. |
| **Versión revisada** | El commit del código en ejecución coincide con `version.json` y procede de la rama revisada |
| **Archivos íntegros** | Cada archivo de código y datos publicado coincide con su huella SHA-256 de la compilación |

Si alguna garantía falla, el análisis **no se habilita** y se muestra el motivo concreto. Con todas cumplidas:
- el XLSX se elige desde su equipo y se procesa en el navegador; **no se sube a ningún servidor**;
- se llega hasta la **vista previa completa** (identificación, diagnóstico frente al informe agregado, calles, recuentos, pendientes y advertencias);
- **no se incorpora ni se guarda nada**: la base es temporal y solo vive en la memoria de la pestaña; al salir de la página o cerrarla, desaparece;
- la confirmación de la incorporación real sigue **bloqueada**.

## Comprobado antes de publicar

Con un servidor local que aplica **las mismas cabeceras** (`scripts/vercel/servir-como-vercel.mjs`) y emula la protección, bajo un nombre `*.vercel.app` y HTTPS, en un navegador de pruebas:

- Demostración, mapa, territorio, datos y espacios: **ninguna violación** de la CSP.
- Garantías cumplidas, análisis de un XLSX hasta la vista previa, «Incorporar» deshabilitado y **ninguna base de datos real creada**.
- Sin protección: «NO protegido» y análisis deshabilitado. Con un archivo publicado alterado: «no coincide» y análisis deshabilitado.

## Límites

- La protección depende de su cuenta de Vercel. Para dar acceso a otras personas de la Cátedra habrá que estudiar las opciones de su plan.
- El plan gratuito (*Hobby*) de Vercel es para uso no comercial.
- Los datos de demostración y ensayo guardados en el navegador dependen de esa dirección y de ese navegador. Use los respaldos del ensayo si los necesita.
- Lo que no se puede verificar desde aquí (Vercel no es accesible desde el entorno de Claude) se verifica en la **primera ejecución del workflow** (protección por HTTP) y **en su navegador** (las cuatro garantías).
