# Persistencia segura de Timmy v3

El modo local sigue siendo el predeterminado. No se cambia la memoria existente por desplegar este PR. En modo Supabase se guarda el documento v3 completo (guilds, tickets y demás campos), con una revisión global por instalación. Cada guild conserva su ID y configuración; no se crea una base separada por servidor. El panel web y Discord siguen usando el mismo Store, de modo que las modificaciones confirmadas se reflejan en ambos en la misma instancia.

## Migración: no crear una memoria vacía

1. Detén todas las instancias de Timmy. Localiza la ruta real que imprime al arrancar (prioridad RAILWAY_VOLUME_MOUNT_PATH, DATA_DIR, data/). Copia **todo** el directorio a un backup privado fuera del hosting; conserva timmy-v3.json y .bak. No subas ese contenido a GitHub. Si el principal falta pero tienes una copia válida, restaura una copia del backup primero.
2. Comprueba que el JSON v3 contiene los servidores y tickets esperados. Si vienes de bot_memory.json anterior a v3, este procedimiento no lo convierte: requiere una migración específica.
3. Crea o elige un proyecto Supabase de confianza. En SQL Editor ejecuta docs/supabase-persistence.sql. Las tablas tienen RLS y no dan acceso al rol anon o authenticated. Las escrituras se hacen por RPC transaccional con revisión esperada. No compartas la clave secreta.
4. En las variables privadas del proceso que tiene el JSON existente configura TIMMY_STORAGE=supabase, TIMMY_SUPABASE_URL (URL HTTPS del proyecto), TIMMY_SUPABASE_KEY (secret key o service_role JWT del servidor), TIMMY_STORAGE_ID (identificador fijo y exclusivo de esta instalación, por ejemplo timmy-produccion), TIMMY_SUPABASE_BOOTSTRAP=import. Conserva DISCORD_TOKEN y las variables previas. No uses la clave anon.
5. Inicia una única instancia. Si la importación se confirma, la tabla timmy_state contiene una fila y timmy_state_history contiene la revisión 1. Comprueba el número de servidores/tickets y algunos IDs conocidos sin publicar el JSON. Verifica la configuración desde /setup y el panel.
6. Retira TIMMY_SUPABASE_BOOTSTRAP del entorno. Cambia un ajuste de prueba, comprueba la revisión nueva, reinicia y verifica el ajuste y los anteriores. Solo después cambia de Codespace o hosting si lo necesitas. Conserva TIMMY_STORAGE_ID y las mismas variables remotas. No ejecutes simultáneamente la copia antigua y la nueva.
7. Para una instalación realmente nueva sin datos, existe bootstrap=empty; no usar para recuperar un servidor que perdió archivos. No habilitarlo permanentemente.

## Protección, recuperación y límites

- El servidor remoto confirma cada cambio antes de que Store.save() devuelva éxito. No se hace fallback a una memoria vacía al fallar la red o encontrar una revisión en conflicto. Se detiene el proceso real para no operar con datos inconsistentes. Si el resultado de una escritura es desconocido, el siguiente arranque lee la revisión remota; no reintenta a ciegas.
- La migración no pisa un JSON distinto de una fila remota preexistente. El archivo .remote identifica el proyecto y la instalación; si falta la fila remota en una instalación marcada, el inicio se rechaza. Si cambias accidentalmente de proyecto en un disco nuevo, el identificador fijo y la ausencia de bootstrap ayudan a impedir una inicialización accidental.
- Cada revisión confirmada se conserva en timmy_state_history. Las copias locales previas a migración terminan en .pre-cloud-... y el Store sigue creando .bak. Exporta backups privados fuera de Supabase y fija una política de retención: el historial completo crece y contiene datos de Discord.
- Si necesitas restaurar una revisión, detén las instancias y conserva primero la fila actual y su historial. Revisa las diferencias con la copia elegida; no borres la fila ni reduzcas la revisión. Un administrador puede preparar un snapshot reconciliado y confirmarlo mediante timmy_commit_state con la revisión actual. La protección rechaza eliminar IDs de servidores completos. No ejecutes un rollback de datos sin verificar tickets/roles y cambios posteriores.
- Para volver a modo local, detén todas las instancias, exporta el snapshot remoto más reciente a un directorio nuevo y persistente, verifica su integridad y configura el modo local y las variables correspondientes. No quites el marcador del directorio activo sin hacer el procedimiento.
- XP (timmy-xp.sqlite), vínculos Spotify, imágenes y transcripciones no se incluyen en el JSON. Mantén un volumen persistente y backups de todo el directorio para esos datos. Este PR no mueve esos archivos a Supabase.
- El panel y el bot deben seguir en un único proceso. La revisión protege contra escrituras concurrentes, pero no convierte el bot en un sistema multiinstancia.
- La API histórica de Store es síncrona; el adaptador usa una llamada HTTP aislada por escritura con timeout máximo de 15 s. Esto puede bloquear brevemente el event loop y retrasar interacciones; mide latencia con tu hosting antes de habilitar producción. Sin cambios no hay escritura remota. Para alta carga, se recomienda una refactorización asíncrona posterior.
- La base remota no restaura roles/canales eliminados manualmente en Discord: conserva sus referencias y permisos configurados. No se altera la jerarquía existente.

## Pruebas

Ejecuta node --test test/persistence.test.js (sin secretos) y npm test en un entorno Node compatible. Las pruebas usan un remoto simulado y prueban reinicios, importación, aislamiento por guild, tickets, conflictos y fallos. Antes de fusionar, prueba también la SQL y las credenciales contra un proyecto Supabase de staging y una copia de datos de prueba. No uses tokens de producción en CI.

## Diagnóstico de conexión (Railway Deploy Logs)

La etiqueta Supabase [lectura] indica que falló la consulta inicial; [escritura] indica que falló el RPC de importación o guardado. HTTP 401 apunta a autenticación, 403 a permisos, 404/PGRST205/PGRST202 a URL o esquema no disponible, 429 a límites, 5xx al servicio remoto. ENOTFOUND/EAI_AGAIN indican DNS; otros códigos permiten distinguir TLS, tiempo límite y cortes de red. No se imprimen cuerpos de respuesta, claves ni URLs. Los JWT heredados se decodifican solo para comprobar rol, expiración y referencia de proyecto cuando está disponible; la API verifica la autenticidad. No se sigue una redirección. No desactives TLS ni cambies bootstrap a empty para superar un error.

Si las tablas existen pero la lectura devuelve un error, verifica que Data API esté habilitada y exponga public, y que la clave corresponda al proyecto correcto. Si la lectura funciona pero la escritura falla, revisa el código SQL reportado. Mantén el volumen y backups intactos. No hay migración real en las pruebas de CI.
