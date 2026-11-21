'use strict';

const { MILESTONES, roleName } = require('./rewards');
const escape = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const modules = [
    ['niveles', 'Niveles', 'Gana XP al conversar y consigue roles por tus hitos.'],
    ['boosts', 'Boosts', 'Da las gracias y muestra los beneficios de impulsar el servidor.'],
    ['verificacion', 'Verificación', 'Revisa solicitudes en tickets privados y entrega el rol de acceso.'],
    ['proteccion', 'Protección', 'Detecta oleadas, consulta registros y controla cuándo bloquear un canal.'],
    ['bienvenidas', 'Bienvenidas y tickets', 'Recibe a los nuevos miembros y dales un lugar para pedir ayuda.'],
    ['ask', 'Ask', 'Pregunta por tu nivel, tus permisos o las reglas de tu comunidad.']
];
function sample(code) {
    const text = escape(code);
    return '<div class="guide-code"><code>' + text + '</code><button type="button" class="copy" data-copy="' + text + '">Copiar</button></div>';
}
function sampleTabs() {
    return '<div class="event-demo"><div class="demo-head"><span class="demo-icon" aria-hidden="true">#</span><span>comunidad</span><small>Vista previa</small></div>' +
        '<div role="tablist" aria-label="Mensaje de ejemplo" class="demo-tabs">' +
        ['Niveles', 'Boosts', 'Verificación'].map((label, n) => '<button type="button" id="tab-' + n + '" role="tab" aria-controls="example-' + n + '" aria-selected="' + (n === 0) + '" tabindex="' + (n === 0 ? '0' : '-1') + '">' + label + '</button>').join('') + '</div>' +
        '<div class="demo-message"><div class="demo-author"><span class="mark" aria-hidden="true">T<span>m</span></span><strong>Timmy Max</strong><small>APP</small></div>' +
        [
            ['@Papu', '¡Subiste de nivel!', 'Llegaste al <b>nivel 5</b> con <b>510 XP</b>.', '𝑙𝑒𝑣𝑒𝑙 5', '05', 'nivel'],
            ['@Papu', '¡Gracias por el boost!', 'Tu boost te da acceso a la sala de boosters mientras esté activo.', 'Sala de boosters', '✦', 'boost'],
            ['Acceso al servidor', 'Verifica tu cuenta', 'Abre un ticket privado. El equipo leerá tu solicitud y te avisará aquí.', 'Solicitar verificación', '✓', 'acceso']
        ].map(([name, title, desc, note, icon, caption], n) => '<section class="demo-panel demo-' + n + '" id="example-' + n + '" role="tabpanel" aria-labelledby="tab-' + n + '"' + (n ? ' hidden' : '') + '><div class="demo-body"><div><span class="demo-mention">' + name + '</span><h2>' + title + '</h2><p>' + desc + '</p></div><div class="demo-medal" aria-hidden="true"><b>' + icon + '</b><span>' + caption + '</span></div></div><div class="demo-reward"><i aria-hidden="true"></i>' + note + '</div></section>').join('') + '</div></div>';
}
function homeContent(configured) {
    return '<section class="cover"><div class="cover-copy"><div class="edition">Bot de Discord <span>Beta</span></div><h1>Timmy <em>Max</em></h1>' +
        '<p>Recibe a tus miembros, celebra sus niveles y agradece cada boost. Timmy también responde preguntas con las reglas y los permisos de tu servidor.</p>' +
        '<div class="cover-actions"><a class="button primary" href="/guia">Leer la guía rápida <span aria-hidden="true">→</span></a>' +
        (configured ? '<a class="cover-link" href="/servers">Abrir mi panel <span aria-hidden="true">↗</span></a>' : '') +
        '</div></div>' + sampleTabs() + '</section><section class="module-section" id="modulos"><div class="module-heading"><h2>Elige qué configurar</h2><a href="/guia">Ver guía completa →</a></div><div class="module-index">' +
        modules.map(([anchor, title, desc]) => '<a href="/guia#' + anchor + '"><h3>' + title + '</h3><p>' + desc + '</p><b aria-hidden="true">↗</b></a>').join('') + '</div></section>';
}
function guideContent() {
    const anchors = [['inicio', 'Primeros pasos'], ...modules.map(([id, title]) => [id, title])];
    const section = (id, title, body) => '<section class="guide-section" id="' + id + '"><h2>' + title + '</h2>' + body + '</section>';
    return '<div class="guide-shell"><nav class="guide-index" aria-label="Índice de la guía"><strong>En esta guía</strong>' +
        anchors.map(([id, label]) => '<a href="#' + id + '">' + label + '</a>').join('') +
        '</nav><article class="guide-article"><div class="guide-title"><span class="edition">Timmy Max / Documentación</span><h1>Guía rápida</h1><p>Elige la tarea que quieres hacer. Puedes volver a la guía y activar otro módulo cuando lo necesites.</p></div>' +
        section('inicio', 'Primeros pasos', '<ol><li><strong>Abre Discord.</strong> En un servidor donde ya esté Timmy, escribe <code>/setup</code>. También puedes escribir <code>&gt;setup</code> y pulsar <em>Abrir configuración</em>.</li><li><strong>Elige un módulo.</strong> El dueño o un administrador puede abrir este panel privado. Los miembros pueden consultar su progreso con <code>/level</code> y pedir ayuda con <code>/ask</code>.</li><li><strong>Revisa antes de guardar.</strong> En Niveles, Boosts y Verificación, usa <em>Siguiente</em> para llegar al resumen. <em>Atrás</em> permite corregirlo. <em>Guardar</em> aplica los cambios a ese servidor.</li></ol>') +
        section('niveles', 'Niveles y mensajes de XP', '<p>En <strong>/setup → Niveles</strong>, pulsa <em>Activar Niveles</em>. Elige dónde anunciar las subidas. Si dejas el canal vacío, Timmy responde donde la persona ganó el nivel.</p><p>Escribe el anuncio en <em>Editar mensaje</em>. La vista previa usa datos de ejemplo y al guardar Timmy crea estos cinco roles acumulables.</p><ul class="guide-ranks">' +
            MILESTONES.map(m => '<li><i class="rank-' + m.level + '"></i>' + roleName(m.level) + ' <small>' + m.label + '</small></li>').join('') +
            '</ul><p>Timmy necesita <strong>Gestionar roles</strong> y su rol debe estar por encima de los roles que entrega. Cada mensaje válido da 15 XP, con un minuto de espera por persona. Cada 100 XP subes un nivel. Los comandos, los bots y los tickets no suman XP.</p><p>Personaliza el aviso como una bienvenida. Sustituye <code>#niveles</code> por una mención real al canal.</p>' +
            sample('>levelmessage add #niveles {embed}$v{message: {user.mention}}$v{title: ¡Llegaste al nivel {level}!}$v{description: Ya tienes **{xp} XP** en {guild.name}.}$v{thumbnail: {user.avatar}}') +
            '<p>Usa <code>&gt;levelmessage test</code> para ver una muestra. Para consultar tu progreso real, usa <code>/level</code>.</p>') +
        section('boosts', 'Boosts y beneficios', '<ol><li>Abre <strong>/setup → Boosts</strong>, actívalo y elige el canal de agradecimientos.</li><li>En <em>Editar beneficios</em>, escribe lo que ofrece tu servidor. Puedes elegir un rol temporal de recompensa. Si promete acceso a un canal, configura ese acceso en los permisos del canal.</li><li>Edita el anuncio con <code>{boost.perks}</code>, revisa la muestra y pulsa <em>Guardar</em>. Prueba el diseño con <code>&gt;boostmessage test</code>.</li></ol>' +
            sample('>boostmessage add #boosts {embed}$v{title: ¡Gracias, {user.name}!}$v{description: {boost.perks}}$v{thumbnail: {user.avatar}}') +
            '<p>Timmy agradece el inicio del boost y los impulsos adicionales que Discord anuncie. Cuando termina el boost, retira el rol que él mismo entregó.</p>') +
        section('verificacion', 'Verificación en un ticket', '<ol><li>Elige <strong>/setup → Verificación</strong> y activa el módulo. Selecciona el canal del panel y la categoría para los tickets privados.</li><li>Elige el rol que se entregará, el rol que se retirará si corresponde y quién puede solicitar. En <em>Editar panel y preguntas</em> puedes cambiar el texto, el color, el banner y hasta tres preguntas.</li><li>Pulsa <em>Guardar</em> en el resumen. El miembro pulsa <em>Solicitar verificación</em> en el panel publicado. El dueño o un administrador revisa las respuestas, aprueba o deniega y puede cerrar el ticket con transcripción.</li></ol>') +
        section('proteccion', 'Protección, Snipe y Lockdown', '<dl><dt>Protección</dt><dd>Primero elige el canal de registros en <strong>Moderación → Siguiente</strong>. Activa <em>Protección</em> para recibir una alerta desde 5 entradas o 3 eliminaciones de canales o roles en 10 segundos. La pausa opcional retrasa el autorrol de bienvenida hasta que pase un minuto de calma.</dd><dt>Snipe</dt><dd>Si lo activas, el staff autorizado puede consultar en privado el último texto eliminado o editado de un canal durante cinco minutos.</dd><dt>Lockdown</dt><dd>Elige el canal y revisa la acción antes de guardar. Bloquear modifica <em>Enviar mensajes</em> de @everyone. Desbloquear restaura su valor anterior.</dd></dl>') +
        section('bienvenidas', 'Bienvenidas y tickets de soporte', '<p>Abre <strong>/setup → Bienvenidas y despedidas</strong> para revisar los canales. Variables como <code>{user.mention}</code>, <code>{user.avatar}</code> y <code>{guild.name}</code> también funcionan en anuncios de niveles y boosts.</p>' +
            sample('>welcome add #bienvenidas ¡Hola {user.mention}! Bienvenido a {guild.name}.') +
            '<p>Para el soporte general, abre <strong>/setup → Tickets</strong>, elige la categoría y el equipo con el comando que aparece allí y publica el panel en el canal de soporte.</p>') +
        section('ask', 'Qué puedes pedirle a Timmy', '<p>Un miembro puede preguntar <em>«¿Qué me dan si boosteo?»</em> o <em>«¿Cuánto XP me falta?»</em>. Un administrador puede preguntar <em>«¿Cómo configuro los niveles?»</em>. Timmy usa tu identidad y los ajustes del servidor para darte el siguiente paso.</p><p>Si eres el dueño y quieres revisar la moderación, prueba <code>&gt;ask ¿Puedo solicitar un baneo?</code>. Para pedir información del servidor, pregunta dentro de ese servidor.</p>') +
        '</article></div>';
}
module.exports = { homeContent, guideContent };
