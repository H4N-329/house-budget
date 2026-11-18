const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).find(source => source.trim());

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function createApp(options = {}) {
  const { document, window } = parseHTML(html);
  const values = new Map(Object.entries(options.storage || {}));
  const alerts = [];
  const requests = [];
  const charts = new Map();
  const timers = [];
  const revokedUrls = [];
  const now = Date.parse(options.now || '2026-11-18T12:00:00+09:00');
  Object.defineProperty(document.getElementById('inputBar'), 'offsetHeight', {
    get: () => options.inputBarHeight || 160
  });
  class AppDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return (this.querySelector('option[selected]') || this.options[0])?.value || ''; },
    set(value) {
      for (const option of this.options) option.toggleAttribute('selected', option.value === value);
    }
  });
  window.HTMLSelectElement.prototype.add = function(option) { this.appendChild(option); };
  Object.defineProperty(document.getElementById('inputDate'), 'valueAsDate', {
    set(value) { this.value = value.toISOString().slice(0, 10); }
  });
  window.HTMLCanvasElement.prototype.getContext = function() {
    return { canvas: this, fillRect() {}, drawImage() {} };
  };
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,c2FtcGxl';
  class AppImage {
    naturalWidth = 4000;
    naturalHeight = 3000;
    width = 4000;
    height = 3000;
    set src(value) { queueMicrotask(() => options.imageError ? this.onerror() : this.onload()); }
  }
  const storage = {
    getItem(key) { if (options.blockStorage) throw new Error('Storage disabled'); return values.get(key) ?? null; },
    setItem(key, value) { if (options.blockStorage) throw new Error('Storage disabled'); values.set(key, String(value)); },
    removeItem(key) { if (options.blockStorage) throw new Error('Storage disabled'); values.delete(key); }
  };
  const context = vm.createContext({
    window, document, Date: AppDate, Intl,
    localStorage: storage,
    console: { log() {}, warn() {}, error() {} },
    alert: message => alerts.push(message), confirm: () => true,
    getComputedStyle: () => ({ getPropertyValue: () => '#333333' }),
    Chart: class {
      constructor(ctx, config) { this.config = config; charts.set(ctx.canvas.id, config); }
      destroy() {}
    },
    Option: function(text, value) {
      const option = document.createElement('option');
      option.value = value; option.textContent = text; return option;
    },
    Image: AppImage,
    URL: { createObjectURL: () => 'blob:test-receipt', revokeObjectURL: value => revokedUrls.push(value) },
    AbortController,
    setTimeout: options.manualTimers ? (fn, ms) => { timers.push({ fn, ms }); return timers.length; } : setTimeout,
    clearTimeout: options.manualTimers ? () => {} : clearTimeout,
    crypto: { randomUUID: (() => { let id = 0; return () => `test-${++id}`; })() },
    fetch: (url, init = {}) => {
      requests.push(init);
      if (options.fetch) return options.fetch(url, init);
      return Promise.resolve(response(init.method ? { status: 'success' } : []));
    }
  });
  vm.runInContext(script, context);
  const evaluate = code => vm.runInContext(code, context);
  function setRecords(records) {
    context.fixtureRecords = records;
    evaluate('allData = fixtureRecords; currentDate = new Date(2026, 10, 18);');
  }
  return { document, window, context, evaluate, setRecords, values, alerts, requests, charts, timers, revokedUrls };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('the input date follows the local day before 09:00 in Japan', async () => {
  const app = createApp({ now: '2026-11-19T00:15:00+09:00' });
  app.window.onload();
  await tick();
  assert.equal(app.document.getElementById('inputDate').value, '2026-11-19');
});

test('blocked preference storage does not stop initialization and loading', async () => {
  const app = createApp({ blockStorage: true });
  assert.doesNotThrow(() => app.window.onload());
  await tick();
  assert.equal(app.requests.length, 1);
  assert.ok(app.document.getElementById('selectCategory').options.length > 0);
});

