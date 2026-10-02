import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(); const src=path.join(root,'public'); const dist=path.join(root,'dist');
await fs.rm(dist,{recursive:true,force:true}); await fs.mkdir(dist,{recursive:true});
for(const item of await fs.readdir(src,{withFileTypes:true})){
  if(item.name==='index.template.html') continue;
  await fs.cp(path.join(src,item.name),path.join(dist,item.name),{recursive:true});
}
await fs.copyFile(path.join(src,'index.template.html'),path.join(dist,'index.html'));
console.log('Build estático gerado em dist/.');
