import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './support/fake-rtdb-server.mjs';

let srv;
let app;
let mod = {};
let login;
let users;

const ORIGIN = 'https://erp.local';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}

async function attemptLogin(password, ip = '10.0.0.1') {
  const req = {
    method: 'POST',
    url: '/api/auth/login',
    headers: { host: 'erp.local', origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: { password },
    query: {},
    socket: { remoteAddress: ip },
  };
  const res = response();
  await login(req, res);
  return res;
}

const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).claims;

before(async () => {
  srv = await startFakeRtdb();
  Object.assign(process.env, {
    USE_FIREBASE_EMULATORS: 'true',
    FIREBASE_PROJECT_ID: 'demo-erp-test',
    FIREBASE_DATABASE_URL: srv.databaseURL,
    FIREBASE_DATABASE_EMULATOR_HOST: srv.host,
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9',
    FIREBASE_STORAGE_BUCKET: 'demo-erp-test.appspot.com',
    LOGIN_RATE_LIMIT_SECRET: 'segredo-de-teste-com-tamanho-suficiente',
  });
  delete process.env.APP_ENV;
  delete process.env.VERCEL_ENV;
  const admin = await import('../server/shared/firebase/firebase-admin.ts');
  ({ app } = admin.getFirebaseAdmin());
  mod = await import('../server/modules/access/index.ts');
  login = (await import('../api/auth/login.ts')).default;
  users = () => srv.read('erpAuth/users') || {};
});

after(async () => {
  try {
    await app?.delete();
  } catch {}
  await srv?.close();
});

async function seed() {
  srv.reset({
    erpAuth: {
      users: {
        elaine: { login: 'elaine', passwordHash: await mod.hashPassword('senha-da-elaine'), admin: true, active: true, profile: { name: 'Elaine', tabs: [] } },
        joao: {
          login: 'joao',
          passwordHash: await mod.hashPassword('senha-do-joao'),
          admin: false,
          active: true,
          profile: { name: 'João', tabs: ['compra_sucata', 'lancamento_rapido'] },
        },
        inativo: { login: 'inativo', passwordHash: await mod.hashPassword('senha-inativa'), active: false, profile: {} },
      },
    },
    erp: { users: { elaine: { name: 'Elaine' }, joao: { name: 'João' } } },
  });
}

test('login: a senha identifica o usuário e o token leva as permissões do perfil', async () => {
  await seed();
  const res = await attemptLogin('senha-do-joao');
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.username, 'joao');
  assert.equal(res.body.profile.admin, false);
  const claims = claimsOf(res.body.customToken);
  assert.equal(claims.erpUser, 'joao');
  assert.equal(claims.erpAccess, true);
  assert.equal(claims.canPurchasing, true);
  assert.equal(claims.canQuickEntry, true);
  assert.equal(claims.canPayables, false);
  const admin = await attemptLogin('senha-da-elaine');
  assert.equal(admin.statusCode, 200);
  assert.equal(claimsOf(admin.body.customToken).canPayables, true);
  const audit = Object.values(srv.read('erpAudit') || {});
  assert.ok(audit.some((row) => row.action === 'login' && row.actorLogin === 'joao' && row.ipHash));
});

test('login: senha errada ou de usuário inativo é recusada, e 5 erros bloqueiam o IP', async () => {
  await seed();
  const inactive = await attemptLogin('senha-inativa', '10.0.0.2');
  assert.equal(inactive.statusCode, 401);
  assert.equal(inactive.body.code, 'INVALID_CREDENTIALS');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal((await attemptLogin('errada', '10.0.0.2')).statusCode, 401);
  }
  const blocked = await attemptLogin('senha-do-joao', '10.0.0.2');
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.equal((await attemptLogin('senha-do-joao', '10.0.0.3')).statusCode, 200, 'outro IP continua entrando');
  assert.ok(Object.values(srv.read('erpAudit') || {}).some((row) => row.action === 'login_failed'));
});

test('usuários: criar, recusar senha repetida, renomear, trocar senha e excluir', async () => {
  await seed();
  const created = await mod.manageUser({
    action: 'create',
    login: ' Maria ',
    password: 'senha-da-maria',
    profile: { name: 'Maria', tabs: ['vendas', 'vendas'], admin: true },
  });
  assert.equal(created.login, 'maria');
  assert.deepEqual(created.profile.tabs, ['vendas']);
  assert.equal(created.profile.admin, true);
  assert.equal(users().maria.admin, false, 'cadastro comum nunca vira administradora');
  assert.equal(srv.read('erp/users/maria').login, 'maria');
  await assert.rejects(
    mod.manageUser({ action: 'create', login: 'pedro', password: 'senha-do-joao', profile: {} }),
    { code: 'DUPLICATE_PASSWORD' },
  );
  await assert.rejects(mod.manageUser({ action: 'create', login: 'maria', password: 'outra-senha-1', profile: {} }), {
    code: 'LOGIN_EXISTS',
  });
  await assert.rejects(mod.manageUser({ action: 'create', login: 'x', password: 'curta', profile: {} }), {
    code: 'WEAK_PASSWORD',
  });
  await assert.rejects(mod.manageUser({ action: 'create', login: 'engAdministrator', password: 'senha-forte-1', profile: {} }), {
    code: 'ENGINEER_RESERVED',
  });

  const renamed = await mod.manageUser({ action: 'update', login: 'maria', newLogin: 'maria.souza', profile: { name: 'Maria S.', tabs: [] } });
  assert.equal(renamed.login, 'maria.souza');
  assert.equal(users().maria, undefined);
  assert.ok(users()['~u~' + Buffer.from('maria.souza').toString('base64url')]);
  assert.deepEqual(srv.read('erp/usersDeleted'), { 0: 'maria' });
  assert.equal((await attemptLogin('senha-da-maria', '10.0.0.4')).body.username, 'maria.souza');

  await mod.manageUser({ action: 'resetPassword', login: 'maria.souza', password: 'nova-senha-maria' });
  assert.equal((await attemptLogin('senha-da-maria', '10.0.0.5')).statusCode, 401);
  assert.equal((await attemptLogin('nova-senha-maria', '10.0.0.5')).statusCode, 200);

  await assert.rejects(mod.manageUser({ action: 'update', login: 'elaine', newLogin: 'elaine2' }), {
    code: 'ADMIN_LOGIN_IMMUTABLE',
  });
  await assert.rejects(mod.manageUser({ action: 'delete', login: 'elaine' }), { code: 'ADMIN_DELETE_FORBIDDEN' });
  const removed = await mod.manageUser({ action: 'delete', login: 'joao' });
  assert.deepEqual(removed, { login: 'joao', deleted: true });
  assert.equal(users().joao, undefined);
  assert.equal(srv.read('erp/users/joao'), null);
  await assert.rejects(mod.manageUser({ action: 'delete', login: 'joao' }), { code: 'USER_NOT_FOUND' });
  await assert.rejects(mod.manageUser({ action: 'voar', login: 'elaine' }), { code: 'INVALID_ACTION' });
});
