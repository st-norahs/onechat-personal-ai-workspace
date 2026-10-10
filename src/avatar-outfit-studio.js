const themes = ['princess','traditional Nigerian fashion','school style','fantasy','sportswear','cozy day','creative artist'];
const styles = ['classic','colorful','traditional Nigerian','school uniform','fantasy','sporty','cozy'];
const hairstyles = ['keep current hairstyle','natural braids','two puff buns','twists','headband style','short natural style'];
const accessories = ['none','small hair clips','headband','simple crown','beads','school backpack'];
const backgrounds = ['keep current background','school garden','sunny park','cozy bedroom','storybook castle','colorful studio','Lagos courtyard'];
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read = (key,fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key,value) => localStorage.setItem(key,JSON.stringify(value));
const options = values => values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
let parentToken=null;

export function mountOutfitStudio(host) {
  const studio=host.querySelector('.avatar-studio');
  studio.insertAdjacentHTML('beforeend',`<section class="outfit-studio" aria-labelledby="outfitTitle"><div class="outfit-heading"><div><div class="voice-eyebrow">SALT'S LOOKBOOK</div><h3 id="outfitTitle">Outfit of the day</h3></div><span class="outfit-budget" id="outfitBudget">Checking image budget…</span></div><p class="outfit-note">Choose the theme and look. Each image requires parent approval before its reference is sent to the image service. Existing outfits remain available without AI.</p><div class="outfit-options"><label>Daily theme<select id="outfitTheme">${options(themes)}</select></label><label>Clothing style<select id="outfitStyle">${options(styles)}</select></label><label>Hairstyle<select id="outfitHair">${options(hairstyles)}</select></label><label>Accessory<select id="outfitAccessory">${options(accessories)}</select></label><label>Background<select id="outfitBackground">${options(backgrounds)}</select></label><label>Identity reference<select id="outfitReference"><option value="">Choose a reference image</option></select></label></div><label class="outfit-approval"><input id="outfitApproval" type="checkbox" disabled><span>I’m the parent/guardian and approve one image edit using the selected reference. It is sent to Vercel AI Gateway for processing.</span></label><div class="outfit-controls"><button type="button" class="outfit-generate" id="outfitGenerate" disabled>Generate today's look</button><button type="button" class="outfit-browse" id="outfitBrowse">Use a saved outfit</button></div><div class="outfit-status" id="outfitStatus" role="status" aria-live="polite">Choose your preferences and a reference image.</div><div class="outfit-result" id="outfitResult" hidden></div><details class="parent-controls"><summary>Parent controls & look history</summary><div class="parent-control-copy"><strong id="parentState">Set or unlock Parent controls</strong><div class="parent-auth"><input id="parentPin" type="password" autocomplete="current-password" minlength="8" maxlength="64" placeholder="Parent PIN or passphrase"><button type="button" id="parentUnlock">Unlock</button></div><label class="parent-budget-label">Daily image limit<select id="parentBudget">${Array.from({length:10},(_,index)=>`<option value="${index+1}">${index+1} image${index===0?'':'s'} per day</option>`).join('')}</select></label><button type="button" class="parent-save-budget" id="parentSaveBudget" disabled>Save spending limit</button><span id="outfitLimit">Daily usage status loading…</span><label class="outfit-pause"><input id="outfitPause" type="checkbox"><span>Pause AI outfit generation on this device</span></label><p>Parent PIN is stored as a salted server-side hash. Unlock expires after 15 minutes. Images are sent to Vercel AI Gateway only after approval and are saved in the local avatar folder.</p></div><div class="outfit-history" id="outfitHistory"></div></details><div class="outfit-wardrobe" id="outfitWardrobe" hidden></div></section>`);
  host.querySelector('#outfitReference').closest('label').insertAdjacentHTML('afterend','<button type="button" id="cropIdentity" class="crop-identity" hidden>Prepare a single-person identity reference</button>');

  const prefs=read('salt.outfitPrefs',{});
  for(const [id,key] of [['outfitTheme','theme'],['outfitStyle','style'],['outfitHair','hairstyle'],['outfitAccessory','accessory'],['outfitBackground','background']])if(prefs[key])host.querySelector(`#${id}`).value=prefs[key];
  const pause=host.querySelector('#outfitPause');pause.checked=read('salt.outfitPaused',false);pause.onchange=()=>{write('salt.outfitPaused',pause.checked);setOutfitStatus(host,pause.checked?'AI generation paused. Saved outfits are still available.':'AI generation enabled for parent-approved requests.')};
  host.querySelectorAll('.outfit-options select').forEach(select=>select.onchange=savePrefs);
  host.querySelector('#outfitApproval').onchange=()=>{if(host.querySelector('#outfitApproval').checked)setOutfitStatus(host,'Parent approval recorded for this request. Choose Generate to continue.');};
  host.querySelector('#outfitGenerate').onclick=()=>generateOutfit(host);
  host.querySelector('#outfitBrowse').onclick=()=>showWardrobe(host);
  host.querySelector('#outfitReference').onchange=()=>savePrefs();
  host.querySelector('#cropIdentity').onclick=()=>cropShowcaseIdentity(host);
  host.querySelector('#parentUnlock').onclick=()=>parentLogin(host);
  host.querySelector('#parentSaveBudget').onclick=()=>saveBudget(host);
  refreshOutfitControls(host);
  renderHistory(host);
}

