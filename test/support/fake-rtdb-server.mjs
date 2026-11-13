import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const WebSocket=require('ws');

const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const parts=path=>String(path||'').split('/').filter(Boolean);
const normalize=path=>parts(path).join('/');

const INTEGER=/^-?(0*)\d{1,10}$/;
function tryParseInt(text){
  if(!INTEGER.test(text))return null;
  const value=Number(text);
  return value>=-2147483648&&value<=2147483647?value:null;
}
function nameCompare(a,b){
  if(a===b)return 0;
  const ai=tryParseInt(a),bi=tryParseInt(b);
  if(ai!==null){
    if(bi!==null)return ai-bi===0?a.length-b.length:ai-bi;
    return -1;
  }
  if(bi!==null)return 1;
  return a<b?-1:1;
}
function doubleToIEEE754String(v){
  const buffer=Buffer.alloc(8);
  buffer.writeDoubleBE(v);
  return buffer.toString('hex');
}
const sha1=text=>createHash('sha1').update(Buffer.from(text,'utf8')).digest('base64');
export function nodeHash(value){
  if(value===null||value===undefined)return '';
  if(typeof value!=='object'){
    let text=typeof value+':';
    text+=typeof value==='number'?doubleToIEEE754String(value):String(value);
    return sha1(text);
  }
  const entries=Array.isArray(value)?value.map((child,index)=>[String(index),child]):Object.entries(value);
  let text='';
  for(const [key,child] of entries.filter(([,child])=>child!==null&&child!==undefined).sort(([a],[b])=>nameCompare(a,b))){
    const childHash=nodeHash(child);
    if(childHash!=='')text+=':'+key+':'+childHash;
  }
  return text===''?'':sha1(text);
}

function prune(value){
  if(value===null||value===undefined)return null;
  if(typeof value!=='object')return value;
  const out={};
  const entries=Array.isArray(value)?value.map((child,index)=>[String(index),child]):Object.entries(value);
  for(const [key,child] of entries){
    const next=prune(child);
    if(next!==null)out[key]=next;
  }
  return Object.keys(out).length?out:null;
}

