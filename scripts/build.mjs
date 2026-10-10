import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const buildDirectory = join(projectRoot, 'build');
await rm(buildDirectory, { recursive:true, force:true });
await mkdir(buildDirectory, { recursive:true });
await build({
  absWorkingDir:projectRoot, entryPoints:[join(projectRoot,'src/main.js')], bundle:true, splitting:true, format:'esm', platform:'browser', target:['es2022'],
  outdir:buildDirectory, entryNames:'main', chunkNames:'chunks/[name]-[hash]', assetNames:'[name]-[hash]',
  minify:true, sourcemap:false, legalComments:'none', metafile:true,
});