test('dates include JST boundaries and reject nonexistent calendar days', () => {
  const app = createApp();
  assert.equal(app.evaluate('getRecordMonth({date:"2026-10-31T15:00:00Z"}).month'), 10);
  assert.equal(app.evaluate('getRecordMonth({date:"2026-10-31T14:59:59Z"}).month'), 9);
  assert.equal(app.evaluate('getRecordMonth({date:"2026-02-30"})'), null);
  assert.equal(app.evaluate('getRecordMonth({date:"2024-02-29"}).day'), 29);
});

test('month navigation from the 31st reaches the next month', () => {
  const app = createApp();
  app.evaluate('currentDate = new Date(2026, 0, 31); changeMonth(1);');
  assert.equal(app.document.getElementById('inputDate').value, '2026-02-28');
});

test('shared allocation and each summary agree to the yen', () => {
  const app = createApp();
  // すべて合成したテストデータを使用する。
  app.setRecords([
    { date:'2026-11-01', type:'収入', user:'ゆうき', category:'手取り給与', amount:10000 },
    { date:'2026-11-01', type:'収入', user:'れな', category:'手取り給与', amount:7000 },
    { date:'2026-11-02', type:'支出', user:'ゆうき', category:'家賃', amount:1000 },
    { date:'2026-11-03', type:'支出', user:'れな', category:'共通：食料品', amount:101 },
    { date:'2026-11-04', type:'支出', user:'ゆうき', category:'個人：飲食', amount:200 },
    { date:'2026-11-04', type:'支出', user:'れな', category:'個人：飲食', amount:50 }
  ]);
  app.evaluate('renderUI(); renderIndividualView();');
  assert.equal(app.document.getElementById('totalBalance').textContent, '収支 ¥15,649');
  assert.equal(app.document.getElementById('yukiRemBadge').textContent, 'ゆうき残金 ¥9,149');
  assert.equal(app.document.getElementById('renaRemBadge').textContent, 'れな残金 ¥6,500');
  assert.match(app.document.getElementById('splitResult').textContent, /349/);
  assert.equal(app.document.getElementById('indivRemVal').textContent, '¥9,149');
});

test('record text is displayed as text and row IDs survive rendering', () => {
  const app = createApp();
  app.setRecords([{ date:'2026-11-01', type:'支出', user:'ゆうき', category:'共通：消耗品', memo:'<img src=x onerror=alert(1)>', amount:100, id:'test-row', rowIndex:2 }]);
  app.evaluate('updateCategoryDropdowns(); renderUI();');
  const list = app.document.getElementById('dataList');
  assert.equal(list.querySelector('img'), null);
  assert.match(list.textContent, /<img src=x/);
  list.querySelector('.edit-btn').click();
  assert.equal(app.evaluate('selectedEditRecordId'), 'test-row');
});

test('legacy budgets merge once and malformed stored amounts never become HTML', () => {
  const app = createApp({ storage: { app_budgets:JSON.stringify({
    'shared_共通：日用品':100, 'shared_共通：消耗品':200,
    'shared_共通：日用品・消耗品':300,
    'shared_共通：食料品':'\"><img src=x onerror=alert(1)>'
  }) } });
  assert.equal(app.evaluate('getStoredBudgets()["shared_共通：日用品・消耗品"]'), 600);
  assert.equal(app.evaluate('getStoredBudgets()["shared_共通：日用品・消耗品"]'), 600);
  app.evaluate('renderBudgetSettingInputs();');
  assert.equal(app.document.querySelector('#budgetInputsShared img'), null);
});

test('an HTTP success carrying a JSON failure is rejected', async () => {
  const app = createApp({ fetch:async () => response({ status:'failed', message:'test failure' }) });
  await assert.rejects(app.evaluate('requestGAS({action:"add"})'), /test failure/);
});

