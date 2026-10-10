const providers = [
  { id: 'openai', name: 'ChatGPT', mark: '✳', color: '#5aa987', desc: 'OpenAI models' },
  { id: 'claude', name: 'Claude', mark: '✳', color: '#d58a5a', desc: 'Anthropic models' },
  { id: 'gemini', name: 'Gemini', mark: '✦', color: '#6189d9', desc: 'Google models' },
  { id: 'grok', name: 'Grok', mark: '𝕏', color: '#242424', desc: 'xAI models' },
  { id: 'deepseek', name: 'DeepSeek', mark: '◈', color: '#4f83cc', desc: 'DeepSeek models' },
  { id: 'perplexity', name: 'Perplexity', mark: '⌕', color: '#34a9a1', desc: 'Perplexity models' },
];

const starterThreads = [
  { id: 'welcome', title: 'Your AI workspace, together', provider: 'openai', updated: 'Just now', messages: [
    { role: 'assistant', text: 'Hi! This is your personal AI workspace. Pick a provider above, ask a question, or start with one of these ideas.\n\nChats and drafts save in this browser. To send live requests, configure the server-side AI Gateway key first.' }
  ] },
  { id: 'app-ideas', title: 'Ideas for the app', provider: 'claude', updated: 'Yesterday', messages: [{ role: 'assistant', text: 'A few things we could build into your workspace: shared prompts, side-by-side model answers, research folders, and encrypted backups.' }] },
  { id: 'trip-plan', title: 'Plan a weekend away', provider: 'perplexity', updated: 'Monday', messages: [{ role: 'assistant', text: 'Tell me where you’re thinking of going and what kind of trip you enjoy. I can help make a first draft here; live research will be available when connected.' }] },
];

