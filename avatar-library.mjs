import { mkdir, readdir, lstat, readFile, writeFile, rename, rm, unlink, realpath } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
export const avatarDataRoot = join(root, 'avatar-data');
const categories = ['portraits', 'outfits', 'hairstyles', 'gestures', 'speech', 'references'];
const categoryAllows = {
  portraits:new Set(['.png','.jpg','.jpeg','.webp','.gif']),
  outfits:new Set(['.png','.jpg','.jpeg','.webp','.gif']),
  hairstyles:new Set(['.png','.jpg','.jpeg','.webp','.gif']),
  gestures:new Set(['.png','.jpg','.jpeg','.webp','.gif','.mp4','.webm']),
  speech:new Set(['.mp3','.wav','.ogg','.m4a']),
  references:new Set(['.png','.jpg','.jpeg','.webp','.gif']),
};
const mediaTypes = {
  '.png': { mime:'image/png', signature:bytes=>bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  '.jpg': { mime:'image/jpeg', signature:bytes=>bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff },
  '.jpeg': { mime:'image/jpeg', signature:bytes=>bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff },
  '.webp': { mime:'image/webp', signature:bytes=>bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP' },
  '.gif': { mime:'image/gif', signature:bytes=>bytes.toString('ascii',0,3)==='GIF' },
  '.mp4': { mime:'video/mp4', signature:bytes=>bytes.toString('ascii',4,8)==='ftyp' },
  '.webm': { mime:'video/webm', signature:bytes=>bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) },
  '.mp3': { mime:'audio/mpeg', signature:bytes=>bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0) },
  '.wav': { mime:'audio/wav', signature:bytes=>bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE' },
  '.ogg': { mime:'audio/ogg', signature:bytes=>bytes.toString('ascii',0,4)==='OggS' },
  '.m4a': { mime:'audio/mp4', signature:bytes=>bytes.toString('ascii',4,8)==='ftyp' },
};
const maxBytes = 8 * 1024 * 1024;
const outfitModel = process.env.SALT_IMAGE_MODEL || 'openai/gpt-image-2';
const dailyGenerationLimit = Math.max(1, Math.min(10, Number.parseInt(process.env.SALT_AVATAR_DAILY_LIMIT || '1', 10) || 1));
const jobs = new Map();
const themes = new Set(['princess','traditional Nigerian fashion','school style','fantasy','sportswear','cozy day','creative artist']);
const styles = new Set(['classic','colorful','traditional Nigerian','school uniform','fantasy','sporty','cozy']);
const hairstyles = new Set(['keep current hairstyle','natural braids','two puff buns','twists','headband style','short natural style']);
const accessories = new Set(['none','small hair clips','headband','simple crown','beads','school backpack']);
const backgrounds = new Set(['keep current background','school garden','sunny park','cozy bedroom','storybook castle','colorful studio','Lagos courtyard']);
const generationFile = join(avatarDataRoot, 'generation-usage.json');
const parentFile = join(avatarDataRoot, 'parent-controls.json');
const parentSessions = new Map();

async function usageForToday() {
  try {
    const usage = JSON.parse(await readFile(generationFile, 'utf8'));
    return usage.day === new Date().toISOString().slice(0, 10) ? usage : { day:new Date().toISOString().slice(0, 10), count:0, successes:0, failures:0, limit:Number.isInteger(usage.limit)?usage.limit:dailyGenerationLimit };
  } catch { return { day:new Date().toISOString().slice(0, 10), count:0, successes:0, failures:0, limit:dailyGenerationLimit }; }
}
async function saveUsage(usage) {
  const temp = `${generationFile}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, JSON.stringify(usage), { flag:'wx' });
  try { await rename(temp, generationFile); } catch (error) { await rm(temp, { force:true }); throw error; }
}
function validateGeneration(body) {
  if (!body || typeof body !== 'object' || typeof body.reference !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(body.reference)) throw Object.assign(new Error('Choose a saved Salt reference image.'), { status:400 });
  const choices = { theme:themes, style:styles, hairstyle:hairstyles, accessory:accessories, background:backgrounds };
  for (const [key, allowed] of Object.entries(choices)) if (!allowed.has(body[key])) throw Object.assign(new Error(`Choose a supported ${key}.`), { status:400 });
}
async function readParentControls(){try{return JSON.parse(await readFile(parentFile,'utf8'))}catch{return null}}
function parentSession(token){const expires=parentSessions.get(token);if(!token||!expires||expires<Date.now()){if(token)parentSessions.delete(token);return false}return true}
async function issueParentSession(pin){
  if(typeof pin!=='string'||pin.length<8||pin.length>64)throw Object.assign(new Error('Use a parent PIN or passphrase with 8–64 characters.'),{status:400});
  const saved=await readParentControls();if(!saved||typeof saved.salt!=='string'||typeof saved.hash!=='string')throw Object.assign(new Error('Set a parent PIN first.'),{status:409});
  const actual=scryptSync(pin,Buffer.from(saved.salt,'base64'),64),expected=Buffer.from(saved.hash,'base64');
  if(expected.length!==actual.length||!timingSafeEqual(actual,expected))throw Object.assign(new Error('That parent PIN is incorrect.'),{status:403});
  const token=randomBytes(32).toString('base64url');parentSessions.set(token,Date.now()+15*60*1000);return token;
}
async function generateOutfit(body) {
  if (!process.env.AI_GATEWAY_API_KEY) throw Object.assign(new Error('Image generation is not configured. Add a rotated AI_GATEWAY_API_KEY to the local server .env, then restart Salt.'), { status:503 });
  validateGeneration(body);
  const extension = extname(body.reference).toLowerCase(), type = mediaTypes[extension];
  if (!type || !['.png','.jpg','.jpeg','.webp'].includes(extension)) throw Object.assign(new Error('The reference must be a PNG, JPEG, or WebP image.'), { status:415 });
  const referencePath = join(avatarDataRoot, 'references', body.reference);
  const stat = await lstat(referencePath).catch(()=>null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw Object.assign(new Error('The selected reference image is missing or too large.'), { status:404 });
  const reference = await readFile(referencePath);
  if (!type.signature(reference.subarray(0,16))) throw Object.assign(new Error('The reference image contents are invalid.'), { status:415 });
  const request = { model:outfitModel, reference:body.reference, theme:body.theme, style:body.style, hairstyle:body.hairstyle, accessory:body.accessory, background:body.background };
  const fingerprint = createHash('sha256').update(reference).update(JSON.stringify(request)).digest('hex');
  const filename = `salt-generated-${fingerprint.slice(0,24)}.png`;
  const target = join(avatarDataRoot, 'outfits', filename);
  const currentUsage = await usageForToday(),limit=currentUsage.limit||dailyGenerationLimit;
  if (currentUsage.count >= limit && !(await lstat(target).catch(()=>null))) throw Object.assign(new Error(`Today's image budget is used (${currentUsage.count}/${limit}). A parent can adjust the daily limit in Parent controls.`), { status:429 });
  const cached = await lstat(target).catch(()=>null);
  if (cached?.isFile() && cached.size <= maxBytes) return { asset:{ name:filename, url:`/avatar/outfits/${filename}`, type:'image/png', size:cached.size, cached:true }, usage:{ used:currentUsage.count, limit, remaining:Math.max(0,limit-currentUsage.count) } };
  if (jobs.has(fingerprint)) return jobs.get(fingerprint);
  const promise = (async()=>{
    const usage = await usageForToday();
    const requestLimit=usage.limit||dailyGenerationLimit;
    if (usage.count >= requestLimit) throw Object.assign(new Error(`Today's image budget is used (${usage.count}/${requestLimit}). A parent can adjust the daily limit in Parent controls.`), { status:429 });
    const safeText = `Edit the supplied image to create one child-safe daily outfit portrait for the same child. Preserve the child's exact facial identity, age-appropriate appearance, skin tone, facial features, and natural proportions. Keep the child fully clothed. Do not change facial identity or make the child look older. Outfit theme: ${body.theme}. Clothing style: ${body.style}. Hairstyle: ${body.hairstyle}. Accessory: ${body.accessory}. Background: ${body.background}. Keep the framing, expression, and pose close to the reference. Photorealistic, warm, respectful, age-appropriate. No text, logos, revealing clothing, adult styling, makeup, or suggestive poses.`;
    const form = new FormData();
    form.append('model', outfitModel);
    form.append('prompt', safeText);
    form.append('output_format', 'png');
    form.append('image', new Blob([reference], { type:type.mime }), body.reference);
    const started = Date.now();
    let response;
    try { response = await fetch('https://ai-gateway.vercel.sh/v1/images/edits', { method:'POST', headers:{ Authorization:`Bearer ${process.env.AI_GATEWAY_API_KEY}` }, body:form, signal:AbortSignal.timeout(120000) }); }
    catch { usage.failures++; await saveUsage(usage); throw Object.assign(new Error('Image service could not be reached. Your reference stays in the local library; try again when online.'), { status:502 }); }
    if (!response.ok) { usage.failures++; await saveUsage(usage); throw Object.assign(new Error(response.status===429?'Image service rate limit reached. Try again later.':`Image generation failed (${response.status}). No outfit was saved.`), { status:response.status===429?429:502 }); }
    const result = await response.json();
    const imageData = result?.data?.[0]?.b64_json;
    if (typeof imageData !== 'string' || imageData.length > Math.ceil(maxBytes*4/3)+16) { usage.failures++; await saveUsage(usage); throw Object.assign(new Error('Image service returned an unsupported or oversized result.'), { status:502 }); }
    const output = Buffer.from(imageData, 'base64');
    const png = mediaTypes['.png'];
    if (!output.length || output.length > maxBytes || output.toString('base64').replace(/=+$/,'')!==imageData.replace(/=+$/,'') || !png.signature(output.subarray(0,16))) { usage.failures++; await saveUsage(usage); throw Object.assign(new Error('Generated image failed validation and was not saved.'), { status:502 }); }
    await ensureAvatarLibrary();
    const temp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temp, output, { flag:'wx' });
    try { await rename(temp,target); } catch (error) { await rm(temp,{force:true}); if (!(await lstat(target).catch(()=>null))) throw error; }
    usage.count++; usage.successes++; usage.lastDurationMs=Date.now()-started; await saveUsage(usage);
    return { asset:{ name:filename, url:`/avatar/outfits/${filename}`, type:'image/png', size:output.length, cached:false }, usage:{ used:usage.count, limit:requestLimit, remaining:Math.max(0,requestLimit-usage.count) } };
  })();
  jobs.set(fingerprint,promise);
  try { return await promise; } finally { jobs.delete(fingerprint); }
}

