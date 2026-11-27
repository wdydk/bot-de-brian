# Music Center
No se cambia Supabase, su SQL ni las configuraciones existentes. El panel es privado para administradores y dueños; para controles, primero inicia una sesión de voz desde Discord (>join) y permanece en el mismo canal. Se comprueba acceso al canal de texto y reglas DJ. La cola y el estado son temporales. El panel muestra una instantánea; pulsa Actualizar estado.

## Reproducir con un enlace

Entra en voz y pega un enlace de pista de Audius en el chat de voz o en un canal de música como `#music-24-7`. En otros canales de texto usa `>play enlace`. Timmy recibe el audio al reproducir y lo envía al canal. Comprueba al comenzar cada pista que Audius permita su reproducción pública completa. El reproductor enlaza la página del artista y la canción en Audius.

Con un enlace de pista de Spotify, Timmy usa primero cualquier asociación local existente. Después busca la grabación en Audius con su identificador. Wikidata proporciona la búsqueda pública. Si tienes Musicfetch, también puedes configurar `MUSICFETCH_TOKEN` para resolver enlaces entre plataformas. Si la grabación solo está disponible en Spotify, el botón de Spotify abre el reproductor personal. Con un título, Timmy busca primero en Music Center y después en Audius.

Para comprobar la reproducción con la biblioteca vacía, pega el [enlace de Spotify de Monkeys Spinning Monkeys](https://open.spotify.com/track/1VsTvfmPwrJxIP5idldxX7) en el chat de música. El reproductor muestra la grabación de Audius y sus controles al recibir audio.

## Biblioteca autorizada
En el volumen persistente de Timmy, crea music-library/ y añade archivos propios o con permiso explícito de reproducción/retransmisión a tu audiencia. Solo el operador del hosting tiene acceso de escritura. No se descarga ni copia música de Spotify o YouTube para preparar esta biblioteca. No se agregan fuentes de internet arbitrarias, cookies ni proxies. Formatos MP3, WAV, FLAC, OGG; máximo 100 MiB por pista y 30 minutos de reproducción. Crea music-library/manifest.json con este ejemplo (reemplaza archivo y declaración de derechos por los reales):

```json
[{"id":"intro","title":"Mi grabación original","file":"intro.wav","rights":"Grabación propia; autorizada para los canales de voz de este bot"}]
```

El campo `rights` documenta la autorización del operador. El nombre del archivo es simple y debe estar dentro de `music-library`. El manifiesto admite `artist` y `spotifyUrl` opcionales en cada pista. Los archivos registrados antes de esta actualización siguen disponibles por nombre y por ID.

## Pedir una canción

Entra a voz y escribe `>play` con el título, el título y artista o `local:ID`. Timmy admite tildes y puntuación distintas. Cuando varias grabaciones coinciden, muestra sus IDs. Puedes pedir una playlist registrada con `>play local-playlist:ID`.

Para asociar un archivo propio con un enlace de Spotify, abre la pista en **Music Center → Editar o eliminar** y guarda su enlace completo en **Enlace de Spotify de la canción**. También puedes pegarlo al subir el archivo. Para una playlist, guarda su enlace en la playlist local. La cola usa las pistas y el orden de esa playlist local. Timmy reconoce enlaces `open.spotify.com`, incluidos los que llevan `/intl-es/` y `?si=`, y las URI `spotify:track:` y `spotify:playlist:`.

Si falta una coincidencia reproducible, **Abrir en Spotify** abre el enlace original en el reproductor oficial. Cuando esté configurado el control de dispositivos, **Reproducir en mi Spotify** permite que quien pulse el botón escuche desde su cuenta Premium. La autorización personal se gestiona en `>spotify`. Una búsqueda por texto que no coincide con un archivo ofrece **Buscar en Spotify**. Los botones de Spotify controlan la escucha personal.

## Validación
CI instala FFmpeg y ejecuta toda la suite. Prueba en un servidor aislado la sesión, permisos DJ, sonido local, controles y rechazo de URLs externas. No se garantiza reproducción de música comercial ni se modifica Railway automáticamente.


## Cargas desde Music Center (biblioteca web)
El propietario de la aplicación Discord (o dueño del equipo propietario) inicia sesión con Discord, abre un servidor que administra y entra a Music Center. El backend verifica la propiedad de la aplicación en Discord antes de aceptar cargas, además de OAuth, permiso de administrador del servidor, origen y CSRF. No basta con ser dueño de un servidor. No hay nueva variable ni modificación a Supabase.

Arrastra un audio o selecciona archivo, escribe título/artista/declaración de derechos y confirma permiso para retransmitir en todos los servidores que utilicen el bot. Puedes elegir portada opcional PNG/JPEG/WebP. Audio: MP3/WAV/FLAC/OGG, máximo 25 MiB y 30 minutos, validado por FFprobe. Portadas: 3 MiB, convertidas a JPEG de hasta 512 px por FFmpeg. Solo una carga global simultánea. No se aceptan URLs remotas ni se publican archivos de audio vía HTTP. Los administradores pueden ver portadas y reproducir con los permisos musicales existentes.

El catálogo web vive en music-library/web-managed dentro del directorio persistente, separado del manifiesto manual. Guarda hasta 200 pistas (incluye papelera) y 1 GiB de archivos web; conserva margen libre en el volumen. El límite de bytes no incluye el catálogo manual ni otros datos del bot. La papelera conserva archivos y permite recuperar pistas; no libera espacio ni vuelve a añadir la pista a las playlists. No se ofrece purga permanente desde la web. El operador puede respaldar y hacer mantenimiento manual con el bot detenido. No borres el volumen. El catálogo es compartido por todos los servidores; playlists de hasta 30 pistas, máximo 50. Usa los IDs mostrados para organizar las playlists, o >play local-playlist:ID. Las playlists y archivos sobreviven reinicios si se mantiene el volumen; la cola activa no.

El permiso se declara, no se verifica jurídicamente por el bot. No subas música de Spotify/YouTube sin autorización de retransmisión. Se requiere FFmpeg/FFprobe y una única réplica del bot; no se recomienda editar los archivos simultáneamente desde fuera. Si se guarda el audio pero falla la portada, recarga y edita la portada sin duplicar el audio. Prueba con una grabación propia antes de usar en producción.

Mover a papelera impide nuevas reproducciones y elimina la pista de playlists; si ya está sonando, puede terminar porque se conserva el archivo. Los elementos previamente en cola se vuelven a validar al empezar. No hay reproducción de una playlist vacía.