const state = { threads: read('onechat.threads', starterThreads), active: read('onechat.active', 'welcome'), provider: read('onechat.provider', 'openai'), autoRoute: read('onechat.autoRoute', true), lastRoute: null, selectedModels: read('onechat.models', {}), catalog: {}, gatewayConfigured: false, pendingBackupFile: null, importCandidate: null, modalError: '', online: navigator.onLine, modal: null, toast: '' };
function read(key, fallback) { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function persist() { localStorage.setItem('onechat.threads', JSON.stringify(state.threads)); localStorage.setItem('onechat.active', JSON.stringify(state.active)); localStorage.setItem('onechat.provider', JSON.stringify(state.provider)); localStorage.setItem('onechat.models', JSON.stringify(state.selectedModels)); localStorage.setItem('onechat.autoRoute', JSON.stringify(state.autoRoute)); }
function esc(value='') { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function getThread() { return state.threads.find(thread => thread.id === state.active) || state.threads[0]; }
function model(id) { return providers.find(item => item.id === id) || providers[0]; }
function selectedModel() { return state.selectedModels[state.provider] || ''; }
function rankModel(item) {
 const value=`${item.name} ${item.id}`.toLowerCase();let score=0;
 if(/opus|pro|reasoner|deep.?research|codex|thinking|ultra/.test(value))score+=8;
 if(/sonnet|flagship|advanced/.test(value))score+=5;
 if(/mini|flash|nano|haiku|lite|small|fast/.test(value))score-=6;
 const version=value.match(/(?:^|[- .])(?:gpt-|claude-|gemini-)?(\d+(?:\.\d+)?)/);
 if(version)score+=Math.min(Number(version[1]),20)/5;
 if(/preview|experimental|beta/.test(value))score-=1;
 return score;
}
function chooseRoute(prompt) {
 const task=prompt.toLowerCase();let preferred='openai';
 if(/\b(research|sources|citations?|references?|web|news|today|current|latest|recent|compare evidence)\b/.test(task))preferred='perplexity';
 else if(/\b(image|picture|photo|diagram|screenshot|audio|voice|video|visual|multimodal)\b/.test(task))preferred='gemini';
 else if(/\b(code|coding|program|debug|bug|stack trace|function|typescript|javascript|python|repository|repo|software)\b/.test(task))preferred='claude';
 else if(/\b(math|prove|proof|logic|reason|complex|analyze|analysis|architecture|algorithm)\b/.test(task))preferred='openai';
 else if(/\b(write|writing|edit|rewrite|story|essay|brainstorm|tone|summari[sz]e)\b/.test(task))preferred='claude';
 const providerOrder=[...new Set([preferred,'openai','claude','gemini','deepseek','perplexity','grok'])];
 for(const provider of providerOrder){const modelChoice=[...(state.catalog[provider]||[])].sort((a,b)=>rankModel(b)-rankModel(a))[0];if(modelChoice)return{provider,model:modelChoice.id,label:modelChoice.name}}
 return null;
}
async function loadCatalog() {
 try {
  const status = await fetch('/api/status').then(r=>r.json()); state.gatewayConfigured = status.configured;
  if (state.gatewayConfigured) {
   state.catalog = await fetch('/api/models').then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not load models');return data});
   for (const provider of providers) if (state.catalog[provider.id]?.length && !state.catalog[provider.id].some(item=>item.id===state.selectedModels[provider.id])) state.selectedModels[provider.id]=state.catalog[provider.id][0].id;
   persist();
  }
 } catch { state.gatewayConfigured = false; }
 render();
}
function icon(name, size=18) {
 const paths={grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',plus:'<path d="M12 5v14M5 12h14"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.3a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.3a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1A1.7 1.7 0 1 1 7.7 3.3l.1.1a1.7 1.7 0 0 0 2.9-1.2v-.3a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.3a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/>',cloud:'<path d="M20 16.2A4.5 4.5 0 0 0 18.5 7h-1A7 7 0 0 0 4 9a5 5 0 0 0 .5 10H18a4 4 0 0 0 2-2.8Z"/>',arrow:'<path d="M7 17 17 7M7 7h10v10"/>',paperclip:'<path d="m21 11.5-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18m0-18a15 15 0 0 0 0 18"/>',lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m18 6-12 12M6 6l12 12"/>'};
 return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||''}</svg>`;
}
function render() {
 const thread=getThread();
 document.querySelector('#app').innerHTML=`<div class="app-shell">
 <aside class="sidebar" id="sidebar">
  <div class="brand-row"><div class="brand-mark"><span></span><span></span></div><span class="brand-name">onechat</span><button class="icon-button mobile-close" data-action="sidebar">${icon('close')}</button></div>
  <button class="new-chat" data-action="new">${icon('plus',17)}<span>New chat</span><kbd>⌘ K</kbd></button>
  <button class="nav-link" data-action="search">${icon('search')}<span>Search chats</span><kbd>⌘ F</kbd></button>
  <div class="side-label">WORKSPACE</div><button class="nav-link active">${icon('grid')}<span>All conversations</span><span class="nav-count">${state.threads.length}</span></button>
  <div class="thread-heading"><span class="side-label">RECENTS</span><button class="tiny-button" data-action="new" title="New chat">${icon('plus',15)}</button></div>
  <div class="thread-list">${state.threads.map(t=>`<button class="thread-item ${t.id===state.active?'selected':''}" data-thread="${esc(t.id)}"><span class="thread-dot" style="--dot:${model(t.provider).color}">${model(t.provider).mark}</span><span class="thread-title">${esc(t.title)}</span><span class="thread-more">···</span></button>`).join('')}</div>
  <div class="sidebar-bottom"><div class="drive-card"><div class="drive-icon">${icon('cloud',17)}</div><div class="drive-copy"><strong>Private by default</strong><span>Saved on this device</span></div><span class="green-dot"></span></div><button class="profile" data-action="settings"><div class="avatar">Y</div><div class="profile-copy"><strong>Your workspace</strong><span>Personal plan</span></div><span class="more">···</span></button></div>
 </aside>
 <main class="main-area">
  <header class="topbar"><button class="icon-button menu-button" data-action="sidebar">${icon('menu')}</button><div class="breadcrumbs"><span>Workspace</span><span class="crumb-slash">/</span><strong>${esc(thread?.title||'New chat')}</strong></div><div class="top-actions"><span class="connection ${state.online?'':'offline'}"><i></i>${state.online?'Online':'Offline'}</span><button class="share-button" data-action="share">${icon('arrow',15)}<span>Share</span></button><button class="icon-button top-more" data-action="settings">${icon('settings',17)}</button></div></header>
  <section class="chat-scroll" id="chatScroll"><div class="chat-column">
   <div class="welcome-heading"><div class="eyebrow"><span class="eyebrow-line"></span> YOUR PERSONAL AI SPACE</div><h1>${thread?.id==='welcome'?'Good to have you here.':'Let’s pick up where you left off.'}</h1><p>One calm place to think, make, and get things done.</p></div>
   <div class="model-row"><span class="model-label">CHOOSE A MODEL</span><div class="model-pills"><button class="model-pill auto-pill ${state.autoRoute?'chosen':''}" data-auto-route="true"><span class="model-glyph">✦</span><span>Auto</span></button>${providers.map(p=>`<button class="model-pill ${!state.autoRoute&&state.provider===p.id?'chosen':''}" data-provider="${p.id}" style="--provider:${p.color}"><span class="model-glyph">${p.mark}</span><span>${p.name}</span></button>`).join('')}<button class="model-manage" data-action="settings">Manage</button></div><select class="model-select" id="modelSelect" aria-label="Choose a model" ${!state.gatewayConfigured||state.autoRoute?'disabled':''}>${(state.catalog[state.provider]||[]).length?(state.catalog[state.provider]||[]).map(item=>`<option value="${esc(item.id)}" ${selectedModel()===item.id?'selected':''}>${esc(item.name)}</option>`).join(''):`<option>${state.gatewayConfigured?'No models found':'Add Gateway key to load models'}</option>`}</select><span class="auto-caption">${state.autoRoute?(state.lastRoute?`Last used: ${esc(state.lastRoute.label)}`:'Auto matches each prompt to a task and model'):`Manual: ${esc(model(state.provider).name)}`}</span></div>
   <div class="messages" id="messages">${thread?.messages.map((m,i)=>messageMarkup(m,i)).join('')||''}</div>
   ${thread?.messages.length===1 && thread.id==='welcome'?`<div class="suggestions"><button data-prompt="Help me plan a personal project, one step at a time."><span class="suggestion-icon sage">✳</span><span><strong>Plan a project</strong><small>Turn an idea into next steps</small></span>${icon('arrow',15)}</button><button data-prompt="Help me research a topic and compare a few perspectives."><span class="suggestion-icon peach">⌕</span><span><strong>Explore a question</strong><small>Research with more than one model</small></span>${icon('arrow',15)}</button><button data-prompt="Help me write a clear, warm message about…"><span class="suggestion-icon lilac">✎</span><span><strong>Write something</strong><small>Start a draft you can shape</small></span>${icon('arrow',15)}</button></div>`:''}
  </div></section>
  <div class="composer-wrap"><div class="composer" id="composer"><textarea id="prompt" rows="1" placeholder="Message ${model(state.provider).name}…" aria-label="Message"></textarea><div class="composer-toolbar"><div class="composer-tools"><button class="tool-button" data-action="attach" title="Add a file">${icon('paperclip',16)}<span>Attach</span></button><button class="tool-button web-tool" data-action="web" title="Web search">${icon('globe',16)}<span>Web search</span><i></i></button></div><button class="send-button" id="send" data-action="send" aria-label="Send message">${icon('send',16)}</button></div></div><div class="composer-note">${icon('lock',11)} Chats save on this device; live prompts go through Vercel AI Gateway to the selected model.</div></div>
 </main>
 ${state.modal?modalMarkup():''}${state.toast?`<div class="toast">${icon('check',15)} ${esc(state.toast)}</div>`:''}
 </div>`;
 attachEvents();
}
function messageMarkup(message,index) {
 const p=message.role==='assistant'?model(message.provider||state.provider):null;
 return `<article class="message ${message.role}" data-message="${index}"><div class="message-avatar ${message.role==='assistant'?'ai-avatar':''}" style="${p?`--provider:${p.color}`:''}">${p?p.mark:'Y'}</div><div class="message-body"><div class="message-meta"><strong>${message.role==='user'?'You':p?.name||'OneChat'}</strong><span>${message.role==='assistant'?esc(message.modelName||'AI response'):'Just now'}</span></div><div class="message-text">${esc(message.text).split('\n\n').map(block=>`<p>${block.replace(/\n/g,'<br>')}</p>`).join('')}</div>${message.role==='assistant'?`<div class="message-actions"><button data-copy="${index}" title="Copy response">${icon('copy',14)} Copy</button><button data-action="save" title="Save response">${icon('check',14)} Save</button><button data-action="post" title="Prepare a post">${icon('arrow',14)} Use in a post</button></div>`:''}</div></article>`;
}
function modalMarkup() {
 if(state.modal==='settings')return `<div class="modal-backdrop" data-action="dismiss"><section class="modal settings-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">YOUR WORKSPACE</div><h2>Settings & connections</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><div class="notice-card"><span class="notice-icon">${icon('lock',18)}</span><div><strong>${state.gatewayConfigured?'Live model gateway is configured':'Live models need a server key'}</strong><p>Your conversations save in this browser. When you send a prompt, it goes to Vercel AI Gateway and the selected model provider. Their terms and retention practices apply.</p></div></div><div class="settings-section"><div class="section-title"><div><h3>AI providers</h3><p>Available through your server-side Gateway key.</p></div><span class="badge">${providers.length} supported</span></div>${providers.map(p=>`<div class="provider-row"><span class="provider-avatar" style="--provider:${p.color}">${p.mark}</span><span class="provider-info"><strong>${p.name}</strong><small>${p.desc}</small></span><span class="badge">${(state.catalog[p.id]||[]).length?'Ready':'Setup key'}</span></div>`).join('')}</div><div class="settings-section"><div class="section-title"><div><h3>Encrypted backup</h3><p>Move chats between your devices with a passphrase.</p></div></div><div class="backup-row"><div class="backup-symbol">${icon('lock',18)}</div><div class="provider-info"><strong>Encrypted backup file</strong><small>Encrypt before you save it to Drive</small></div><button class="connect-button secondary" data-action="backup">Export</button><button class="connect-button" data-action="import-backup">Import</button><input id="backupFile" type="file" accept=".onechat,application/json" hidden></div><div class="inline-tip">OneChat encrypts the file in your browser. Keep the passphrase safe: it cannot be recovered. Drive only stores the file; this app does not connect to Drive yet.</div></div><div class="settings-footer">Offline access is available for saved conversations and drafts. Live model replies need an internet connection.</div></section></div>`;
 if(state.modal==='backup-export')return `<div class="modal-backdrop"><section class="modal confirm-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">ENCRYPTED EXPORT</div><h2>Create backup</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><p class="modal-explainer">Choose a strong passphrase with at least 12 characters. The encrypted .onechat file can be stored in Drive. OneChat never receives the passphrase; if you lose it, the backup cannot be opened.</p><label class="backup-label" for="backupPassword">Passphrase</label><input class="backup-password" id="backupPassword" type="password" autocomplete="new-password"><label class="backup-label" for="backupConfirm">Confirm passphrase</label><input class="backup-password" id="backupConfirm" type="password" autocomplete="new-password">${state.modalError?`<p class="backup-error">${esc(state.modalError)}</p>`:''}<div class="modal-actions"><button class="text-button" data-action="dismiss">Cancel</button><button class="primary-button" data-action="download-backup">Encrypt & download</button></div></section></div>`;
 if(state.modal==='backup-import')return `<div class="modal-backdrop"><section class="modal confirm-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">ENCRYPTED IMPORT</div><h2>Unlock backup</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><p class="modal-explainer">Enter the passphrase used to encrypt ${esc(state.pendingBackupFile?.name||'this file')}.</p><label class="backup-label" for="backupPassword">Passphrase</label><input class="backup-password" id="backupPassword" type="password" autocomplete="current-password">${state.modalError?`<p class="backup-error">${esc(state.modalError)}</p>`:''}<div class="modal-actions"><button class="text-button" data-action="dismiss">Cancel</button><button class="primary-button" data-action="decrypt-backup">Unlock</button></div></section></div>`;
 if(state.modal?.type==='confirm-import')return `<div class="modal-backdrop"><section class="modal confirm-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">REPLACE LOCAL CONVERSATIONS</div><h2>Import ${state.modal.count} chats?</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><p class="modal-explainer">This will replace the ${state.threads.length} conversations currently saved in this browser with the chats from “${esc(state.modal.name)}”. The backup is decrypted only in this browser.</p><div class="modal-actions"><button class="text-button" data-action="dismiss">Cancel</button><button class="primary-button" data-action="apply-backup">Replace & import</button></div></section></div>`;
 if(state.modal==='search')return `<div class="modal-backdrop" data-action="dismiss"><section class="modal search-modal" role="dialog" aria-modal="true"><div class="searchbox">${icon('search')}<input id="searchInput" placeholder="Search conversations…" autofocus><kbd>ESC</kbd></div><div class="search-results">${state.threads.map(t=>`<button data-thread="${esc(t.id)}"><span>${icon('search',16)}</span><span><strong>${esc(t.title)}</strong><small>${esc(t.messages[0]?.text.slice(0,88)||'')}</small></span>${icon('arrow',15)}</button>`).join('')}</div></section></div>`;
 if(state.modal==='confirm')return `<div class="modal-backdrop" data-action="dismiss"><section class="modal confirm-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">REVIEW BEFORE SHARING</div><h2>Prepare a post</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><p class="modal-explainer">Your text stays as a draft. Nothing will be posted until you connect a publishing app and approve the final action there.</p><textarea id="postDraft" rows="7">${esc(state.modal.text||'')}</textarea><div class="modal-actions"><button class="text-button" data-action="dismiss">Keep chatting</button><button class="primary-button" data-action="save-post">Save as draft</button></div></section></div>`;
 return '';
}
function toast(text){state.toast=text;render();setTimeout(()=>{state.toast='';render()},2200)}
function attachEvents(){
 document.querySelectorAll('[data-provider]').forEach(button=>button.onclick=()=>{state.provider=button.dataset.provider;state.autoRoute=false;persist();render()});
 document.querySelector('[data-auto-route]')?.addEventListener('click',()=>{state.autoRoute=true;persist();render()});
 const modelSelect=document.querySelector('#modelSelect');modelSelect?.addEventListener('change',()=>{state.selectedModels[state.provider]=modelSelect.value;persist()});
 document.querySelectorAll('[data-thread]').forEach(button=>button.onclick=()=>{state.active=button.dataset.thread;state.modal=null;persist();render()});
 document.querySelectorAll('[data-prompt]').forEach(button=>button.onclick=()=>{const input=document.querySelector('#prompt');input.value=button.dataset.prompt;input.focus();resizeInput(input)});
 document.querySelectorAll('[data-action]').forEach(button=>button.onclick=(event)=>{const action=button.dataset.action;if(action==='dismiss'&&event.target!==button)return;
  if(action==='new'){const t={id:crypto.randomUUID(),title:'New conversation',provider:state.provider,updated:'Just now',messages:[]};state.threads.unshift(t);state.active=t.id;persist();render();document.querySelector('#prompt')?.focus()}
  if(action==='settings') {state.modal='settings';render()} if(action==='search'){state.modal='search';render();document.querySelector('#searchInput')?.focus()}
  if(action==='sidebar')document.querySelector('#sidebar').classList.toggle('open'); if(action==='dismiss'){state.modal=null;render()}
  if(action==='send')sendMessage(); if(action==='share')toast('Sharing will be available once you choose a sync option.');
  if(action==='attach')toast('File attachments are coming in the next build.');if(action==='web')toast('Web search needs a connected provider.');
  if(action==='save')toast('Saved to this conversation.');if(action==='post'){const m=getThread().messages.findLast(x=>x.role==='assistant');state.modal={type:'confirm',text:m?.text||''};render()}
  if(action==='backup'){state.modalError='';state.modal='backup-export';render()}if(action==='save-post'){state.modal=null;toast('Draft saved on this device.');}
  if(action==='import-backup')document.querySelector('#backupFile')?.click();
  if(action==='download-backup')exportBackup();if(action==='decrypt-backup')importBackup();
  if(action==='apply-backup')applyBackupImport();
 });
 document.querySelectorAll('[data-connect]').forEach(button=>button.onclick=()=>{state.modal=null;toast(`${model(button.dataset.connect).name} connection setup is planned next.`)});
 document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{const text=getThread().messages[Number(button.dataset.copy)]?.text;if(text){await navigator.clipboard?.writeText(text);toast('Response copied.')}});
 const prompt=document.querySelector('#prompt');prompt?.addEventListener('input',()=>resizeInput(prompt));prompt?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});
 document.querySelector('#searchInput')?.addEventListener('input',e=>{const query=e.target.value.toLowerCase();document.querySelectorAll('.search-results button').forEach(b=>b.hidden=!b.innerText.toLowerCase().includes(query))});
 document.querySelector('#backupFile')?.addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;state.pendingBackupFile=file;state.modalError='';state.modal='backup-import';render()});
 document.addEventListener('keydown',shortcut,{once:true});
}
function shortcut(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();state.modal=null;render();document.querySelector('#prompt')?.focus()}else if(e.key==='Escape'&&state.modal){state.modal=null;render()}}
function resizeInput(input){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px'}
async function sendMessage(){
 const input=document.querySelector('#prompt'),text=input?.value.trim();if(!text)return;
 const route=state.autoRoute?chooseRoute(text):null;
 if(state.autoRoute&&state.gatewayConfigured&&!route){toast('No model is available for this task yet.');return}
 if(route){state.provider=route.provider;state.selectedModels[route.provider]=route.model;state.lastRoute={...route};}
 const provider=route?.provider||state.provider,thread=getThread(),modelId=route?.model||selectedModel();
 thread.messages.push({role:'user',text});if(thread.title==='New conversation')thread.title=text.length>30?text.slice(0,30)+'…':text;thread.provider=provider;persist();
 if(!state.online){render();toast('Offline: your message is saved as a draft.');return}
 if(!state.gatewayConfigured||!modelId){render();toast('Set AI_GATEWAY_API_KEY on the OneChat server to enable live models.');return}
 const assistant={role:'assistant',text:'',provider,modelName:modelId};thread.messages.push(assistant);persist();render();
 const textArea=document.querySelector('#prompt');if(textArea)textArea.disabled=true;
 try{
  const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,model:modelId,messages:thread.messages.filter(m=>m.role==='user'||m.role==='assistant').slice(0,-1).slice(-30).map(m=>({role:m.role,content:m.text}))})});
  if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'The model request failed.')}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',answer='';
  while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines){if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(!data||data==='[DONE]')continue;try{const event=JSON.parse(data);answer+=event.choices?.[0]?.delta?.content||''}catch{} }
   assistant.text=answer;const bubble=document.querySelector(`[data-message="${thread.messages.length-1}"] .message-text`);if(bubble){bubble.textContent=answer;bubble.style.whiteSpace='pre-wrap'}persist();document.querySelector('#chatScroll').scrollTop=999999;
  }
  assistant.text=answer||'(The model returned an empty response.)';
 }catch(error){assistant.text=error.message||'The model request failed.';assistant.modelName='Connection status';}
 persist();render();document.querySelector('#chatScroll').scrollTop=999999;
}
const BACKUP_ITERATIONS=600000;
const MAX_BACKUP_CHARS=1800000;
function toBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)}
function fromBase64(value){if(typeof value!=='string'||value.length>35_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('Backup file is invalid.');return Uint8Array.from(atob(value),char=>char.charCodeAt(0))}
async function deriveBackupKey(passphrase,salt,iterations=BACKUP_ITERATIONS){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function exportBackup(){
 const password=document.querySelector('#backupPassword')?.value||'',confirm=document.querySelector('#backupConfirm')?.value||'';
 if(password.length<12){state.modalError='Use a passphrase with at least 12 characters.';render();return}
 if(password!==confirm){state.modalError='The passphrases do not match.';render();return}
 try{
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveBackupKey(password,salt);
  const backup={format:'onechat-backup',version:1,exportedAt:new Date().toISOString(),threads:state.threads,preferences:{provider:state.provider,autoRoute:state.autoRoute,selectedModels:state.selectedModels}};
  const serialized=JSON.stringify(backup),plaintext=new TextEncoder().encode(serialized);
  if(serialized.length>MAX_BACKUP_CHARS||plaintext.length>4*1024*1024){state.modalError='This backup is too large for browser storage. Remove older chats and try again.';render();return}
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('onechat-backup-v1')},key,plaintext);
  const envelope={format:'onechat-encrypted-backup',version:1,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:BACKUP_ITERATIONS,salt:toBase64(salt)},cipher:{name:'AES-GCM',iv:toBase64(iv),data:toBase64(new Uint8Array(ciphertext))}};
  const blob=new Blob([JSON.stringify(envelope)],{type:'application/vnd.onechat.encrypted-backup+json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`onechat-backup-${new Date().toISOString().slice(0,10)}.onechat`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  state.modalError='';state.modal='settings';toast('Encrypted backup downloaded. Store the passphrase separately.');
 }catch{state.modalError='Your browser could not encrypt this backup. Try a current browser on localhost or HTTPS.';render()}
}
async function importBackup(){
 const password=document.querySelector('#backupPassword')?.value||'',file=state.pendingBackupFile;
 if(!file){state.modalError='Choose an encrypted .onechat file first.';render();return}
 if(file.size>6*1024*1024){state.modalError='This backup is larger than the 6 MB import limit.';render();return}
 try{
  const envelope=JSON.parse(await file.text());
  if(envelope.format!=='onechat-encrypted-backup'||envelope.version!==1||envelope.kdf?.name!=='PBKDF2'||envelope.kdf?.hash!=='SHA-256'||envelope.cipher?.name!=='AES-GCM'||!Number.isInteger(envelope.kdf.iterations)||envelope.kdf.iterations<600000||envelope.kdf.iterations>1000000)throw new Error('Unsupported backup format.');
  const salt=fromBase64(envelope.kdf.salt),iv=fromBase64(envelope.cipher.iv),data=fromBase64(envelope.cipher.data);
  if(salt.length!==16||iv.length!==12||data.length<16||data.length>4*1024*1024+16)throw new Error('Backup file is invalid.');
  const key=await deriveBackupKey(password,salt,envelope.kdf.iterations);
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('onechat-backup-v1')},key,data);
  if(plaintext.byteLength>4*1024*1024)throw new Error('Backup data is invalid.');
  const serialized=new TextDecoder().decode(plaintext);if(serialized.length>MAX_BACKUP_CHARS)throw new Error('Backup data is invalid.');
  const backup=JSON.parse(serialized);
  if(backup.format!=='onechat-backup'||backup.version!==1||!Array.isArray(backup.threads)||backup.threads.length>1000)throw new Error('Backup data is invalid.');
  const safeThreads=backup.threads.map(thread=>{
   if(!thread||typeof thread.title!=='string'||!Array.isArray(thread.messages)||thread.messages.length>2000)throw new Error('Backup data is invalid.');
   const safeMessages=thread.messages.map(message=>{if(!message||!['user','assistant'].includes(message.role)||typeof message.text!=='string'||message.text.length>100000)throw new Error('Backup data is invalid.');return{role:message.role,text:message.text,provider:providers.some(p=>p.id===message.provider)?message.provider:undefined,modelName:typeof message.modelName==='string'?message.modelName.slice(0,300):undefined}});
   return{id:typeof thread.id==='string'&&thread.id.length<=100?thread.id:crypto.randomUUID(),title:thread.title.slice(0,200),provider:providers.some(p=>p.id===thread.provider)?thread.provider:'openai',updated:typeof thread.updated==='string'?thread.updated.slice(0,100):'Imported',messages:safeMessages};
  });
  state.importCandidate={threads:safeThreads,preferences:backup.preferences};state.modalError='';state.modal={type:'confirm-import',name:file.name,count:safeThreads.length};render();
 }catch{state.modalError='Could not decrypt this backup. Check the passphrase and file, then try again.';render()}
}
function applyBackupImport(){
 if(!state.importCandidate)return;
 const {threads,preferences}=state.importCandidate;state.threads=threads;state.active=threads[0]?.id||'';
 if(providers.some(provider=>provider.id===preferences?.provider))state.provider=preferences.provider;
 if(typeof preferences?.autoRoute==='boolean')state.autoRoute=preferences.autoRoute;
  if(preferences?.selectedModels&&typeof preferences.selectedModels==='object'){
   state.selectedModels={};
   for(const provider of providers){const value=preferences.selectedModels[provider.id];if(typeof value==='string'&&value.length<=300)state.selectedModels[provider.id]=value;}
  }
 state.importCandidate=null;state.pendingBackupFile=null;persist();state.modal='settings';toast('Encrypted backup imported.');
}
window.addEventListener('online',()=>{state.online=true;render()});window.addEventListener('offline',()=>{state.online=false;render()});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
render();
loadCatalog();
