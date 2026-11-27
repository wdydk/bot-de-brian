# Música en directo — Timmy

El modo predeterminado no requiere subir archivos ni registrar una biblioteca. Entra en voz y pega una URL de Audius en un canal de música, o usa `>play enlace`, `/play`, o `>play título artista`. La fuente debe permitir la reproducción y el uso correspondiente. Timmy conserva los controles de voz y la cola.

Spotify no proporciona un stream de audio completo para Discord. El resolver puede identificar una grabación disponible en Audius a través de identificadores independientes; si no existe, ofrece abrir Spotify. No selecciona una grabación ambigua ni extrae audio de Spotify o YouTube. No se garantizan todas las canciones ni playlists.

Diagnóstico: `>audiotest`, luego `>musicdiag`, y prueba un enlace directo autorizado. Si el tono falla, revisar permisos y voz; si solo falla una pista, revisar catálogo y disponibilidad.

Los archivos y playlists históricos no se eliminan del volumen. Para rollback explícito, configurar `MUSIC_LEGACY_LIBRARY=true` en Railway; por defecto está desactivado. No borrar `/data`, Supabase ni variables existentes. La radio oficial ya configurada conserva sus pistas históricas. Las cargas y edición web quedan desactivadas en modo remoto.
