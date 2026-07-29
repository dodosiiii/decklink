let socket, configData, systemInfo, connected = false;
let activeCategory = 'all', searchQuery = '', fileHistory = [];
let mediaInterval = null, screenInterval = null, mouseTracking = false;
let detectedApps = [], setupSelectedApps = new Set(), _detectModalOpen = false;
let _mediaPosTimer = null, _mediaPos = 0, _mediaDur = 0;
const $ = id => document.getElementById(id);

function init() { connectSocket(); bindUI(); setInterval(()=>{if(connected)socket.emit('get_system_info');},5000); }

function connectSocket() {
  updateStatus('connecting','Connexion...');
  socket = io(window.location.origin,{transports:['websocket','polling'],reconnection:true,reconnectionDelay:1000});
  socket.on('connect',()=>{connected=true;updateStatus('connected','Connecté');renderAll();startMediaPolling();});
  socket.on('disconnect',()=>{connected=false;updateStatus('disconnected','Hors-ligne');});
  socket.on('config',d=>{configData=d;renderAll();});
  socket.on('config_updated',()=>showToast('Configuration mise à jour','success'));
  socket.on('system_info',d=>{systemInfo=d;updateStats(d);updateInfoPanel(d);});
  socket.on('launch_result',d=>showToast(d.message,d.success?'success':'error'));
  socket.on('media_info',d=>updateNowPlaying(d));
  socket.on('deezer_top',d=>renderDeezerTop(d));
  socket.on('deezer_tracks',d=>renderDeezerTracks(d));
  socket.on('file_list',d=>renderFileList(d));
  socket.on('file_download_data',d=>handleFileDownload(d));
  socket.on('clipboard_data',d=>{$('clipText').value=d.text||'';});
  socket.on('clipboard_result',d=>showToast(d.success?'Presse-papier mis à jour':'Erreur',d.success?'success':'error'));
  socket.on('powershell_result',d=>showPSResult(d));
  socket.on('wol_result',d=>showToast(d.success?'Signal envoyé':'Erreur MAC',d.success?'success':'error'));
  socket.on('system_command_result',d=>showToast(d.error||'Commande exécutée',d.error?'error':'success'));
  socket.on('screenshot_result',d=>{if(d.image){$('screenImage').src='data:image/jpeg;base64,'+d.image;$('screenImage').style.display='block';$('screenLoading').style.display='none';}else showToast(d.message||'Erreur','error');});
  socket.on('screenshot_stream_frame',d=>{if(d.image){$('screenImage').src='data:image/jpeg;base64,'+d.image;$('screenImage').style.display='block';$('screenLoading').style.display='none';}});
  socket.on('processes',d=>renderProcesses(d));
  socket.on('mouse_position',d=>{$('mouseStatus').textContent=`Position: ${d.x}, ${d.y}`;});
  socket.on('mouse_result',d=>{});
  socket.on('audio_devices',d=>renderVolumeMixer(d));
  socket.on('services_list',d=>renderServices(d));
  socket.on('service_result',d=>showToast(`${d.action} ${d.name}: ${d.success?'OK':'Erreur'}`,d.success?'success':'error'));
  socket.on('wallpaper_path',d=>{if(d.path)$('wallpaperPreview').innerHTML=`<img src="file://${d.path}" onerror="this.parentElement.innerHTML='<span class=\\'material-symbols-rounded\\' style=\\'font-size:48px;opacity:0.3\\'>wallpaper</span>'">`;});
  socket.on('wallpaper_result',d=>showToast(d.success?'Fond changé':'Erreur',d.success?'success':'error'));
  socket.on('volume_set_result',d=>{});
  socket.on('first_launch',d=>{if(d&&d.show)showSetup();});
  socket.on('detected_apps',d=>renderDetectedApps(d));
}
function showSetup(){$('setupOverlay').classList.add('active');$('setupWizard').classList.add('active');showSetupStep(1);}
function showSetupStep(n){[1,2,3].forEach(i=>{const s=$('setupStep'+i);if(s)s.classList.toggle('active',i===n);});if(n===1)$('setupTitle').textContent='Bienvenue sur DeckLink';if(n===2)$('setupTitle').textContent='Applications détectées';if(n===3)$('setupTitle').textContent='Terminé !';}
function renderDetectedApps(apps){
  detectedApps=apps||[];
  if(_detectModalOpen){renderDetectModalResults();return;}
  setupSelectedApps=new Set(detectedApps.map(a=>a.path));$('setupScanning').style.display='none';$('setupResults').style.display='block';$('setupResultCount').textContent=detectedApps.length;const list=$('setupAppList');list.innerHTML=detectedApps.map(a=>{const sel=setupSelectedApps.has(a.path);return`<div class="setup-app-item ${sel?'selected':''}" data-path="${escHtml(a.path)}"><span class="sai-check material-symbols-rounded">${sel?'check_box':'check_box_outline_blank'}</span><span class="sai-icon" style="background:${a.color||'#1991ff'}22;color:${a.color||'#1991ff'}">${_saiIcon(a)}</span><div class="sai-info"><div class="sai-name">${escHtml(a.name)}</div><div class="sai-path">${escHtml(a.path)}</div></div></div>`}).join('');list.querySelectorAll('.setup-app-item').forEach(el=>{const path=el.dataset.path;el.addEventListener('click',function(){if(setupSelectedApps.has(path)){setupSelectedApps.delete(path);this.classList.remove('selected');this.querySelector('.sai-check').textContent='check_box_outline_blank';}else{setupSelectedApps.add(path);this.classList.add('selected');this.querySelector('.sai-check').textContent='check_box';}});});
}
function _saiIcon(a){
  if(a.icon_b64) return '<img src="'+a.icon_b64+'" style="width:18px;height:18px">';
  return '<span class="material-symbols-rounded">'+(a.icon||'apps')+'</span>';
}
function _renderDetectAppList(filter){
  filter=(filter||'').toLowerCase();
  const filtered=detectedApps.filter(function(a){return!filter||a.name.toLowerCase().includes(filter)||a.path.toLowerCase().includes(filter);});
  const html=filtered.map(function(a){var s=setupSelectedApps.has(a.path);return'<div class="setup-app-item'+(s?' selected':'')+'" data-path="'+escHtml(a.path)+'"><span class="sai-check material-symbols-rounded">'+(s?'check_box':'check_box_outline_blank')+'</span><span class="sai-icon" style="background:'+(a.color||'#1991ff')+'22;color:'+(a.color||'#1991ff')+'">'+_saiIcon(a)+'</span><div class="sai-info"><div class="sai-name">'+escHtml(a.name)+'</div><div class="sai-path">'+escHtml(a.path)+'</div></div></div>';}).join('');
  var list=$('detectAppList');
  if(list){list.innerHTML=html||'<p style="color:var(--text-sec);padding:12px;text-align:center">Aucun resultat</p>';
  list.querySelectorAll('.setup-app-item').forEach(function(el){var p=el.dataset.path;el.addEventListener('click',function(){if(setupSelectedApps.has(p)){setupSelectedApps.delete(p);this.classList.remove('selected');this.querySelector('.sai-check').textContent='check_box_outline_blank';}else{setupSelectedApps.add(p);this.classList.add('selected');this.querySelector('.sai-check').textContent='check_box';}});});}
}
function renderDetectModalResults(){
  setupSelectedApps=new Set(detectedApps.map(function(a){return a.path;}));
  var count=detectedApps.length;
  $('editModalTitle').textContent='Detection auto ('+count+' apps)';
  $('editModalBody').innerHTML='<div style="display:flex;gap:6px;margin-bottom:10px"><span class="material-symbols-rounded" style="color:var(--text-sec);font-size:18px;margin-top:8px">search</span><input type="text" id="detectSearchInput" class="form-input" placeholder="Rechercher..." style="flex:1"></div>'
    +'<div class="btn-row" style="margin-bottom:8px">'
    +'<button class="btn-secondary btn-sm" id="detectSelectAll">Tout</button>'
    +'<button class="btn-secondary btn-sm" id="detectDeselectAll">Aucun</button>'
    +'<span style="color:var(--text-sec);font-size:12px;margin-left:auto;padding-top:6px">'+count+' apps</span></div>'
    +'<div class="setup-app-list" id="detectAppList" style="max-height:400px"></div>'
    +'<button class="btn-primary" id="detectImportBtn" style="margin-top:12px;width:100%"><span class="material-symbols-rounded">check</span> Ajouter la selection</button>';
  $('editModalSave').style.display='none';$('editModalCancel').textContent='Fermer';
  _renderDetectAppList('');
  $('detectSearchInput').addEventListener('input',function(){_renderDetectAppList(this.value);});
  $('detectSelectAll').addEventListener('click',function(){setupSelectedApps=new Set(detectedApps.map(function(a){return a.path;}));_renderDetectAppList($('detectSearchInput').value);});
  $('detectDeselectAll').addEventListener('click',function(){setupSelectedApps=new Set();_renderDetectAppList($('detectSearchInput').value);});
  $('detectImportBtn').addEventListener('click',function(){var apps=detectedApps.filter(function(a){return setupSelectedApps.has(a.path);});socket.emit('import_detected_apps',{apps:apps});closeEditModal();_detectModalOpen=false;showToast(apps.length+' apps ajoutees','success');});
}
function closeSetup(){$('setupOverlay').classList.remove('active');$('setupWizard').classList.remove('active');}

