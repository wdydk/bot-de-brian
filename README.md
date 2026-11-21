# Timmy Max v3.3

Timmy recibe a tus miembros, celebra sus niveles y agradece cada boost. También responde preguntas con las reglas y los permisos de tu servidor. Incluye música, tickets y un editor de embeds.

## Sorteos y eventos con Timmy

Un dueño o administrador puede escribir `@Timmy Max créame un giveaway en #giveaway de 5 horas, premio: 5k Robux, ganadores: 2 y anúncialo en #evento`. Selecciona los canales reales al escribir. Timmy muestra ambos destinos antes de **Publicar**. También entiende minutos y días. Para un evento independiente, prueba `>ask hazme un evento en #evento diciendo que el torneo TSB empieza el sábado a las 6`.

Los miembros pulsan **Entrar** y reciben una confirmación privada. Timmy guarda las entradas, el plazo y los resultados en `giveaways.sqlite`. Si se reinicia en mitad del sorteo, retoma el cierre. Sortea personas distintas y actualiza el embed original. El organizador se encarga de entregar el premio.

## Primeros pasos con la comunidad

1. Como dueño o administrador, escribe `/setup`. Elige **Niveles** para configurar el aviso y preparar los cinco roles al guardar. Los miembros pueden consultar su progreso con `/level`.
2. En **Boosts**, elige el canal, escribe los beneficios y, si quieres, selecciona un rol temporal. En **Verificación** puedes publicar un panel que abre solicitudes en tickets privados.
3. Pulsa **Siguiente** hasta llegar a **Revisión**. Usa **Atrás** para corregir los ajustes y **Guardar** para aplicarlos. Puedes practicar con `>levelmessage test` y `>boostmessage test`.

La web incluye una **Guía rápida** en `/guia` con ejemplos para copiar. Las configuraciones se conservan en el volumen de Timmy. Con niveles activos, la base `timmy-xp.sqlite` guarda la experiencia por servidor y miembro.

## Actualizar desde v3.2

1. En GitHub, integra la actualización en `main` con **Merge pull request → Confirm merge**. Railway construye esa versión si tienes activo el despliegue desde GitHub.
2. En **Deployments → View logs → Deploy Logs**, busca `Timmy Max v3.3 conectado`. La actualización usa el volumen actual y las variables que ya configuraste.
3. Desde la cuenta dueña de la aplicación de Discord, abre el DM de Timmy. Adjunta `emojigg-collection (1).zip`, escribe `>emojis importar` en el mismo mensaje y envíalo. Espera **Listos 22/22 emojis para Timmy**. Puedes repetir la importación si queda alguno pendiente. Usa `>emojis` para ver los dibujos. Son emojis de la aplicación que Timmy puede usar en sus servidores y en DM. Hasta importarlos usa sus equivalentes de teclado.
4. En un servidor que administras, prueba los tres ejemplos de abajo. Envía cada comando como un mensaje separado.

```text
>ask si alguien dice brian dile ola soy yo
>recuerda si alguien dice "hay tarea", reacciona con nerdcat
>ask recuerda que los tryouts son los viernes
```

Escribe **brian** como un mensaje normal. Timmy contesta **ola soy yo**. Con **hay tarea** verás la reacción. La pregunta `>ask ¿cuándo son los tryouts?` usa la nota de este servidor. Las respuestas y reacciones guardadas también funcionan si Gemini está desconectado. Puedes añadir una respuesta y una reacción para la misma frase.

- `>recuerda lista` te envía por privado las frases y notas. `>recuerda quitar brian` borra la regla. Para quitar un dato, usa el identificador `nota_…` que Timmy te da al guardarlo.
- Una frase se reconoce como palabras completas, incluso dentro de una oración, con mayúsculas o signos. Si coinciden varias, gana la más larga. Las reglas automáticas ignoran bots, webhooks, DMs y canales de tickets.
- El historial personal de la IA y las notas del servidor son independientes. `>forget` borra el historial de quien lo escribe en ese chat. Las notas y reglas compartidas se guardan y se administran desde cada servidor.

## Configurar la moderación

