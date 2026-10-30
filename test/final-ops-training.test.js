import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {coursePayload,enrollmentPayload,yearMonthDelta,courseState,visibleNotice,validDate,safeId} from '../server/domain/training.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('renovação anual de certificados respeita fim do mês',()=>{
 assert.equal(yearMonthDelta('2024-02-29',12),'2025-02-28');
 assert.equal(yearMonthDelta('2026-01-31',1),'2026-02-28');
 assert.equal(yearMonthDelta('2026-10-28',24),'2028-10-28');
});
test('datas inválidas, periodicidades negativas e identificadores inseguros são rejeitados',()=>{
 for(const date of ['2026-02-30','2026-13-01','bad','2026/10/28'])assert.throws(()=>validDate(date));
 for(const id of ['../../../admin','foo.bar','/abc','x'])assert.throws(()=>safeId(id));
 assert.throws(()=>coursePayload({title:'Muck',renewalMonths:241}));
 assert.throws(()=>coursePayload({title:'Empilhadeira',noticeDays:-1}));
 assert.throws(()=>enrollmentPayload({employeeId:'F003',courseId:'TM1234',status:'concluido'}));
});
test('certificado vencido tem aviso apenas para o login vinculado',()=>{
 const course=coursePayload({title:'Operador de Munck',renewalMonths:12,noticeDays:30});
 const e=enrollmentPayload({employeeId:'F003',courseId:'TM1234',status:'concluido',completedAt:'2025-01-12',employeeLogin:'test3',notifyEnabled:true,notifyAt:'2026-01-01'});
 assert.equal(courseState(e,course,'2026-10-28').displayStatus,'vencido');
 assert.equal(visibleNotice(e,course,'test3','2026-10-28'),true);
 assert.equal(visibleNotice(e,course,'outro','2026-10-28'),false);
 assert.equal(visibleNotice(e,course,'test3','2025-10-01'),false);
});
test('serviço de matriz é exclusivo de Elaine e usa autenticação do Firebase no servidor',()=>{
 const src=read('api/training/matrix.js');
 assert.match(src,/requireIdentity\(req\)/);
 assert.match(src,/identity\.admin|i\.admin===true/);
 assert.match(src,/elaine/);
 assert.match(src,/assertSameOrigin\(req,\{required:true\}\)/);
 assert.match(src,/getFirebaseAdmin/);
 assert.match(src,/audit/);
});
test('RTDB mantém dados da matriz server-only e Storage restringe certificados',()=>{
 const r=JSON.parse(read('database.rules.json'));
 assert.equal(r.rules.erpTraining['.read'],false);
 assert.equal(r.rules.erpTraining['.write'],false);
 assert.equal(r.rules['.read'],false);
 assert.equal(r.rules['.write'],false);
 const storage=read('storage.rules');
 assert.match(storage,/match \/erp-files\/training\/\{enrollmentId\}\/\{fileName\}/);
 assert.match(storage,/request\.auth\.token\.erpUser == 'elaine'/);
 assert.match(storage,/request\.resource\.size <= 10 \* 1024 \* 1024/);
 assert.match(storage,/allow update: if false/);
});
test('interface registra matriz, Help, relatórios impressos e não duplica submódulos',()=>{
 const ui=read('public/modules/final-ops/final-ops.js'),bootstrap=read('public/app/bootstrap.js');
 assert.match(ui,/Matriz de Capacitações/);
 assert.match(ui,/Central de ajuda/);
 assert.match(ui,/Imprimir combustível do mês/);
 assert.match(ui,/Imprimir viagens do mês/);
 assert.match(ui,/window\.print\(\)/);
 assert.match(ui,/querySelector\('\[data-tab=/);
 assert.match(bootstrap,/\/modules\/final-ops\/final-ops\.js/);
});
