# Validación de Timmy Max v3.2

## Resultado local

- `npm run check`: sintaxis correcta en **12 archivos JavaScript**.
- `npm test`: **47 pruebas aprobadas**, sin fallos.
- **64 comandos** en el catálogo común de prefijo, slash y web.
- La versión del paquete es 3.2.0. No se añadieron dependencias ni se cambiaron sus versiones.
- El motor de música conserva su implementación. Siguen pasando las pruebas de FFmpeg, PCM → Opus → AudioPlayer y eventos de reproducción.

## Comprobado automáticamente

Se mantienen las pruebas anteriores de permisos, jerarquía, ayuda, memoria, información IA por servidor y aislamiento de OAuth. Las peticiones a Discord y Gemini se simulan: estas pruebas no envían mensajes reales ni usan claves del usuario.

Pruebas nuevas de diseño:

- Entrada de mensajes con prefijo y de interacciones slash: conserva saltos de línea, comillas y variables.
- Formato `{embed}$v{...}` con llaves anidadas, saltos de línea, avatar, contador y enlaces con parámetros.
- Los valores de nombres de usuarios/servidores se sustituyen como texto; no se vuelven a interpretar como bloques.
- Rechazo de bloques inválidos, URLs que no son HTTP/S, colores inválidos y límites de texto de Discord.
- Exportación e importación de varios embeds, campos y botones de enlace.
- Lectura de bienvenidas antiguas, múltiples canales, persistencia y aislamiento entre servidores.
- Los comandos y alias nuevos rechazan a miembros sin Administrador aunque tengan Gestionar servidor o Gestionar mensajes.
- Borradores que no publican hasta confirmar; rechazo de otro usuario, otro servidor, permisos revocados y expiración.
- Dos clics concurrentes en Publicar solo producen un envío.
- `@everyone` requiere activación explícita y permisos actuales en el destino.
- El formulario edita el embed que se seleccionó al abrirlo. Un cambio inválido conserva el borrador anterior.
- Guardar diseño no publica; las opciones de ticket son independientes por servidor; botones y preguntas personalizadas generan el formulario esperado.
- La IA de diseño no recibe historial del chat ni herramientas para ejecutar acciones.

## Comprobado visualmente

Se usó una vista local del HTML real del catálogo con un servidor ficticio llamado Papulandia y el catálogo real de 64 comandos. No se inició sesión con el Discord del usuario.

- Lista compacta en escritorio.
- Diálogo de apariencia, tema claro, acento menta, vista de tarjetas y restablecimiento.
- Búsqueda `welcome`: devuelve un comando.
- Botón Copiar: copia la sintaxis de bienvenida al portapapeles.
- Filtros de categorías y catálogo de diseño.
- Vista de 390 píxeles mediante un iframe de prueba: sin desbordamiento horizontal (375 píxeles de contenido útil y viewport, descontando la barra vertical). No sustituye una prueba en un teléfono real.

Capturas del resultado: [panel](docs/panel.jpg) y [apariencia](docs/apariencia.jpg).

## Alcance y comprobaciones pendientes

La actualización se prepara en una rama y un pull request. Crear el pull request no cambia `main` ni despliega Railway. Hay que integrar el cambio y esperar el despliegue antes de usar los comandos nuevos.

No se ha construido una imagen Docker nueva en este entorno ni probado un inicio OAuth2 real con la aplicación, el callback HTTPS de Railway, un envío real de embed, los eventos reales de entrada/salida, un panel de tickets nuevo contra Discord o una respuesta real de la clave de Gemini. El usuario ya tiene una versión anterior funcionando; las pruebas locales no certifican las variables ni permisos reales de producción.

La prueba final es la sección 10 de [DISENO_Y_EMBEDS.md](DISENO_Y_EMBEDS.md). El volumen `/data` debe seguir conectado para conservar diseños y configuración. Los borradores son temporales; los diseños guardados persisten.

No se afirma que el audio sea audible en el servidor: las pruebas musicales verifican el procesamiento local. Los servicios externos pueden fallar por permisos, cuotas, restricciones o enlaces no disponibles.