1. Abre `/setup` de **Timmy Max** dentro del servidor. También puedes escribir `>setup` y pulsar **Abrir configuración**. Solo quien abrió el panel puede usar sus controles.
2. Elige **Moderación**. Timmy lee el ID del dueño y el permiso **Administrador** de Discord. El selector **Comprobar un rol** te muestra si ese rol concede Administrador. Puedes activar o desactivar los baneos para todo el servidor.
3. Pulsa **Siguiente** y elige un canal de registros. Timmy necesita **Ver canal**, **Enviar mensajes** e **Insertar enlaces** allí. En esta pantalla también puedes activar el antispam.
4. Para consultar tu acceso, pregunta `@Timmy Max ¿puedes banear a alguien si te lo pido?`. Para **aplicar** un baneo, menciona al miembro con `@Timmy Max banea a @miembro motivo: spam`. Si omites el motivo, responde al mensaje de Timmy con el motivo o con `cancelar`.

Los baneos por mención, por prefijo y por `/ban` requieren dueño o Administrador. Timmy necesita **Banear miembros** y un rol por encima del objetivo. Si quien solicita el baneo es administrador, su rol también debe estar por encima. Los servidores existentes empiezan con los baneos habilitados. El panel y el comando `>logs` comparten el canal de registros del servidor.

## Dar acceso al rol de moderación

Escribe `/access fakepermissions add` en Discord. En **role** elige el rol del menú. En **permissions** pega `manage_messages, moderate_members, manage_nicknames, kick_members`. Puedes hacerlo con el dueño del servidor o una cuenta con Administrador. Los miembros del rol pueden usar los comandos correspondientes de Timmy desde ese momento.

| Permiso dentro de Timmy | Comandos |
| --- | --- |
| `manage_messages` | `purge`, `say`, `snipe`, `editsnipe` (snipe requiere activación) |
| `moderate_members` | `warn`, `warnings`, `clearwarn`, `timeout`, `untimeout` |
| `manage_nicknames` | `nick` |
| `kick_members` | `kick` |
| `manage_channels` | `lock`, `unlock`, `slowmode` |
| `manage_roles` | `role` para roles voluntarios o de bienvenida configurados |

Las delegaciones antiguas de `ban_members` aparecen marcadas como inactivas. Puedes retirarlas con `/access fakepermissions remove`.

Para probar un permiso, alguien del rol puede escribir `>nick @miembro Papu` sobre un miembro de rango inferior. El bot también necesita **Gestionar apodos** y un rol por encima del destinatario. Para usar la versión con barra si Discord la oculta, abre **Ajustes del servidor → Integraciones → Timmy Max → Gestionar**, elige **/nick** y permite ese rol para ese comando. El prefijo `>` ya funciona con la delegación.

Usa `/access fakepermissions list` para consultar los roles. **remove** retira los permisos indicados o todo el acceso de un rol si omites **permissions**. **reset** retira las delegaciones de este servidor. La ayuda de Timmy consulta los roles de cada miembro. Los ajustes del servidor, los tickets y la web de administración siguen requiriendo sus permisos propios.

Los ejemplos de diseño están en [DISENO_Y_EMBEDS.md](DISENO_Y_EMBEDS.md). Para instalar la web por primera vez, consulta [PAGINA_Y_ACTUALIZACION.md](PAGINA_Y_ACTUALIZACION.md).

## Instalar en tu Railway actual

1. Descarga este repositorio desde **Code → Download ZIP** y descomprímelo. Si actualizas mediante un pull request, intégralo en `main` y conserva la conexión existente de Railway.
2. Guarda una copia del repositorio anterior y, si quieres conservar pruebas de tickets, exporta sus transcripciones. No subas el `.env` ni la memoria privada a GitHub.
3. En GitHub, abre `wdydk/bot-de-brian` → **Add file → Upload files**.
4. Sube **el contenido** de la carpeta del proyecto, no el ZIP ni una carpeta que deje `index.js` anidado. Deben quedar `index.js`, `package.json`, `package-lock.json`, `Dockerfile`, `railway.json`, `src/`, `scripts/` y `web/` en la raíz. Sube también los archivos de documentación y `test/` si quieres las pruebas. Actualiza `.gitignore` y `.dockerignore` si el selector oculta esos archivos.
5. Haz un solo commit con todos los cambios. **Reemplazar únicamente index.js no funciona:** ahora usa los módulos de `src/` y dependencias diferentes.
6. En Railway conserva `DISCORD_TOKEN` y `GEMINI_API_KEY`. Añade `GUILD_ID` (ID de tu servidor), `GEMINI_MODEL=gemini-3.5-flash-lite`, `PREFIX=>` y `REGISTER_SLASH=true`.
7. Conecta un volumen al servicio con ruta **`/data`**. Railway inyecta `RAILWAY_VOLUME_MOUNT_PATH`. No montes el volumen sobre `/app`, donde está el código.
8. Usa **una sola réplica**. Desactiva Serverless/suspensión si estuviera activo. Deja que el Dockerfile instale Python, FFmpeg, yt-dlp y las dependencias. El bot solo no necesita dominio. Para su página de comandos, sigue PAGINA_Y_ACTUALIZACION.md y activa WEB_ENABLED.
9. Espera a ver en los logs: `Timmy Max v3.3 conectado`, `Archivo de memoria: /data/timmy-v3.json` y `68 comandos / registrados`.
10. Apaga la copia del bot que tengas abierta en tu PC. Prueba `>ping`, `>help`, `/help` y un DM al bot.

