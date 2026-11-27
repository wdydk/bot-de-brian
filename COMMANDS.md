# Comandos · Timmy Max v3.3

Consulta `>help` o `/help` para ver los comandos disponibles con tus permisos. Timmy también reconoce la coma como prefijo. El panel de configuración requiere ser dueño o administrador del servidor.

Consulta [DISENO_Y_EMBEDS.md](DISENO_Y_EMBEDS.md) para los ejemplos completos de bienvenidas, despedidas, embeds, tickets y personalización de la página.

## Utilidades

| Comando | Función | Acceso |
| --- | --- | --- |
| `>help [categoría o comando]` | Ayuda breve según tus permisos · Alias: `ayuda` | Miembros |
| `>ping` | Comprueba conexión y latencia | Miembros |
| `>avatar [@usuario]` | Muestra un avatar · Alias: `av`, `pfp` | Miembros |
| `>banner [@usuario]` | Muestra el banner de un usuario | Miembros |
| `>userinfo [@usuario]` | Consulta un miembro · Alias: `ui`, `whois` | Miembros |
| `>serverinfo` | Consulta el servidor · Alias: `si` | Miembros |
| `>sf [@usuario]` | Muestra Spotify compartido en Discord | Miembros |

## Configuración

| Comando | Función | Acceso |
| --- | --- | --- |
| `>panel` | Enlace privado a la página de comandos · Alias: `web`, `dashboard` | Administrador / dueño |
| `/access fakepermissions add / list / remove / reset` | Administra permisos internos por rol | Administrador / dueño |
| `>recuerda si alguien dice frase, dile texto` | Guarda respuestas, reacciones y notas | Administrador / dueño |
| `>setup` | Panel privado con permisos, canal de registros y antispam | Administrador / dueño |
| `>welcome add #canal <plantilla> \| edit\|view\|test\|remove #canal \| list \| off` | Bienvenidas con texto, embeds y editor | Administrador / dueño |
| `>goodbye add #canal <plantilla> \| edit\|view\|test\|remove #canal \| list \| off` | Despedidas con texto, embeds y editor | Administrador / dueño |
| `>autorole @rol \| off` | Rol automático para nuevos miembros | Administrador / dueño |
| `>logs #canal \| off` | Canal de registros | Administrador / dueño |
| `>djrole @rol \| off` | Restringe controles al rol DJ | Administrador / dueño |
| `>prefix <prefijo>` | Cambia el prefijo del servidor | Administrador / dueño |
| `>snipeconfig on \| off` | Activa o desactiva snipe | Administrador / dueño |
| `>automod on \| off` | Activa o desactiva automod | Administrador / dueño |
| `>aiconfig on \| off` | Activa o desactiva ai | Administrador / dueño |
| `>knowledge add nombre <texto> \| remove nombre \| list \| clear` | Fichas de información IA de este servidor | Administrador / dueño |
| `>config` | Muestra la configuración actual | Administrador / dueño |
| `>autoreact add "frase" emoji \| remove "frase" \| list` | Reacciona a palabras o frases | Administrador / dueño |
| `>responder add nombre <texto> \| remove nombre \| list` | Responde a una palabra sola o con prefijo | Administrador / dueño |
| `>rolebutton @rol <etiqueta>` | Publica un botón para obtener un rol | Administrador / dueño |
| `>ticketsetup <id-categoría> @soporte` | Configura categoría y rol de soporte | Administrador / dueño |

## IA

| Comando | Función | Acceso |
| --- | --- | --- |
| `>emojis` | Colección de Timmy. El dueño de la aplicación importa el ZIP por DM con `>emojis importar` | Miembros |
| `>ask [pregunta] [foto adjunta]` | Pregunta por texto o adjunta una foto para leerla con Gemini. En `/ask`, selecciona `imagen`. Alias `ia`. | Miembros |
| `>forget` | Borra tu contexto de IA de este chat · Alias: `clearmem` | Miembros |
| `>privacy` | Explica el uso de datos de IA y snipe | Miembros |

## Diseño

| Comando | Función | Acceso |
| --- | --- | --- |
| `>embed [#canal] [plantilla]` | Crea un borrador con editor y publicación · Alias: `ce` | Administrador / dueño |
| `>embedai #canal <instrucciones>` | Diseña un anuncio con IA antes de publicarlo | Administrador / dueño |

## Tickets

| Comando | Función | Acceso |
| --- | --- | --- |
| `>ticketdesign [plantilla \| reset]` | Edita el aspecto del panel de tickets | Administrador / dueño |
| `>ticketstyle menu\|buttons` | Elige menú o botones para abrir tickets | Administrador / dueño |
| `>ticketoption add clave "Etiqueta" "Emoji" "Pregunta" \| remove clave \| list \| reset` | Configura las opciones y preguntas del ticket | Administrador / dueño |
| `>ticketpanel` | Publica el panel de tickets | Administrador / dueño |
| `>ticket` | Indica dónde abrir tu ticket · Alias: `tickets` | Miembros |
| `>close` | Muestra confirmación para cerrar el ticket · Alias: `cerrar` | Autor del ticket / soporte |
| `>transcript` | Descarga la transcripción del ticket | Autor del ticket / soporte |

## Moderación

