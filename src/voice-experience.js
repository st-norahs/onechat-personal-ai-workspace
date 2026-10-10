import { createSaltAvatar } from './voice-avatar.js';
import { mountOutfitStudio, refreshOutfitReferences } from './avatar-outfit-studio.js';

let avatar=null;
let libraryTimer=null;
const suggestions=['Summarize my day and help me choose one priority.','Help me think through a problem out loud.','Draft a clear reply to my latest message.','Teach me one useful idea in five minutes.'];
const categories={portraits:'Portraits',outfits:'Outfits',hairstyles:'Hairstyles',gestures:'Gestures & animation',speech:'Speech',references:'Style references'};
const esc=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountVoiceExperience({onClose,onMic,onSend,lastReply=''}){
  closeVoiceExperience();
  const host=document.createElement('div');host.id='voiceExperienceHost';host.className='voice-experience';
  host.innerHTML=`<header class="voice-head"><a class="voice-wordmark"><span class="brand-mark"><span></span><span></span></span>Salt</a><span class="voice-private">◉ Local voice controls</span><button id="voiceClose" aria-label="Close voice mode">Back to chat</button></header><main class="voice-main"><section class="avatar-stage" data-mode="idle"><div class="avatar-aura"></div><canvas id="saltAvatar" aria-label="Animated 3D Salt avatar"></canvas><img id="saltPortrait" class="avatar-portrait" alt="Selected Salt avatar image" hidden><video id="saltGesture" class="avatar-gesture" playsinline muted loop hidden></video><div class="voice-state" id="voiceState">Salt is here</div></section><section class="voice-conversation"><div class="voice-eyebrow">YOUR VOICE SPACE</div><h1>Talk it through.</h1><p class="voice-subtitle">Press the microphone when you’re ready. Salt listens on this device where your browser supports offline speech.</p><details class="avatar-studio"><summary>Avatar studio <span>Local library · auto-refresh</span></summary><p>Drop new media into the Salt avatar folders or upload it here. Updates appear automatically while voice mode is open.</p><div class="avatar-studio-controls"><label>Folder<select id="avatarCategory">${Object.entries(categories).map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label><label class="avatar-upload">Add media<input id="avatarUpload" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label></div><label class="avatar-assets-label">Choose an asset<select id="avatarAssetSelect"><option value="">No assets in this folder yet</option></select></label><div class="avatar-studio-status" id="avatarLibraryStatus" aria-live="polite">Looking for local Salt assets…</div><audio id="saltSpeechAsset" controls preload="none" hidden></audio><img id="saltReferencePreview" class="avatar-reference-preview" alt="Salt avatar style reference" hidden></details><div class="voice-response" id="voiceResponse">${esc(lastReply||'Tell Salt what you’re thinking about. Choose a prompt below or speak when you’re ready.')}</div><textarea id="voiceTranscript" rows="3" placeholder="Your words appear here so you can review them before sending…"></textarea><div class="voice-controls"><button id="voiceMic" class="voice-mic" type="button">◉ <span>Start listening</span></button><button id="voiceSend" type="button">Ask Salt</button></div><div class="voice-suggestions"><div class="voice-eyebrow">TRY SAYING</div><div>${suggestions.map((item,index)=>`<button data-voice-suggestion="${index}">${esc(item)} <span>↗</span></button>`).join('')}</div></div></section></main><footer class="voice-foot">Local voiceprint match · microphone audio is processed on this device · not secure authentication</footer>`;
  document.body.append(host);
  mountOutfitStudio(host);
  try{avatar=createSaltAvatar(host.querySelector('#saltAvatar'))}catch{host.querySelector('.avatar-stage')?.classList.add('avatar-fallback')}
  host.querySelector('#voiceClose').onclick=()=>{closeVoiceExperience();onClose?.()};
  host.querySelector('#voiceMic').onclick=()=>onMic?.();
  host.querySelector('#voiceSend').onclick=()=>onSend?.(host.querySelector('#voiceTranscript').value.trim());
  host.querySelectorAll('[data-voice-suggestion]').forEach(button=>button.onclick=()=>{host.querySelector('#voiceTranscript').value=suggestions[Number(button.dataset.voiceSuggestion)]||'';host.querySelector('#voiceTranscript').focus()});
  host.querySelector('#avatarCategory').onchange=()=>{updateAcceptTypes(host);refreshAvatarLibrary(host)};
  host.querySelector('#avatarUpload').onchange=event=>uploadAvatarAsset(host,event.target.files?.[0]);
  host.querySelector('#avatarAssetSelect').onchange=()=>selectAvatarAsset(host);
  host.querySelector('#saltPortrait').onerror=()=>{host.querySelector('#saltPortrait').hidden=true;setLibraryStatus(host,'This image could not be opened. Salt is using the animated fallback.');};
  host.querySelector('#saltGesture').onerror=()=>{host.querySelector('#saltGesture').hidden=true;setLibraryStatus(host,'This gesture clip could not be opened. Salt is using the animated fallback.');};
  updateAcceptTypes(host);refreshAvatarLibrary(host);
  libraryTimer=setInterval(()=>refreshAvatarLibrary(host,{quiet:true}),20000);
}
export function setVoiceMode(mode){avatar?.setMode(mode);const host=document.querySelector('#voiceExperienceHost');if(!host)return;const status=host.querySelector('#voiceState'),mic=host.querySelector('#voiceMic');const labels={idle:['Salt is here','Start listening'],listening:['Listening on this device…','Stop listening'],thinking:['Salt is thinking…','Listening'],speaking:['Salt is speaking','Stop speaking']};const [label,micText]=labels[mode]||labels.idle;if(status)status.textContent=label;if(mic){mic.classList.toggle('recording',mode==='listening');mic.querySelector('span').textContent=micText}host.querySelector('.avatar-stage')?.setAttribute('data-mode',mode)}
export function updateVoiceTranscript(text){const input=document.querySelector('#voiceTranscript');if(input)input.value=text}
export function updateVoiceReply(text){const response=document.querySelector('#voiceResponse');if(response)response.textContent=text}
export function closeVoiceExperience(){avatar?.dispose();avatar=null;if(libraryTimer)clearInterval(libraryTimer);libraryTimer=null;document.querySelector('#voiceExperienceHost')?.remove()}