El inicio reemplaza el catálogo GLOBAL de comandos de esta aplicación por el nuevo. Si defines GUILD_ID también reemplaza el catálogo de ese servidor, para retirar los viejos `/hola` y `/ping` de la captura. No toca comandos de otras aplicaciones. Si tienes comandos antiguos registrados en otros servidores, define ese servidor como GUILD_ID y despliega para reemplazar su catálogo; vuelve luego a tu ID principal. Los comandos globales pueden tardar en aparecer; reabre Discord. Se requiere la autorización `applications.commands` en la invitación del bot.

Si Railway tiene comandos personalizados de inicio/build configurados de antes, quítalos o deja el inicio en `node index.js`; no uses `npm test` como inicio.

## Discord Developer Portal

En la aplicación → Bot → Privileged Gateway Intents activa:

- **Server Members Intent** (bienvenida/autorrol).
- **Presence Intent** (`>sf`).
- **Message Content Intent** (comandos con prefijo y chat en servidor).

Invita la aplicación con scopes `bot` y `applications.commands`. Permisos del bot según las funciones que vayas a usar:

- Ver canales, Enviar mensajes, Insertar enlaces, Adjuntar archivos, Leer historial, Añadir reacciones.
- Conectar y Hablar para música.
- Gestionar roles para autorrol y roles con botones; coloca el rol del bot por encima de los roles que gestione.
- Gestionar canales para tickets y slowmode; Gestionar roles para sobrescrituras de canales.
- Gestionar mensajes, Moderar miembros, Expulsar miembros, Banear miembros para moderación.

No hace falta Administrador. Las funciones que carezcan de permisos mostrarán error. Tener un permiso de staff no concede todas las acciones. El bot también respeta la jerarquía del moderador. Nunca quita roles administrativos para forzar un timeout.

## Configuración inicial (ejemplos)

Ejecuta los siguientes en Discord, reemplazando las menciones/IDs por los tuyos. Para configurar necesitas ser dueño del servidor o tener Administrador; el bot necesita los permisos correspondientes para cada acción.

```text
>logs #logs
>welcome #bienvenidas ¡Bienvenido {user} a {server}! Ya somos {count}.
>welcome test
>goodbye #despedidas {username} salió de {server}.
>autorole @Miembro
>autoreact add "hola" 👋
>autoreact add "buenas noches" 🌙
>responder add redes Síguenos en nuestras redes; consulta el canal de anuncios.
>rolebutton @Eventos Avisos de eventos
>snipeconfig on
>automod on
>knowledge Aquí puedes explicar las normas, horarios y cómo contactar al staff.
>ticketsetup ID_DE_LA_CATEGORIA @Soporte
>ticketpanel
>config
```

- Bienvenidas/despedidas admiten `{user.mention}`, `{user.avatar}`, `{guild.name}`, `{guild.count}` y otras variables; consulta DISENO_Y_EMBEDS.md. Las variables anteriores `{user}`, `{username}`, `{server}`, `{count}` siguen funcionando, también en respuestas personalizadas.
- `>autoreact remove "hola"` quita una reacción; `>autoreact list` muestra las configuradas.
- Los roles automáticos y voluntarios deben ser roles sin poderes de moderación.
- `>responder add redes ...` responde cuando alguien escribe `redes` solo, `>redes` o `>ask redes`.
- `>welcome off`, `>goodbye off`, `>autorole off` y `>logs off` desactivan esas funciones.
- Snipe está apagado inicialmente. `>snipe` y `>editsnipe` requieren Gestionar mensajes, solo recuperan texto observado mientras el bot estaba en línea y caducan a los 5 minutos. No recuperan archivos borrados ni mensajes previos al arranque. La respuesta llega por DM al usar prefijo, o de forma privada al usar slash.
- El antispam es una regla simple y opcional: 6 mensajes en 5 segundos en el mismo canal. Intenta eliminar el exceso y aplicar 1 minuto de timeout. Omite bots y moderadores. No es un sistema antiraid completo ni una garantía contra ataques.
- Los comandos de configuración slash usan un campo `opciones`. Ej.: `/welcome opciones:#bienvenidas Hola {user}`. No pongas el prefijo dentro de `opciones`.
- `>help` muestra una selección breve; `>help Música` filtra esa categoría por permisos. La ayuda sensible se envía por DM o slash privado. `>panel` envía al administrador la página. COMMANDS.md es la referencia del código, no una página pública del servicio web.