export async function startFakeRtdb({namespace='demo-erp-test'}={}){
  let root=null;
  const listens=new Map();
  const stats={connections:0,puts:0,hashedPuts:0,datastale:0,dropped:0,gets:0,merges:0};
  const dropRules=[];
  const denyRules=[];
  const denied=changes=>changes.some(([path,value])=>denyRules.some(rule=>rule(normalize(path),value,read)));
  const sockets=new Set();

  const read=path=>{
    let cursor=root;
    for(const key of parts(path)){
      if(cursor===null||typeof cursor!=='object')return null;
      cursor=Array.isArray(cursor)?cursor[Number(key)]:cursor[key];
      if(cursor===undefined)return null;
    }
    return cursor===undefined?null:clone(cursor);
  };
  const write=(path,value)=>{
    const keys=parts(path);
    if(!keys.length){root=prune(clone(value));return;}
    const base=root&&typeof root==='object'?clone(root):{};
    let cursor=base;
    for(let i=0;i<keys.length-1;i++){
      const key=keys[i];
      if(cursor[key]===null||typeof cursor[key]!=='object')cursor[key]={};
      else if(Array.isArray(cursor[key]))cursor[key]={...cursor[key]};
      cursor=cursor[key];
    }
    cursor[keys.at(-1)]=clone(value);
    root=prune(base);
  };
  const overlaps=(a,b)=>{
    const x=normalize(a),y=normalize(b);
    return x===y||x===''||y===''||x.startsWith(y+'/')||y.startsWith(x+'/');
  };
  const send=(socket,message)=>{
    if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));
  };
  const notify=changed=>{
    for(const [socket,paths] of listens){
      for(const path of paths){
        if(changed.some(item=>overlaps(item,path)))send(socket,{t:'d',d:{a:'d',b:{p:normalize(path),d:read(path)}}});
      }
    }
  };
  const respond=(socket,request,status,data)=>send(socket,{t:'d',d:{r:request,b:{s:status,d:data}}});
  const shouldDrop=(action,path)=>{
    const index=dropRules.findIndex(rule=>rule.action===action&&normalize(path).startsWith(normalize(rule.prefix)));
    if(index<0)return false;
    const rule=dropRules[index];
    rule.remaining-=1;
    if(rule.remaining<=0)dropRules.splice(index,1);
    return rule.applyBeforeDrop?'apply':'drop';
  };

  function handle(socket,message){
    if(!message||message.t!=='d'||!message.d)return;
    const {r:request,a:action,b:body={}}=message.d;
    switch(action){
      case 's':case 'gauth':case 'auth':case 'unauth':case 'appcheck':case 'unappeck':
        respond(socket,request,'ok',{});return;
      case 'q':{
        const path=normalize(body.p);
        if(!listens.has(socket))listens.set(socket,new Set());
        listens.get(socket).add(path);
        send(socket,{t:'d',d:{a:'d',b:{p:path,d:read(path)}}});
        respond(socket,request,'ok',{});return;
      }
      case 'n':{
        listens.get(socket)?.delete(normalize(body.p));
        if(request!==undefined)respond(socket,request,'ok',{});return;
      }
      case 'g':
        stats.gets+=1;
        respond(socket,request,'ok',read(body.p));return;
      case 'p':{
        stats.puts+=1;
        const path=normalize(body.p);
        if('h' in body){
          stats.hashedPuts+=1;
          const drop=shouldDrop('transaction',path);
          if(drop==='drop'){stats.dropped+=1;socket.terminate();return;}
          if(nodeHash(read(path))!==body.h){stats.datastale+=1;respond(socket,request,'datastale','');return;}
          write(path,body.d);
          notify([path]);
          if(drop==='apply'){stats.dropped+=1;socket.terminate();return;}
          respond(socket,request,'ok','');return;
        }
        if(denied([[path,body.d]])){respond(socket,request,'permission_denied','Permission denied');return;}
        write(path,body.d);
        notify([path]);
        respond(socket,request,'ok','');return;
      }
      case 'm':{
        stats.merges+=1;
        const base=normalize(body.p);
        const changed=[];
        const entries=Object.entries(body.d||{}).map(([child,value])=>[[base,normalize(child)].filter(Boolean).join('/'),value]);
        if(denied(entries)){respond(socket,request,'permission_denied','Permission denied');return;}
        for(const [full,value] of entries){
          write(full,value);changed.push(full);
        }
        notify(changed);
        respond(socket,request,'ok','');return;
      }
      default:
        if(request!==undefined)respond(socket,request,'ok',{});
    }
  }

  const server=new WebSocket.Server({host:'127.0.0.1',port:0});
  await new Promise(resolve=>server.once('listening',resolve));
  const port=server.address().port;
  const host='127.0.0.1:'+port;
  server.on('connection',socket=>{
    stats.connections+=1;
    sockets.add(socket);
    let pending=null,expected=0;
    socket.on('message',raw=>{
      const text=String(raw);
      if(pending===null&&text.length<=6&&/^\d+$/.test(text)){
        if(text==='0')return;
        expected=Number(text);pending=[];return;
      }
      if(pending!==null){
        pending.push(text);
        if(pending.length<expected)return;
        const full=pending.join('');pending=null;
        try{handle(socket,JSON.parse(full));}catch{ }
        return;
      }
      try{handle(socket,JSON.parse(text));}catch{ }
    });
    socket.on('close',()=>{sockets.delete(socket);listens.delete(socket);});
    send(socket,{t:'c',d:{t:'h',d:{ts:Date.now(),v:'5',h:host,s:'session-'+stats.connections}}});
  });

  return {
    host,port,namespace,
    databaseURL:'http://'+host+'?ns='+namespace,
    stats,
    read,
    seed(path,value){write(path,value);notify([path]);},
    reset(value=null){root=prune(clone(value));},
    dropNextTransaction(prefix,{times=1,applyBeforeDrop=false}={}){dropRules.push({action:'transaction',prefix,remaining:times,applyBeforeDrop});},
    denyWrites(rule){denyRules.push(rule);},
    dropAllConnections(){for(const socket of sockets){stats.dropped+=1;socket.terminate();}},
    async close(){
      for(const socket of sockets)socket.terminate();
      await new Promise(resolve=>server.close(resolve));
    }
  };
}