export async function ensureAvatarLibrary() {
  await Promise.all(categories.map(category=>mkdir(join(avatarDataRoot,category),{recursive:true})));
}

async function listLibrary() {
  await ensureAvatarLibrary();
  const library={};
  for(const category of categories) {
    const files=[];
    for(const name of await readdir(join(avatarDataRoot,category))) {
      if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(name))continue;
      const extension=extname(name).toLowerCase(),type=mediaTypes[extension];if(!type||!categoryAllows[category].has(extension))continue;
      const path=join(avatarDataRoot,category,name);const info=await lstat(path).catch(()=>null);
      if(!info?.isFile()||info.isSymbolicLink()||info.size>maxBytes)continue;
      files.push({name,url:`/avatar/${category}/${encodeURIComponent(name)}`,type:type.mime,size:info.size,updatedAt:info.mtime.toISOString()});
    }
    files.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));library[category]=files;
  }
  return library;
}

export async function handleAvatarApi(req,pathname,readJson,send,checkOrigin) {
  if(req.method==='GET'&&pathname==='/api/avatar/status') {
    const usage=await usageForToday();
    const limit=usage.limit||dailyGenerationLimit,parent=await readParentControls();
    return send(200,{generationConfigured:Boolean(process.env.AI_GATEWAY_API_KEY),model:outfitModel,parentConfigured:Boolean(parent),limit,used:usage.count,remaining:Math.max(0,limit-usage.count),successes:usage.successes,failures:usage.failures});
  }
  if(req.method==='POST'&&pathname==='/api/avatar/parent/setup') {
    checkOrigin(req);const body=await readJson(req,4096);
    if(await readParentControls())throw Object.assign(new Error('A parent PIN is already set. Enter it to unlock controls.'),{status:409});
    if(typeof body.pin!=='string'||body.pin.length<8||body.pin.length>64)throw Object.assign(new Error('Use a parent PIN or passphrase with 8–64 characters.'),{status:400});
    const salt=randomBytes(16),hash=scryptSync(body.pin,salt,64);await ensureAvatarLibrary();
    await writeFile(parentFile,JSON.stringify({salt:salt.toString('base64'),hash:hash.toString('base64'),createdAt:new Date().toISOString()}),{flag:'wx'});
    const token=randomBytes(32).toString('base64url');parentSessions.set(token,Date.now()+15*60*1000);return send(201,{token,expiresIn:900});
  }
  if(req.method==='POST'&&pathname==='/api/avatar/parent/unlock') {
    checkOrigin(req);const body=await readJson(req,4096);return send(200,{token:await issueParentSession(body.pin),expiresIn:900});
  }
  if(req.method==='POST'&&pathname==='/api/avatar/parent/limit') {
    checkOrigin(req);if(!parentSession(req.headers['x-salt-parent-token']))throw Object.assign(new Error('Unlock Parent controls again to change the image budget.'),{status:401});
    const body=await readJson(req,4096);if(!Number.isInteger(body.limit)||body.limit<1||body.limit>10)throw Object.assign(new Error('Choose a daily image limit from 1 to 10.'),{status:400});
    const usage=await usageForToday();usage.limit=body.limit;await saveUsage(usage);return send(200,{limit:body.limit,used:usage.count,remaining:Math.max(0,body.limit-usage.count)});
  }
  if(req.method==='POST'&&pathname==='/api/avatar/generate') {
    checkOrigin(req);if(!parentSession(req.headers['x-salt-parent-token']))return send(401,{error:'Unlock Parent controls before requesting an outfit image.'});
    try { return send(200,await generateOutfit(await readJson(req,64*1024))); }
    catch(error) { return send(error.status||502,{error:error.status?error.message:'The outfit could not be generated. Try again later.'}); }
  }
  if(req.method==='GET'&&pathname==='/api/avatar/library')return send(200,{categories:await listLibrary()});
  if(req.method==='GET'&&pathname==='/api/avatar/export') {
    const library=await listLibrary(),assets=[];let total=0;
    for(const [category,files] of Object.entries(library))for(const asset of files) {
      const bytes=await readFile(join(avatarDataRoot,category,asset.name));total+=bytes.length;
      if(total>12*1024*1024)throw Object.assign(new Error('Avatar media exceeds the 12 MB encrypted sync limit. Remove unused assets and retry.'),{status:413});
      assets.push({category,name:asset.name,type:asset.type,data:bytes.toString('base64')});
    }
    return send(200,{assets});
  }
  if(req.method==='POST'&&pathname==='/api/avatar/restore') {
    checkOrigin(req);const body=await readJson(req,12*1024*1024);
    if(!categories.includes(body.category)||typeof body.filename!=='string'||basename(body.filename)!==body.filename||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(body.filename))throw Object.assign(new Error('Invalid avatar restore path.'),{status:400});
    const extension=extname(body.filename).toLowerCase(),type=mediaTypes[extension];
    if(!type||!categoryAllows[body.category].has(extension)||typeof body.data!=='string'||body.data.length>Math.ceil(maxBytes*4/3)+8)throw Object.assign(new Error('Unsupported avatar asset or file too large.'),{status:413});
    const bytes=Buffer.from(body.data,'base64');
    if(!bytes.length||bytes.length>maxBytes||bytes.toString('base64').replace(/=+$/,'')!==body.data.replace(/=+$/,'')||!type.signature(bytes.subarray(0,16)))throw Object.assign(new Error('Avatar contents do not match the supported file type.'),{status:415});
    await ensureAvatarLibrary();const target=join(avatarDataRoot,body.category,body.filename),temp=`${target}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temp,bytes,{flag:'wx'});try{await rename(temp,target)}catch(error){await rm(temp,{force:true});throw error}
    return send(200,{restored:true});
  }
  if(req.method==='POST'&&pathname==='/api/avatar/upload') {
    checkOrigin(req);
    const body=await readJson(req,12*1024*1024);
    if(!categories.includes(body.category))throw Object.assign(new Error('Choose an avatar library folder.'),{status:400});
    if(typeof body.filename!=='string'||basename(body.filename)!==body.filename)throw Object.assign(new Error('Invalid upload filename.'),{status:400});
    const extension=extname(body.filename).toLowerCase(),type=mediaTypes[extension];
    if(!type||!categoryAllows[body.category].has(extension))throw Object.assign(new Error('That media type is not supported in this avatar folder.'),{status:415});
    if(typeof body.data!=='string'||body.data.length>Math.ceil(maxBytes*4/3)+8)throw Object.assign(new Error('Avatar assets are limited to 8 MB.'),{status:413});
    const bytes=Buffer.from(body.data,'base64');
    if(!bytes.length||bytes.length>maxBytes||bytes.toString('base64').replace(/=+$/,'')!==body.data.replace(/=+$/,''))throw Object.assign(new Error('Invalid avatar file data or file too large.'),{status:413});
    if(!type.signature(bytes.subarray(0,16)))throw Object.assign(new Error('The file contents do not match their file type.'),{status:415});
    await ensureAvatarLibrary();
    const digest=createHash('sha256').update(bytes).digest('hex').slice(0,20);
    const stem=basename(body.filename,extname(body.filename)).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30)||'salt-avatar';
    const unique=`${stem}-${digest}${extension}`;
    const target=join(avatarDataRoot,body.category,unique);
    try{await writeFile(target,bytes,{flag:'wx'})}catch(error){if(error.code!=='EEXIST')throw error}
    return send(200,{asset:{name:unique,url:`/avatar/${body.category}/${encodeURIComponent(unique)}`,type:type.mime,size:bytes.length,cached:true}});
  }
  if(req.method==='DELETE'&&pathname.startsWith('/api/avatar/generated/')) {
    checkOrigin(req);const name=pathname.slice('/api/avatar/generated/'.length);
    if(!/^salt-generated-[a-f0-9]{24}\.png$/.test(name))throw Object.assign(new Error('Only generated outfit previews can be discarded here.'),{status:400});
    const path=join(avatarDataRoot,'outfits',name);const info=await lstat(path).catch(()=>null);
    if(!info?.isFile()||info.isSymbolicLink())return send(404,{error:'Generated outfit not found.'});
    await unlink(path);return send(200,{deleted:true});
  }
  return false;
}

export async function serveAvatarAsset(res,pathname) {
  const match=pathname.match(/^\/avatar\/(portraits|outfits|hairstyles|gestures|speech|references)\/([A-Za-z0-9][A-Za-z0-9._-]{0,95})$/);
  if(!match)return false;
  const [,category,name]=match,extension=extname(name).toLowerCase(),type=mediaTypes[extension];if(!type){res.writeHead(404);res.end();return true;}
  try {
    const directory=await realpath(join(avatarDataRoot,category));const path=join(directory,name);
    const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>maxBytes)throw new Error('Invalid asset');
    const bytes=await readFile(path);if(!type.signature(bytes.subarray(0,16)))throw new Error('Invalid media signature');
    res.writeHead(200,{'Content-Type':type.mime,'Content-Length':bytes.length,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});res.end(bytes);return true;
  } catch {res.writeHead(404,{'Cache-Control':'no-store'});res.end('Avatar asset unavailable.');return true;}
}