## IA y mensajes privados

- Funciona con tu variable **GEMINI_API_KEY**. Si falta la clave, el resto del bot funciona.
- Consulta con `>ask pregunta`, `/ask` o una mención directa al bot.
- Como administrador, `>embedai #anuncios instrucciones` prepara un borrador con botones de edición y publicación. También puedes empezar `>ask crea un embed ... #anuncios`. El contenido se envía a Gemini sin el historial del chat. El modelo no publica ni elige permisos; el editor confirma el destino y requiere pulsar **Publicar**.
- Por DM, escribe directamente al bot. No hace falta prefijo. La IA responde a mensajes recibidos; no envía DMs masivos ni contacta por iniciativa propia a miembros.
- El usuario debe permitir los DMs correspondientes en Discord. El bot no puede eludir sus ajustes.
- Para leer un meme o una captura, adjunta la foto al mismo mensaje que «¿Qué dice ahí?». Por DM también puedes enviar solo la foto. En un servidor, menciona a Timmy con la foto, usa `>ask` con el adjunto o selecciona `imagen` en `/ask`. Admite JPG, PNG y WebP, hasta 10 MiB en total por consulta.
- Gemini recibe las fotos de esa consulta y hasta 6 turnos de texto del mismo usuario y chat. El historial del bot guarda la pregunta y la respuesta, incluida la transcripción que dé Timmy. Las fotos se procesan en memoria para ese turno. En los tickets, el staff revisa las pruebas. Para consultar una foto con la IA, adjúntala al mencionar a Timmy o al usar `ask`.
- El contexto se mantiene en RAM, caduca tras 2 horas sin uso y se pierde al reiniciar. `>forget` elimina el contexto de ese usuario en ese chat. `>privacy` explica el uso de datos.
- `>aiconfig off` desactiva IA en el servidor. `AI_DM_ENABLED=false` desactiva la IA en DMs.
- `>knowledge add nombre texto` permite hasta 20 fichas por servidor (4000 caracteres por ficha, 16000 en total). El formato anterior >knowledge texto sigue disponible. Los DMs no usan información de servidores.
- La IA no ejecuta moderación, no lee otros canales, no entrega roles y no toma decisiones sobre reportes. Ya no existe Berserk/Hellflash ni castigos por insultar al personaje.
- Hay cooldown por usuario y máximo 3 consultas simultáneas. No se envían múltiples llamadas al fallar por cuota. El consumo de Gemini es independiente de Railway. El modelo es configurable: si tu cuenta no tiene acceso al predeterminado, usa un modelo disponible para tu clave.

## Música: reparación y comprobación

El proyecto usa una única sesión por servidor, control serial de la cola y eventos compartidos tanto para `>join` como para `>play`. El Dockerfile instala el yt-dlp de Linux, sus dependencias de JavaScript y FFmpeg. No se utiliza `yt-dlp.exe`, no se desactiva la verificación TLS y no se ocultan los errores de FFmpeg.

El anuncio de reproducción se envía solo después de recibir PCM y entrar en **Playing**. Eso confirma el procesamiento local; no prueba por sí solo que un usuario haya oído el sonido.

Prueba en este orden:

```text
>stop
>join
>audiotest
>musicdiag
>play nombre de la canción y artista
>queue
```

`>stop` puede responder que no hay sesión si aún no entraste: es normal. Entra tú primero en un canal de voz normal, no un escenario. La prueba genera un tono suave de 3 segundos sin usar YouTube.

| Resultado | Qué revisar |
| --- | --- |
| No conecta a voz | Conectar/Hablar, silencio del bot, conexión UDP del hosting y logs. |
| Se oye el tono pero no YouTube | La voz funciona; revisa errores yt-dlp/YouTube, disponibilidad del video y restricciones de la IP del hosting. |
| No oyes el tono pero hay PCM y Playing | Revisa el volumen individual del bot en tu Discord, tu salida de audio, silencio del servidor y la conexión de voz. |
| PCM en cero o fallo de FFmpeg | Revisa el Dockerfile nuevo y los logs de despliegue/audio. |
| Error 403/429 o “sign in / not a bot” | YouTube puede rechazar centros de datos. No se garantiza reproducir todos los videos ni se eluden restricciones. |