async function refreshAvatarLibrary(host,{quiet=false}={}){
  try{
    const response=await fetch('/api/avatar/library',{cache:'no-store'});if(!response.ok)throw new Error('Could not read the avatar folders.');
    const {categories:library}=await response.json();host.avatarLibrary=library||{};
    refreshOutfitReferences(host,host.avatarLibrary);
    const autoCategories=['portraits','outfits','hairstyles','gestures'];
    const fresh=autoCategories.flatMap(category=>(host.avatarLibrary[category]||[]).map(asset=>({...asset,category}))).filter(asset=>!host.seenAvatarAssets?.has(asset.url));
    const hadScan=Boolean(host.seenAvatarAssets);host.seenAvatarAssets=new Set(Object.values(host.avatarLibrary).flat().map(asset=>asset.url));
    const category=host.querySelector('#avatarCategory').value;const assets=host.avatarLibrary[category]||[];const select=host.querySelector('#avatarAssetSelect');const previous=select.value;
    select.innerHTML=assets.length?assets.map((asset,index)=>`<option value="${index}">${esc(asset.name)}</option>`).join(''):'<option value="">No assets in this folder yet</option>';
    if(assets.some((asset,index)=>String(index)===previous))select.value=previous;
    const total=Object.values(host.avatarLibrary).reduce((sum,list)=>sum+list.length,0);
    setLibraryStatus(host,quiet?`${total} local asset${total===1?'':'s'} · checked just now`:`${total} local asset${total===1?'':'s'} found. New files are checked every 20 seconds.`);
    const newest=fresh.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    if(newest||(!hadScan&&!host.activeAvatarURL)){
      const choice=newest||autoCategories.flatMap(category=>(host.avatarLibrary[category]||[]).map(asset=>({...asset,category}))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
      if(choice){host.querySelector('#avatarCategory').value=choice.category;updateAcceptTypes(host);const choices=host.avatarLibrary[choice.category]||[];select.innerHTML=choices.map((asset,index)=>`<option value="${index}">${esc(asset.name)}</option>`).join('');select.value=String(choices.findIndex(asset=>asset.url===choice.url));selectAvatarAsset(host);}
    }
  }catch(error){if(!quiet)setLibraryStatus(host,`${error.message} The animated fallback still works.`);}
}
function updateAcceptTypes(host){const category=host.querySelector('#avatarCategory').value;const accept=category==='speech'?'.mp3,.wav,.ogg,.m4a,audio/*':category==='gestures'?'.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,image/*,video/mp4,video/webm':'.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif';host.querySelector('#avatarUpload').accept=accept;}
function setLibraryStatus(host,text){const status=host.querySelector('#avatarLibraryStatus');if(status)status.textContent=text;}
function selectAvatarAsset(host){
  const category=host.querySelector('#avatarCategory').value;const asset=(host.avatarLibrary?.[category]||[])[Number(host.querySelector('#avatarAssetSelect').value)];
  const image=host.querySelector('#saltPortrait'),video=host.querySelector('#saltGesture'),audio=host.querySelector('#saltSpeechAsset'),reference=host.querySelector('#saltReferencePreview');
  image.hidden=true;video.pause();video.hidden=true;audio.pause();audio.hidden=true;reference.hidden=true;
  if(!asset)return;
  if(category==='speech'){audio.src=asset.url;audio.hidden=false;audio.load();setLibraryStatus(host,`${asset.name} · local speech preview`);return}
  if(category==='references'){reference.src=asset.url;reference.hidden=false;setLibraryStatus(host,`${asset.name} · style reference`);return}
  if(category==='gestures'&&asset.type.startsWith('video/')){video.src=asset.url;video.hidden=false;video.play().catch(()=>{});setLibraryStatus(host,`${asset.name} · looping gesture clip`);return}
  host.activeAvatarURL=asset.url;image.src=asset.url;image.hidden=false;image.classList.toggle('is-gif',asset.type==='image/gif');setLibraryStatus(host,`${asset.name} · local avatar media`);
}
async function uploadAvatarAsset(host,file){
  if(!file)return;const category=host.querySelector('#avatarCategory').value;
  if(file.size>8*1024*1024){setLibraryStatus(host,'Files are limited to 8 MB.');return}
  setLibraryStatus(host,`Preparing ${file.name} for the local ${categories[category]} folder…`);
  try{
    const prepared=await prepareAvatarUpload(file);
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read this file.'));reader.readAsDataURL(prepared)});
    setLibraryStatus(host,`Saving ${prepared.name} locally…`);
    const response=await fetch('/api/avatar/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,filename:prepared.name,mime:prepared.type,data:String(dataUrl).split(',')[1]})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Upload failed.');
    await refreshAvatarLibrary(host);const assets=host.avatarLibrary?.[category]||[];const uploaded=assets.findIndex(asset=>asset.name===result.asset.name);
    host.querySelector('#avatarCategory').value=category;host.querySelector('#avatarAssetSelect').value=String(uploaded);selectAvatarAsset(host);
    window.dispatchEvent(new Event('salt:resources-changed'));
  }catch(error){setLibraryStatus(host,`${error.message} Existing avatar media remains available.`)}
  finally{host.querySelector('#avatarUpload').value=''}
}

async function prepareAvatarUpload(file){
  if(!file.type.startsWith('image/')||file.type==='image/gif')return file;
  if(!('createImageBitmap'in window))return file;
  const bitmap=await createImageBitmap(file);
  try{
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    if(scale===1&&file.size<=2*1024*1024)return file;
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d',{alpha:true});context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88));if(!blob)return file;
    return new File([blob],`${file.name.replace(/\.[^.]+$/,'')}.webp`,{type:'image/webp',lastModified:Date.now()});
  }finally{bitmap.close?.();}
}
