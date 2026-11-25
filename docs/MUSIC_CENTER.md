# Music Center
No se cambia Supabase, su SQL ni las configuraciones existentes. El panel es privado para administradores y dueños; para controles, primero inicia una sesión de voz desde Discord (>join) y permanece en el mismo canal. Se comprueba acceso al canal de texto y reglas DJ. La cola y el estado son temporales. El panel muestra una instantánea; pulsa Actualizar estado.

## Biblioteca autorizada
En el volumen persistente de Timmy, crea music-library/ y añade archivos propios o con permiso explícito de reproducción/retransmisión a tu audiencia. Solo el operador del hosting tiene acceso de escritura. No se descarga ni copia música de Spotify o YouTube para preparar esta biblioteca. No se agregan fuentes de internet arbitrarias, cookies ni proxies. Formatos MP3, WAV, FLAC, OGG; máximo 100 MiB por pista y 30 minutos de reproducción. Crea music-library/manifest.json con este ejemplo (reemplaza archivo y declaración de derechos por los reales):

```json
[{"id":"intro","title":"Mi grabación original","file":"intro.wav","rights":"Grabación propia; autorizada para los canales de voz de este bot"}]
```

El campo rights documenta la autorización declarada por el operador; el bot no puede comprobar derechos de autor. El nombre del archivo es simple, sin rutas ni enlaces simbólicos. Ejecuta >play local:intro o elige el audio en Music Center. Los archivos no se sirven por HTTP, no se suben al repositorio y no se comparten con Supabase. Conserva el volumen.

## Fallos de YouTube
HTTP 429 o verificación anti-bot activa una pausa de 15 minutos por proceso, compartida por servidores. Se retiran las pistas remotas pendientes de la sesión afectada; las locales permanecen. Otras sesiones respetan la pausa antes de iniciar otra extracción. No se reintenta automáticamente al terminar la pausa. Tres fallos consecutivos detienen la cola, y los avisos del reproductor se limitan a uno por minuto y servidor. El tono de prueba y la biblioteca no dependen de YouTube. El diagnóstico muestra el último código y el tiempo restante; no incluye credenciales. Las solicitudes manuales reciben su propio error de validación. Un reinicio pierde cooldown y cola: no reiniciar para esquivar límites. La integración histórica de YouTube sigue disponible cuando no existe bloqueo; úsala únicamente cuando tengas permiso y el servicio lo permita. La API oficial es para metadatos, no para entregar audio; Spotify no proporciona audio para retransmitir en Discord.

## Validación
CI instala FFmpeg y ejecuta toda la suite. Prueba en un servidor aislado la sesión, permisos DJ, sonido local, controles, rechazo de URLs y pausa ante restricciones simuladas. No se garantiza reproducción de música comercial ni se modifica Railway automáticamente.
