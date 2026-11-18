# Timmy Max v3.1 — página y permisos

Esta actualización conserva tus datos de **timmy-v3.json**. No reinicia el bot desde cero ni borra tickets. La página ya viene programada dentro del paquete; se sirve desde tu mismo servicio de Railway. No necesitas contratar otro hosting ni crear un proyecto nuevo.

## 1. Qué cambia

| Persona | Ayuda en Discord | Página |
| --- | --- | --- |
| Miembro normal | `>help` muestra 9 comandos básicos; las categorías muestran solo comandos permitidos. `>ticket` indica dónde pedir soporte. | Sin acceso al catálogo. |
| Staff con permisos específicos | Además, los comandos de moderación correspondientes a sus permisos; ayuda sensible por DM o slash privado. | Sin acceso salvo que tenga Administrador o sea dueño. |
| Administrador o dueño del servidor | `>setup`, configuración, `>ticketpanel` y `>panel`. Ayuda y enlace por DM; con slash, respuesta solo visible para él. | Inicia sesión con Discord y elige un servidor que administra. |

El nombre o la posición de un rol no otorga acceso por sí solo: se verifica el permiso **Administrador** o la propiedad del servidor. El staff mantiene sus permisos específicos de moderación; soporte puede atender tickets sin Administrador. Cualquier miembro sigue pudiendo abrir un ticket desde el panel público. Solo un administrador o dueño puede crear ese panel.

Los comandos con `/` también registran restricciones y el bot vuelve a verificarlas al ejecutar. Si alguien intenta escribir un comando oculto, la comprobación lo bloquea. Las respuestas anteriores que el bot ya publicó en Discord no se borran.

La página tiene búsqueda, filtros, copiar comando y una guía de configuración. **Es un catálogo y guía, no un panel que cambie ajustes desde el navegador.** Copias el comando y lo usas en Discord. El acceso al catálogo se comprueba en el servidor web; un enlace reenviado no concede acceso.

## 2. Actualiza tu GitHub

1. Descarga otra vez `Timmy-Max-v3.zip`; esta revisión contiene v3.1. Descomprímelo.
2. Abre tu repositorio actual **wdydk/new-timmy-**.
3. En la raíz usa **Add file → Upload files**.
4. Desde dentro de la carpeta descomprimida, arrastra **las carpetas completas** `src`, `scripts`, `web` y `test`, junto con los archivos de la raíz. No entres a `src` para arrastrar sus archivos sueltos. No subas el ZIP ni `node_modules`, `.env` ni datos privados.
5. Antes de guardar, comprueba que la lista contiene `src/access.js`, `src/web.js`, `web/style.css`, `web/app.js`, `scripts/check.js`, etc. Si muestra solo `web.js` o `style.css` en la raíz, cancela esa carga y arrastra la carpeta completa.
6. Reemplaza también `index.js`, `Dockerfile`, `package.json` y `package-lock.json`. Confirma todos los cambios en un solo commit.
7. Conserva tu volumen `/data` en Railway y una sola réplica. No cambies ni borres ese volumen para actualizar. Espera a que el bot arranque con v3.1.

Archivos que cambian respecto a v3: index.js; src/access.js y src/web.js (nuevos); src/core.js, src/ai.js, src/tickets.js; scripts/check.js; web/style.css y web/app.js (nuevos); Dockerfile; package.json y package-lock.json; documentación y pruebas. Música y su motor permanecen iguales.

Si quedaron copias de módulos en la raíz al subir la versión anterior, el bot usa los que están dentro de `src/`. Las copias sueltas no se usan. No hace falta crear `src` archivo por archivo.

## 3. Crea el dominio en Railway

1. Abre el servicio **new-timmy-** → **Settings**.
2. Busca **Networking → Public Networking → Generate Domain**.
3. Si solicita un puerto, indica **8080**. En Variables añade `PORT=8080` para que coincidan el dominio y el proceso web.
4. Copia el dominio completo con `https://`. Por ejemplo, `https://tu-bot.up.railway.app` (el tuyo será diferente).

La página no estará disponible hasta completar el siguiente paso y desplegar las variables. No cambies `DISCORD_TOKEN` por el Client Secret: son claves diferentes.

## 4. Configura el acceso con Discord

1. Abre https://discord.com/developers/applications e ingresa a la **misma aplicación de Timmy Max**.
2. En **General Information**, copia **Application ID**. Lo usarás como `DISCORD_CLIENT_ID`.
3. En **OAuth2**, busca **Client Secret** y copia o genera ese secreto. Pégalo únicamente en Variables de Railway como `DISCORD_CLIENT_SECRET`. No lo compartas en el chat ni lo subas a GitHub.
4. En **OAuth2 → Redirects → Add Redirect**, agrega tu dominio seguido de `/auth/callback`. Ejemplo:

   ```text
   https://tu-bot.up.railway.app/auth/callback
   ```

5. Guarda los cambios en Discord.
6. En Railway → Variables, añade:

   | Variable | Valor |
   | --- | --- |
   | `WEB_ENABLED` | `true` |
   | `WEB_BASE_URL` | Tu dominio completo con `https://`, sin `/auth/callback` y sin barra final |
   | `DISCORD_CLIENT_ID` | Application ID de Timmy Max |
   | `DISCORD_CLIENT_SECRET` | OAuth2 Client Secret de Timmy Max |
   | `PORT` | `8080` |
   | `REGISTER_SLASH` | `true` |

7. Conserva también `DISCORD_TOKEN`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `PREFIX` y las variables de tu volumen. Aplica los cambios y despliega.
8. Los logs deben mostrar `Página de comandos escuchando en 8080` y `Timmy Max v3.1 conectado`.
9. En tu servidor, como administrador, escribe **`>panel`**. El bot te enviará el enlace por DM. Si no recibes DMs, usa **`/panel`**.
10. En la página, pulsa **Continuar con Discord**, autoriza y selecciona tu servidor. La autorización pide identidad básica y lista de servidores; no necesita acceso a correo ni DMs.

