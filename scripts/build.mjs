import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { build as buildWeb } from 'vite';
const root=process.cwd(); const src=path.join(root,'public'); const dist=path.join(root,'dist');
await fs.rm(dist,{recursive:true,force:true}); await fs.mkdir(dist,{recursive:true});
for(const item of await fs.readdir(src,{withFileTypes:true})){
  if(item.name==='index.template.html') continue;
  await fs.cp(path.join(src,item.name),path.join(dist,item.name),{recursive:true});
}
await fs.copyFile(path.join(src,'index.template.html'),path.join(dist,'index.html'));
await buildWeb({configFile:path.join(root,'vite.config.ts'),logLevel:'warn'});
const viteManifestDir=path.join(dist,'.vite');
const viteManifest=JSON.parse(await fs.readFile(path.join(viteManifestDir,'manifest.json'),'utf8'));
const islandsEntry=Object.values(viteManifest).find(entry=>entry.isEntry&&entry.name==='erp-islands');
if(!islandsEntry)throw new Error('Pacote das telas React do ERP (erp-islands) não foi gerado.');
await fs.rm(viteManifestDir,{recursive:true,force:true});
async function filesOf(dir){
  const out=[];
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...await filesOf(full));else out.push(full);
  }
  return out;
}
const hash=crypto.createHash('sha256');
for(const file of (await filesOf(dist)).filter(f=>f!==path.join(dist,'index.html')).sort()){
  hash.update(path.relative(dist,file));hash.update(await fs.readFile(file));
}
const contentRevision=hash.digest('hex').slice(0,10);
const indexPath=path.join(dist,'index.html');
const indexHtml=await fs.readFile(indexPath,'utf8');
await fs.writeFile(indexPath,indexHtml.replace(/\?v=([^"&]+)/g,(_,rev)=>'?v='+rev+'-'+contentRevision));
const bootstrapPath=path.join(dist,'app','bootstrap.js');
const bootstrapJs=await fs.readFile(bootstrapPath,'utf8');
if(!/const assetRevision = '[^']+';/.test(bootstrapJs))throw new Error('assetRevision não encontrado em bootstrap.js');
if(!bootstrapJs.includes("const webIslandsEntry = '';"))throw new Error('webIslandsEntry não encontrado em bootstrap.js');
if(!bootstrapJs.includes('const webIslandsStyles = [];'))throw new Error('webIslandsStyles não encontrado em bootstrap.js');
const islandsStyles=(islandsEntry.css||[]).map(file=>'/'+file);
await fs.writeFile(bootstrapPath,bootstrapJs
  .replace(/const assetRevision = '([^']+)';/,(_,rev)=>"const assetRevision = '"+rev+'-'+contentRevision+"';")
  .replace("const webIslandsEntry = '';","const webIslandsEntry = '/"+islandsEntry.file+"';")
  .replace('const webIslandsStyles = [];','const webIslandsStyles = '+JSON.stringify(islandsStyles)+';'));
console.log('Build estático gerado em dist/ (legado + telas React).');
