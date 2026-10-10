import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { dirname, extname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('.', import.meta.url));
const workspaceRoot = join(root, 'workspaces');
const runtimeImages = {
  node:'node:22-alpine', python:'python:3.13-alpine', go:'golang:alpine', rust:'rust:alpine',
  java:'maven:3-eclipse-temurin-21', cpp:'gcc:14', php:'php:8.4-cli-alpine', ruby:'ruby:3.4-alpine',
  dotnet:'mcr.microsoft.com/dotnet/sdk:8.0', deno:'denoland/deno:alpine',
};
const allowedExtensions = new Set(['.html','.htm','.css','.js','.mjs','.cjs','.ts','.tsx','.jsx','.json','.md','.txt','.svg','.xml','.yml','.yaml','.toml','.py','.go','.rs','.java','.c','.h','.cpp','.hpp','.cc','.cs','.csproj','.php','.rb','.sh','.sql']);
const staticFiles = new Set(['index.html','manifest.webmanifest','favicon.svg','sw.js','build/main.js','build/main.css']);

function validProject(value) { return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value); }
function validRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  const parts=value.split('/');
  return parts.every(part=>part && part!=='.' && part!=='..' && !part.startsWith('.') && /^[A-Za-z0-9 _.-]+$/.test(part)) && allowedExtensions.has(extname(value).toLowerCase());
}
function getProject(value) {
  if (!validProject(value)) throw Object.assign(new Error('Invalid project name.'),{status:400});
  return join(workspaceRoot,value);
}
async function ensureProject(name) {
  const directory=getProject(name);
  await mkdir(directory,{recursive:true});
  if(name==='onechat-starter') {
    const files=await readdir(directory).catch(()=>[]);
    if(!files.length) {
      await writeFile(join(directory,'index.html'),'<!doctype html>\n<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>My first app</title><link rel="stylesheet" href="style.css"><main><h1>Hello from Salt</h1><p>Edit index.html, style.css, and app.js.</p></main><script src="app.js"></script></html>\n','utf8');
      await writeFile(join(directory,'style.css'),'body{font:18px system-ui;max-width:680px;margin:12vh auto;padding:24px;background:#111611;color:#ecf0e9}h1{color:#d5ed91}\n','utf8');
      await writeFile(join(directory,'app.js'),'console.log("Hello from the Salt project preview.");\n','utf8');
    }
  }
  return directory;
}
function ensureInside(base,target) { const rel=relative(base,target);if(rel.startsWith('..')||isAbsolute(rel))throw Object.assign(new Error('Path is outside the project folder.'),{status:400}); }
async function safeFile(project,name,{create=false}={}) {
  if(!validRelativePath(name))throw Object.assign(new Error('Use a supported filename without hidden folders or path traversal.'),{status:400});
  const base=await realpath(await ensureProject(project));const target=resolve(base,...name.split('/'));ensureInside(base,target);
  let cursor=base;
  for(const segment of name.split('/')) {
    cursor=join(cursor,segment);
    try { const info=await lstat(cursor);if(info.isSymbolicLink())throw Object.assign(new Error('Symbolic links are not supported in the workspace.'),{status:400}); }
    catch(error) { if(error.code==='ENOENT'&&create)continue;if(error.code==='ENOENT')throw Object.assign(new Error('File not found.'),{status:404});throw error; }
  }
  return {base,target};
}
async function walk(directory, prefix='') {
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(entry.name.startsWith('.')||entry.isSymbolicLink()||['node_modules','vendor','target','dist','build','coverage','bin','obj','__pycache__','.next'].includes(entry.name))continue;
    const path=prefix?`${prefix}/${entry.name}`:entry.name;
    if(entry.isDirectory())result.push(...await walk(join(directory,entry.name),path));
    else if(allowedExtensions.has(extname(entry.name).toLowerCase()))result.push({path});
  }
  return result.sort((a,b)=>a.path.localeCompare(b.path));
}
async function command(executable,args,{cwd,timeout=120000,stdin,env=cleanEnvironment(),outputLimit=512*1024}={}) {
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(executable,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
    let output='',timedOut=false;
    const append=chunk=>{if(output.length<outputLimit)output+=chunk.toString('utf8').slice(0,outputLimit-output.length);};
    child.stdout.on('data',append);child.stderr.on('data',append);
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeout);
    child.on('error',error=>{clearTimeout(timer);reject(Object.assign(new Error(`Could not start ${executable}: ${error.message}`),{status:503}));});
    child.on('close',code=>{clearTimeout(timer);resolvePromise({exitCode:timedOut?124:(code??1),output:timedOut?`${output}\nProcess stopped after the time limit.`:output});});
    if(stdin)child.stdin.end(stdin);else child.stdin.end();
  });
}
async function dockerStatus() {
  try { await execFileAsync('docker',['info','--format','{{.ServerVersion}}'],{timeout:3500,windowsHide:true});return true; } catch { return false; }
}
async function codexPath() {
  const configured=process.env.CODEX_CLI_PATH;
  if(configured)return configured;
  try { const result=await execFileAsync('where.exe',['codex'],{timeout:2500,windowsHide:true});return result.stdout.trim().split(/\r?\n/)[0]||''; } catch { return ''; }
}
async function imageNames() { try {const {stdout}=await execFileAsync('docker',['images','--format','{{.Repository}}:{{.Tag}}'],{timeout:3500,windowsHide:true});return stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);}catch{return [];} }
function shellCommand(runtime, operation, path) {
  if(operation==='run') {
    if(runtime==='node')return ['node',`/workspace/${path}`];
    if(runtime==='python')return ['python',`/workspace/${path}`];
    if(runtime==='go')return ['go','run',`/workspace/${path}`];
    if(runtime==='rust')return ['sh','-lc',`rustc /workspace/${path} -o /tmp/salt-app && /tmp/salt-app`];
    if(runtime==='java')return ['sh','-lc',`mkdir -p /tmp/salt-classes && javac -d /tmp/salt-classes /workspace/${path} && java -cp /tmp/salt-classes Main`];
    if(runtime==='cpp')return ['sh','-lc',`g++ -std=c++20 -O2 /workspace/${path} -o /tmp/salt-app && /tmp/salt-app`];
    if(runtime==='php')return ['php',`/workspace/${path}`];
    if(runtime==='ruby')return ['ruby',`/workspace/${path}`];
    if(runtime==='dotnet')return ['dotnet','run','--project',`/workspace/${path}`];
    if(runtime==='deno')return ['deno','run','--no-prompt','--no-remote',`/workspace/${path}`];
  }
  const install={
    node:['sh','-lc','if [ -f package.json ]; then npm install --ignore-scripts --no-audit --no-fund; else echo "Create package.json first."; exit 2; fi'],
    python:['sh','-lc','if [ -f requirements.txt ]; then python -m pip install --disable-pip-version-check -r requirements.txt; else echo "Create requirements.txt first."; exit 2; fi'],
    go:['sh','-lc','if [ -f go.mod ]; then go mod download; else echo "Create go.mod first."; exit 2; fi'],
    rust:['sh','-lc','if [ -f Cargo.toml ]; then cargo fetch; else echo "Create Cargo.toml first."; exit 2; fi'],
    java:['sh','-lc','if [ -f pom.xml ]; then mvn -B dependency:go-offline; elif [ -f build.gradle ]; then gradle dependencies; else echo "Add pom.xml or build.gradle first."; exit 2; fi'],
    cpp:['sh','-lc','echo "Compiler tools are included in this image; add project dependencies to a build file."'],
    php:['sh','-lc','if [ -f composer.json ]; then composer install --no-interaction --no-scripts; else echo "Create composer.json first."; exit 2; fi'],
    ruby:['sh','-lc','if [ -f Gemfile ]; then bundle install --jobs 2; else echo "Create Gemfile first."; exit 2; fi'],
    dotnet:['sh','-lc',`dotnet restore /workspace/${path}`],
    deno:['sh','-lc','if [ -f deno.json ]; then deno install --entrypoint deno.json; else echo "Create deno.json first."; exit 2; fi'],
  };
  return install[runtime];
}
async function runDocker(runtime, project, operation, path='') {
  const image=runtimeImages[runtime];if(!image)throw Object.assign(new Error('Unsupported language runtime.'),{status:400});
  const directory=await ensureProject(project);const mountPath=directory.replaceAll('\\','/');const dockerArgs=['run','--rm','--network',operation==='install'?'bridge':'none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--memory=768m','--cpus=1','--tmpfs','/tmp:rw,noexec,nosuid,size=128m','--mount',`type=bind,source=${mountPath},target=/workspace,rw`,'--workdir','/workspace','--user','1000:1000'];
  dockerArgs.push(image,...shellCommand(runtime,operation,path));
  return command('docker',dockerArgs,{cwd:directory,timeout:operation==='install'?600000:120000,outputLimit:512*1024});
}
function cleanEnvironment() {
  const keep=['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','APPDATA','CODEX_HOME'];
  return Object.fromEntries(keep.filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
}
export async function handleDevApi(req,res,pathname,readJson,send,checkOrigin) {
  if(req.method==='GET'&&pathname==='/api/dev/status') {
    const [docker,codex,images,dockerCli]=await Promise.all([dockerStatus(),codexPath(),imageNames(),execFileAsync('where.exe',['docker'],{timeout:2500,windowsHide:true}).then(result=>result.stdout.trim()).catch(()=> '')]);
    return send(200,{docker,dockerInstalled:Boolean(dockerCli),codex:Boolean(codex),images:Object.values(runtimeImages).filter(image=>images.includes(image)),runtimes:Object.keys(runtimeImages)});
  }
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&pathname==='/api/dev/export') {
    await mkdir(workspaceRoot,{recursive:true});
    const entries=await readdir(workspaceRoot,{withFileTypes:true});const projects=[];let total=0;
    for(const entry of entries) {
      if(!entry.isDirectory()||entry.isSymbolicLink()||!validProject(entry.name))continue;
      const directory=await realpath(join(workspaceRoot,entry.name));const files=[];
      for(const item of await walk(directory)) {
        const {target}=await safeFile(entry.name,item.path);const info=await lstat(target);
        if(!info.isFile()||info.size>512*1024)continue;
        total+=info.size;if(total>10*1024*1024)throw Object.assign(new Error('Coding projects exceed the 10 MB sync limit. Remove generated files and retry.'),{status:413});
        files.push({path:item.path,content:await readFile(target,'utf8')});
      }
      if(files.length)projects.push({name:entry.name,files});
    }
    return send(200,{projects});
  }
  if(req.method==='POST'&&pathname==='/api/dev/import') {
    checkOrigin(req);const body=await readJson(req,22*1024*1024);
    if(!Array.isArray(body.projects)||body.projects.length>100)throw Object.assign(new Error('Invalid project archive.'),{status:400});
    const writes=[];let total=0;const seen=new Set();
    for(const project of body.projects) {
      if(!validProject(project?.name)||!Array.isArray(project.files)||project.files.length>2000)throw Object.assign(new Error('Invalid project archive.'),{status:400});
      for(const file of project.files) {
        if(!validRelativePath(file?.path)||typeof file.content!=='string'||Buffer.byteLength(file.content)>512*1024)throw Object.assign(new Error('A project file is invalid or too large.'),{status:400});
        total+=Buffer.byteLength(file.content);if(total>10*1024*1024)throw Object.assign(new Error('Coding projects exceed the 10 MB sync limit.'),{status:413});
        const key=`${project.name}/${file.path}`;if(seen.has(key))throw Object.assign(new Error('Project archive contains duplicate file paths.'),{status:400});seen.add(key);
        const {base,target}=await safeFile(project.name,file.path,{create:true});ensureInside(base,target);writes.push({base,target,content:file.content});
      }
    }
    for(const item of writes){await mkdir(dirname(item.target),{recursive:true});ensureInside(item.base,resolve(item.target));await writeFile(item.target,item.content,'utf8');}
    return send(200,{projects:body.projects.length,files:writes.length});
  }
  if(req.method==='GET'&&pathname==='/api/dev/files') {
    const project=url.searchParams.get('project')||'onechat-starter';const directory=await ensureProject(project);return send(200,{files:await walk(directory)});
  }
  if(req.method==='GET'&&pathname==='/api/dev/file') {
    const project=url.searchParams.get('project')||'onechat-starter';const path=url.searchParams.get('path')||'';const {target}=await safeFile(project,path);const info=await lstat(target);if(!info.isFile()||info.size>512*1024)throw Object.assign(new Error('Files are limited to 512 KB in the editor.'),{status:413});return send(200,{content:await readFile(target,'utf8')});
  }
  if(req.method==='PUT'&&pathname==='/api/dev/file') {
    checkOrigin(req);const body=await readJson(req,1024*1024);if(typeof body.content!=='string'||Buffer.byteLength(body.content)>512*1024)throw Object.assign(new Error('Files are limited to 512 KB.'),{status:413});
    const {base,target}=await safeFile(body.project,body.path,{create:true});await mkdir(dirname(target),{recursive:true});ensureInside(base,resolve(target));await writeFile(target,body.content,'utf8');return send(200,{message:'Saved.'});
  }
  if(req.method==='POST'&&pathname==='/api/dev/status') { checkOrigin(req);return send(405,{error:'Method not allowed.'}); }
  if(req.method==='POST'&&['/api/dev/run','/api/dev/install-dependencies','/api/dev/install-runtime','/api/dev/agent'].includes(pathname)) {
    checkOrigin(req);const body=await readJson(req,64*1024);
    if(pathname==='/api/dev/install-runtime') {
      const image=runtimeImages[body.runtime];if(!image)throw Object.assign(new Error('Unsupported language runtime.'),{status:400});const result=await command('docker',['pull',image],{timeout:600000});return send(result.exitCode?502:200,result);
    }
    if(pathname==='/api/dev/run'||pathname==='/api/dev/install-dependencies') {
      const operation=pathname.endsWith('/run')?'run':'install';const {runtime,project}=body;
      if(operation==='run') { const {target}=await safeFile(project,body.path);if(!(await lstat(target)).isFile())throw Object.assign(new Error('Select a regular project file.'),{status:400}); }
      if(!(await dockerStatus()))throw Object.assign(new Error('Docker Desktop is not running. Start Docker Desktop and retry.'),{status:503});
      const result=await runDocker(runtime,project,operation,body.path||'');return send(200,result);
    }
    if(pathname==='/api/dev/agent') {
      const prompt=body.prompt;if(typeof prompt!=='string'||!prompt.trim()||prompt.length>12000)throw Object.assign(new Error('Describe the coding task in 1–12,000 characters.'),{status:400});
      const binary=await codexPath();if(!binary)throw Object.assign(new Error('Codex CLI is not installed or not on PATH for this OneChat server.'),{status:503});
      const directory=await ensureProject(body.project);const args=['exec','--ignore-user-config','--ephemeral','--json','--sandbox','workspace-write','--cd',directory,'-'];
      const result=await command(binary,args,{cwd:directory,stdin:prompt,env:cleanEnvironment(),timeout:600000,outputLimit:1024*1024});return send(result.exitCode?502:200,result);
    }
  }
  return false;
}

export async function serveProjectPreview(res,pathname,sendError) {
  const match=pathname.match(/^\/workspace\/([a-z0-9][a-z0-9-]{0,31})\/(.+)$/);if(!match)return false;
  try {
    const {base,target}=await safeFile(match[1],match[2]);const info=await lstat(target);if(!info.isFile()||info.size>2*1024*1024)throw new Error('Preview file too large or not a regular file.');
    const types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
    const content=await readFile(target);res.writeHead(200,{'Content-Type':types[extname(target).toLowerCase()]||'text/plain; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox allow-scripts allow-forms allow-popups; default-src 'self' data: blob: https:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"});res.end(content);return true;
  } catch(error) { sendError(error);return true; }
}
export { staticFiles };
