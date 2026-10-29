import { mkdir,readdir,readFile,writeFile,copyFile,rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const revision=process.env.LOAMS_TRACE_DATA_REVISION;
if(!/^[a-f0-9]{40}$/.test(revision??''))throw new Error('Set LOAMS_TRACE_DATA_REVISION to the immutable data commit used for VITE_TRACE_DATA_URL.');
await rm('site',{recursive:true,force:true});await mkdir('site',{recursive:true});
const files=[];
async function copy(from,relative){
  const target=path.join('site',relative);await mkdir(path.dirname(target),{recursive:true});await copyFile(from,target);
  const bytes=await readFile(target);files.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(const file of ['index.html','_headers','THIRD_PARTY_NOTICES.txt'])await copy(path.join('dist',file),file);
for(const folder of ['assets','wasm'])for(const file of await readdir(path.join('dist',folder)))await copy(path.join('dist',folder,file),path.join(folder,file));
await writeFile('site/manifest.json',JSON.stringify({schemaVersion:1,dataRevision:revision,files},null,2)+'\n');
console.log('Prepared website assets:',files.length,'files. Raw data remains in the pinned archive revision.');
