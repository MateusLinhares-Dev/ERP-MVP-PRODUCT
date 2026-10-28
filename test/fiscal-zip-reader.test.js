import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {extractXmlsFromZip} from '../public/modules/phase1/fiscal-zip-reader.js';
// Constrói ZIP padrão sem dependências externas, com 2 arquivos e directórios.
const u16=(n)=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const u32=(n)=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;};
function makeZip(entries){
  const local=[], central=[];let offset=0;
  for(const [name,content,method=8] of entries){
    const nameB=Buffer.from(name),raw=Buffer.from(content),body=method===8?deflateRawSync(raw):raw;
    const localHead=Buffer.concat([u32(0x04034b50),u16(20),u16(0),u16(method),u16(0),u16(0),u32(0),u32(body.length),u32(raw.length),u16(nameB.length),u16(0),nameB,body]);
    local.push(localHead);
    const center=Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(method),u16(0),u16(0),u32(0),u32(body.length),u32(raw.length),u16(nameB.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nameB]);
    central.push(center);offset+=localHead.length;
  }
  const c=Buffer.concat(central),l=Buffer.concat(local),end=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(c.length),u32(l.length),u16(0)]);
  return Buffer.concat([l,c,end]);
}
function mock(buffer){return {size:buffer.length,async arrayBuffer(){return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.length);}};}
test('extrai múltiplos XML de ZIP deflate e stored, ignorando arquivos não XML',async()=>{
  const zip=makeZip([['nfe/primeira.xml','<NFe>Um</NFe>',8],['pasta/segunda.XML','<NFe>Dois</NFe>',0],['outro.txt','ignorado',8]]);
  const result=await extractXmlsFromZip(mock(zip));
  assert.equal(result.files.length,2);assert.deepEqual(result.files.map(f=>f.name),['nfe/primeira.xml','pasta/segunda.XML']);
  assert.equal(result.files[1].text,'<NFe>Dois</NFe>');assert.equal(result.errors.length,0);
});
test('rejeita arquivo ZIP corrompido e arquivos acima do limite',async()=>{
  await assert.rejects(extractXmlsFromZip(mock(Buffer.from('abc'))),/ZIP/);
  await assert.rejects(extractXmlsFromZip({size:40*1024*1024}),/32 MB/);
});
test('ignora entrada ZIP com caminho inseguro',async()=>{
  const result=await extractXmlsFromZip(mock(makeZip([['../out.xml','<NFe/>'],['ok.xml','<NFe/>']])));
  assert.equal(result.files.length,1);assert.equal(result.errors.length,1);
});