Hay soporte DAVE a través de @discordjs/voice y su dependencia. El diagnóstico de arranque muestra qué librerías se cargaron. `npm run doctor` comprueba herramientas locales, no una sesión real de Discord.

Funciones: play, join, stop/leave, skip, pause, resume, volume 0–100, loop off/song/queue, queue, nowplaying, shuffle, audiotest y musicdiag. Todos los controles de modificación requieren estar en el mismo canal de voz. Opcional: `>djrole @DJ` restringe los controles; `>djrole off` quita esa restricción. Cualquiera en el canal puede pedir una canción dentro de los límites.

- `>sf` lee Spotify compartido en Discord; no reproduce audio ni muestra un historial de escuchas.
- Una canción de Spotify se busca en YouTube por su título. Para playlists, Timmy consulta los títulos y artistas de la cuenta vinculada y busca las versiones disponibles en YouTube. Los enlaces individuales de YouTube se resuelven directamente.
- Límite de 30 minutos por pista y de 50 solicitudes pendientes por servidor, 10 por persona. Una playlist cuenta como una solicitud y se carga por páginas. Los directos y los vídeos privados o no disponibles se omiten.
- Desconexión tras 30 segundos de canal vacío o 2 minutos sin pista. La cola de música es temporal y no se recupera tras un despliegue.
- Para actualizar yt-dlp en el futuro, cambia `ARG YTDLP_VERSION` del Dockerfile por una versión publicada y vuelve a desplegar. Consulta primero los logs; no cambies dependencias a ciegas.

### Configurar Spotify y YouTube en Railway