function updateStatus(state,text){const dot=document.querySelector('.status-dot');dot.className='status-dot '+state;$('statusText').textContent=text;}
function renderAll(){if(!configData)return;renderCategories();renderAppGrid();renderQuickActions();renderAppList();renderActionList();renderCategoryEditList();applyTheme(configData.theme);applyLogo(configData.logo);hideLoading();}
function renderCategories(){const cats=configData.categories||[];$('categoryList').innerHTML=cats.map(c=>`<button class="category-btn ${c.id===activeCategory?'active':''}" data-cat="${c.id}"><span class="material-symbols-rounded">${c.icon||'folder'}</span>${c.name}</button>`).join('');$('categoryList').querySelectorAll('.category-btn').forEach(b=>b.addEventListener('click',()=>{activeCategory=b.dataset.cat;renderCategories();renderAppGrid();}));}
function getFilteredButtons(){let btns=configData?.buttons||[];if(activeCategory!=='all')btns=btns.filter(b=>(b.category||'')===activeCategory);if(searchQuery){const q=searchQuery.toLowerCase();btns=btns.filter(b=>b.name.toLowerCase().includes(q)||b.path.toLowerCase().includes(q));}return btns;}
function _gridIcon(b,c){
  if(b.icon_b64) return '<img src="'+b.icon_b64+'" style="width:28px;height:28px;border-radius:6px">';
  return '<span class="material-symbols-rounded">'+(b.icon||'apps')+'</span>';
}
function renderAppGrid(){const grid=$('appGrid'),empty=$('emptyState'),btns=getFilteredButtons();document.querySelectorAll('.skeleton-card').forEach(s=>s.remove());grid.innerHTML='';grid.style.display=btns.length?'grid':'none';empty.style.display=btns.length?'none':'flex';$('sectionTitle').textContent=activeCategory==='all'?'Applications':(configData.categories?.find(c=>c.id===activeCategory)?.name||'Apps');btns.forEach(b=>{const c=b.color||configData?.theme?.accent||'#1991ff';const card=document.createElement('div');card.className='app-card';card.innerHTML=`<div class="card-accent" style="background:${c}"></div>${b.favorite?'<span class="card-fav material-symbols-rounded">star</span>':''}<div class="card-icon" style="background:${c}22;color:${c}">${_gridIcon(b,c)}</div><div class="card-name">${b.name}</div>`;card.addEventListener('click',()=>launchApp(b.id));card.addEventListener('touchend',e=>{e.preventDefault();launchApp(b.id);});grid.appendChild(card);});}
function renderQuickActions(){const bar=$('bottomActions'),acts=configData?.quick_actions||[];bar.innerHTML=acts.map(a=>`<button class="qa-btn" data-id="${a.id}"><span class="material-symbols-rounded">${a.icon||'flash_on'}</span>${a.name}</button>`).join('');bar.querySelectorAll('.qa-btn').forEach(b=>b.addEventListener('click',()=>{const a=acts.find(x=>x.id===b.dataset.id);if(!a)return;if(a.type==='screenshot'){socket.emit('screenshot');showToast('Capture...','info');}else if(a.confirm)showModal(a.name,`Exécuter "${a.name}" ?`,()=>launchApp(a.id));else launchApp(a.id);}));}
function launchApp(id){if(!connected)return showToast('Non connecté','error');socket.emit('launch',{id});}
function _eiIcon(b){
  if(b.icon_b64) return '<img src="'+b.icon_b64+'" style="width:20px;height:20px;border-radius:4px">';
  return '<span class="material-symbols-rounded">'+(b.icon||'apps')+'</span>';
}
function renderAppList(){const list=$('appList'),btns=configData?.buttons||[];list.innerHTML=btns.map((b,i)=>`<div class="editor-item"><span class="ei-icon">${_eiIcon(b)}</span><div class="ei-info"><div class="ei-name">${escHtml(b.name)}</div><div class="ei-path">${escHtml(b.path)}</div></div><div class="ei-actions"><button class="ei-btn" data-action="edit" data-index="${i}"><span class="material-symbols-rounded">edit</span></button><button class="ei-btn danger" data-action="delete" data-index="${i}"><span class="material-symbols-rounded">delete</span></button></div></div>`).join('');list.querySelectorAll('[data-action="edit"]').forEach(b=>b.addEventListener('click',()=>editApp(parseInt(b.dataset.index))));list.querySelectorAll('[data-action="delete"]').forEach(b=>b.addEventListener('click',()=>{const btn=btns[parseInt(b.dataset.index)];showModal('Supprimer',`Supprimer "${btn.name}" ?`,()=>socket.emit('remove_button',{id:btn.id}));}));}
function renderActionList(){const list=$('actionList'),acts=configData?.quick_actions||[];list.innerHTML=acts.map((a,i)=>`<div class="editor-item"><span class="ei-icon"><span class="material-symbols-rounded">${a.icon||'flash_on'}</span></span><div class="ei-info"><div class="ei-name">${escHtml(a.name)}</div><div class="ei-path">${a.path||a.type}</div></div><div class="ei-actions"><button class="ei-btn" data-action="edit-action" data-index="${i}"><span class="material-symbols-rounded">edit</span></button><button class="ei-btn danger" data-action="del-action" data-index="${i}"><span class="material-symbols-rounded">delete</span></button></div></div>`).join('');list.querySelectorAll('[data-action="edit-action"]').forEach(b=>b.addEventListener('click',()=>editAction(parseInt(b.dataset.index))));list.querySelectorAll('[data-action="del-action"]').forEach(b=>b.addEventListener('click',()=>{const a=acts[parseInt(b.dataset.index)];showModal('Supprimer',`Supprimer "${a.name}" ?`,()=>{configData.quick_actions=configData.quick_actions.filter((_,i)=>i!==parseInt(b.dataset.index));socket.emit('update_config',configData);});}));}
function renderCategoryEditList(){const list=$('categoryListEdit'),cats=configData?.categories||[];list.innerHTML=cats.filter(c=>c.id!=='all').map((c,i)=>`<div class="editor-item"><span class="ei-icon"><span class="material-symbols-rounded">${c.icon||'folder'}</span></span><div class="ei-info"><div class="ei-name">${escHtml(c.name)}</div><div class="ei-path">ID: ${c.id}</div></div><div class="ei-actions"><button class="ei-btn" data-action="edit-cat" data-index="${i+1}"><span class="material-symbols-rounded">edit</span></button><button class="ei-btn danger" data-action="del-cat" data-index="${i+1}"><span class="material-symbols-rounded">delete</span></button></div></div>`).join('');list.querySelectorAll('[data-action="edit-cat"]').forEach(b=>b.addEventListener('click',()=>editCategory(parseInt(b.dataset.index))));list.querySelectorAll('[data-action="del-cat"]').forEach(b=>b.addEventListener('click',()=>{const idx=parseInt(b.dataset.index),c=configData.categories[idx];showModal('Supprimer',`Supprimer "${c.name}" ?`,()=>{configData.categories.splice(idx,1);socket.emit('update_config',configData);});}));}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
let editModalCallback=null;
function openEditModal(cb){editModalCallback=cb;$('modalOverlay').classList.add('active');$('editModal').classList.add('active');}
function closeEditModal(){$('modalOverlay').classList.remove('active');$('editModal').classList.remove('active');editModalCallback=null;$('editModalSave').style.display='inline-flex';$('editModalCancel').textContent='Annuler';}
function editApp(index){const btn=configData.buttons[index];if(!btn)return;const cats=(configData.categories||[]).map(c=>c.id).filter(c=>c!=='all');$('editModalBody').innerHTML=`<div class="form-group"><label>Nom</label><input type="text" id="ef_name" class="form-input" value="${escHtml(btn.name)}"></div><div class="form-group"><label>Chemin</label><input type="text" id="ef_path" class="form-input" value="${escHtml(btn.path)}"></div><div class="form-group"><label>Icône</label><input type="text" id="ef_icon" class="form-input" value="${escHtml(btn.icon||'apps')}"></div><div class="form-group"><label>Couleur</label><input type="color" id="ef_color" value="${btn.color||'#1991ff'}" style="width:100%;height:36px;border:1px solid var(--card-border);border-radius:var(--radius-xs);background:none;cursor:pointer;padding:2px"></div><div class="form-group"><label>Type</label><select id="ef_type"><option value="app" ${btn.type==='app'?'selected':''}>App</option><option value="url" ${btn.type==='url'?'selected':''}>URL</option></select></div><div class="form-group"><label>Catégorie</label><select id="ef_cat"><option value="">Aucune</option>${cats.map(c=>`<option value="${c}" ${btn.category===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="form-group"><label><input type="checkbox" id="ef_fav" ${btn.favorite?'checked':''}> Favori</label></div>`;$('editModalTitle').textContent='Modifier : '+btn.name;openEditModal(()=>{const u={...btn,name:$('ef_name').value,path:$('ef_path').value,icon:$('ef_icon').value,color:$('ef_color').value,type:$('ef_type').value,category:$('ef_cat').value,favorite:$('ef_fav').checked};socket.emit('update_button',{index,button:u});closeEditModal();});}
function editAction(index){const a=configData.quick_actions[index];if(!a)return;$('editModalBody').innerHTML=`<div class="form-group"><label>Nom</label><input type="text" id="af_name" class="form-input" value="${escHtml(a.name)}"></div><div class="form-group"><label>Commande</label><input type="text" id="af_path" class="form-input" value="${escHtml(a.path)}"></div><div class="form-group"><label>Icône</label><input type="text" id="af_icon" class="form-input" value="${escHtml(a.icon||'flash_on')}"></div><div class="form-group"><label>Couleur</label><input type="color" id="af_color" value="${a.color||'#1991ff'}" style="width:100%;height:36px;border:1px solid var(--card-border);border-radius:var(--radius-xs);background:none;cursor:pointer;padding:2px"></div><div class="form-group"><label><input type="checkbox" id="af_confirm" ${a.confirm?'checked':''}> Confirmation</label></div>`;$('editModalTitle').textContent='Modifier : '+a.name;openEditModal(()=>{configData.quick_actions[index]={...a,name:$('af_name').value,path:$('af_path').value,icon:$('af_icon').value,color:$('af_color').value,confirm:$('af_confirm').checked};socket.emit('update_config',configData);closeEditModal();});}
function editCategory(index){const c=configData.categories[index];if(!c)return;$('editModalBody').innerHTML=`<div class="form-group"><label>Nom</label><input type="text" id="cf_name" class="form-input" value="${escHtml(c.name)}"></div><div class="form-group"><label>ID</label><input type="text" id="cf_id" class="form-input" value="${escHtml(c.id)}"></div><div class="form-group"><label>Icône</label><input type="text" id="cf_icon" class="form-input" value="${escHtml(c.icon||'folder')}"></div>`;$('editModalTitle').textContent='Modifier catégorie';openEditModal(()=>{configData.categories[index]={...c,name:$('cf_name').value,id:$('cf_id').value,icon:$('cf_icon').value};socket.emit('update_config',configData);closeEditModal();});}

function applyTheme(t){if(!t)return;const r=document.documentElement;const set=(n,v)=>{if(v)r.style.setProperty(n,v);};set('--bg',t.background);set('--bg-grad',t.background_gradient);set('--surface',t.surface);set('--accent',t.accent);set('--accent-hover',t.accent_hover);set('--card',t.card_bg);set('--card-hover',t.card_hover);set('--text',t.text);set('--text-sec',t.text_secondary);set('--card-border',t.border);['bgColor1','bgColor2','surfaceColor','accentColor','cardColor','textColor','textSecColor'].forEach(id=>{const key={bgColor1:'background',bgColor2:'background_gradient',surfaceColor:'surface',accentColor:'accent',cardColor:'card_bg',textColor:'text',textSecColor:'text_secondary'}[id];const el=$(id),tel=$(id+'Text');if(el&&t[key]){el.value=t[key];if(tel)tel.value=t[key];}});}
function applyLogo(l){if(!l)return;const icon=$('logoIcon'),text=$('logoText');icon.style.display=(l.type==='icon'||l.type==='both')?'':'none';text.style.display=(l.type==='text'||l.type==='both')?'':'none';if(l.icon)icon.textContent=l.icon;if(l.text)text.textContent=l.text;$('logoType').value=l.type||'both';$('logoTextInput').value=l.text||'DeckLink';$('logoIconInput').value=l.icon||'devices';}
function _t(s){if(!s||s<=0)return'0:00';const m=Math.floor(s/60);return m+':'+String(Math.floor(s%60)).padStart(2,'0');}
function _fs(s){if(!s)return'-';if(s<1024)return s+' o';if(s<1048576)return(s/1024).toFixed(1)+' Ko';return(s/1048576).toFixed(1)+' Mo';}

function _updateProgressBars(){
  if(!_mediaDur)return;
  if(_mediaPos < _mediaDur) _mediaPos = Math.min(_mediaPos + 1, _mediaDur);
  const pct = _mediaDur > 0 ? Math.min(100, (_mediaPos / _mediaDur) * 100) : 0;
  $('npCurrentTime').textContent=_t(_mediaPos);
  $('npBarFill').style.width=pct+'%';$('npBarThumb').style.left=pct+'%';
  $('mpBarFill').style.width=pct+'%';
}
function updateNowPlaying(d){
  const ph=$('npPlaceholder'),ct=$('npContent'),mp=$('miniPlayer');
  if(!d||(!d.title&&!d.artist)){ph.style.display='flex';ct.classList.remove('active');mp.classList.remove('active');if(_mediaPosTimer){clearInterval(_mediaPosTimer);_mediaPosTimer=null;}return;}
  ph.style.display='none';ct.classList.add('active');mp.classList.add('active');
  $('npTitle').textContent=d.title||'-';$('npArtist').textContent=d.artist||'-';$('npAlbum').textContent=d.album||'';
  $('mpTitle').textContent=d.title||'-';$('mpArtist').textContent=d.artist||'-';
  const appSrc=d.source==='window'?'Fenêtre ':(d.source==='audio'?'Audio ':'');
  $('npSource').textContent=d.app?appSrc+d.app:'';
  _mediaPos = d.pos||0; _mediaDur = d.dur||0;
  $('npTotalTime').textContent=_t(_mediaDur);
  const sm={'Playing':'▶ Lecture','Paused':'⏸ Pause','Stopped':'⏹ Arrêté'};
  $('npStatus').textContent=sm[d.status]||'Lecture en cours';
  if(!_mediaPosTimer){_mediaPosTimer=setInterval(_updateProgressBars,1000);}
  _updateProgressBars();
  const art=$('npArt'),cover=$('mpCover');
  if(d.cover){
    art.innerHTML='<img src="'+d.cover+'" style="width:64px;height:64px;border-radius:8px;object-fit:cover">';
    cover.innerHTML='<img src="'+d.cover+'" style="width:32px;height:32px;border-radius:6px;object-fit:cover">';
  }else{
    art.innerHTML='<span class="material-symbols-rounded">audiotrack</span>';
    cover.innerHTML='<span class="material-symbols-rounded">music_note</span>';
  }
}

function renderDeezerTop(d){const c=$('deezerPlaylists');if(!d||!d.tracks){c.innerHTML='<p style="padding:12px;color:var(--text-sec)">Chargement...</p>';return;}c.innerHTML=`<div class="dz-playlist active" style="background:rgba(25,145,255,0.08);border-color:rgba(25,145,255,0.2)"><div class="dz-icon"><span class="material-symbols-rounded" style="font-size:28px">trending_up</span></div><div class="dz-info"><div class="dz-name" style="font-size:15px">${escHtml(d.name)}</div><div class="dz-meta">${d.tracks.length} titres - Deezer Top</div></div></div><div class="deezer-tracks active" id="dzTrackList">${d.tracks.map(t=>`<div class="dz-track" data-id="${t.id}"><span class="dt-title">${escHtml(t.title)}</span><span class="dt-artist">${escHtml(t.artist)}</span><span class="dt-dur">${_t(t.duration)}</span></div>`).join('')}</div>`;c.querySelectorAll('.dz-track').forEach(el=>el.addEventListener('click',()=>{socket.emit('deezer_play',{track_id:el.dataset.id});showToast('Lecture Deezer','success');}));}
function renderDeezerTracks(d){if(!d||d.length===0)return;$('deezerTracks').innerHTML=d.map(t=>`<div class="dz-track" data-id="${t.id}"><span class="dt-title">${escHtml(t.title)}</span><span class="dt-artist">${escHtml(t.artist)}</span><span class="dt-dur">${_t(t.duration)}</span></div>`).join('');$('deezerTracks').querySelectorAll('.dz-track').forEach(el=>el.addEventListener('click',()=>{socket.emit('deezer_play',{track_id:el.dataset.id});showToast('Lecture Deezer','success');}));$('deezerTracks').classList.add('active');}

function updateStats(info){
  if(!info)return;const cpu=info.cpu_percent||0,mem=info.memory?info.memory.percent:0,disk=info.disk?info.disk.percent:0;
  $('statCpu').textContent=cpu.toFixed(1)+'%';const cpuBar=$('statCpuBar');cpuBar.style.width=cpu+'%';cpuBar.className='stat-fill'+(cpu>80?' critical':cpu>60?' high':'');
  $('statRam').textContent=mem.toFixed(1)+'%';const ramBar=$('statRamBar');ramBar.style.width=mem+'%';ramBar.className='stat-fill'+(mem>80?' critical':mem>60?' high':'');
  $('statDisk').textContent=disk.toFixed(1)+'%';const diskBar=$('statDiskBar');diskBar.style.width=disk+'%';diskBar.className='stat-fill'+(disk>90?' critical':disk>75?' high':'');
  $('statHostname').textContent=info.hostname||'-';$('statIp').textContent=info.ip||'-';
  if(info.boot_time){const up=Math.floor((Date.now()/1000-info.boot_time)/60);$('statUptime').textContent=up>1440?(up/1440).toFixed(1)+'j':up>60?Math.floor(up/60)+'h '+up%60+'m':up+'min';}
  const tv=Object.values(info.temperatures||{}).filter(v=>v>0);$('statTemp').textContent=tv.length?tv[0]+'°C':(info.admin?'- (aucune)':'- (admin requis)');
  if(info.gpu&&info.gpu.util>0){const g=info.gpu;$('statGpuUtil').textContent=g.util+'%';const gBar=$('statGpuBar');gBar.style.width=(g.util||0)+'%';gBar.className='stat-fill'+((g.util||0)>80?' critical':(g.util||0)>60?' high':'');$('statGpuInfo').textContent=g.name||'GPU';const pct=g.memory_total>0?((g.memory_used/g.memory_total)*100).toFixed(0):0;$('statGpuMem').textContent=pct+'%';const gmBar=$('statGpuMemBar');gmBar.style.width=pct+'%';gmBar.className='stat-fill'+(pct>80?' critical':pct>60?' high':'');$('statGpuTemp').textContent='Temp: '+(g.temp?g.temp+'°C':'-');$('gpuCard').style.display='flex';$('gpuMemCard').style.display='flex';}else{$('gpuCard').style.display='none';$('gpuMemCard').style.display='none';}
  if($('statsPanel').classList.contains('open'))socket.emit('get_processes');
}

function renderProcesses(procs){$('processList').innerHTML=(procs||[]).slice(0,30).map(p=>`<div class="process-item"><span class="pi-name">${escHtml(p.name||'?')}</span><span class="pi-cpu">CPU:${(p.cpu_percent||0).toFixed(1)}% RAM:${(p.memory_percent||0).toFixed(1)}%</span><button class="pi-kill" data-pid="${p.pid}"><span class="material-symbols-rounded">close</span></button></div>`).join('');$('processList').querySelectorAll('.pi-kill').forEach(b=>b.addEventListener('click',()=>{const pid=parseInt(b.dataset.pid);showModal('Arrêter',`Arrêter #${pid} ?`,()=>socket.emit('kill_process',{pid}));}));}
function updateInfoPanel(info){if(!info)return;$('infoHostname').textContent=info.hostname||'-';$('infoIp').textContent=info.ip||'-';$('infoPort').textContent=info.port||'-';$('infoPlatform').textContent=info.platform||'-';$('infoCpu').textContent=info.cpu_percent!=null?info.cpu_percent.toFixed(1)+'%':'-';if(info.memory)$('infoRam').textContent=(info.memory.used/1073741824).toFixed(1)+' / '+(info.memory.total/1073741824).toFixed(1)+' GB ('+info.memory.percent+'%)';$('connectionUrl').textContent='http://'+info.ip+':'+info.port;}
function hideLoading(){document.querySelectorAll('.skeleton-card').forEach(s=>s.remove());}
function openSettings(){$('settingsOverlay').classList.add('active');$('settingsPanel').classList.add('open');renderAll();if(systemInfo)updateInfoPanel(systemInfo);}
function closeSettings(){$('settingsOverlay').classList.remove('active');$('settingsPanel').classList.remove('open');}
function openPanel(id){document.querySelectorAll('.slide-panel').forEach(p=>p.classList.remove('open'));;$(id).classList.add('open');if(id==='mediaPanel'){socket.emit('get_media_info');if(mediaInterval)clearInterval(mediaInterval);mediaInterval=setInterval(()=>socket.emit('get_media_info'),2000);socket.emit('deezer_top');}else if(id!=='mediaPanel'){if(mediaInterval)clearInterval(mediaInterval);mediaInterval=setInterval(()=>socket.emit('get_media_info'),3000);}if(id==='statsPanel')socket.emit('get_system_info');if(id==='remotePanel')socket.emit('mouse_pos');if(id==='toolsPanel'){socket.emit('get_services');socket.emit('get_wallpaper');socket.emit('get_audio_devices');}}
function closeAllPanels(){document.querySelectorAll('.slide-panel').forEach(p=>p.classList.remove('open'));if(screenInterval){clearInterval(screenInterval);screenInterval=null;$('screenLiveToggle').innerHTML='<span class="material-symbols-rounded">play_arrow</span> Live';}if($('mediaPanel').classList.contains('open')){$('mediaPanel').classList.remove('open');}}

function startMediaPolling(){if(!mediaInterval){mediaInterval=setInterval(()=>socket.emit('get_media_info'),3000);socket.emit('get_media_info');}}
function stopMediaPolling(){if(mediaInterval){clearInterval(mediaInterval);mediaInterval=null;}if(_mediaPosTimer){clearInterval(_mediaPosTimer);_mediaPosTimer=null;}}

function renderFileList(items){const grid=$('fileGrid');if(!items||items.length===0){grid.innerHTML='<p style="color:var(--text-sec);padding:20px">Dossier vide</p>';return;}grid.innerHTML=items.map(i=>`<div class="file-item" data-path="${escHtml(i.path)}" data-dir="${i.is_dir}"><span class="fi-icon ${i.is_dir?'dir':''} material-symbols-rounded">${i.is_dir?'folder':i.name.endsWith('.exe')?'terminal':i.name.endsWith('.jpg')||i.name.endsWith('.png')?'image':i.name.endsWith('.mp3')?'music_note':i.name.endsWith('.mp4')?'movie':i.name.endsWith('.pdf')?'picture_as_pdf':i.name.endsWith('.zip')?'folder_zip':'description'}</span><div class="fi-info"><div class="fi-name">${escHtml(i.name)}</div><div class="fi-size">${i.is_dir?'Dossier':_fs(i.size)}</div></div></div>`).join('');grid.querySelectorAll('.file-item').forEach(el=>{el.addEventListener('click',()=>{if(el.dataset.dir==='True'){fileHistory.push($('filePath').textContent);$('filePath').textContent=el.dataset.path;socket.emit('file_list',{path:el.dataset.path});}else{socket.emit('file_download',{path:el.dataset.path});showToast('Téléchargement...','info');}});});$('fileBackBtn').style.display=fileHistory.length?'inline-flex':'none';}
function handleFileDownload(d){if(d.error){showToast('Erreur: '+d.error,'error');return;}try{const b64=d.data;const byteChars=atob(b64);const byteNums=new Array(byteChars.length);for(let i=0;i<byteChars.length;i++)byteNums[i]=byteChars.charCodeAt(i);const byteArr=new Uint8Array(byteNums);const blob=new Blob([byteArr]);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=d.name||'fichier';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);showToast('Téléchargé: '+d.name,'success');}catch(e){showToast('Erreur téléchargement','error');}}
function showPSResult(d){const out=$('psOutput');out.style.display='block';if(d.error){out.innerHTML='<span class="err">Erreur: '+escHtml(d.error)+'</span>';}else{out.innerHTML='';if(d.stdout)out.innerHTML+=escHtml(d.stdout);if(d.stderr)out.innerHTML+='<span class="err">'+escHtml(d.stderr)+'</span>';if(!d.stdout&&!d.stderr)out.innerHTML='(aucune sortie)';}out.classList.add('active');}

function renderVolumeMixer(devs){const list=$('volumeList');if(!devs||devs.length===0){list.innerHTML='<p style="color:var(--text-sec);padding:12px">Aucune session audio</p>';return;}list.innerHTML=devs.map(d=>`<div class="vol-item" data-pid="${d.pid}"><span class="vol-icon material-symbols-rounded">${d.muted?'volume_off':'volume_up'}</span><div class="vol-info"><div class="vol-name">${escHtml(d.name)}${d.muted?' (muet)':''}</div><div class="vol-bar"><div class="vol-fill" style="width:${d.volume}%;background:${d.muted?'var(--text-sec)':'var(--accent)'}"></div></div></div><span class="vol-pct">${d.volume}%</span></div>`).join('');list.querySelectorAll('.vol-item').forEach(el=>el.addEventListener('click',()=>{const pid=parseInt(el.dataset.pid);showModal('Volume',`Changer le volume ?`,'');}));}

function renderServices(svcs){const list=$('servicesList');if(!svcs||svcs.length===0){list.innerHTML='<p style="color:var(--text-sec);padding:12px">Aucun service</p>';return;}list.innerHTML=svcs.slice(0,80).map(s=>`<div class="svc-item" data-name="${escHtml(s.name)}"><span class="svc-dot ${s.status==='Running'?'running':'stopped'}"></span><span class="svc-name">${escHtml(s.display||s.name)}</span><button class="svc-action ${s.status==='Running'?'stop':''}" data-name="${escHtml(s.name)}" data-action="${s.status==='Running'?'Stop':'Start'}"><span class="material-symbols-rounded">${s.status==='Running'?'stop':'play_arrow'}</span></button></div>`).join('');list.querySelectorAll('.svc-action').forEach(b=>b.addEventListener('click',(e)=>{e.stopPropagation();const name=b.dataset.name;const action=b.dataset.action;showModal(action,`${action} le service "${name}" ?`,()=>socket.emit('control_service',{name,action}));}));}

function showModal(title,message,onConfirm){$('modalOverlay').classList.add('active');$('modal').classList.add('active');$('modalTitle').textContent=title;$('modalMessage').textContent=message;const close=()=>{$('modalOverlay').classList.remove('active');$('modal').classList.remove('active');$('modalConfirmBtn').onclick=null;};$('modalConfirmBtn').onclick=()=>{close();if(onConfirm)onConfirm();};$('modalCancelBtn').onclick=close;$('modalCloseBtn').onclick=close;$('modalOverlay').onclick=close;}

function showToast(message,type='info'){const c=$('toastContainer'),t=document.createElement('div');t.className='toast '+type;t.textContent=message;c.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transform='translateY(-8px)';t.style.transition='all 0.3s';setTimeout(()=>t.remove(),300);},2500);}
function showDetectDialog(){
  $('editModalTitle').textContent='Detection en cours...';
  $('editModalBody').innerHTML='<div style="text-align:center;padding:20px"><div class="setup-spinner"></div><p style="margin-top:12px;color:var(--text-sec)">Analyse du systeme...</p></div>';
  $('editModalSave').style.display='none';$('editModalCancel').textContent='Fermer';
  _detectModalOpen=true;
  openEditModal(()=>{_detectModalOpen=false;});
  socket.emit('detect_apps');
}