| Comando | Función | Acceso |
| --- | --- | --- |
| `>snipe` | Último texto eliminado (staff) · Alias: `s` | ManageMessages |
| `>editsnipe` | Último texto editado (staff) · Alias: `es` | ManageMessages |
| `>purge <1-100>` | Borra mensajes recientes · Alias: `clear`, `c` | ManageMessages |
| `>timeout @usuario 10m <motivo>` | Aplica un timeout con motivo | ModerateMembers |
| `>untimeout @usuario` | Retira un timeout | ModerateMembers |
| `>kick @usuario <motivo>` | Expulsa a un miembro | KickMembers |
| `>ban @usuario <motivo>` | Banea a un miembro con el motivo indicado | Administrador / dueño |
| `>nick @usuario apodo` | Cambia el apodo. Usa `reset` para quitarlo | ManageNicknames |
| `>warn @usuario <motivo>` | Guarda una advertencia | ModerateMembers |
| `>warnings @usuario` | Consulta advertencias | ModerateMembers |
| `>clearwarn @usuario <id>` | Elimina una advertencia por ID | ModerateMembers |
| `>role @usuario @rol add\|remove` | Añade o quita un rol sin privilegios | ManageRoles |
| `>lock` | Bloquea el canal para @everyone | ManageChannels |
| `>unlock` | Restaura el permiso anterior | ManageChannels |
| `>slowmode <0-21600>` | Configura el modo lento | ManageChannels |
| `>say <texto>` | Publica un texto con el bot | ManageMessages |

## Música

| Comando | Función | Acceso |
| --- | --- | --- |
| `>join` | Conecta al canal de voz | Miembros |
| `>spotify` | Vincula Spotify o actualiza permisos para reproducir en tu dispositivo | Miembros |
| `>play <nombre o enlace>` | Reproduce audio guardado por título, ID o enlace de Spotify asociado · Alias: `p` | Miembros |
| `>stop` | Detiene y desconecta · Alias: `leave`, `disconnect` | Miembros |
| `>skip` | Salta la pista · Alias: `next` | Miembros |
| `>pause` | Pausa la música | Miembros |
| `>resume` | Reanuda la música | Miembros |
| `>shuffle` | Mezcla la cola | Miembros |
| `>volume <0-100>` | Ajusta el volumen de 0 a 100 · Alias: `vol` | Miembros |
| `>loop off\|song\|queue` | Cambia el modo de repetición | Miembros |
| `>queue` | Muestra las siguientes canciones · Alias: `q` | Miembros |
| `>nowplaying` | Muestra la pista actual · Alias: `np` | Miembros |
| `>audiotest` | Prueba la voz con un tono suave | Administrador / dueño |
| `>musicdiag` | Diagnóstico de la sesión de audio | Administrador / dueño |

En los comandos slash de configuración, escribe los argumentos en el campo `opciones` sin el prefijo ni el nombre del comando. Los comandos de diseño conservan los saltos de línea de la plantilla.

Las delegaciones de moderación admiten las siete capacidades enumeradas en el [README](README.md#dar-acceso-al-rol-de-moderación). Los ajustes administrativos requieren Administrador o ser el dueño.

## Sorteos y eventos

| Pedido | Resultado |
| --- | --- |
| `>sorteos` o `/sorteos` | Muestra en privado los próximos diez sorteos abiertos en canales que puedes leer. También puedes preguntar «¿Qué sorteos hay activos?». |
| `>giveaway #giveaway hours: 5 prize: 5k Robux winners: 2` | Prepara el embed y el botón de entrada. Admite `minutes`, `hours` y `days`. |
| `@Timmy Max crea un sorteo en #giveaway de 2 días, premio: VIP, ganadores: 2 y anúncialo en #evento` | Prepara el sorteo y el anuncio en los dos canales indicados. |
| `>ask hazme un evento en #evento diciendo que el torneo TSB empieza el sábado a las 6` | Abre el borrador del anuncio con el texto indicado. |

El dueño o un administrador publica. Si Timmy pregunta cuántos ganadores habrá, basta responder `>ask 2`. Si solo falta el premio, responde por ejemplo `>ask 5k Robux`. Comprueba el borrador y pulsa **Publicar**. Cada miembro puede entrar una vez. Los resultados aparecen en el embed al finalizar.

## Niveles, boosts y verificación

El dueño o un administrador abre `/setup`, elige un módulo y revisa el resumen antes de guardar. La guía web está en `/guia`.

| Comando | Uso |
| --- | --- |
| `>rc` o `/rc` | Un booster elige nombre y color de su rol en un formulario. |
| `/cumple fecha:21/11` | Registra día y mes en este servidor. Usa `borrar` para retirar la fecha. |
| `/level` o `>nivel` | Muestra tu nivel, tus XP y cuánto te falta. |
| `>levelmessage add #canal <plantilla>` | Guarda un aviso con las variables de bienvenida, `{level}` y `{xp}`. También admite `{level.new_rank}` y `{level.user_xp}`. |
| `>boostmessage add #canal <plantilla>` | Guarda el agradecimiento. `{boost.perks}` muestra los beneficios escritos en el setup. |
| `>levelmessage test` o `>boostmessage test` | Muestra al solicitante un ejemplo de diseño. |
| `>levelmessage edit` o `>boostmessage edit` | Abre el editor visual. `view` exporta la plantilla. |

Los mensajes puntuables dan 15 XP por persona y por servidor como máximo una vez por minuto. Cada 100 XP se sube de nivel. Los roles son acumulables. Timmy guarda la experiencia en `timmy-xp.sqlite` junto a su configuración en el volumen. Para una copia en caliente usa el mecanismo de backup de SQLite, o detén el proceso antes de copiar el volumen completo.

En **Boosts** puedes elegir un rol temporal y describir los beneficios. En **Verificación** puedes publicar el panel, elegir hasta tres preguntas y revisar solicitudes en un ticket privado. En **Protección**, **Snipe** y **Lockdown** el asistente explica la acción antes de guardarla.