1. En [Spotify for Developers](https://developer.spotify.com/dashboard), abre tu aplicación y registra la URL HTTPS exacta de `WEB_BASE_URL` seguida de `/musica/spotify/callback`. Guarda `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET` en las variables de Railway. Si usas modo de desarrollo, revisa qué cuentas pueden usar esa app en **Users Management**.
2. En [Google Cloud](https://console.cloud.google.com/apis/library/youtube.googleapis.com), habilita **YouTube Data API v3**, crea una clave restringida a esa API y guárdala en Railway como `YOUTUBE_API_KEY`.
3. Activa el panel web con el acceso de Discord descrito en [Página y actualización](PAGINA_Y_ACTUALIZACION.md). Aplica las variables y conserva una sola instancia con su volumen. Cada participante vincula **su** cuenta con `>spotify`. La app guarda la autorización cifrada en `music-links.sqlite`. Si rotas el secreto, los miembros vuelven a vincular su cuenta.
4. Entra a voz y usa `>play` con una lista de YouTube o una playlist que hayas creado en Spotify o en la que colabores. `>musicdiag` muestra si las APIs están configuradas y `>audiotest` permite comprobar la conexión de voz. La API de YouTube aporta búsqueda y listas. El audio depende de la fuente, la cuota, la región y la conexión de voz.

## Tickets

1. Como dueño o administrador, configura categoría y rol específico de soporte con `>ticketsetup`.
2. Como dueño o administrador, publica `>ticketpanel` en un canal de texto. Los miembros usan `>ticket` para encontrar ese panel.
3. Personaliza el diseño con `>ticketdesign`, las opciones con `>ticketoption` y menú/botones con `>ticketstyle`. Publica de nuevo el panel después de guardar los cambios.
4. El usuario selecciona categoría y rellena un formulario de hasta 1000 caracteres.
5. Se permite un ticket abierto por usuario y servidor. La IA responde al texto que envía el autor dentro del ticket.
6. Soporte puede atender/reclamar el ticket y pausar/reactivar IA. Reclamar pausa IA automáticamente.
7. Solo el autor y soporte pueden exportar/cerrar. El cierre necesita confirmación.
8. Antes de eliminar el canal se guarda la transcripción en `/data/transcripts/ID.txt`; si falla el guardado no se elimina el canal.

Las transcripciones incluyen hasta los últimos 1000 mensajes y enlaces de adjuntos, no los archivos multimedia. Los enlaces pueden caducar. No se envían transcripciones a un canal público. Los administradores de Discord siempre pueden acceder a canales privados. Los registros de moderación solo anuncian IDs/estados de tickets, sin copiar su contenido.

Las transcripciones permanecen en el volumen hasta que el administrador las retire o borre el volumen. Define tu política de retención e informa a la comunidad.

### Reportes, boosters, XP y cumpleaños

Dentro de un ticket abierto, Timmy conserva el usuario reportado, pregunta qué pasó y acepta una captura, un enlace o la indicación de que no hay pruebas. El staff puede pausar la IA del ticket.

Para los beneficios de boost, `>knowledge add beneficios-boost Texto` define lo que reciben y `>knowledge add reclamar-boost Texto` explica cómo reclamarlo. La ficha `boost` sirve como alternativa. Las fichas describen los beneficios del servidor. Cada booster activo puede crear o editar un rol personal con `>rc`, **Diseñar mi rol**, nombre y color. Si menciona a Timmy para preguntar por su rol, los pasos llegan por DM. `/rc` abre el formulario de manera privada.

En la web, entra por `>panel` y abre **Experiencia y ajustes**. En **Experiencia**, busca por ID o pulsa **Editar** en la clasificación. En **Avisos de nivel**, `{level.new_rank}` y `{level.user_xp}` muestran el nivel y la XP total, también en el pie. Las secciones de mensajes permiten editar, previsualizar y guardar. Para **Cumpleaños**, activa la celebración, elige zona horaria, hora, canal y rol. Timmy puede crear el rol al guardar. Los miembros registran solo su día y mes con `/cumple fecha:21/11`. El rol que entrega Timmy dura 24 horas.

## Memoria por servidor y copias de seguridad

**Al actualizar de v3, v3.1 o v3.2 a v3.3 se conserva timmy-v3.json, los tickets y la configuración existentes.** Los campos nuevos se añaden automáticamente. Los servidores nuevos empiezan sin ajustes propios. Si vienes del index antiguo anterior a v3, bot_memory.json no se importa ni se borra; sus botones antiguos no son compatibles.

La memoria guarda configuración por servidor, advertencias y tickets activos. Cada guardado escribe un temporal, lo sincroniza y lo renombra, conservando la versión anterior como `timmy-v3.json.bak`. No borra memoria si el JSON está corrupto: detiene el inicio y permite recuperar la copia. No hay comandos `wipe` o `nuke`.

La copia `.bak` está en el mismo volumen y no protege frente al borrado del volumen. Para restaurar, detén el bot y reemplaza `timmy-v3.json` por una copia válida. No edites el archivo mientras corre el bot. Configura además backups del volumen si tu plan los ofrece.

## Ejecutar en PC

Necesitas Node.js 24.17+ de la rama 24, Python 3.11+, FFmpeg en PATH y yt-dlp:

```sh
python -m pip install "yt-dlp[default]==2026.10.26"
npm ci
npm run check
npm run doctor
```

Copia `.env.example` a `.env`, rellena las variables y ejecuta `npm start`. Si FFmpeg o yt-dlp no están en PATH, define sus rutas absolutas en `.env`. No ejecutes la copia local y Railway con el mismo token al mismo tiempo.

## Pruebas y límites de la entrega

Consulta VALIDACION.md para resultados y límites. La página requiere configurar tu dominio y credenciales OAuth2 reales antes de usarla; no está publicada automáticamente.

`npm test` verifica permisos, jerarquía, aislamiento de memoria/IA, persistencia, JSON corrupto, formularios, catálogo slash, validación de fuentes de música, generación PCM con FFmpeg y codificación PCM→Opus con AudioPlayer. No necesita token de Discord ni clave de Gemini.

No se ha desplegado esta versión ni se han enviado mensajes con tu cuenta. No se ha confirmado audio real en tu servidor, acceso real de tu clave a Gemini ni todas las funciones contra la API de Discord. La comprobación final incluye unirse con dos cuentas, probar permisos, abrir/cerrar un ticket, escuchar el tono y reiniciar con una configuración guardada.

## Referencias técnicas

- https://discord.js.org/docs/packages/voice/main
- https://github.com/yt-dlp/yt-dlp
- https://docs.discord.com/developers/events/gateway
- https://docs.railway.com/volumes/reference
- https://ai.google.dev/gemini-api/docs/models

No se incluye el código propietario, marca, pagos, last.fm, redes sociales, economía, herramientas avanzadas antinuke ni todo el catálogo de Bleed. El alcance exacto es la lista COMMANDS.md.