function showAddAppDialog(){const cats=(configData.categories||[]).map(c=>c.id).filter(c=>c!=='all');$('editModalBody').innerHTML=`<div class="form-group"><label>Nom</label><input type="text" id="af_name" class="form-input" placeholder="App"></div><div class="form-group"><label>Chemin</label><input type="text" id="af_path" class="form-input" placeholder="C:\\Program Files\\..."></div><div class="form-group"><label>Icône</label><input type="text" id="af_icon" class="form-input" value="apps"></div><div class="form-group"><label>Couleur</label><input type="color" id="af_color" value="#1991ff" style="width:100%;height:36px;border:1px solid var(--card-border);border-radius:var(--radius-xs);background:none;cursor:pointer;padding:2px"></div><div class="form-group"><label>Type</label><select id="af_type"><option value="app">App</option><option value="url">URL</option></select></div><div class="form-group"><label>Catégorie</label><select id="af_cat"><option value="">Aucune</option>${cats.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div><div class="form-group"><label><input type="checkbox" id="af_fav"> Favori</label></div>`;$('editModalTitle').textContent='Nouvelle application';$('editModalSave').style.display='inline-flex';$('editModalCancel').textContent='Annuler';openEditModal(()=>{const n=$('af_name').value,p=$('af_path').value;if(!n||!p){showToast('Nom et chemin requis','error');return;}socket.emit('add_button',{id:'app_'+Date.now(),name:n,path:p,icon:$('af_icon').value||'apps',color:$('af_color').value,type:$('af_type').value,category:$('af_cat').value,favorite:$('af_fav').checked,args:[],row:0,col:0});closeEditModal();});}
function showAddActionDialog(){$('editModalBody').innerHTML=`<div class="form-group"><label>Nom</label><input type="text" id="qf_name" class="form-input" placeholder="Action"></div><div class="form-group"><label>Commande</label><input type="text" id="qf_path" class="form-input" placeholder="shutdown /s /t 5"></div><div class="form-group"><label>Icône</label><input type="text" id="qf_icon" class="form-input" value="flash_on"></div><div class="form-group"><label>Couleur</label><input type="color" id="qf_color" value="#1991ff" style="width:100%;height:36px;border:1px solid var(--card-border);border-radius:var(--radius-xs);background:none;cursor:pointer;padding:2px"></div><div class="form-group"><label><input type="checkbox" id="qf_confirm"> Confirmation</label></div><div class="form-group"><label><input type="checkbox" id="qf_screenshot"> Capture</label></div>`;$('editModalTitle').textContent='Nouvelle action';openEditModal(()=>{const n=$('qf_name').value;if(!n){showToast('Nom requis','error');return;}const isScr=$('qf_screenshot').checked;configData.quick_actions=[...(configData.quick_actions||[]),{id:'action_'+Date.now(),name:n,icon:$('qf_icon').value||'flash_on',color:$('qf_color').value,type:isScr?'screenshot':'command',path:isScr?'':$('qf_path').value,confirm:$('qf_confirm').checked}];socket.emit('update_config',configData);closeEditModal();});}
function showAddCategoryDialog(){$('editModalBody').innerHTML=`<div class="form-group"><label>Nom</label><input type="text" id="cf_name" class="form-input" placeholder="Jeux"></div><div class="form-group"><label>ID</label><input type="text" id="cf_id" class="form-input" placeholder="games"></div><div class="form-group"><label>Icône</label><input type="text" id="cf_icon" class="form-input" value="folder"></div>`;$('editModalTitle').textContent='Nouvelle catégorie';openEditModal(()=>{const n=$('cf_name').value,i=$('cf_id').value;if(!n||!i){showToast('Nom et ID requis','error');return;}configData.categories=[...(configData.categories||[]),{id:i,name:n,icon:$('cf_icon').value||'folder'}];socket.emit('update_config',configData);closeEditModal();});}