export function refreshOutfitReferences(host,library={}) {
  const select=host.querySelector('#outfitReference');if(!select)return;
  const refs=library.references||[],previous=select.value;
  select.innerHTML=refs.length?refs.map(item=>`<option value="${esc(item.name)}">${esc(item.name)}</option>`).join(''):'<option value="">Add a reference image in the Style references folder</option>';
  if(refs.some(item=>item.name===previous))select.value=previous;
  else if(refs.length)select.value=refs.find(item=>item.name.toLowerCase().includes('weekly'))?.name||refs[0].name;
  const crop=host.querySelector('#cropIdentity');if(crop)crop.hidden=!/weekly-avatar-showcase/i.test(select.value);
  savePrefs();
}

async function refreshOutfitControls(host) {
  try {
    const response=await fetch('/api/avatar/status',{cache:'no-store'}),status=await response.json();
    if(!response.ok)throw new Error(status.error||'Could not read the image service status.');
    host.querySelector('#outfitBudget').textContent=`${status.remaining} of ${status.limit} image${status.limit===1?'':'s'} left today`;
    host.querySelector('#outfitLimit').textContent=`${status.used} used · ${status.limit} per day · ${status.successes} successful · ${status.failures} failed.`;
    host.querySelector('#parentBudget').value=String(status.limit);
    host.querySelector('#parentState').textContent=status.parentConfigured?(parentToken?'Unlocked for 15 minutes':'Parent PIN set · unlock to approve or change budget'):'Create a Parent PIN to enable image requests';
    host.querySelector('#parentUnlock').textContent=status.parentConfigured?'Unlock':'Set Parent PIN';
    const button=host.querySelector('#outfitGenerate');button.disabled=!status.generationConfigured||!status.parentConfigured||!parentToken||read('salt.outfitPaused',false);
    host.querySelector('#outfitApproval').disabled=!status.parentConfigured||!parentToken;
    host.querySelector('#parentSaveBudget').disabled=!parentToken;
    if(!status.generationConfigured)setOutfitStatus(host,'Image generation needs the rotated server-side AI_GATEWAY_API_KEY. Use saved outfits in the meantime.');
    else if(!status.parentConfigured)setOutfitStatus(host,'A parent must set an 8-character-or-longer PIN in Parent controls before image generation.');
    else if(!parentToken)setOutfitStatus(host,'Unlock Parent controls to approve generation and manage the daily image limit.');
    else if(read('salt.outfitPaused',false))setOutfitStatus(host,'AI outfit generation is paused by Parent controls.');
  } catch(error) { setOutfitStatus(host,error.message); }
}

async function parentLogin(host){
  const pin=host.querySelector('#parentPin').value;if(pin.length<8){setOutfitStatus(host,'Use a Parent PIN or passphrase with at least 8 characters.');return}
  const status=await fetch('/api/avatar/status',{cache:'no-store'}).then(r=>r.json());
  const endpoint=status.parentConfigured?'/api/avatar/parent/unlock':'/api/avatar/parent/setup';
  try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})}),result=await response.json();if(!response.ok)throw new Error(result.error||'Could not unlock Parent controls.');parentToken=result.token;host.querySelector('#parentPin').value='';setOutfitStatus(host,status.parentConfigured?'Parent controls unlocked for 15 minutes.':'Parent PIN set. You can now approve outfit generation.');await refreshOutfitControls(host);}
  catch(error){setOutfitStatus(host,error.message)}
}

