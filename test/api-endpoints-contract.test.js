import test from 'node:test';
import assert from 'node:assert/strict';

const ENDPOINTS = {
  'auth/session': { GET: 'user' },
  'auth/verify-admin': { POST: 'user' },
  'admin/users': { POST: 'admin' },
  'admin/employee-companies': { GET: 'admin', POST: 'admin' },
  'admin/branding': { POST: 'admin' },
  'admin/snapshots': { POST: 'admin' },
  'admin/restore-history': { GET: 'admin' },
  'admin/data-backup': { POST: 'admin' },
  'help/articles': { GET: 'user', POST: 'engineer' },
  'agenda/services': { GET: 'user', POST: 'user' },
  'fiscal/staff': { GET: 'user' },
  'training/matrix': { GET: 'user', POST: 'user' },
  'engineering/logs': { GET: 'engineer' },
  'engineering/telemetry': { POST: 'user' },
};

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

async function call(path, method, headers = {}, body = {}) {
  const handler = (await import(`../api/${path}.ts`)).default;
  const req = {
    method,
    url: '/api/' + path,
    headers: { host: 'erp.local', 'content-type': 'application/json', ...headers },
    body,
    query: {},
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = response();
  await handler(req, res);
  return res;
}

for (const [path, routes] of Object.entries(ENDPOINTS)) {
  test(`/api/${path}: só aceita ${Object.keys(routes).join(' e ')} e exige login`, async () => {
    const other = ['GET', 'POST', 'PUT', 'DELETE'].find((method) => !routes[method]);
    const refused = await call(path, other, { origin: 'https://erp.local' });
    assert.equal(refused.statusCode, 405);
    assert.equal(refused.body.code, 'METHOD_NOT_ALLOWED');
    for (const method of Object.keys(routes)) {
      const anonymous = await call(path, method, { origin: 'https://erp.local' });
      assert.equal(anonymous.statusCode, 401, `${method} sem token`);
      assert.equal(anonymous.body.code, 'UNAUTHENTICATED');
      assert.equal(anonymous.headers['cache-control'], 'no-store, max-age=0');
      if (method === 'POST') {
        const foreign = await call(path, method, { origin: 'https://atacante.example' });
        assert.equal(foreign.statusCode, 403, 'POST de outra origem');
        assert.equal(foreign.body.code, 'BAD_ORIGIN');
      }
    }
  });
}

test('/api/auth/login: público, só POST da mesma origem e recusa senha vazia sem consultar o banco', async () => {
  assert.equal((await call('auth/login', 'GET')).statusCode, 405);
  const foreign = await call('auth/login', 'POST', { origin: 'https://atacante.example' }, { password: 'x' });
  assert.equal(foreign.body.code, 'BAD_ORIGIN');
  const empty = await call('auth/login', 'POST', { origin: 'https://erp.local' }, { password: '' });
  assert.equal(empty.statusCode, 400);
  assert.deepEqual(empty.body, { code: 'INVALID_CREDENTIAL', message: 'Credencial inválida.' });
  const tooLong = await call('auth/login', 'POST', { origin: 'https://erp.local' }, { password: 'x'.repeat(129) });
  assert.equal(tooLong.statusCode, 400);
});

test('/api/health responde sem login e só por GET', async () => {
  const ok = await call('health', 'GET');
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.ok, true);
  assert.equal((await call('health', 'POST', { origin: 'https://erp.local' })).statusCode, 405);
});
