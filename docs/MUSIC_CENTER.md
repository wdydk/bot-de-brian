# Music Center
No se cambia Supabase, su SQL ni las configuraciones existentes. El panel es privado para administradores y dueños; para controles, primero inicia una sesión de voz desde Discord (>join) y permanece en el mismo canal. Se comprueba acceso al canal de texto y reglas DJ. La cola y el estado son temporales. El panel muestra una instantánea; pulsa Actualizar estado.

## Biblioteca autorizada
En el volumen persistente de Timmy, crea music-library/ y añade archivos propios o con permiso explícito de reproducción/retransmisión a tu audiencia. Solo el operador del hosting tiene acceso de escritura. No se descarga ni copia música de Spotify o YouTube para preparar esta biblioteca. No se agregan fuentes de internet arbitrarias, cookies ni proxies. Formatos MP3, WAV, FLAC, OGG; máximo 100 MiB por pista y 30 minutos de reproducción. Crea music-library/manifest.json con este ejemplo (reemplaza archivo y declaración de derechos por los reales):

```json
[{"id":"intro","title":"Mi grabación original","file":"intro.wav","rights":"Grabación propia; autorizada para los canales de voz de este bot"}]
```

El campo rights documenta la autorización declarada por el operador; el bot no puede comprobar derechos de autor. El nombre del archivo es simple, sin rutas ni enlaces simbólicos. Ejecuta >play local:intro o elige el audio en Music Center. Los archivos no se sirven por HTTP, no se suben al repositorio y no se comparten con Supabase. Conserva el volumen.

## Fallos de YouTube
HTTP 429 o verificación anti-bot activa una pausa de 15 minutos por proceso, compartida por servidores. Se conservan en memoria las pistas remotas pendientes (no la pista fallida) y las locales pueden continuar. Otras sesiones respetan la pausa antes de iniciar otra extracción. No se reintenta automáticamente al terminar la pausa: cuando no haya pista activa, un usuario autorizado en el canal de voz puede usar >resume. La sesión retenida se elimina después de 30 minutos sin actividad de reproducción; >stop también limpia la cola. La cola no sobrevive a un reinicio. Tres fallos consecutivos detienen la cola, y los avisos del reproductor se limitan a uno por minuto y servidor. El tono de prueba y la biblioteca no dependen de YouTube. El diagnóstico muestra el último código y el tiempo restante; no incluye credenciales. Las solicitudes manuales reciben su propio error de validación. Un reinicio pierde cooldown y cola: no reiniciar para esquivar límites. La integración histórica de YouTube sigue disponible cuando no existe bloqueo; úsala únicamente cuando tengas permiso y el servicio lo permita. La API oficial es para metadatos, no para entregar audio; Spotify no proporciona audio para retransmitir en Discord.

## Validación
CI instala FFmpeg y ejecuta toda la suite. Prueba en un servidor aislado la sesión, permisos DJ, sonido local, controles, rechazo de URLs y pausa ante restricciones simuladas. No se garantiza reproducción de música comercial ni se modifica Railway automáticamente.


## Cargas desde Music Center (biblioteca web)
El propietario de la aplicación Discord (o dueño del equipo propietario) inicia sesión con Discord, abre un servidor que administra y entra a Music Center. El backend verifica la propiedad de la aplicación en Discord antes de aceptar cargas, además de OAuth, permiso de administrador del servidor, origen y CSRF. No basta con ser dueño de un servidor. No hay nueva variable ni modificación a Supabase.

Arrastra un audio o selecciona archivo, escribe título/artista/declaración de derechos y confirma permiso para retransmitir en todos los servidores que utilicen el bot. Puedes elegir portada opcional PNG/JPEG/WebP. Audio: MP3/WAV/FLAC/OGG, máximo 25 MiB y 30 minutos, validado por FFprobe. Portadas: 3 MiB, convertidas a JPEG de hasta 512 px por FFmpeg. Solo una carga global simultánea. No se aceptan URLs remotas ni se publican archivos de audio vía HTTP. Los administradores pueden ver portadas y reproducir con los permisos musicales existentes.

El catálogo web vive en music-library/web-managed dentro del directorio persistente, separado del manifiesto manual. Guarda hasta 200 pistas (incluye papelera) y 1 GiB de archivos web; conserva margen libre en el volumen. El límite de bytes no incluye el catálogo manual ni otros datos del bot. La papelera conserva archivos y permite recuperar pistas; no libera espacio ni vuelve a añadir la pista a las playlists. No se ofrece purga permanente desde la web. El operador puede respaldar y hacer mantenimiento manual con el bot detenido. No borres el volumen. El catálogo es compartido por todos los servidores; playlists de hasta 30 pistas, máximo 50. Usa los IDs mostrados para organizar las playlists, o >play local-playlist:ID. Las playlists y archivos sobreviven reinicios si se mantiene el volumen; la cola activa no.

El permiso se declara, no se verifica jurídicamente por el bot. No subas música de Spotify/YouTube sin autorización de retransmisión. Se requiere FFmpeg/FFprobe y una única réplica del bot; no se recomienda editar los archivos simultáneamente desde fuera. Si se guarda el audio pero falla la portada, recarga y edita la portada sin duplicar el audio. Prueba con una grabación propia antes de usar en producción.

Mover a papelera impide nuevas reproducciones y elimina la pista de playlists; si ya está sonando, puede terminar porque se conserva el archivo. Los elementos previamente en cola se vuelven a validar al empezar. No hay reproducción de una playlist vacía.
