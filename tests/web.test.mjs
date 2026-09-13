import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const template = await readFile(new URL('../scripts/service-worker.js', import.meta.url), 'utf8');
const assets = ['/index.html', '/_expo/static/js/web/app.js', '/icons/icon-192.png'];

function harness({ failInstall = false } = {}) {
  const stores = new Map([
    ['wordmemo-web-old', new Map([['/index.html', 'old-release']])],
    ['another-app', new Map([['/other.html', 'unrelated']])],
  ]);
  const listeners = new Map();
  const calls = { fetched: [], claimed: 0 };
  const caches = {
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        addAll: async requests => {
          if (failInstall) throw new Error('Download failed');
          for (const request of requests) store.set(request.url, `cached:${request.url}`);
        },
        match: async path => store.get(path),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
  };
  const context = {
    self: {
      location: { origin: 'https://wordmemo.example' },
      clients: { claim: async () => { calls.claimed += 1; } },
      addEventListener: (name, listener) => listeners.set(name, listener),
      skipWaiting: () => { throw new Error('Must not replace an open practice session'); },
    },
    caches, URL, Set,
    Request: class { constructor(url, options) { this.url = url; this.cache = options.cache; } },
    fetch: async request => { calls.fetched.push(request.url); return 'network'; },
  };
  vm.runInNewContext(template.replace('__BUILD_VERSION__', 'test').replace('__PRECACHE_URLS__', JSON.stringify(assets)), context);
  async function lifecycle(name) {
    let work;
    listeners.get(name)({ waitUntil: promise => { work = promise; } });
    await work;
  }
  async function request(path, { method = 'GET', mode = 'cors' } = {}) {
    let response;
    listeners.get('fetch')({
      request: { url: new URL(path, 'https://wordmemo.example').href, method, mode },
      respondWith: promise => { response = promise; },
    });
    return response;
  }
  return { stores, calls, lifecycle, request };
}

test('web release serves cached app assets and navigation without a network', async () => {
  const h = harness();
  await h.lifecycle('install');
  await h.lifecycle('activate');
  assert.equal(await h.request('/', { mode: 'navigate' }), 'cached:/index.html');
  assert.equal(await h.request('/?opened=home', { mode: 'navigate' }), 'cached:/index.html');
  assert.equal(await h.request('/_expo/static/js/web/app.js'), 'cached:/_expo/static/js/web/app.js');
  assert.deepEqual(h.calls.fetched, []);
});

test('failed offline download keeps the previous release available', async () => {
  const h = harness({ failInstall: true });
  await assert.rejects(h.lifecycle('install'), /Download failed/);
  assert.equal(h.stores.get('wordmemo-web-old').get('/index.html'), 'old-release');
  assert.equal(h.calls.claimed, 0);
});

test('updates retire only old WordMemo caches after activation', async () => {
  const h = harness();
  await h.lifecycle('install');
  assert.ok(h.stores.has('wordmemo-web-old'));
  await h.lifecycle('activate');
  assert.ok(!h.stores.has('wordmemo-web-old'));
  assert.ok(h.stores.has('wordmemo-web-test'));
  assert.equal(h.stores.get('another-app').get('/other.html'), 'unrelated');
  assert.equal(h.calls.claimed, 1);
});

test('worker leaves publisher links, non-GET requests, and unknown resources alone', async () => {
  const h = harness();
  await h.lifecycle('install');
  assert.equal(await h.request('https://ebible.org/engwebp/'), undefined);
  assert.equal(await h.request('/index.html', { method: 'POST' }), undefined);
  assert.equal(await h.request('/sw.js'), undefined);
  assert.equal(await h.request('/does-not-exist.js'), undefined);
});

test('an evicted asset falls back to network instead of returning HTML as JavaScript', async () => {
  const h = harness();
  await h.lifecycle('install');
  h.stores.get('wordmemo-web-test').delete('/_expo/static/js/web/app.js');
  assert.equal(await h.request('/_expo/static/js/web/app.js'), 'network');
  assert.equal(h.calls.fetched.length, 1);
});
