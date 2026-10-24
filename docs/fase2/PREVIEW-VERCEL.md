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

El token se guarda **solo en el entorno `preview` de GitHub Actions**, restringido a la rama `claude/fase2-oficina-itinerarios`. No va en un secreto general del repositorio. El job del workflow declara `environment: preview`, y GitHub entrega el secreto únicamente a ejecuciones de esa rama.

1. **Token de Vercel:** en vercel.com → *Account Settings* → *Tokens* → *Create Token*.
   - Nombre: `ulit-censo-pruebas (GitHub Actions)`.
   - Ámbito (*Scope*): la cuenta o el equipo donde quiera el proyecto.
   - Caducidad: por ejemplo, 90 días.

   Es la única credencial necesaria. Vercel no ofrece tokens limitados a un solo proyecto; el workflow solo actúa sobre `ulit-censo-pruebas`.
2. **Entorno `preview` en GitHub:** en el repositorio → *Settings* → *Environments*. Si ya aparece `preview` (GitHub lo crea vacío en la primera ejecución), ábralo; si no, pulse *New environment*, escriba `preview` y pulse *Configure environment*.
   - En *Deployment branches and tags*, elija **Selected branches and tags** → *Add deployment branch or tag rule* → tipo *Branch* → `claude/fase2-oficina-itinerarios` → *Add rule*.
   - En *Environment secrets*, pulse *Add environment secret*. Nombre: `VERCEL_TOKEN`; valor: el token.
3. **Sin secreto general:** en *Settings* → *Secrets and variables* → *Actions* → pestaña *Secrets*, compruebe que en *Repository secrets* **no** existe `VERCEL_TOKEN`. Si existe, elimínelo: se usaría en lugar del del entorno cuando este no lo tuviera.
4. **Primer despliegue:** avise a Claude para que relance el último workflow, o espere a la siguiente entrega. La ejecución hace esto, en orden:
   1. Comprueba que se ejecuta desde la rama permitida. Si no, falla sin hacer nada.
   2. Crea el proyecto `ulit-censo-pruebas` (no modifica ningún otro) y desactiva su barra de herramientas.
   3. Activa **Vercel Authentication** y **lo confirma por la API** (`ssoProtection` con un ámbito que cubra las previews). Si no se confirma, falla **sin desplegar**.
   4. Despliega la preview (nunca `--prod`).
   5. **Antes de asignar la dirección fija**, comprueba **sin sesión** el despliegue (`/`, `/index.html`, `/version.json`). Si no está protegido o no se puede confirmar, **retira el despliegue y falla** sin asignar la dirección.
   6. Asigna la dirección fija y la vuelve a comprobar. Si no estuviera protegida, retira la dirección y el despliegue, y falla.
5. Abra la dirección fija, inicie sesión con su cuenta de Vercel y guárdela en favoritos.

Sin el secreto, el workflow pasa igualmente las comprobaciones, pero **no despliega**: lo indica con un aviso.

### Qué se considera «protegido» (`scripts/vercel/proteccion.mjs`)

Cada petición se hace sin cookies y sin seguir redirecciones. Solo se acepta una respuesta que **proceda de Vercel** (cabecera `server: Vercel`) y que sea:

- **401 o 403**, y sin contenido de la aplicación en el cuerpo (ni `version.json` ni el código de la página); o
- una **redirección al inicio de sesión de Vercel**: `https://vercel.com/sso-api…` o `https://vercel.com/login…`, exactamente ese dominio, por HTTPS, sin puerto ni usuario.

**Cualquier otra respuesta falla**: 200, 404, una redirección a otro dominio (también a dominios parecidos como `vercel.com.ejemplo`), una relativa o sin destino, una respuesta de otro servidor, o un error de red. Las pruebas automáticas cubren estos casos. También ejecutan el script de despliegue completo con una CLI de Vercel simulada, y comprueban el orden (protección antes de la dirección fija) y la retirada segura.

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
- Lo que no se puede verificar desde aquí (Vercel no es accesible desde el entorno de Claude) se verifica en la **primera ejecución del workflow** (configuración por la API y protección por HTTP, antes de la dirección fija) y **en su navegador** (las cuatro garantías).