test('legacy text success is accepted while HTML and HTTP errors are rejected', async () => {
  const legacy = createApp({ fetch:async () => ({ ok:true, text:async () => 'success' }) });
  assert.equal(await legacy.evaluate('requestGAS({action:"add"})'), 'success');
  const htmlError = createApp({ fetch:async () => ({ ok:true, text:async () => '<html>sign in</html>' }) });
  await assert.rejects(htmlError.evaluate('requestGAS({action:"add"})'));
  const httpError = createApp({ fetch:async () => response({}, 500) });
  await assert.rejects(httpError.evaluate('requestGAS()'), /HTTP 500/);
});

test('requests time out and provide an actionable error', async () => {
  const app = createApp({ manualTimers:true, fetch:(_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }) });
  const request = app.evaluate('requestGAS({action:"add"})');
  assert.equal(app.timers.length, 1);
  app.timers[0].fn();
  await assert.rejects(request, /タイムアウト/);
});

test('an older GET response cannot overwrite a newer response', async () => {
  const first = deferred();
  const second = deferred();
  let count = 0;
  const app = createApp({ fetch:() => (++count === 1 ? first.promise : second.promise) });
  const olderLoad = app.evaluate('loadData()');
  const newerLoad = app.evaluate('loadData()');
  second.resolve(response([{ date:'2026-11-01', type:'支出', user:'ゆうき', category:'共通：食料品', amount:200 }]));
  await newerLoad;
  first.resolve(response([{ date:'2026-11-01', type:'支出', user:'ゆうき', category:'共通：食料品', amount:100 }]));
  await olderLoad;
  assert.equal(app.evaluate('allData[0].amount'), 200);
});

test('failed submissions keep input and reuse the same client ID', async () => {
  const app = createApp({ fetch:async () => { throw new Error('test offline'); } });
  app.evaluate('updateCategoryDropdowns();');
  app.document.getElementById('inputDate').value = '2026-11-18';
  app.document.getElementById('inputMemo').value = 'test receipt';
  app.document.getElementById('inputAmount').value = '120';
  await app.evaluate('addData()');
  await app.evaluate('addData()');
  assert.equal(app.document.getElementById('inputMemo').value, 'test receipt');
  assert.equal(app.document.getElementById('inputAmount').value, '120');
  assert.equal(JSON.parse(app.requests[0].body).id, JSON.parse(app.requests[1].body).id);
  assert.equal(app.evaluate('busyOperation'), false);
});

test('a receipt registers as one batch with independent retry-safe IDs', async () => {
  const app = createApp();
  app.document.getElementById('inputDate').value = '2026-11-18';
  app.context.receiptFixture = [{ memo:'test apples', amount:198 }, { memo:'test eggs', amount:280 }];
  app.evaluate('showReceiptModal(receiptFixture);');
  await app.evaluate('saveReceiptItems()');
  const posted = app.requests.filter(request => request.method === 'POST');
  assert.equal(posted.length, 1);
  const payload = JSON.parse(posted[0].body);
  assert.equal(payload.records.length, 2);
  assert.notEqual(payload.records[0].id, payload.records[1].id);
  assert.deepEqual(payload.records.map(record => record.amount), ['198', '280']);
});

test('editing uses the stable record ID and unlocks after a network failure', async () => {
  const app = createApp({ fetch:async () => { throw new Error('test offline'); } });
  app.evaluate('updateCategoryDropdowns(); openEditModal(2, "共通：食料品", "test memo", 100, "test-edit-id", "支出");');
  await app.evaluate('saveEdit()');
  assert.equal(JSON.parse(app.requests[0].body).id, 'test-edit-id');
  assert.equal(app.document.getElementById('editModal').style.display, 'flex');
  assert.equal(app.evaluate('busyOperation'), false);
});

test('camera and photo selection are separate native inputs', () => {
  const app = createApp();
  assert.equal(app.document.getElementById('receiptFileInput').getAttribute('capture'), 'environment');
  assert.ok(app.document.getElementById('receiptLibraryInput'));
  assert.equal(app.document.getElementById('receiptLibraryInput').getAttribute('capture'), null);
});

