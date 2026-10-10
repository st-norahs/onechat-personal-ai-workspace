import './style.css';
import { mountWorkstation } from './workstation.js';
import { loadOfflineEngine, localReply, offlineModelId } from './offline-engine.js';
import { mountVoiceExperience, setVoiceMode, updateVoiceTranscript, updateVoiceReply, closeVoiceExperience } from './voice-experience.js';
import { captureVoiceprint, voiceChallenge, voiceSimilarity } from './voiceprint.js';
import { attachMcpPanel, mcpPanelMarkup } from './mcp-panel.js';
import { mountPublishingStudio } from './publishing-studio.js';
import { mountMediaStudio } from './media-studio.js';

const providers = [
  { id: 'openai', name: 'ChatGPT', mark: '✳', color: '#5aa987', desc: 'OpenAI models' },
  { id: 'claude', name: 'Claude', mark: '✳', color: '#d58a5a', desc: 'Anthropic models' },
  { id: 'gemini', name: 'Gemini', mark: '✦', color: '#6189d9', desc: 'Google models' },
  { id: 'grok', name: 'Grok', mark: '𝕏', color: '#242424', desc: 'xAI models' },
  { id: 'deepseek', name: 'DeepSeek', mark: '◈', color: '#4f83cc', desc: 'DeepSeek models' },
  { id: 'perplexity', name: 'Perplexity', mark: '⌕', color: '#34a9a1', desc: 'Perplexity models' },
  { id: 'local', name: 'On device', mark: '◉', color: '#a9c978', desc: 'Local offline model' },
];

const starterThreads = [
  { id: 'welcome', title: 'Your AI workspace, together', provider: 'openai', updated: 'Just now', messages: [
    { role: 'assistant', text: 'Hi! This is your personal AI workspace. Pick a provider above, ask a question, or start with one of these ideas.\n\nChats and drafts save in this browser. To send live requests, configure the server-side AI Gateway key first.' }
  ] },
  { id: 'app-ideas', title: 'Ideas for the app', provider: 'claude', updated: 'Yesterday', messages: [{ role: 'assistant', text: 'A few things we could build into your workspace: shared prompts, side-by-side model answers, research folders, and encrypted backups.' }] },
  { id: 'trip-plan', title: 'Plan a weekend away', provider: 'perplexity', updated: 'Monday', messages: [{ role: 'assistant', text: 'Tell me where you’re thinking of going and what kind of trip you enjoy. I can help make a first draft here; live research will be available when connected.' }] },
];