async function saveBudget(host){
  if(!parentToken){setOutfitStatus(host,'Unlock Parent controls first.');return}
  try{const response=await fetch('/api/avatar/parent/limit',{method:'POST',headers:{'Content-Type':'application/json','X-Salt-Parent-Token':parentToken},body:JSON.stringify({limit:Number(host.querySelector('#parentBudget').value)})}),result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save the daily budget.');setOutfitStatus(host,`Daily image limit set to ${result.limit}.`);await refreshOutfitControls(host);}
  catch(error){setOutfitStatus(host,error.message)}
}

function savePrefs(){
  const host=document.querySelector('#voiceExperienceHost');if(!host)return;
  const prefs={theme:host.querySelector('#outfitTheme').value,style:host.querySelector('#outfitStyle').value,hairstyle:host.querySelector('#outfitHair').value,accessory:host.querySelector('#outfitAccessory').value,background:host.querySelector('#outfitBackground').value,reference:host.querySelector('#outfitReference').value};
  write('salt.outfitPrefs',prefs);
}

function setOutfitStatus(host,text){const status=host.querySelector('#outfitStatus');if(status)status.textContent=text;}

async function cropShowcaseIdentity(host){
  const selected=host.avatarLibrary?.references?.find(item=>item.name===host.querySelector('#outfitReference').value);if(!selected)return;
  const button=host.querySelector('#cropIdentity');button.disabled=true;setOutfitStatus(host,'Preparing a private, single-person reference crop from the supplied showcase…');
  try{
    const image=new Image();image.src=selected.url;await image.decode();
    const sx=Math.round(image.naturalWidth*.25),sy=Math.round(image.naturalHeight*.35),sw=Math.round(image.naturalWidth*.5),sh=Math.round(image.naturalHeight*.35);
    const canvas=document.createElement('canvas');canvas.width=900;canvas.height=630;canvas.getContext('2d').drawImage(image,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.9));if(!blob)throw new Error('Could not prepare the reference crop.');
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the prepared crop.'));reader.readAsDataURL(blob)});
    const response=await fetch('/api/avatar/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:'references',filename:'salt-identity-reference.webp',mime:'image/webp',data:String(dataUrl).split(',')[1]})}),result=await response.json();if(!response.ok)throw new Error(result.error||'Could not save the reference crop.');
    window.dispatchEvent(new Event('salt:resources-changed'));setOutfitStatus(host,'Single-person identity crop saved locally and selected for outfit edits.');
    const libraryResponse=await fetch('/api/avatar/library',{cache:'no-store'}),libraryResult=await libraryResponse.json();refreshOutfitReferences(host,libraryResult.categories||{});host.querySelector('#outfitReference').value=result.asset.name;savePrefs();
  }catch(error){setOutfitStatus(host,`${error.message} You can still select another image from Style references.`)}
  finally{button.disabled=false;}
}

async function generateOutfit(host){
  const approval=host.querySelector('#outfitApproval');
  if(read('salt.outfitPaused',false)){setOutfitStatus(host,'AI outfit generation is paused.');return;}
  if(!approval.checked){setOutfitStatus(host,'Parent approval is required before an image request.');approval.focus();return;}
  const prefs=read('salt.outfitPrefs',{}),reference=host.querySelector('#outfitReference').value;
  if(!reference){setOutfitStatus(host,'Add or select a Salt image in Style references first.');return;}
  const button=host.querySelector('#outfitGenerate');button.disabled=true;button.textContent='Creating your look…';
  setOutfitStatus(host,'Preparing the approved reference…');
  try{
    const body={reference,theme:prefs.theme||themes[0],style:prefs.style||styles[0],hairstyle:prefs.hairstyle||hairstyles[0],accessory:prefs.accessory||accessories[0],background:prefs.background||backgrounds[0]};
    setOutfitStatus(host,'Sending one approved image edit. This can take a little while; keep Salt open.');
    const response=await fetch('/api/avatar/generate',{method:'POST',headers:{'Content-Type':'application/json','X-Salt-Parent-Token':parentToken},body:JSON.stringify(body)}),result=await response.json();
    if(!response.ok)throw new Error(result.error||'The outfit could not be generated.');
    const asset={...result.asset,createdAt:new Date().toISOString(),theme:body.theme,approved:false};host.pendingOutfit=asset;
    const panel=host.querySelector('#outfitResult');panel.hidden=false;panel.innerHTML=`<img src="${esc(asset.url)}" alt="Salt's generated outfit for review"><div class="outfit-review"><strong>Review this look</strong><span>Keep it in Favorites or discard it. It is stored in your local avatar library.</span><div><button type="button" data-outfit-approve>Approve & favorite</button><button type="button" data-outfit-discard>Discard</button></div></div>`;
    panel.querySelector('[data-outfit-approve]').onclick=()=>approveOutfit(host,asset);
    panel.querySelector('[data-outfit-discard]').onclick=()=>discardOutfit(host,asset);
    approval.checked=false;setOutfitStatus(host,`Image ready · ${result.usage.used}/${result.usage.limit} used today. Parent review is still needed.`);
    await refreshOutfitControls(host);
  }catch(error){setOutfitStatus(host,`${error.message} Existing outfits remain available.`);}
  finally{button.disabled=read('salt.outfitPaused',false);button.textContent='Generate today’s look';approval.checked=false;}
}

function approveOutfit(host,asset){
  asset.approved=true;const favorites=read('salt.outfitFavorites',[]);if(!favorites.some(item=>item.name===asset.name))favorites.unshift(asset);write('salt.outfitFavorites',favorites.slice(0,100));
  const history=read('salt.outfitHistory',[]);history.unshift(asset);write('salt.outfitHistory',history.slice(0,100));host.pendingOutfit=null;
  host.querySelector('#outfitResult').hidden=true;setOutfitStatus(host,'Approved and added to Favorites on this device.');renderHistory(host);window.dispatchEvent(new Event('salt:resources-changed'));
}

async function discardOutfit(host,asset){
  try{const response=await fetch('/api/avatar/generated/'+encodeURIComponent(asset.name),{method:'DELETE'});if(!response.ok){const result=await response.json();throw new Error(result.error||'Could not discard this look.');}navigator.serviceWorker?.controller?.postMessage({type:'DELETE_AVATAR_CACHE',url:asset.url});host.querySelector('#outfitResult').hidden=true;host.pendingOutfit=null;setOutfitStatus(host,'Discarded. Your remaining daily budget was not refunded.');window.dispatchEvent(new Event('salt:resources-changed'));await refreshOutfitControls(host);}
  catch(error){setOutfitStatus(host,`${error.message} The image remains in the local outfits folder.`)}
}

function renderHistory(host){
  const box=host.querySelector('#outfitHistory');if(!box)return;
  const favorites=read('salt.outfitFavorites',[]),history=read('salt.outfitHistory',[]);
  const merged=[...favorites.map(item=>({...item,favorite:true})),...history.filter(item=>!favorites.some(f=>f.name===item.name))].slice(0,8);
  box.innerHTML=merged.length?merged.map(item=>`<button type="button" class="outfit-history-card" data-look="${esc(item.url)}"><img src="${esc(item.url)}" alt="Saved Salt outfit"><span>${item.favorite?'★ Favorite':'Past look'} · ${esc(item.theme||'Daily look')}</span></button>`).join(''):'<p>No approved looks yet. Your favorites and past looks will appear here.</p>';
  box.querySelectorAll('[data-look]').forEach(button=>button.onclick=()=>{const url=button.dataset.look;const image=host.querySelector('#saltPortrait');host.querySelector('#saltGesture').hidden=true;image.src=url;image.hidden=false;host.activeAvatarURL=url;setOutfitStatus(host,'Showing a saved look.');});
}

async function showWardrobe(host){
  const box=host.querySelector('#outfitWardrobe');box.hidden=!box.hidden;if(box.hidden)return;
  try{
    const response=await fetch('/api/avatar/library',{cache:'no-store'}),result=await response.json();if(!response.ok)throw new Error(result.error||'Could not load saved outfits.');
    const assets=result.categories?.outfits||[];
    box.innerHTML=assets.length?assets.map(item=>`<button type="button" class="outfit-history-card" data-look="${esc(item.url)}"><img src="${esc(item.url)}" alt="Saved outfit"><span>${esc(item.name)}</span></button>`).join(''):'<p>No saved outfits yet. Add outfit images to the local outfits folder.</p>';
    box.querySelectorAll('[data-look]').forEach(button=>button.onclick=()=>{const image=host.querySelector('#saltPortrait');host.querySelector('#saltGesture').hidden=true;image.src=button.dataset.look;image.hidden=false;host.activeAvatarURL=button.dataset.look;setOutfitStatus(host,'Showing a saved outfit from the local wardrobe.');});
  }catch(error){box.innerHTML=`<p>${esc(error.message)}</p>`;}
}
