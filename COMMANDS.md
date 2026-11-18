# Comandos · Timmy Max v3.1

59 comandos con prefijo y slash. >help muestra solo una selección; >help categoría filtra por permisos. La página /panel solo permite administradores y dueños del servidor.

## Utilidades

| Comando | Función | Acceso |
| --- | --- | --- |
| `>help [categoría o comando]` | Ayuda breve según tus permisos | Miembros |
| `>ping` | Comprueba conexión y latencia | Miembros |
| `>avatar [@usuario]` | Muestra un avatar | Miembros |
| `>banner [@usuario]` | Muestra el banner de un usuario | Miembros |
| `>userinfo [@usuario]` | Consulta un miembro | Miembros |
| `>serverinfo` | Consulta el servidor | Miembros |
| `>sf [@usuario]` | Muestra Spotify compartido en Discord | Miembros |

## Configuración

| Comando | Función | Acceso |
| --- | --- | --- |
| `>panel` | Enlace privado a la página de comandos | Administrador / dueño |
| `>setup` | Guía de configuración de este servidor | Administrador / dueño |
| `>welcome #canal <mensaje> \| off \| test` | Configura la bienvenida | Administrador / dueño |
| `>goodbye #canal <mensaje> \| off \| test` | Configura la despedida | Administrador / dueño |
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
| `>ask <pregunta>` | Pregunta a la IA | Miembros |
| `>forget` | Borra tu contexto de IA de este chat | Miembros |
| `>privacy` | Explica el uso de datos de IA y snipe | Miembros |

## Moderación

| Comando | Función | Acceso |
| --- | --- | --- |
| `>snipe` | Último texto eliminado (staff) | ManageMessages |
| `>editsnipe` | Último texto editado (staff) | ManageMessages |
| `>purge <1-100>` | Borra mensajes recientes | ManageMessages |
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

## Tickets

| Comando | Función | Acceso |
| --- | --- | --- |
| `>ticketpanel` | Publica el panel de tickets | Administrador / dueño |
| `>ticket` | Indica dónde abrir tu ticket | Miembros |
| `>close` | Muestra confirmación para cerrar el ticket | Autor del ticket / soporte |
| `>transcript` | Descarga la transcripción del ticket | Autor del ticket / soporte |

## Música

| Comando | Función | Acceso |
| --- | --- | --- |
| `>join` | Conecta al canal de voz | Miembros |
| `>play <nombre o enlace>` | Busca y reproduce una canción | Miembros |
| `>stop` | Detiene y desconecta | Miembros |
| `>skip` | Salta la pista | Miembros |
| `>pause` | Pausa la música | Miembros |
| `>resume` | Reanuda la música | Miembros |
| `>shuffle` | Mezcla la cola | Miembros |
| `>volume <0-100>` | Ajusta el volumen de 0 a 100 | Miembros |
| `>loop off\|song\|queue` | Cambia el modo de repetición | Miembros |
| `>queue` | Muestra las siguientes canciones | Miembros |
| `>nowplaying` | Muestra la pista actual | Miembros |
| `>audiotest` | Prueba la voz con un tono suave | Administrador / dueño |
| `>musicdiag` | Diagnóstico de la sesión de audio | Administrador / dueño |

