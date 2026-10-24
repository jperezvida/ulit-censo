# Vista previa de ULIT Censo en Vercel (solo pruebas)

**Dirección fija (para favoritos):** https://ulit-censo-pruebas-vista.vercel.app

Cada vez que se publica en la rama `claude/fase2-oficina-itinerarios`, GitHub Actions pasa las comprobaciones y despliega **solo una PREVIEW** en el proyecto propio `ulit-censo-pruebas`. Después mueve la dirección fija a la versión nueva. Para probar cada entrega basta con abrir la dirección y recargar.

## Por qué GitHub Actions y no la integración nativa de Vercel

Al importar el repositorio en Vercel con la integración Git, Vercel despliega en **producción** la rama principal (`main`). No se puede evitar desde `vercel.json`, porque ese archivo no está en `main` y `main` no se toca. Así que no se podía **garantizar** que `main` no llegara a producción. Con GitHub Actions:

- solo se despliega al publicar en `claude/fase2-oficina-itinerarios` (una rama nueva de Claude no cambia la aplicación de pruebas);
- siempre como **preview**, nunca `--prod`, y **verificado por la API de Vercel** después de cada despliegue (ver «Incidente del primer despliegue»);
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
4. **Cada despliegue** (`scripts/vercel/desplegar-preview.mjs`) hace esto, en orden. Si un paso no se confirma, no se pasa al siguiente y **nunca** se asigna la dirección fija:
   1. Comprueba que se ejecuta desde la rama permitida y que hay token.
   2. Enlaza el proyecto `ulit-censo-pruebas` (lo crea si no existe; no modifica ningún otro) y desactiva su barra de herramientas.
   3. Activa **Vercel Authentication** y **lo confirma por la API** (`ssoProtection` con un ámbito que cubra las previews). Si no, falla **sin desplegar**.
   4. Si el proyecto **no tiene ningún despliegue**, falla **sin desplegar**: Vercel asignaría el primero a producción.
   5. Valida, antes de desplegar, los despliegues de producción que hay que retirar (`RETIRAR_PRODUCCION` en el workflow): deben ser de este proyecto y de producción. Si no, falla sin tocar nada.
   6. Despliega con la CLI, lee su respuesta JSON y **consulta el despliegue en la API**. Debe ser de este proyecto, estar listo y ser de tipo **preview** (`target` nulo). Si Vercel lo hubiera creado como **producción**, lo **elimina** de inmediato y falla.
   7. Comprueba **sin sesión** el despliegue (`/`, `/index.html`, `/version.json`). Si no está protegido, lo elimina y falla.
   8. Retira los despliegues de producción indicados: primero los alias que apuntan a cada uno y después el despliegue. A continuación comprueba **por la API**:
      - que ninguno de esos alias apunta ya al despliegue retirado. Se comprueban los que lista la API y los de `ALIAS_PRODUCCION` en el workflow: `ulit-censo-pruebas.vercel.app` y `ulit-censo-pruebas-jaimes-projects-e2a33d1a.vercel.app`. Una respuesta HTTP de autenticación en el dominio **no** cuenta como prueba;
      - que el proyecto queda **sin ningún despliegue de producción** y sin un destino de producción activo. Si hubiera otros despliegues no previstos, no los toca y falla;
      - además, que el dominio de producción ya no sirve la aplicación.

      Si algo no se cumple, se detiene **sin asignar la dirección fija**.
   9. Solo entonces asigna la **dirección fija**. Verifica por la API que apunta a esta preview y, sin sesión, que está protegida. Si no, retira la dirección y el despliegue, y falla.
5. Abra la dirección fija, inicie sesión con su cuenta de Vercel y guárdela en favoritos.

Sin el secreto, el workflow pasa igualmente las comprobaciones, pero **no despliega**: lo indica con un aviso.

### Qué se considera «protegido» (`scripts/vercel/proteccion.mjs`)

Cada petición se hace sin cookies y sin seguir redirecciones. Solo se acepta una respuesta que **proceda de Vercel** (cabecera `server: Vercel`) y que sea:

- **401 o 403**, y sin contenido de la aplicación en el cuerpo (ni `version.json` ni el código de la página); o
- una **redirección al inicio de sesión de Vercel**: `https://vercel.com/sso-api…` o `https://vercel.com/login…`, exactamente ese dominio, por HTTPS, sin puerto ni usuario.

**Cualquier otra respuesta falla**: 200, 404, una redirección a otro dominio (también a dominios parecidos como `vercel.com.ejemplo`), una relativa o sin destino, una respuesta de otro servidor, o un error de red. Las pruebas automáticas cubren estos casos. También ejecutan el script de despliegue completo con una CLI y una API de Vercel simuladas (`src/domain/despliegue-vercel.test.ts`). Usan la respuesta JSON **real** de la CLI y cubren un despliegue marcado como `production`, el orden de los pasos y la retirada segura.

## Incidente del primer despliegue (24-10-2026)

La primera ejecución con token creó el despliegue `dpl_5wBBNu998QbWfURDUtHgy5FSKgJV` como **producción**, con el dominio `ulit-censo-pruebas.vercel.app`, y no asignó la dirección fija.

**Causas**, comprobadas en el código de la CLI `vercel@63.1.0`:

1. La CLI convierte `--target preview` en «sin target» al llamar a la API (`target==="preview" → undefined`).
2. Vercel asigna a **producción** el **primer** despliegue de un proyecto que llega sin target. El proyecto se acababa de crear.
3. Con `--non-interactive`, `vercel deploy` imprime un **JSON** en lugar de la dirección. El script anterior usaba ese JSON como dirección, de modo que fallaron la comprobación y la retirada.

**Corrección:**

- El script lee el JSON de la CLI.
- No se fía del tipo que indica la CLI: lo **verifica en la API**, y elimina el despliegue si es de producción.
- Se niega a desplegar en un proyecto sin despliegues.
- No asigna la dirección fija sin haber verificado antes el tipo **preview**, la protección y la ausencia de producción.

**Retirada del despliegue erróneo:** la hace el propio workflow en su siguiente ejecución (paso 8), pero solo después de crear y verificar una preview válida. Así el proyecto nunca se queda sin despliegues, que era el caso que provocó el incidente. Si Vercel volviera a crear el nuevo despliegue como producción, el workflow lo elimina y falla. El despliegue erróneo seguiría protegido por Vercel Authentication hasta resolverlo.

**Límite:** la regla «primer despliegue → producción» la aplica Vercel en su servidor. Lo que se garantiza aquí es que **cualquier** despliegue que no sea preview se detecta por la API y se elimina antes de cualquier otra acción, y que la dirección fija solo se asigna a una preview verificada y protegida.

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
