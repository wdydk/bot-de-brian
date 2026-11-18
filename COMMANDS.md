# Comandos · Timmy Max v3.2

64 comandos con prefijo y slash. Se aceptan también los prefijos coma y mayor que. La ayuda filtra según tus permisos; la página requiere ser dueño o Administrador.

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
| `>setup` | Guía de configuración de este servidor | Administrador / dueño |
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
| `>responder add nombre <texto> \| remove nombre \| list` | Crea respuestas a comandos | Administrador / dueño |
| `>rolebutton @rol <etiqueta>` | Publica un botón para obtener un rol | Administrador / dueño |
| `>ticketsetup <id-categoría> @soporte` | Configura categoría y rol de soporte | Administrador / dueño |

## IA

| Comando | Función | Acceso |
| --- | --- | --- |
| `>ask <pregunta>` | Pregunta a la IA · Alias: `ia` | Miembros |
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
| `>ban @usuario <motivo>` | Banea a un miembro | BanMembers |
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
| `>play <nombre o enlace>` | Busca y reproduce una canción · Alias: `p` | Miembros |
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