test('receipt images are resized to JPEG and blob URLs are released', async () => {
  const app = createApp();
  app.context.receiptFile = { name:'test.heic', type:'image/heic', size:1000000 };
  const result = await app.evaluate('prepareReceiptImage(receiptFile)');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.imageData, 'c2FtcGxl');
  assert.deepEqual(app.revokedUrls, ['blob:test-receipt']);
});

test('six-month charts include JST boundary timestamps and empty months', () => {
  const app = createApp();
  app.setRecords([
    { date:'2026-06-01', type:'支出', user:'ゆうき', category:'共通：食料品', amount:100 },
    { date:'2026-10-31T14:59:59Z', type:'支出', user:'ゆうき', category:'共通：食料品', amount:200 },
    { date:'2026-10-31T15:00:00Z', type:'支出', user:'ゆうき', category:'共通：食料品', amount:300 },
    { date:'2026-11-01', type:'収入', user:'ゆうき', category:'手取り給与', amount:1000 }
  ]);
  app.evaluate('renderAnalytics();');
  assert.deepEqual(Array.from(app.charts.get('trendChart').data.datasets[0].data), [100, 0, 0, 0, 200, 300]);
});

test('bottom spacing follows the wrapped input form and settings tab', () => {
  const app = createApp({ inputBarHeight:230 });
  app.evaluate('updateInputPadding();');
  assert.equal(app.document.body.style.paddingBottom, '306px');
  const settings = app.document.querySelectorAll('.nav-item')[4];
  app.context.settingsButton = settings;
  app.evaluate('switchTab("tabSettings", settingsButton);');
  assert.equal(app.document.body.style.paddingBottom, '76px');
});

test('form fields are locked until a submission finishes, then restored', async () => {
  const submitted = deferred();
  const app = createApp({ fetch:(_url, init) => init.method ? submitted.promise : Promise.resolve(response([])) });
  app.evaluate('updateCategoryDropdowns();');
  app.document.getElementById('inputDate').value = '2026-11-18';
  app.document.getElementById('inputMemo').value = 'test purchase';
  app.document.getElementById('inputAmount').value = '120';
  const adding = app.evaluate('addData()');
  assert.equal(app.document.getElementById('inputMemo').disabled, true);
  assert.equal(app.document.getElementById('receiptLibraryInput').disabled, true);
  submitted.resolve(response({ status:'success' }));
  await adding;
  assert.equal(app.document.getElementById('inputMemo').disabled, false);
  assert.equal(app.document.getElementById('inputMemo').value, '');
});

test('malformed GET data preserves the last valid records and shows an error', async () => {
  const app = createApp({ fetch:async () => response([null]) });
  app.setRecords([{ date:'2026-11-01', type:'支出', user:'ゆうき', category:'共通：食料品', amount:100 }]);
  await app.evaluate('loadData()');
  assert.equal(app.evaluate('allData[0].amount'), 100);
  assert.match(app.document.getElementById('statusMessage').textContent, /不正な記録/);
});

test('a failed image decode releases its blob URL', async () => {
  const app = createApp({ imageError:true });
  app.context.receiptFile = { name:'test.heic', type:'image/heic', size:1000000 };
  await assert.rejects(app.evaluate('prepareReceiptImage(receiptFile)'), /写真を開けません/);
  assert.deepEqual(app.revokedUrls, ['blob:test-receipt']);
});

test('zoom shortcuts are canceled while normal typing and scrolling are allowed', () => {
  const app = createApp();
  function dispatch(type, properties) {
    const event = new app.window.Event(type, { cancelable:true, bubbles:true });
    Object.assign(event, properties);
    app.document.dispatchEvent(event);
    return event.defaultPrevented;
  }
  assert.equal(dispatch('keydown', {key:'+', ctrlKey:true}), true);
  assert.equal(dispatch('keydown', {key:'c', metaKey:true}), false);
  assert.equal(dispatch('keydown', {key:'-', ctrlKey:false}), false);
  assert.equal(dispatch('wheel', {ctrlKey:false, metaKey:false}), false);
  assert.equal(dispatch('wheel', {ctrlKey:true}), true);
});