function setupMousePad(){
  const pad=$('mousePad');let dragging=false;
  pad.addEventListener('click',(e)=>{const rect=pad.getBoundingClientRect();const x=Math.round(e.clientX-rect.left);const y=Math.round(e.clientY-rect.top);socket.emit('mouse_click',{button:'left',x,y});});
  pad.addEventListener('contextmenu',(e)=>{e.preventDefault();const rect=pad.getBoundingClientRect();const x=Math.round(e.clientX-rect.left);const y=Math.round(e.clientY-rect.top);socket.emit('mouse_click',{button:'right',x,y});});
  let moveTimer=null;pad.addEventListener('mousemove',(e)=>{if(!moveTimer){moveTimer=setTimeout(()=>{moveTimer=null;const rect=pad.getBoundingClientRect();const x=Math.round(e.clientX-rect.left);const y=Math.round(e.clientY-rect.top);socket.emit('mouse_move',{x,y});},50);}});
  pad.addEventListener('touchstart',(e)=>{e.preventDefault();const t=e.touches[0];const rect=pad.getBoundingClientRect();const x=Math.round(t.clientX-rect.left);const y=Math.round(t.clientY-rect.top);socket.emit('mouse_move',{x,y});dragging=true;});
  pad.addEventListener('touchmove',(e)=>{e.preventDefault();if(dragging){const t=e.touches[0];const rect=pad.getBoundingClientRect();const x=Math.round(t.clientX-rect.left);const y=Math.round(t.clientY-rect.top);socket.emit('mouse_move',{x,y});}});
  pad.addEventListener('touchend',(e)=>{e.preventDefault();if(dragging){dragging=false;socket.emit('mouse_click',{button:'left'});}});
}

