import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const src=fs.readFileSync(new URL('../public/modules/final-ops/final-ops.js',import.meta.url),'utf8')
  .replace('})(window);', 'window.__uploadTest={uploadTrainingDoc,trainingData,setSelected(id){trainingSelectedEnrollmentId=id;}};})(window);');
const bytes=new TextEncoder().encode('%PDF-1.7 test upload');
const sample={name:'certificado.pdf',type:'application/pdf',size:bytes.length,async arrayBuffer(){return bytes.buffer.slice(0);}};

function createHarness(state){
 const browser={crypto:webcrypto,showToast(){},__fbRaw:{auth:{currentUser:{async getIdToken(){return 'token';}}},storage:{ref(){return {
    async getMetadata(){if(!state.exists)throw {code:'storage/object-not-found'};return {size:sample.size,contentType:sample.type};},
    put(){state.uploads++;const task=new Promise(resolve=>setTimeout(()=>{state.exists=true;resolve();},25));task.on=(_type,callback)=>callback({bytesTransferred:1,totalBytes:sample.size});return task;}
 };}}}};
 const mockDocument={addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}};
 vm.runInNewContext(src,{window:browser,document:mockDocument,console,setTimeout,TextEncoder,fetch:async(_url,options)=>{
    state.posts++;
    const body=JSON.parse(options.body);
    await new Promise(resolve=>setTimeout(resolve,10));
    return {ok:true,async json(){return {ok:true,id:body.id,document:{id:body.id,enrollmentId:body.enrollmentId,name:body.name,path:`erp-files/training/${body.enrollmentId}/${body.id}.pdf`}};}};
 }});
 browser.__uploadTest.setSelected('TM123456789000');
 const submit={disabled:false,textContent:'Anexar certificado'};
 const fileInput={files:[sample],disabled:false};
 const status={hidden:true};
 const selectors={'button[type="submit"]':submit,'#ops-training-upload-feedback':status,'#ops-training-upload-label':{textContent:''},'#ops-training-upload-progress':{value:0}};
 const form={elements:{file:fileInput},querySelector(q){return selectors[q]||null;}};
 return {browser,event:{preventDefault(){},currentTarget:form},submit,fileInput};
}

test('vinte cliques criam apenas um upload e um registro, e reenvio após F5 mantém o ID',async()=>{
 const state={uploads:0,posts:0,exists:false};
 const first=createHarness(state);
 await Promise.all(Array.from({length:20},()=>first.browser.__uploadTest.uploadTrainingDoc(first.event)));
 assert.equal(state.uploads,1);
 assert.equal(state.posts,1);
 assert.equal(first.submit.disabled,false);
 assert.equal(first.fileInput.disabled,false);
 assert.equal(Object.keys(first.browser.__uploadTest.trainingData.documents).length,1);
 await first.browser.__uploadTest.uploadTrainingDoc(first.event);
 assert.equal(state.uploads,1);
 assert.equal(state.posts,1);
 const again=createHarness(state);
 await again.browser.__uploadTest.uploadTrainingDoc(again.event);
 assert.equal(state.uploads,1,'não reenvia o arquivo que já existe no Storage');
 assert.equal(state.posts,2,'API confirma sem criar novo registro');
 assert.deepEqual(Object.keys(again.browser.__uploadTest.trainingData.documents),Object.keys(first.browser.__uploadTest.trainingData.documents));
});

test('API protege o registro de certificados com transação create-only e valida MIME',()=>{
 const api=fs.readFileSync(new URL('../api/training/matrix.js',import.meta.url),'utf8');
 assert.match(api,/documentRef\.transaction\(current=>current===null\?document:undefined/);
 assert.match(api,/alreadyExists:!transaction\.committed/);
 assert.match(api,/meta\.contentType!==allowedMime\[extension\]/);
 assert.match(api,/assertSameOrigin\(req,\{required:true\}\)/);
});