const state = { threads: read('salt.threads', read('onechat.threads', starterThreads)), active: read('salt.active', read('onechat.active', 'welcome')), provider: read('salt.provider', read('onechat.provider', 'openai')), autoRoute: read('salt.autoRoute', read('onechat.autoRoute', true)), compareMode: read('salt.compareMode', read('onechat.compareMode', false)), compareProviders: read('salt.compareProviders', read('onechat.compareProviders', [])), lastRoute: null, selectedModels: read('salt.models', read('onechat.models', {})), catalog: {}, gatewayConfigured: false, googleClientId:'', driveToken:null, driveKey:null, driveKdfSalt:null, driveDirty:false, pendingBackupFile: null, importCandidate: null, modalError: '', online: navigator.onLine, modal: null, toast: '', offlineReady: false, offlineProgress: '', voiceUnlocked:false, voiceRecognizer:null, voiceBusy:false, voiceSpeaking:false };
let driveSyncTimer=null,driveSyncBusy=false;
function read(key, fallback) { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function persist() { for(const [key,value] of Object.entries({threads:state.threads,active:state.active,provider:state.provider,models:state.selectedModels,autoRoute:state.autoRoute,compareMode:state.compareMode,compareProviders:state.compareProviders}))localStorage.setItem(`salt.${key}`,JSON.stringify(value));if(state.driveKey){state.driveDirty=true;scheduleDriveSync()} }
function esc(value='') { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function getThread() { return state.threads.find(thread => thread.id === state.active) || state.threads[0]; }
function model(id) { return providers.find(item => item.id === id) || providers[0]; }
function selectedModel() { return state.selectedModels[state.provider] || ''; }
function topModelFor(provider) { return [...(state.catalog[provider]||[])].sort((a,b)=>rankModel(b)-rankModel(a))[0]; }
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
  const status = await fetch('/api/status').then(r=>r.json()); state.gatewayConfigured = status.configured; state.googleClientId=status.googleClientId||'';
  if (state.gatewayConfigured) {
   state.catalog = await fetch('/api/models').then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not load models');return data});
   for (const provider of providers) if (state.catalog[provider.id]?.length && !state.catalog[provider.id].some(item=>item.id===state.selectedModels[provider.id])) state.selectedModels[provider.id]=(topModelFor(provider.id)||state.catalog[provider.id][0]).id;
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
  <div class="brand-row"><div class="brand-mark"><span></span><span></span></div><span class="brand-name">Salt</span><button class="icon-button mobile-close" data-action="sidebar">${icon('close')}</button></div>
  <button class="new-chat" data-action="new">${icon('plus',17)}<span>New chat</span><kbd>⌘ K</kbd></button>
  <button class="nav-link" data-action="search">${icon('search')}<span>Search chats</span><kbd>⌘ F</kbd></button>
  <div class="side-label">WORKSPACE</div><button class="nav-link active">${icon('grid')}<span>All conversations</span><span class="nav-count">${state.threads.length}</span></button><button class="nav-link" data-action="workstation">${icon('grid')}<span>Build apps</span></button><button class="nav-link" data-action="media-studio">${icon('search')}<span>Media & web search</span></button><button class="nav-link" data-action="publishing-studio">${icon('arrow',16)}<span>Create & publish</span></button>
  <div class="thread-heading"><span class="side-label">RECENTS</span><button class="tiny-button" data-action="new" title="New chat">${icon('plus',15)}</button></div>
  <div class="thread-list">${state.threads.map(t=>`<button class="thread-item ${t.id===state.active?'selected':''}" data-thread="${esc(t.id)}"><span class="thread-dot" style="--dot:${model(t.provider).color}">${model(t.provider).mark}</span><span class="thread-title">${esc(t.title)}</span><span class="thread-more">···</span></button>`).join('')}</div>
  <div class="sidebar-bottom"><div class="drive-card"><div class="drive-icon">${icon('cloud',17)}</div><div class="drive-copy"><strong>Private by default</strong><span>Saved on this device</span></div><span class="green-dot"></span></div><button class="profile" data-action="settings"><div class="avatar">Y</div><div class="profile-copy"><strong>Your workspace</strong><span>Personal plan</span></div><span class="more">···</span></button></div>
 </aside>
 <main class="main-area">
  <header class="topbar"><button class="icon-button menu-button" data-action="sidebar">${icon('menu')}</button><div class="breadcrumbs"><span>Workspace</span><span class="crumb-slash">/</span><strong>${esc(thread?.title||'New chat')}</strong></div><div class="top-actions"><span class="connection ${state.online?'':'offline'}"><i></i>${state.online?'Online':'Offline'}</span><button class="share-button" data-action="share">${icon('arrow',15)}<span>Share</span></button><button class="icon-button top-more" data-action="settings">${icon('settings',17)}</button></div></header>
  <div id="chatView"><section class="chat-scroll" id="chatScroll"><div class="chat-column">
   <div class="welcome-heading"><div class="eyebrow"><span class="eyebrow-line"></span> YOUR PERSONAL AI SPACE</div><h1>${thread?.id==='welcome'?'Good to have you here.':'Let’s pick up where you left off.'}</h1><p>One calm place to think, make, and get things done.</p></div>
   <div class="model-row"><span class="model-label">CHOOSE A MODEL</span><div class="model-pills"><button class="model-pill auto-pill ${state.autoRoute&&!state.compareMode?'chosen':''}" data-auto-route="true" ${state.compareMode?'disabled':''}><span class="model-glyph">✦</span><span>Auto</span></button>${providers.map(p=>`<button class="model-pill ${state.compareMode?state.compareProviders.includes(p.id)?'chosen':'':!state.autoRoute&&state.provider===p.id?'chosen':''}" data-provider="${p.id}" style="--provider:${p.color}" ${state.compareMode&&p.id==='local'?'disabled':''}><span class="model-glyph">${p.mark}</span><span>${p.name}</span></button>`).join('')}<button class="model-manage" data-action="settings">Manage</button></div><select class="model-select" id="modelSelect" aria-label="Choose a model" ${!state.gatewayConfigured||state.autoRoute||state.provider==='local'?'disabled':''}>${(state.catalog[state.provider]||[]).length?(state.catalog[state.provider]||[]).map(item=>`<option value="${esc(item.id)}" ${selectedModel()===item.id?'selected':''}>${esc(item.name)}</option>`).join(''):`<option>${state.provider==='local'?'SmolLM2 · runs on this device':state.gatewayConfigured?'No models found':'Add Gateway key to load models'}</option>`}</select><button class="compare-toggle ${state.compareMode?'active':''}" data-action="compare-mode" ${!state.gatewayConfigured?'disabled':''}>${state.compareMode?'Exit compare':'Compare'}</button><button class="compare-toggle" data-action="offline-model">${state.offlineReady?'Local model ready':state.offlineProgress||'Set up offline AI'}</button><span class="auto-caption">${state.compareMode?`Select 2–3 providers · up to 3 model requests per prompt`:state.provider==='local'?'On-device model · no prompt is sent to a provider':state.autoRoute?(state.lastRoute?`Last used: ${esc(state.lastRoute.label)}`:'Auto matches each prompt to a task and model'):`Manual: ${esc(model(state.provider).name)}`}</span></div>
   <div class="messages" id="messages">${renderMessages(thread?.messages||[])}</div>
   ${thread?.messages.length===1 && thread.id==='welcome'?`<div class="suggestions"><button data-prompt="Help me plan a personal project, one step at a time."><span class="suggestion-icon sage">✳</span><span><strong>Plan a project</strong><small>Turn an idea into next steps</small></span>${icon('arrow',15)}</button><button data-prompt="Help me research a topic and compare a few perspectives."><span class="suggestion-icon peach">⌕</span><span><strong>Explore a question</strong><small>Research with more than one model</small></span>${icon('arrow',15)}</button><button data-prompt="Help me write a clear, warm message about…"><span class="suggestion-icon lilac">✎</span><span><strong>Write something</strong><small>Start a draft you can shape</small></span>${icon('arrow',15)}</button></div>`:''}
  </div></section>
  <div class="composer-wrap"><div class="composer" id="composer"><textarea id="prompt" rows="1" placeholder="Message ${model(state.provider).name}…" aria-label="Message"></textarea><div class="composer-toolbar"><div class="composer-tools"><button class="tool-button" data-action="attach" title="Add a file">${icon('paperclip',16)}<span>Attach</span></button><button class="tool-button web-tool" data-action="web" title="Web search">${icon('globe',16)}<span>Web search</span><i></i></button><button class="tool-button voice-tool" data-action="voice" title="Voice input">◉<span>Voice</span></button></div><button class="send-button" id="send" data-action="send" aria-label="${state.compareMode?'Compare responses':'Send message'}" title="${state.compareMode?'Compare responses':'Send message'}">${icon('send',16)}<span class="send-caption">${state.compareMode?'Compare':'Send'}</span></button></div></div><div class="composer-note">${icon('lock',11)} ${state.compareMode?'Compare sends one request to each selected provider; usage and charges multiply.':state.provider==='local'?'On-device model · prompts stay in this browser. First setup downloads the model.':'Chats save on this device; live prompts go through Vercel AI Gateway to the selected model.'}</div></div></div>
 </main>
 ${state.modal?modalMarkup():''}${state.toast?`<div class="toast">${icon('check',15)} ${esc(state.toast)}</div>`:''}
 </div>`;
 attachEvents();
 attachMcpPanel({onInsert:text=>{const input=document.querySelector('#prompt');if(!input)return;input.value=`${input.value}${input.value.trim()?"\n\n":""}${text}`;resizeInput(input);}});
}
function renderMessages(messages) {
 let html='';
 for(let i=0;i<messages.length;i++){
  const message=messages[i];
  if(message.comparisonId){const group=[{message,index:i}];let j=i+1;while(j<messages.length&&messages[j].comparisonId===message.comparisonId){group.push({message:messages[j],index:j});j++}html+=`<div class="comparison-grid" aria-label="Compared model responses">${group.map(item=>messageMarkup(item.message,item.index)).join('')}</div>`;i=j-1;continue}
  html+=messageMarkup(message,i);
 }
 return html;
}
function messageMarkup(message,index) {
 const p=message.role==='assistant'?model(message.provider||state.provider):null;
 return `<article class="message ${message.role}" data-message="${index}"><div class="message-avatar ${message.role==='assistant'?'ai-avatar':''}" style="${p?`--provider:${p.color}`:''}">${p?p.mark:'Y'}</div><div class="message-body"><div class="message-meta"><strong>${message.role==='user'?'You':p?.name||'Salt'}</strong><span>${message.role==='assistant'?esc(message.modelName||'AI response'):'Just now'}</span></div><div class="message-text">${esc(message.text).split('\n\n').map(block=>`<p>${block.replace(/\n/g,'<br>')}</p>`).join('')}</div>${message.role==='assistant'?`<div class="message-actions"><button data-copy="${index}" title="Copy response">${icon('copy',14)} Copy</button><button data-speak="${index}" title="Speak response">◖)) Speak</button><button data-action="save" title="Save response">${icon('check',14)} Save</button><button data-action="post" title="Prepare a post">${icon('arrow',14)} Use in a post</button></div>`:''}</div></article>`;
}
function modalMarkup() {
 if(state.modal==='settings')return `<div class="modal-backdrop" data-action="dismiss"><section class="modal settings-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">YOUR WORKSPACE</div><h2>Settings & connections</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><div class="notice-card"><span class="notice-icon">${icon('lock',18)}</span><div><strong>${state.gatewayConfigured?'Live model gateway is configured':'Live models need a server key'}</strong><p>Your conversations save in this browser. When you send a prompt, it goes to Vercel AI Gateway and the selected model provider. Their terms and retention practices apply.</p></div></div><div class="settings-section"><div class="section-title"><div><h3>AI providers</h3><p>Available through your server-side Gateway key.</p></div><span class="badge">${providers.length} supported</span></div>${providers.map(p=>`<div class="provider-row"><span class="provider-avatar" style="--provider:${p.color}">${p.mark}</span><span class="provider-info"><strong>${p.name}</strong><small>${p.desc}</small></span><span class="badge">${(state.catalog[p.id]||[]).length?'Ready':'Setup key'}</span></div>`).join('')}</div>${mcpPanelMarkup()}<div class="settings-section"><div class="section-title"><div><h3>Google Drive workspace sync</h3><p>Encrypted chats, avatar media, and coding projects across devices.</p></div><span class="badge">${state.googleClientId?'Ready to connect':'Needs setup'}</span></div><div class="backup-row"><div class="backup-symbol">${icon('cloud',18)}</div><div class="provider-info"><strong>${state.googleClientId?'Your Drive':'Connect Google Drive'}</strong><small>${state.driveToken?'Connected for this session':'Token stays in memory; no password is stored'}</small></div><button class="connect-button" data-action="drive-connect" ${!state.googleClientId?'disabled':''}>${state.driveToken?'Reconnect':'Connect'}</button></div><div class="backup-row"><div class="provider-info"><strong>Sync encrypted workspace</strong><small>Chats, avatar media, coding files · encrypted</small></div><button class="connect-button secondary" data-action="drive-export" ${!state.googleClientId?'disabled':''}>Save</button><button class="connect-button" data-action="drive-restore" ${!state.googleClientId?'disabled':''}>Restore</button></div><div class="inline-tip">Salt encrypts chats, preferences, avatar media, and text project files in this browser before upload. Restore replaces chats and merges project files and avatar media; matching filenames are overwritten. Voice profiles, provider API keys, downloaded model weights, dependencies, and Salt app source stay out of the archive. Set GOOGLE_CLIENT_ID in the server .env. Drive stores files but cannot run or install the app.</div></div><div class="settings-section"><div class="section-title"><div><h3>Encrypted backup file</h3><p>Manual file export or import.</p></div></div><div class="backup-row"><div class="backup-symbol">${icon('lock',18)}</div><div class="provider-info"><strong>Encrypted backup</strong><small>Encrypt before saving outside this device</small></div><button class="connect-button secondary" data-action="backup">Export</button><button class="connect-button" data-action="import-backup">Import</button><input id="backupFile" type="file" accept=".onechat,application/json" hidden></div><div class="inline-tip">Keep the passphrase safe: Salt cannot recover it. The app itself must be deployed to HTTPS for installation on other devices.</div></div><div class="settings-footer">Offline access is available on each device after its first load. Live model replies need an internet connection.</div></section></div>`;
 if(state.modal==='backup-export'||state.modal==='backup-export-drive')return `<div class="modal-backdrop"><section class="modal confirm-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">ENCRYPTED EXPORT</div><h2>${state.modal==='backup-export-drive'?'Save encrypted backup to Drive':'Create backup'}</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><p class="modal-explainer">Choose a strong passphrase with at least 12 characters. Salt encrypts chats, preferences, avatar media, and coding project files in this browser before saving. If you lose the passphrase, the backup cannot be opened.</p><label class="backup-label" for="backupPassword">Passphrase</label><input class="backup-password" id="backupPassword" type="password" autocomplete="new-password"><label class="backup-label" for="backupConfirm">Confirm passphrase</label><input class="backup-password" id="backupConfirm" type="password" autocomplete="new-password">${state.modalError?`<p class="backup-error">${esc(state.modalError)}</p>`:''}<div class="modal-actions"><button class="text-button" data-action="dismiss">Cancel</button><button class="primary-button" data-action="${state.modal==='backup-export-drive'?'drive-upload-backup':'download-backup'}">${state.modal==='backup-export-drive'?'Encrypt & save':'Encrypt & download'}</button></div></section></div>`;
 if(state.modal==='backup-import')return `<div class="modal-backdrop"><section class="modal confirm-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">ENCRYPTED IMPORT</div><h2>Unlock backup</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><p class="modal-explainer">Enter the passphrase used to encrypt ${esc(state.pendingBackupFile?.name||'this file')}.</p><label class="backup-label" for="backupPassword">Passphrase</label><input class="backup-password" id="backupPassword" type="password" autocomplete="current-password">${state.modalError?`<p class="backup-error">${esc(state.modalError)}</p>`:''}<div class="modal-actions"><button class="text-button" data-action="dismiss">Cancel</button><button class="primary-button" data-action="decrypt-backup">Unlock</button></div></section></div>`;
 if(state.modal==='voiceprint'){
  const enrolled=Boolean(read('salt.voiceprint',null));
  return `<div class="modal-backdrop"><section class="modal confirm-modal voiceprint-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">ON-DEVICE VOICEPRINT</div><h2>${enrolled?'Verify your voice':'Enroll your voice'}</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><p class="modal-explainer">${enrolled?'Say the phrase below to enter voice mode.':'Say the phrase below twice so Salt can create a local speaker profile.'} Audio is analyzed in this browser; only a compact voice feature profile is saved on this device. Enroll again on each device.</p><div class="voiceprint-phrase">“${esc(voiceChallenge)}”</div><div class="voiceprint-status" id="voiceprintStatus" aria-live="polite">${state.modalError?esc(state.modalError):'Voice matching is experimental. A recording or similar voice may pass, and your voice may be rejected. Do not use it to protect sensitive data.'}</div><div class="modal-actions"><button class="text-button" data-action="dismiss">Cancel</button><button class="primary-button" data-action="${enrolled?'voice-verify':'voice-enroll'}" ${state.voiceBusy?'disabled':''}>${state.voiceBusy?'Listening…':enrolled?'Verify & open':'Enroll voice'}</button></div><button class="voiceprint-reset" data-action="voice-reset" ${!enrolled?'hidden':''}>Forget this voiceprint</button></section></div>`;
 }
 if(state.modal?.type==='confirm-import')return `<div class="modal-backdrop"><section class="modal confirm-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">RESTORE WORKSPACE</div><h2>Import ${state.modal.count} chats and resources?</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><p class="modal-explainer">This will replace the ${state.threads.length} local chats and restore ${state.modal.assetCount||0} avatar assets plus ${state.modal.projectCount||0} coding projects from “${esc(state.modal.name)}”. Existing project files with matching names will be overwritten; other local files remain. The backup is decrypted only in this browser.</p><div class="modal-actions"><button class="text-button" data-action="dismiss">Cancel</button><button class="primary-button" data-action="apply-backup">Restore workspace</button></div></section></div>`;
 if(state.modal==='search')return `<div class="modal-backdrop" data-action="dismiss"><section class="modal search-modal" role="dialog" aria-modal="true"><div class="searchbox">${icon('search')}<input id="searchInput" placeholder="Search conversations…" autofocus><kbd>ESC</kbd></div><div class="search-results">${state.threads.map(t=>`<button data-thread="${esc(t.id)}"><span>${icon('search',16)}</span><span><strong>${esc(t.title)}</strong><small>${esc(t.messages[0]?.text.slice(0,88)||'')}</small></span>${icon('arrow',15)}</button>`).join('')}</div></section></div>`;
 if(state.modal==='confirm')return `<div class="modal-backdrop" data-action="dismiss"><section class="modal confirm-modal" role="dialog" aria-modal="true"><div class="modal-head"><div><div class="eyebrow">REVIEW BEFORE SHARING</div><h2>Prepare a post</h2></div><button class="icon-button" data-action="dismiss">${icon('close')}</button></div><p class="modal-explainer">Your text stays as a draft. Nothing will be posted until you connect a publishing app and approve the final action there.</p><textarea id="postDraft" rows="7">${esc(state.modal.text||'')}</textarea><div class="modal-actions"><button class="text-button" data-action="dismiss">Keep chatting</button><button class="primary-button" data-action="save-post">Save as draft</button></div></section></div>`;
 return '';
}
function toast(text){state.toast=text;render();setTimeout(()=>{state.toast='';render()},2200)}
function attachEvents(){
 document.querySelectorAll('[data-provider]').forEach(button=>button.onclick=()=>{
  const provider=button.dataset.provider;state.provider=provider;
  if(state.compareMode){if(provider==='local'){toast('The local model cannot be sent through cloud comparison.');return}if(state.compareProviders.includes(provider))state.compareProviders=state.compareProviders.filter(id=>id!==provider);else if(state.compareProviders.length<3)state.compareProviders.push(provider);else{toast('Compare up to three providers at a time.');return}}
  else state.autoRoute=false;
  persist();render();
 });
 document.querySelector('[data-auto-route]')?.addEventListener('click',()=>{state.autoRoute=true;state.compareMode=false;persist();render()});
 const modelSelect=document.querySelector('#modelSelect');modelSelect?.addEventListener('change',()=>{state.selectedModels[state.provider]=modelSelect.value;persist()});
 document.querySelectorAll('[data-thread]').forEach(button=>button.onclick=()=>{state.active=button.dataset.thread;state.modal=null;persist();render()});
 document.querySelectorAll('[data-prompt]').forEach(button=>button.onclick=()=>{const input=document.querySelector('#prompt');input.value=button.dataset.prompt;input.focus();resizeInput(input)});
 document.querySelectorAll('[data-action]').forEach(button=>button.onclick=(event)=>{const action=button.dataset.action;if(action==='dismiss'&&event.target!==button)return;
  if(action==='new'){const t={id:crypto.randomUUID(),title:'New conversation',provider:state.provider,updated:'Just now',messages:[]};state.threads.unshift(t);state.active=t.id;persist();render();document.querySelector('#prompt')?.focus()}
  if(action==='settings') {state.modal='settings';render()} if(action==='search'){state.modal='search';render();document.querySelector('#searchInput')?.focus()}
  if(action==='workstation')mountWorkstation();
  if(action==='offline-model')prepareOfflineModel();
  if(action==='voice')openVoiceGate();
  if(action==='sidebar')document.querySelector('#sidebar').classList.toggle('open'); if(action==='dismiss'){state.modal=null;render()}
  if(action==='compare-mode'){
   if(!state.compareMode){if(!state.gatewayConfigured){toast('Configure AI_GATEWAY_API_KEY before comparing models.');return}state.autoRoute=false;state.compareMode=true;const available=providers.filter(p=>p.id!=='local'&&(state.catalog[p.id]||[]).length).map(p=>p.id);const first=available.includes(state.provider)?state.provider:available[0];const second=available.find(id=>id!==first);state.compareProviders=[first,...(second?[second]:[])];}
   else state.compareMode=false;
   persist();render();
  }
  if(action==='send')sendMessage(); if(action==='share')toast('Sharing will be available once you choose a sync option.');
  if(action==='attach')toast('File attachments are coming in the next build.');if(action==='web'){const query=document.querySelector('#prompt')?.value.trim();if(query)window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`,'_blank','noopener,noreferrer');else mountMediaStudio({onInsert:insertDraftText});}
  if(action==='media-studio')mountMediaStudio({onInsert:insertDraftText});if(action==='publishing-studio')mountPublishingStudio();
  if(action==='save')toast('Saved to this conversation.');if(action==='post'){const m=getThread().messages.findLast(x=>x.role==='assistant');mountPublishingStudio(m?.text||'')}
  if(action==='backup'){state.modalError='';state.modal='backup-export';render()}if(action==='drive-connect')connectDrive().catch(error=>toast(error.message));if(action==='drive-export'){if(state.driveKey)syncDriveNow();else{state.modalError='';state.modal='backup-export-drive';render()}}if(action==='drive-restore')restoreDriveBackup().catch(error=>toast(error.message));if(action==='drive-upload-backup')uploadDriveBackup();if(action==='save-post'){state.modal=null;toast('Draft saved on this device.');}
  if(action==='import-backup')document.querySelector('#backupFile')?.click();
  if(action==='download-backup')exportBackup();if(action==='decrypt-backup')importBackup();
  if(action==='voice-enroll')enrollVoiceprint();
  if(action==='voice-verify')verifyVoiceprint();
  if(action==='voice-reset')forgetVoiceprint();
  if(action==='apply-backup')applyBackupImport();
 });
 document.querySelectorAll('[data-connect]').forEach(button=>button.onclick=()=>{state.modal=null;toast(`${model(button.dataset.connect).name} connection setup is planned next.`)});
 document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{const text=getThread().messages[Number(button.dataset.copy)]?.text;if(text){await navigator.clipboard?.writeText(text);toast('Response copied.')}});
 document.querySelectorAll('[data-speak]').forEach(button=>button.onclick=()=>speakResponse(Number(button.dataset.speak)));
 const prompt=document.querySelector('#prompt');prompt?.addEventListener('input',()=>resizeInput(prompt));prompt?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});
 document.querySelector('#searchInput')?.addEventListener('input',e=>{const query=e.target.value.toLowerCase();document.querySelectorAll('.search-results button').forEach(b=>b.hidden=!b.innerText.toLowerCase().includes(query))});
 document.querySelector('#backupFile')?.addEventListener('change',event=>{const file=event.target.files?.[0];if(!file)return;state.pendingBackupFile=file;state.modalError='';state.modal='backup-import';render()});
 document.addEventListener('keydown',shortcut,{once:true});
}
function shortcut(e){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();state.modal=null;render();document.querySelector('#prompt')?.focus()}else if(e.key==='Escape'&&state.modal){state.modal=null;render()}}
function resizeInput(input){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px'}
function insertDraftText(text){const input=document.querySelector('#prompt');if(!input)return;input.value=`${input.value}${input.value.trim()?"\n\n":""}${text}`;resizeInput(input)}
async function sendMessage(textOverride='',voiceReply=false){
 if(state.compareMode)return sendComparison();
 const input=document.querySelector('#prompt'),text=(textOverride||input?.value||'').trim();if(!text)return;
 const voiceInput=document.querySelector('#voiceTranscript');if(voiceReply&&voiceInput)voiceInput.value='';
 const route=state.autoRoute?(!navigator.onLine?{provider:'local',model:offlineModelId(),label:'On-device model'}:chooseRoute(text)):null;
 if(state.autoRoute&&state.gatewayConfigured&&!route){toast('No model is available for this task yet.');return}
 if(route){state.provider=route.provider;state.selectedModels[route.provider]=route.model;state.lastRoute={...route};}
 const provider=route?.provider||state.provider,thread=getThread(),modelId=provider==='local'?offlineModelId():(route?.model||selectedModel());
 thread.messages.push({role:'user',text});if(thread.title==='New conversation')thread.title=text.length>30?text.slice(0,30)+'…':text;thread.provider=provider;persist();
 if(provider==='local') { await streamLocal(thread,modelId,voiceReply);return; }
 if(!state.online){render();toast('Offline: choose On device and prepare its model before sending.');return}
 if(!state.gatewayConfigured||!modelId){render();toast('Set AI_GATEWAY_API_KEY on the Salt server to enable live models.');return}
 const history=thread.messages.filter(m=>m.role==='user'||m.role==='assistant').slice(-30).map(m=>({role:m.role,content:m.text}));
 const assistant={role:'assistant',text:'',provider,modelName:modelId};thread.messages.push(assistant);persist();render();
 await streamAssistant(thread,assistant,thread.messages.length-1,provider,modelId,history);
 if(voiceReply)speakResponse(thread.messages.length-1);
 persist();render();document.querySelector('#chatScroll').scrollTop=999999;
}
async function streamLocal(thread,modelId,voiceReply=false){
 const history=thread.messages.filter(m=>m.role==='user'||m.role==='assistant').slice(-12).map(m=>({role:m.role,content:m.text}));
 const assistant={role:'assistant',text:'',provider:'local',modelName:modelId};thread.messages.push(assistant);const index=thread.messages.length-1;persist();render();
 try { await localReply(history,token=>{assistant.text+=token;const bubble=document.querySelector(`[data-message="${index}"] .message-text`);if(bubble){bubble.textContent=assistant.text;bubble.style.whiteSpace='pre-wrap'}updateVoiceReply(assistant.text);persist();},progress=>{state.offlineProgress=progress;const note=document.querySelector('.composer-note');if(note)note.textContent=progress;});assistant.modelName=`Local · ${modelId}`;state.offlineReady=true;if(voiceReply)speakResponse(index); }
 catch(error){assistant.text=`On-device model unavailable: ${error.message}`;assistant.modelName='Local model · setup needed';}
 state.offlineProgress='';persist();render();document.querySelector('#chatScroll')?.scrollTo(0,999999);
}
async function prepareOfflineModel(){
 if(!navigator.onLine){toast('Connect once to download and cache the local model, then use it offline.');return}
 state.offlineProgress='Starting local model…';render();
 try { await loadOfflineEngine(progress=>{state.offlineProgress=progress;const note=document.querySelector('.auto-caption');if(note)note.textContent=progress;const button=document.querySelector('[data-action="offline-model"]');if(button)button.textContent=progress;});state.offlineReady=true;state.offlineProgress='';render();toast('Local model is ready on this device.'); }
 catch(error){state.offlineProgress='';render();toast(error.message||'Could not load the local model.');}
}
function openVoiceGate(){
 if(state.voiceUnlocked){showVoiceMode();return}
 state.modal='voiceprint';state.modalError='';state.voiceBusy=false;render();
}
function showVoiceMode(){const last=getThread()?.messages.findLast(message=>message.role==='assistant')?.text||'';mountVoiceExperience({onClose:()=>{state.voiceModeActive=false;state.voiceUnlocked=false;state.voiceRecognizer?.stop();speechSynthesis.cancel();setVoiceMode('idle')},onMic:()=>toggleLocalDictation(),onSend:text=>{if(text)sendMessage(text,true)},lastReply:last});state.voiceModeActive=true;}
function setVoiceprintStatus(text){const status=document.querySelector('#voiceprintStatus');if(status)status.textContent=text;}
async function recordVoiceprint(){return captureVoiceprint(progress=>setVoiceprintStatus(`Listening… ${progress}%`));}
async function enrollVoiceprint(){
 if(state.voiceBusy)return;state.voiceBusy=true;document.querySelector('[data-action="voice-enroll"]')?.setAttribute('disabled','');setVoiceprintStatus(`Sample 1 of 2. Say: “${voiceChallenge}”`);
 try{
  const first=await recordVoiceprint();setVoiceprintStatus(`Sample 2 of 2. Say: “${voiceChallenge}” again.`);
  const second=await recordVoiceprint();
  localStorage.setItem('salt.voiceprint',JSON.stringify({version:1,samples:[first,second],createdAt:new Date().toISOString()}));
  localStorage.removeItem('salt.voiceCredential');
  state.voiceUnlocked=true;state.voiceBusy=false;state.modal=null;render();showVoiceMode();toggleLocalDictation();
 }catch(error){state.voiceBusy=false;setVoiceprintStatus(error.message||'Voice enrollment failed. Try again in a quiet place.');document.querySelector('[data-action="voice-enroll"]')?.removeAttribute('disabled');}
}
async function verifyVoiceprint(){
 if(state.voiceBusy)return;const profile=read('salt.voiceprint',null);if(!profile?.samples?.length){state.modalError='No voiceprint is saved on this device.';render();return}
 state.voiceBusy=true;document.querySelector('[data-action="voice-verify"]')?.setAttribute('disabled','');setVoiceprintStatus(`Say: “${voiceChallenge}”`);
 try{
  const sample=await recordVoiceprint();const score=Math.max(...profile.samples.map(saved=>voiceSimilarity(sample,saved)));
  if(score<0.88)throw new Error('That voice did not match closely enough. Try again in a quiet place, or forget and enroll your voice again.');
  state.voiceUnlocked=true;state.voiceBusy=false;state.modal=null;render();showVoiceMode();toggleLocalDictation();
 }catch(error){state.voiceBusy=false;setVoiceprintStatus(error.message||'Voice check failed. Try again.');document.querySelector('[data-action="voice-verify"]')?.removeAttribute('disabled');}
}
function forgetVoiceprint(){localStorage.removeItem('salt.voiceprint');state.voiceUnlocked=false;state.voiceBusy=false;state.modal=null;render();toast('Voiceprint removed from this device.');}
async function toggleLocalDictation(){
 if(state.voiceRecognizer){state.voiceRecognizer.stop();state.voiceRecognizer=null;setVoiceMode('idle');return}
 await startLocalDictation();
}
async function startLocalDictation(){
 if(!state.voiceUnlocked){toast('Verify your voice before starting voice mode.');return}
 const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Recognition){toast('This browser has no speech recognition API. Try a current Chrome browser.');return}
 const recognition=new Recognition();recognition.lang='en-US';recognition.interimResults=true;recognition.continuous=false;
 if(!('processLocally'in recognition)){toast('This browser cannot guarantee on-device transcription. Voice input is disabled to avoid a cloud fallback.');return}
 recognition.processLocally=true;
 try { if(typeof Recognition.available==='function'){let availability=await Recognition.available({langs:['en-US'],processLocally:true,quality:'dictation'});if(availability==='downloadable'||availability==='downloading'){setVoiceMode('thinking');toast('Downloading the on-device speech pack…');const installed=await Recognition.install({langs:['en-US'],processLocally:true,quality:'dictation'});if(!installed){setVoiceMode('idle');toast('Speech pack setup failed.');return}toast('Speech pack ready. Press the microphone again to speak.');setVoiceMode('idle');return}if(availability==='unavailable'||availability===false){toast('On-device speech recognition is unavailable in this browser.');return}} }
 catch(error){toast(`On-device speech setup failed: ${error.message}`);return}
 recognition.onresult=event=>{let transcript='';for(let i=event.resultIndex;i<event.results.length;i++)transcript+=event.results[i][0].transcript;const input=document.querySelector('#prompt');if(input){input.value=transcript;resizeInput(input)}updateVoiceTranscript(transcript)};
 recognition.onerror=event=>{setVoiceMode('idle');toast(`Speech input failed: ${event.error||'unknown error'}`)};
 recognition.onend=()=>{state.voiceRecognizer=null;setVoiceMode('idle');document.querySelector('[data-action="voice"]')?.classList.remove('recording')};
 state.voiceRecognizer=recognition;setVoiceMode('listening');document.querySelector('[data-action="voice"]')?.classList.add('recording');try{recognition.start()}catch(error){state.voiceRecognizer=null;setVoiceMode('idle');toast(error.message)}
}
function speakResponse(index){const text=getThread().messages[index]?.text;if(!text||!('speechSynthesis'in window)){toast('Speech output is unavailable in this browser.');return}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-US';utterance.onstart=()=>setVoiceMode('speaking');utterance.onend=()=>setVoiceMode('idle');utterance.onerror=()=>setVoiceMode('idle');speechSynthesis.speak(utterance);updateVoiceReply(text)}
async function sendComparison(){
 const input=document.querySelector('#prompt'),text=input?.value.trim();if(!text)return;
 const targets=state.compareProviders.slice(0,3).map(provider=>({provider,model:state.selectedModels[provider]||topModelFor(provider)?.id})).filter(target=>target.model);
 if(targets.length<2){toast('Choose at least two providers with available models.');return}
 const thread=getThread();thread.messages.push({role:'user',text});if(thread.title==='New conversation')thread.title=text.length>30?text.slice(0,30)+'…':text;thread.provider=targets[0].provider;
 if(!state.online){persist();render();toast('Offline: your comparison prompt is saved as a draft.');return}
 if(!state.gatewayConfigured){persist();render();toast('Configure AI_GATEWAY_API_KEY before comparing models.');return}
 const history=thread.messages.filter(m=>m.role==='user'||m.role==='assistant').slice(-30).map(m=>({role:m.role,content:m.text}));
 const comparisonId=crypto.randomUUID();
 const answers=targets.map(target=>({role:'assistant',text:'',provider:target.provider,modelName:target.model,comparisonId}));
 thread.messages.push(...answers);persist();render();
 await Promise.all(answers.map((answer,index)=>streamAssistant(thread,answer,thread.messages.length-answers.length+index,targets[index].provider,targets[index].model,history)));
 persist();render();document.querySelector('#chatScroll').scrollTop=999999;
}
async function streamAssistant(thread,assistant,index,provider,modelId,messages){
 try{
  const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,model:modelId,messages})});
  if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||`The ${model(provider).name} request failed.`)}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',answer='';
  while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines){if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(!data||data==='[DONE]')continue;try{const event=JSON.parse(data);answer+=event.choices?.[0]?.delta?.content||''}catch{}}
   assistant.text=answer;const bubble=document.querySelector(`[data-message="${index}"] .message-text`);if(bubble){bubble.textContent=answer;bubble.style.whiteSpace='pre-wrap'}persist();document.querySelector('#chatScroll').scrollTop=999999;
  }
  assistant.text=answer||'(The model returned an empty response.)';
 }catch(error){assistant.text=error.message||'The model request failed.';assistant.modelName=`${model(provider).name} · error`;}
}
const BACKUP_ITERATIONS=600000;
const MAX_BACKUP_CHARS=60000000;
const MAX_BACKUP_BYTES=40*1024*1024;
function toBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)}
function fromBase64(value){if(typeof value!=='string'||value.length>60_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('Backup file is invalid.');return Uint8Array.from(atob(value),char=>char.charCodeAt(0))}
async function deriveBackupKey(passphrase,salt,iterations=BACKUP_ITERATIONS){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function driveToken(){
 if(!state.googleClientId)throw new Error('Drive sync is not configured. Add GOOGLE_CLIENT_ID to the server .env and restart Salt.');
 if(state.driveToken&&state.driveToken.expires>Date.now()+30000)return state.driveToken.value;
 if(!window.google?.accounts?.oauth2)throw new Error('Google sign-in is still loading. Wait a moment and retry.');
 return new Promise((resolve,reject)=>{
  const client=window.google.accounts.oauth2.initTokenClient({client_id:state.googleClientId,scope:'https://www.googleapis.com/auth/drive.file',callback:result=>{if(result.error||!result.access_token){reject(new Error(result.error_description||'Google Drive authorization was not completed.'));return}state.driveToken={value:result.access_token,expires:Date.now()+Number(result.expires_in||3600)*1000};resolve(result.access_token)},error_callback:error=>reject(new Error(error.message||'Google sign-in window could not open.'))});
  client.requestAccessToken({prompt:''});
 });
}
async function driveFetch(url,options={}){const token=await driveToken();const response=await fetch(url,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`}});if(!response.ok){let message='Google Drive request failed.';try{message=(await response.json()).error?.message||message}catch{}throw new Error(message)}return response}
async function driveFolder(){
 const query=encodeURIComponent("name = 'Salt Workspace' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
 const found=await driveFetch(`https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=100&fields=files(id,name)&q=${query}`).then(r=>r.json());
 if(found.files?.length)return found.files[0];
 return driveFetch('https://www.googleapis.com/drive/v3/files?fields=id,name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Salt Workspace',mimeType:'application/vnd.google-apps.folder'})}).then(r=>r.json());
}
async function uploadEncryptedBackupToDrive(blob){
 const folder=await driveFolder(),name='salt-workspace-latest.onechat';
 const query=encodeURIComponent(`name = '${name}' and '${folder.id}' in parents and trashed = false`);
 const found=await driveFetch(`https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=10&fields=files(id,name)&q=${query}`).then(r=>r.json());
 const boundary='salt_drive_'+crypto.randomUUID().replaceAll('-','');
 const metadata={name,mimeType:'application/vnd.onechat.encrypted-backup+json',...(found.files?.[0]?{}:{parents:[folder.id]})};
 const prefix=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/vnd.onechat.encrypted-backup+json\r\n\r\n`;
 const body=new Blob([prefix,blob,'\r\n--'+boundary+'--'],{type:`multipart/related; boundary=${boundary}`});
 const url=found.files?.[0]?`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(found.files[0].id)}?uploadType=multipart&fields=id,name`:'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';
 return driveFetch(url,{method:found.files?.[0]?'PATCH':'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body}).then(r=>r.json());
}
async function connectDrive(){await driveToken();if(state.driveKey&&state.driveDirty)scheduleDriveSync();if(state.modal==='settings')render();toast(state.driveKey?'Google Drive reconnected; auto-save will resume.':'Google Drive is connected for this session.');}
async function restoreDriveBackup(){
 const folder=await driveFolder(),query=encodeURIComponent(`name = 'salt-workspace-latest.onechat' and '${folder.id}' in parents and trashed = false`);
 const found=await driveFetch(`https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=10&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&q=${query}`).then(r=>r.json());
 if(!found.files?.length)throw new Error('No Salt backup was found in the Salt Workspace Drive folder.');
 const backup=await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(found.files[0].id)}?alt=media`).then(r=>r.blob());
 if(backup.size>60*1024*1024)throw new Error('The Drive backup exceeds the 60 MB restore limit.');
 state.pendingBackupFile=new File([backup],found.files[0].name,{type:backup.type||'application/vnd.onechat.encrypted-backup+json'});state.modalError='';state.modal='backup-import';render();
}
async function collectPortableResources(){
 const [avatarResponse,projectResponse]=await Promise.all([fetch('/api/avatar/export',{cache:'no-store'}),fetch('/api/dev/export',{cache:'no-store'})]);
 const avatarData=await avatarResponse.json(),projectData=await projectResponse.json();
 if(!avatarResponse.ok)throw new Error(avatarData.error||'Could not collect avatar media.');
 if(!projectResponse.ok)throw new Error(projectData.error||'Could not collect coding projects.');
 return {avatarAssets:Array.isArray(avatarData.assets)?avatarData.assets:[],projects:Array.isArray(projectData.projects)?projectData.projects:[]};
}
function makeBackupData(resources){return {format:'onechat-backup',version:2,exportedAt:new Date().toISOString(),threads:state.threads,preferences:{provider:state.provider,autoRoute:state.autoRoute,compareMode:state.compareMode,compareProviders:state.compareProviders,selectedModels:state.selectedModels},publishingDrafts:read('salt.publishing.drafts',[]).slice(0,500),avatarAssets:resources.avatarAssets,projects:resources.projects}}
async function saveDriveSnapshot(key=state.driveKey){
 if(!key)throw new Error('Set a backup passphrase before enabling Drive auto-save.');
 if(driveSyncBusy)throw new Error('Drive sync is already saving this workspace.');
 driveSyncBusy=true;
 try{
  const resources=await collectPortableResources(),backup=makeBackupData(resources),serialized=JSON.stringify(backup),plaintext=new TextEncoder().encode(serialized);
  if(serialized.length>MAX_BACKUP_CHARS||plaintext.length>MAX_BACKUP_BYTES)throw new Error('Portable resources exceed the 40 MB encrypted backup limit. Reduce chats, project files, or avatar media and retry.');
  const salt=state.driveKdfSalt||crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('onechat-backup-v1')},key,plaintext);
  const envelope={format:'onechat-encrypted-backup',version:1,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:BACKUP_ITERATIONS,salt:toBase64(salt)},cipher:{name:'AES-GCM',iv:toBase64(iv),data:toBase64(new Uint8Array(ciphertext))}};
  await uploadEncryptedBackupToDrive(new Blob([JSON.stringify(envelope)],{type:'application/vnd.onechat.encrypted-backup+json'}));
  return {chats:state.threads.length,assets:resources.avatarAssets.length,projects:resources.projects.length};
 }finally{driveSyncBusy=false}
}
function scheduleDriveSync(){
 if(driveSyncTimer)clearTimeout(driveSyncTimer);
 if(!state.driveKey||!state.driveToken||state.driveToken.expires<Date.now()+30000||!navigator.onLine){state.driveDirty=true;return}
 driveSyncTimer=setTimeout(async()=>{
  if(!state.driveKey||!state.driveToken||state.driveToken.expires<Date.now()+30000||!navigator.onLine){state.driveDirty=true;return}
  try{await saveDriveSnapshot();state.driveDirty=false;}
  catch(error){state.driveDirty=true;toast(`Drive auto-save needs attention: ${error.message}`)}
 },2500);
}
async function syncDriveNow(){try{await driveToken();const result=await saveDriveSnapshot();state.driveDirty=false;toast(`Drive updated · ${result.chats} chats, ${result.assets} avatar assets, ${result.projects} coding projects.`)}catch(error){state.driveDirty=true;toast(`Drive sync needs attention: ${error.message}`)}}
async function uploadDriveBackup(){
 const password=document.querySelector('#backupPassword')?.value||'',confirm=document.querySelector('#backupConfirm')?.value||'';
 if(password.length<12){state.modalError='Use a passphrase with at least 12 characters.';render();return}
 if(password!==confirm){state.modalError='The passphrases do not match.';render();return}
 try{
  await driveToken();const salt=crypto.getRandomValues(new Uint8Array(16)),key=await deriveBackupKey(password,salt);state.driveKdfSalt=salt;
  const result=await saveDriveSnapshot(key);state.driveKey=key;state.driveDirty=false;state.modal='settings';state.modalError='';render();toast(`Encrypted workspace saved · ${result.chats} chats · ${result.assets} avatar assets · ${result.projects} coding projects. Auto-save is on for this session.`);
 }catch(error){state.modalError=error.message||'Could not encrypt or save this backup to Drive.';render()}
}
async function exportBackup(){
 const password=document.querySelector('#backupPassword')?.value||'',confirm=document.querySelector('#backupConfirm')?.value||'';
 if(password.length<12){state.modalError='Use a passphrase with at least 12 characters.';render();return}
 if(password!==confirm){state.modalError='The passphrases do not match.';render();return}
 try{
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveBackupKey(password,salt);
  const resources=await collectPortableResources(),backup=makeBackupData(resources);
  const serialized=JSON.stringify(backup),plaintext=new TextEncoder().encode(serialized);
  if(serialized.length>MAX_BACKUP_CHARS||plaintext.length>MAX_BACKUP_BYTES){state.modalError='Portable resources exceed the 40 MB encrypted backup limit. Reduce chats, project files, or avatar media and retry.';render();return}
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('onechat-backup-v1')},key,plaintext);
  const envelope={format:'onechat-encrypted-backup',version:1,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:BACKUP_ITERATIONS,salt:toBase64(salt)},cipher:{name:'AES-GCM',iv:toBase64(iv),data:toBase64(new Uint8Array(ciphertext))}};
  const blob=new Blob([JSON.stringify(envelope)],{type:'application/vnd.onechat.encrypted-backup+json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`salt-workspace-backup-${new Date().toISOString().slice(0,10)}.onechat`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  state.modalError='';state.modal='settings';toast(`Encrypted workspace exported · ${resources.avatarAssets.length} avatar assets · ${resources.projects.length} coding projects.`);
 }catch{state.modalError='Your browser could not encrypt this backup. Try a current browser on localhost or HTTPS.';render()}
}
async function importBackup(){
 const password=document.querySelector('#backupPassword')?.value||'',file=state.pendingBackupFile;
 if(!file){state.modalError='Choose an encrypted .onechat file first.';render();return}
 if(file.size>60*1024*1024){state.modalError='This backup is larger than the 60 MB import limit.';render();return}
 try{
  const envelope=JSON.parse(await file.text());
  if(envelope.format!=='onechat-encrypted-backup'||envelope.version!==1||envelope.kdf?.name!=='PBKDF2'||envelope.kdf?.hash!=='SHA-256'||envelope.cipher?.name!=='AES-GCM'||!Number.isInteger(envelope.kdf.iterations)||envelope.kdf.iterations<600000||envelope.kdf.iterations>1000000)throw new Error('Unsupported backup format.');
  const salt=fromBase64(envelope.kdf.salt),iv=fromBase64(envelope.cipher.iv),data=fromBase64(envelope.cipher.data);
  if(salt.length!==16||iv.length!==12||data.length<16||data.length>MAX_BACKUP_BYTES+16)throw new Error('Backup file is invalid.');
  const key=await deriveBackupKey(password,salt,envelope.kdf.iterations);
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('onechat-backup-v1')},key,data);
  if(plaintext.byteLength>MAX_BACKUP_BYTES)throw new Error('Backup data is invalid.');
  const serialized=new TextDecoder().decode(plaintext);if(serialized.length>MAX_BACKUP_CHARS)throw new Error('Backup data is invalid.');
  const backup=JSON.parse(serialized);
  if(backup.format!=='onechat-backup'||![1,2].includes(backup.version)||!Array.isArray(backup.threads)||backup.threads.length>1000)throw new Error('Backup data is invalid.');
  const safeThreads=backup.threads.map(thread=>{
   if(!thread||typeof thread.title!=='string'||!Array.isArray(thread.messages)||thread.messages.length>2000)throw new Error('Backup data is invalid.');
   const safeMessages=thread.messages.map(message=>{if(!message||!['user','assistant'].includes(message.role)||typeof message.text!=='string'||message.text.length>100000)throw new Error('Backup data is invalid.');return{role:message.role,text:message.text,provider:providers.some(p=>p.id===message.provider)?message.provider:undefined,modelName:typeof message.modelName==='string'?message.modelName.slice(0,300):undefined}});
   return{id:typeof thread.id==='string'&&thread.id.length<=100?thread.id:crypto.randomUUID(),title:thread.title.slice(0,200),provider:providers.some(p=>p.id===thread.provider)?thread.provider:'openai',updated:typeof thread.updated==='string'?thread.updated.slice(0,100):'Imported',messages:safeMessages};
  });
  const safeAssets=backup.version===2&&Array.isArray(backup.avatarAssets)?backup.avatarAssets:[];let assetBytes=0;
  if(safeAssets.length>500)throw new Error('Too many avatar assets.');
  for(const asset of safeAssets){if(!['portraits','outfits','hairstyles','gestures','speech','references'].includes(asset?.category)||typeof asset.name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(asset.name)||typeof asset.data!=='string')throw new Error('Invalid avatar archive.');const bytes=fromBase64(asset.data);assetBytes+=bytes.length;if(bytes.length>8*1024*1024||assetBytes>12*1024*1024)throw new Error('Avatar archive exceeds its size limit.');}
  const safeProjects=backup.version===2&&Array.isArray(backup.projects)?backup.projects:[];let projectBytes=0;
  if(safeProjects.length>100)throw new Error('Too many coding projects.');
  for(const project of safeProjects){if(!project||typeof project.name!=='string'||!/^[a-z0-9][a-z0-9-]{0,31}$/.test(project.name)||!Array.isArray(project.files)||project.files.length>2000)throw new Error('Invalid coding project archive.');for(const fileEntry of project.files){if(typeof fileEntry?.path!=='string'||fileEntry.path.length>240||fileEntry.path.includes('\\')||fileEntry.path.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.'))||typeof fileEntry.content!=='string'||new TextEncoder().encode(fileEntry.content).length>512*1024)throw new Error('Invalid project file.');projectBytes+=new TextEncoder().encode(fileEntry.content).length;if(projectBytes>10*1024*1024)throw new Error('Coding projects exceed their size limit.');}}
  const safeDrafts=backup.version===2&&Array.isArray(backup.publishingDrafts)?backup.publishingDrafts.slice(0,500).filter(item=>item&&typeof item.id==='string'&&item.id.length<=80&&typeof item.body==='string'&&item.body.length<=10000).map(item=>({id:item.id,title:typeof item.title==='string'?item.title.slice(0,140):'',to:typeof item.to==='string'?item.to.slice(0,500):'',body:item.body,channel:['linkedin','email','both'].includes(item.channel)?item.channel:'linkedin',scheduledAt:typeof item.scheduledAt==='string'&&Number.isFinite(Date.parse(item.scheduledAt))?item.scheduledAt:null,createdAt:typeof item.createdAt==='string'?item.createdAt:new Date().toISOString(),status:['scheduled','draft','ready for review'].includes(item.status)?item.status:'draft'})):[];
  state.importCandidate={threads:safeThreads,preferences:backup.preferences,drafts:safeDrafts,assets:safeAssets,projects:safeProjects,driveKey:key,driveKdfSalt:salt};state.modalError='';state.modal={type:'confirm-import',name:file.name,count:safeThreads.length,assetCount:safeAssets.length,projectCount:safeProjects.length};render();
 }catch(error){state.modalError=error.name==='OperationError'?'Could not decrypt this backup. Check the passphrase and file, then try again.':error.message||'Could not decrypt this backup. Check the passphrase and file, then try again.';render()}
}
async function applyBackupImport(){
 if(!state.importCandidate)return;
 const {threads,preferences,drafts=[],assets=[],projects=[],driveKey,driveKdfSalt}=state.importCandidate;
 try{
  for(const asset of assets){const response=await fetch('/api/avatar/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:asset.category,filename:asset.name,data:asset.data})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not restore avatar media.');}
  if(projects.length){const response=await fetch('/api/dev/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projects})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not restore coding projects.');}
 }catch(error){state.modalError=`Some resources may have been restored. ${error.message} Retry to continue.`;render();return}
 state.threads=threads;state.active=threads[0]?.id||'';
 if(providers.some(provider=>provider.id===preferences?.provider))state.provider=preferences.provider;
 if(typeof preferences?.autoRoute==='boolean')state.autoRoute=preferences.autoRoute;
 if(typeof preferences?.compareMode==='boolean')state.compareMode=preferences.compareMode;
 if(Array.isArray(preferences?.compareProviders))state.compareProviders=[...new Set(preferences.compareProviders.filter(id=>providers.some(provider=>provider.id===id)))].slice(0,3);
  if(preferences?.selectedModels&&typeof preferences.selectedModels==='object'){
   state.selectedModels={};
   for(const provider of providers){const value=preferences.selectedModels[provider.id];if(typeof value==='string'&&value.length<=300)state.selectedModels[provider.id]=value;}
  }
 localStorage.setItem('salt.publishing.drafts',JSON.stringify(drafts));state.importCandidate=null;state.pendingBackupFile=null;if(state.driveToken){state.driveKey=driveKey;state.driveKdfSalt=driveKdfSalt}persist();state.modal='settings';toast(`Restored ${threads.length} chats, ${drafts.length} drafts, ${assets.length} avatar assets, and ${projects.length} coding projects.`);
}
window.addEventListener('online',()=>{state.online=true;if(state.driveKey&&state.driveDirty)scheduleDriveSync();render()});window.addEventListener('offline',()=>{state.online=false;render()});
window.addEventListener('salt:resources-changed',()=>{if(state.driveKey){state.driveDirty=true;scheduleDriveSync()}});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
render();
loadCatalog();