function bindUI(){
$('settingsBtn').addEventListener('click',openSettings);$('closeSettingsBtn').addEventListener('click',closeSettings);$('settingsOverlay').addEventListener('click',closeSettings);
$('addAppBtn').addEventListener('click',showAddAppDialog);$('detectAppBtn').addEventListener('click',showDetectDialog);$('addActionBtn').addEventListener('click',showAddActionDialog);$('addCategoryBtn').addEventListener('click',showAddCategoryDialog);
$('searchInput').addEventListener('input',()=>{searchQuery=$('searchInput').value;renderAppGrid();});$('menuBtn').addEventListener('click',()=>$('searchInput').focus());

// Keyboard
$('keyboardBtn').addEventListener('click',()=>openPanel('keyboardPanel'));$('keyboardClose').addEventListener('click',closeAllPanels);
$('kbSendBtn').addEventListener('click',()=>{const t=$('kbInput').value;if(t){socket.emit('keyboard_input',{text:t});$('kbInput').value='';showToast('Texte envoyé','success');}});
$('kbInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('kbSendBtn').click();});
document.querySelectorAll('.kb-key').forEach(b=>b.addEventListener('click',()=>socket.emit('key_press',{key:b.dataset.key})));

// Media
$('mediaBtn').addEventListener('click',()=>openPanel('mediaPanel'));$('mediaClose').addEventListener('click',closeAllPanels);
$('miniPlayer').addEventListener('click',()=>openPanel('mediaPanel'));
$('mpPlayBtn').addEventListener('click',(e)=>{e.stopPropagation();socket.emit('media_command',{command:'play_pause'});});
document.querySelectorAll('.media-btn').forEach(b=>b.addEventListener('click',()=>socket.emit('media_command',{command:b.dataset.cmd})));

// Screen
$('screenBtn').addEventListener('click',()=>openPanel('screenPanel'));$('screenClose').addEventListener('click',closeAllPanels);
$('screenCaptureBtn').addEventListener('click',()=>{socket.emit('screenshot_stream');$('screenLoading').textContent='Capture...';});
$('screenRefreshBtn').addEventListener('click',()=>{socket.emit('screenshot_stream');});
$('screenLiveToggle').addEventListener('click',function(){if(screenInterval){clearInterval(screenInterval);screenInterval=null;this.innerHTML='<span class="material-symbols-rounded">play_arrow</span> Live';}else{socket.emit('screenshot_stream');screenInterval=setInterval(()=>socket.emit('screenshot_stream'),3000);this.innerHTML='<span class="material-symbols-rounded">stop</span> Stop';}});

// Files
$('filesBtn').addEventListener('click',()=>{openPanel('filePanel');socket.emit('file_list',{path:'C:\\'});fileHistory=[];$('filePath').textContent='C:\\';});$('fileClose').addEventListener('click',closeAllPanels);
$('fileBackBtn').addEventListener('click',()=>{const prev=fileHistory.pop();if(prev){$('filePath').textContent=prev;socket.emit('file_list',{path:prev});}});

// Remote Mouse
$('remoteBtn').addEventListener('click',()=>{openPanel('remotePanel');socket.emit('mouse_pos');});
$('remoteClose').addEventListener('click',closeAllPanels);
setupMousePad();
document.querySelectorAll('.mouse-btn').forEach(b=>b.addEventListener('click',()=>socket.emit('mouse_click',{button:b.dataset.btn})));
document.querySelectorAll('.scroll-btn').forEach(b=>b.addEventListener('click',()=>{const dir=b.dataset.scroll==='up'?1:-1;socket.emit('mouse_scroll',{amount:dir*3});}));

// Tools
$('toolsBtn').addEventListener('click',()=>openPanel('toolsPanel'));$('toolsClose').addEventListener('click',closeAllPanels);
document.querySelectorAll('.tools-tabs .tab-btn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tools-tabs .tab-btn').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.ttab-content').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('ttab-'+b.dataset.ttab).classList.add('active');if(b.dataset.ttab==='services')socket.emit('get_services');if(b.dataset.ttab==='wallpaper')socket.emit('get_wallpaper');if(b.dataset.ttab==='volume')socket.emit('get_audio_devices');}));
$('clipGetBtn').addEventListener('click',()=>socket.emit('clipboard_get'));$('clipSetBtn').addEventListener('click',()=>{const t=$('clipText').value;if(t)socket.emit('clipboard_set',{text:t});});
$('psRunBtn').addEventListener('click',()=>{const s=$('psScript').value;if(s)socket.emit('run_powershell',{script:s});});
$('wolBtn').addEventListener('click',()=>{const m=$('wolMac').value;if(m)socket.emit('wol',{mac:m});});
$('wallpaperBrowseBtn').addEventListener('click',()=>{openPanel('filePanel');socket.emit('file_list',{path:os.homedir?os.homedir()+'\\Pictures':'C:\\Users\\Public\\Pictures'});});
$('wallpaperCurrentBtn').addEventListener('click',()=>socket.emit('get_wallpaper'));
document.querySelectorAll('.sys-cmd').forEach(b=>b.addEventListener('click',()=>{const cmd=b.dataset.cmd;showModal('Confirmation',`Exécuter ${b.textContent.trim()}?`,()=>socket.emit('system_command',{command:cmd}));}));

// Setup wizard
$('setupScanBtn').addEventListener('click',()=>{showSetupStep(2);$('setupScanning').style.display='flex';$('setupResults').style.display='none';socket.emit('detect_apps');});
$('setupSkipBtn').addEventListener('click',()=>{socket.emit('update_config',{setup_done:true});closeSetup();});
$('setupSelectAllBtn').addEventListener('click',function(){setupSelectedApps=new Set(detectedApps.map(a=>a.path));const items=document.querySelectorAll('#setupAppList .setup-app-item');items.forEach(function(e){e.classList.add('selected');e.querySelector('.sai-check').textContent='check_box';});});
$('setupDeselectAllBtn').addEventListener('click',function(){setupSelectedApps=new Set();const items=document.querySelectorAll('#setupAppList .setup-app-item');items.forEach(function(e){e.classList.remove('selected');e.querySelector('.sai-check').textContent='check_box_outline_blank';});});
$('setupImportBtn').addEventListener('click',function(){const apps=detectedApps.filter(function(a){return setupSelectedApps.has(a.path);});socket.emit('import_detected_apps',{apps:apps});closeSetup();showToast(apps.length+' applications ajoutees','success');});
$('setupFinishBtn').addEventListener('click',()=>{socket.emit('update_config',{setup_done:true});closeSetup();});
$('setupDoneBtn').addEventListener('click',closeSetup);

// Stats
$('statsBtn').addEventListener('click',()=>{openPanel('statsPanel');socket.emit('get_system_info');});$('statsClose').addEventListener('click',closeAllPanels);

// Theme
$('applyThemeBtn').addEventListener('click',()=>{socket.emit('update_theme',{background:$('bgColor1').value,background_gradient:$('bgColor2').value,surface:$('surfaceColor').value,accent:$('accentColor').value,accent_hover:$('accentColor').value+'99',card_bg:$('cardColor').value,card_hover:$('cardColor').value.replace('0.04','0.08').replace('0.06','0.12'),text:$('textColor').value,text_secondary:$('textSecColor').value,border:$('cardColor').value.replace('0.04','0.06').replace('0.06','0.08')});showToast('Thème appliqué','success');});
$('resetThemeBtn').addEventListener('click',()=>{socket.emit('update_theme',{background:'#0a0e17',background_gradient:'#111827',surface:'#1a2035',accent:'#1991ff',accent_hover:'#4db8ff',card_bg:'rgba(255,255,255,0.04)',card_hover:'rgba(255,255,255,0.08)',text:'#ffffff',text_secondary:'#8b9bb5',border:'rgba(255,255,255,0.06)'});showToast('Thème réinitialisé','info');});
$('applyLogoBtn').addEventListener('click',()=>{socket.emit('update_logo',{type:$('logoType').value,text:$('logoTextInput').value,icon:$('logoIconInput').value});showToast('Logo mis à jour','success');});
document.querySelectorAll('.color-item input[type="color"]').forEach(inp=>inp.addEventListener('input',()=>{const t=$(inp.id+'Text');if(t)t.value=inp.value;}));
document.querySelectorAll('.color-item input[type="text"]').forEach(inp=>inp.addEventListener('input',()=>{const ci=$(inp.id.replace('Text',''));if(ci&&/^#[0-9a-f]{6}$/i.test(inp.value))ci.value=inp.value;}));
document.querySelectorAll('.settings-tabs .tab-btn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.settings-tabs .tab-btn').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tab-content').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('tab-'+b.dataset.tab).classList.add('active');}));
$('editModalSave').addEventListener('click',()=>{if(editModalCallback)editModalCallback();});$('editModalCancel').addEventListener('click',closeEditModal);$('editModalClose').addEventListener('click',closeEditModal);
$('modalOverlay').addEventListener('click',e=>{if($('editModal').classList.contains('active'))closeEditModal();});
}
document.addEventListener('DOMContentLoaded',init);
