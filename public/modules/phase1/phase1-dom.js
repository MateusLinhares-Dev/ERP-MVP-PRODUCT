(function(global){
'use strict';
const callbacks=new Set();
const OPTIONS={subtree:true,childList:true};
const MAX_PASSES=2;
let queued=false;
let observer=null;
function runCallbacks(){callbacks.forEach(fn=>{try{fn();}catch(error){console.warn('[phase1-dom]',error);}});}
function flush(){
  queued=false;
  for(let pass=0;pass<MAX_PASSES;pass++){
    runCallbacks();
    if(!observer||!observer.takeRecords().length)break;
  }
  if(observer)observer.takeRecords();
}
function schedule(){if(queued)return;queued=true;if(typeof requestAnimationFrame==='function')requestAnimationFrame(flush);else setTimeout(flush,16);}
function register(fn){if(typeof fn!=='function')return()=>{};callbacks.add(fn);schedule();return()=>callbacks.delete(fn);}
observer=new MutationObserver(schedule);observer.observe(document.documentElement,OPTIONS);
global.Phase1Dom=Object.freeze({register,schedule});
})(window);
