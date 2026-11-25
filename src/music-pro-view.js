'use strict';
function view({base,guild,session,music,musicOwner,cfg,esc,s,control}){
 if(!music?.pro)return '';
 const pro=music.pro,g=guild.id,u=session.user.id,tracks=s.library,available=new Map(tracks.map(t=>[t.id,t]));
 const h=(k,v)=>'<input type="hidden" name="'+k+'" value="'+esc(v)+'">';
 const field=(name,label,value,max)=>'<label>'+label+'<input name="'+name+'" value="'+esc(value||'')+'" maxlength="'+max+'"></label>';
 const area=(name,label,value,max)=>'<label>'+label+'<textarea name="'+name+'" maxlength="'+max+'">'+esc(value||'')+'</textarea></label>';
 const form=(action,content,label)=>'<form method="post" action="'+base+'" class="music-library-edit">'+h('csrf',session.csrf)+h('section','music-pro')+h('action',action)+content+'<button class="button">'+label+'</button></form>';
 const choices='<label>Pista<select name="id">'+tracks.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.title)+' · '+esc(t.id)+'</option>').join('')+'</select></label>';
 const favorites=pro.favorites(g,u),lists=pro.lists(g);
 const playlist=p=>form('list-save',h('id',p.id)+h('revision',p.revision)+field('title','Nombre',p.title,100)+area('tracks','IDs de pistas autorizadas, en orden',p.tracks.join('\n'),1500),'Guardar playlist');
 const rightsConfirm='<label><input type="checkbox" name="confirm" value="yes" required> Confirmo autorización para publicar esta letra</label>';
 return '<section class="editor-block"><h2>Music Center Pro</h2><p>Favoritos personales y playlists compartidas entre administradores de este servidor. No modifican los archivos del propietario global.</p><h3>Favoritos</h3>'+form('favorite',choices,'Añadir a favoritos')+favorites.map(id=>'<p>'+esc(available.get(id)?.title||'Pista no disponible')+'</p>'+form('unfavorite',h('id',id),'Quitar favorito')).join('')+
 '<h3>Playlists colaborativas</h3>'+playlist({id:'',revision:0,title:'',tracks:[]})+lists.map(p=>'<details><summary>'+esc(p.title)+' · '+p.tracks.length+' pistas</summary><p>Último editor: '+esc(p.editor)+'</p><ol>'+p.tracks.map(id=>'<li>'+esc(available.get(id)?.title||'No disponible')+'</li>').join('')+'</ol>'+(s.active?control('guild-playlist','Reproducir',h('value',p.id)):'<code>'+esc(cfg.prefix+'play guild-playlist:'+p.id)+'</code>')+playlist(p)+form('list-delete',h('id',p.id)+h('revision',p.revision)+'<label><input type="checkbox" name="confirm" value="yes" required> Eliminar playlist</label>','Eliminar')+'</details>').join('')+
 '<h3>Historial de audios locales</h3><p>No registra canciones remotas, usuarios ni mensajes. Conserva hasta 100 inicios de reproducción.</p>'+(session.user.id===guild.ownerId?form('history-setting','<label><input type="checkbox" name="enabled" '+(cfg.musicHistoryEnabled?'checked':'')+'> Registrar audios locales</label>','Guardar preferencia'):'')+(cfg.musicHistoryEnabled?pro.history(g).map(x=>'<p>'+esc(x.title)+' · '+esc(new Date(x.at).toISOString())+'</p>').join(''):'<p>Desactivado.</p>')+
 '<h3>Letras autorizadas</h3>'+tracks.map(t=>{const l=pro.lyric(t.id);return l||musicOwner?'<details><summary>'+esc(t.title)+'</summary>'+(l?'<pre class="center-result">'+esc(l.body)+'</pre><small>'+esc(l.rights)+'</small>':'<p>Sin letra autorizada.</p>')+(musicOwner?form('lyric',h('id',t.id)+area('body','Letra (vacía para retirar)',l?.body,8000)+field('rights','Autorización',l?.rights,300)+rightsConfirm,'Guardar letra'):'')+'</details>':'';}).join('')+'</section>';
}
module.exports={view};