El inicio utiliza OAuth2, estado vinculado a la sesión y PKCE. El navegador no recibe las claves del bot. La página comprueba permisos de administrador de ese servidor en cada solicitud del catálogo. Las sesiones duran como máximo una hora y se pierden al reiniciar. Usa una réplica; escalar a varias requeriría almacenamiento compartido de sesiones y configuración.

## 5. Configura cada servidor por separado

Invita el **mismo bot** al servidor nuevo. Su configuración propia empieza vacía: sin reglas, bienvenida, reacciones, rol de soporte ni categoría de tickets. La IA general y los comandos básicos siguen disponibles; sus datos se guardan cuando los configures. No necesitas otro token de Discord ni otro servicio Railway.

Como dueño o administrador de cada servidor:

```text
>setup
>knowledge add reglas Respetar a los miembros. No spam. Reportar problemas al equipo.
>knowledge add rangos Visitante, Miembro y Staff. Contacta a soporte para los requisitos.
>knowledge add eventos El torneo se anuncia en #eventos y se juega los sábados.
>knowledge list
>ticketsetup ID_DE_LA_CATEGORIA @Soporte
>ticketpanel
>welcome #bienvenidas ¡Bienvenido {user} a {server}!
>logs #logs
>config
```

- Escribe `>ticketpanel` en el canal donde quieras el menú público. Publica el panel otra vez después de actualizar para que `>ticket` pueda enlazarlo; los tickets v3 ya abiertos siguen registrados.
- Cada ficha tiene un nombre (reglas/rangos/eventos...) y admite hasta 4000 caracteres. Máximo 20 fichas y 16 000 caracteres en total. Discord limita la longitud de cada mensaje: divide el contenido en fichas más pequeñas si lo necesitas.
- Repetir `>knowledge add reglas ...` reemplaza solo la ficha `reglas` de ese servidor.
- `>knowledge remove reglas` elimina esa ficha. `>knowledge clear` elimina la información IA de ese servidor, sin borrar tickets ni otros ajustes.
- La información anterior que guardaste con `>knowledge texto` se conserva como texto general. Ese formato sigue funcionando y sustituye solo el texto general.
- No pongas secretos en las fichas: la IA las utiliza para contestar a los miembros de ese servidor.
- Cuando cambias información, se inicia un contexto nuevo para las siguientes respuestas, evitando que se sigan usando reglas viejas.
- En DM la IA es general y no añade fichas de ningún servidor. No tiene que adivinar de cuál eres miembro.
- El archivo `timmy-v3.json` es un contenedor: dentro hay entradas separadas por el ID de cada servidor. Que sea un archivo único no significa que los servidores compartan ajustes.
- `GUILD_ID` es opcional para registrar comandos locales en tu servidor de pruebas. No limita el bot a un único servidor ni controla su memoria. Los comandos globales se registran para los demás servidores.
- Los nuevos servidores se configuran desde Discord; nunca copies manualmente el JSON de otro servidor. Un servidor que ya usó el bot y lo vuelve a invitar conserva su configuración guardada.

## 6. Prueba con dos cuentas

1. Miembro normal: `>help` debe enviar un solo mensaje breve; `>panel` y `>ticketpanel` deben denegarse. `>help Configuración` no debe listar comandos.
2. Staff con Gestionar mensajes: `>help Moderación` envía por DM solo los comandos para sus permisos; no le da el catálogo de administración.
3. Administrador: `/panel` entrega el enlace de forma privada y puedes entrar al sitio.
4. Miembro sin Administrador: aunque copie ese enlace, el sitio le niega acceso al catálogo de ese servidor.
5. Dos servidores: añade fichas diferentes, pregunta al bot en cada uno y comprueba que no se mezclen. El sitio solo muestra los servidores que administras y donde está el bot.
6. Reinicia el servicio con volumen `/data`: la configuración, las fichas y los tickets deben conservarse. Es normal tener que iniciar sesión de nuevo en la página.

## Si algo falla

- **No recibo el DM:** usa `/help` o `/panel`; esas respuestas son privadas.
- **`invalid redirect_uri`:** la URL de Redirects debe coincidir exactamente con `WEB_BASE_URL` + `/auth/callback` (https, dominio, ruta y barra final).
- **Página sin respuesta:** comprueba `WEB_ENABLED=true`, el puerto 8080 del dominio, `PORT=8080`, el Dockerfile nuevo y los logs `[WEB]`.
- **Sin servidores:** entra con la cuenta correcta; el bot debe estar invitado y debes ser dueño o tener el permiso Administrador. Gestionar servidor por sí solo no concede acceso.
- **Sigo viendo ayuda vieja:** comprueba que el deploy terminó, que no hay otro proceso usando el mismo token y que actualizaste todos los archivos de este paquete.
- **La web está apagada:** el bot sigue funcionando con `WEB_ENABLED=false`. Puedes terminar OAuth2 más tarde sin perder configuración.

Fuentes oficiales de instalación:
- https://docs.railway.com/networking/public-networking
- https://docs.discord.com/developers/topics/oauth2
- https://docs.discord.com/developers/resources/user#get-current-user-guilds
- https://docs.discord.com/developers/topics/permissions

Tu repositorio GitHub aparece público en la captura. La página privada protege el acceso web a cada servidor; el código y COMMANDS.md seguirán siendo legibles para quien visite el repositorio público. Si también quieres que esos archivos sean privados, cambia la visibilidad del repositorio en GitHub. Los nombres de los comandos por sí solos no conceden permisos.
