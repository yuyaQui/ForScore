// 大会ロゴ（2026-11-06）: 大会準備での登録・差し替え・削除と、Main のクイズ画面の見出しの中央（左ロゴ・右大会名）の表示を、
// 実ブラウザ(Chromium)で運営者の操作どおりに確かめるテスト。
// DB は使えないので、大会名・大会ロゴ・選手の API は画面側で差し替えた偽物(メモリ上)で動かす。
// 実行: リポジトリのルートで  node tests/e2e/tournament-logo.e2e.js   （Playwright と socket.io-client が必要）
// 事前: 3100 番が空いていること。サーバはこのスクリプトが起動・停止する（保存先は $KQK_ROOT/state9.json）。
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const { spawn } = require('child_process');
const path = require('path');

const BASE = 'http://localhost:3100';
const ROOT = process.env.KQK_ROOT || process.cwd();
let failed = 0, passed = 0;
function check(name, cond, extra = '') {
    if (cond) { passed++; console.log(`  ok   ${name}`); }
    else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const text = async (p, sel = 'body') => norm(await p.innerText(sel));

// ---- 画像（PNG）を作る ----
const zlib = require('zlib');
function png(w, h, rgba = [255, 200, 0, 255]) {
    const crc32 = (buf) => { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const row = Buffer.alloc(w * 4 + 1);
    for (let x = 0; x < w; x++) row.set(x % 40 < 20 ? rgba : [0, 0, 0, 0], 1 + x * 4);   // 縞（透過あり）
    const raw = Buffer.concat(Array.from({ length: h }, () => row));
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

// ---- 偽の API（メモリ上） ----
function makeFakeApi() {
    const api = { name: 'abc Fortior', logo: null, version: 0, posts: [], deletes: 0, failMainState: false, players: [] };
    const info = () => (api.logo ? { version: api.version, width: api.logo.width, height: api.logo.height } : null);
    api.install = async (page, { main = false } = {}) => {
        await page.route('**/api/secondRound/loadPlayers', r => r.fulfill({ json: { success: true, allPlayers: api.players } }));
        await page.route('**/api/thirdRound/courses', r => r.fulfill({ json: { success: true, courses: [] } }));
        await page.route('**/api/questionPool', r => r.fulfill({ json: { success: true, summary: { count: 0, min: null, max: null, missing: [] } } }));
        await page.route(/\/api\/questions(\?|$)/, r => r.fulfill({ json: { success: true, question: null } }));
        await page.route('**/api/tournamentState', async r => {
            if (main && api.failMainState) return r.fulfill({ status: 500, body: 'error' });
            if (r.request().method() === 'POST') api.name = JSON.parse(r.request().postData()).tournamentName;
            r.fulfill({ json: { success: true, state: { extraRoundNoRevival: false, tournamentName: api.name, logo: info() } } });
        });
        await page.route(/\/api\/tournamentLogo(\?|$)/, async r => {
            const m = r.request().method();
            if (m === 'POST') {
                const dataUrl = JSON.parse(r.request().postData()).dataUrl;
                const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
                api.posts.push(dataUrl.slice(0, 22));
                api.logo = { buf, mime: dataUrl.slice(5, dataUrl.indexOf(';')), ...pngSize(buf) };
                api.version++;
                return r.fulfill({ json: { success: true, logo: info() } });
            }
            if (m === 'DELETE') { api.deletes++; api.logo = null; api.version++; return r.fulfill({ json: { success: true, logo: null } }); }
            if (!api.logo) return r.fulfill({ status: 404, json: { error: '未登録' } });
            r.fulfill({ status: 200, contentType: api.logo.mime, body: api.logo.buf });
        });
    };
    return api;
}

const player = (id, extra = {}) => ({
    id, entryNo: id, paperRank: id, school: '高校', grade: '高2', name: `選手 ${id}`,
    secondRoundGroupNumber: 1, secondRoundPoint: 0, secondRoundWrongCount: 0, secondRoundDoubleChance: false, secondRoundRank: 0,
    thirdRoundCourseName: null, thirdRoundCorrectCount: 0, thirdRoundWrongCount: 0, thirdRoundUpDownPoint: 0, thirdRoundSwedishCross: 0,
    thirdRoundFreezeRest: 0, thirdRoundRank: 0, extraRoundSecondStep: false, extraRoundCorrectCount: 0, extraRoundRank: 0,
    semifinalPoint: 0, semifinalRank: 0, finalCorrectCount: 0, finalWrongCount: 0, finalSetsWon: 0, finalRank: 0, nickname: '', ...extra,
});

// ---- サーバの起動・停止 ----
let serverProc = null;
function startServer() {
    try { require('fs').rmSync(path.join(ROOT, 'state12.json'), { force: true }); } catch {}
    return new Promise((resolve) => {
        serverProc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3100', KQK_STATE_FILE: path.join(ROOT, 'state12.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
        serverProc.stdout.on('data', d => { if (d.toString().includes('Ready on')) resolve(); });
        // エラー出力も読み捨てる（読まないと管が詰まり、サーバが書き込みで止まる。2026-11-06）
        serverProc.stderr.resume();
    });
}
function stopServer() {
    return new Promise((resolve) => {
        if (!serverProc) return resolve();
        serverProc.once('exit', () => resolve());
        serverProc.kill('SIGTERM');
    });
}

// ---- 道具 ----
const header = (admin) => text(admin, 'header');
async function openAdmin(browser, api) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('dialog', d => d.accept());
    await api.install(page);
    await page.goto(`${BASE}/admin`);
    await page.waitForTimeout(2200);
    return page;
}
async function openMain(browser, api) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await api.install(page);
    await page.goto(`${BASE}/main`);
    await page.waitForTimeout(1500);
    return page;
}
const click = async (page, name) => page.getByRole('button', { name }).first().click();
async function waitText(page, sel, re, ms = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (re.test(await text(page, sel))) return true; await sleep(100); }
    return false;
}
function socketClient() {
    return new Promise((resolve) => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); s.on('connect', () => resolve(s)); });
}
async function fits(admin) {
    return admin.evaluate(() => {
        const de = document.documentElement;
        const bar = document.querySelector('header');
        const main = document.querySelector('main');
        return {
            pageW: de.scrollWidth <= window.innerWidth, pageH: de.scrollHeight <= window.innerHeight,
            barW: bar ? bar.scrollWidth <= bar.clientWidth + 1 : false,
            workH: main ? main.scrollHeight <= main.clientHeight + 1 : false,
            workW: main ? main.scrollWidth <= main.clientWidth + 1 : false,
        };
    });
}
const fitsAll = (f) => f.pageW && f.pageH && f.barW && f.workH && f.workW;
/** 進行ボタン(バー右端)を押す。押せるようになる(クールダウン明け)まで待ってから */
async function next(admin, re) {
    await sleep(800);
    await click(admin, re);
}

/** Main の見出しの中央（大会ロゴ・大会名）と、左右の見出しの文字の位置 */
const brandInfo = (main) => main.evaluate(() => {
    const brand = document.querySelector('[data-brand]');
    if (!brand) return null;
    const st = document.querySelector('div[style*="width: 1920px"][style*="scale("]');
    const sr = st.getBoundingClientRect();
    const br = brand.getBoundingClientRect();
    const img = brand.querySelector('img');
    // 見出し（左右の文字）。中央の部品を除いた見出しの段の文字
    const texts = [...st.querySelectorAll('div')].filter(d => d.children.length === 0 && d.textContent.trim() && !brand.contains(d))
        .map(d => ({ t: d.textContent.trim(), r: d.getBoundingClientRect() }))
        .filter(x => x.r.top < br.bottom && x.r.bottom > br.top);
    const overlap = texts.filter(x => x.r.left < br.right && x.r.right > br.left).map(x => x.t);
    return {
        text: brand.innerText.replace(/\s+/g, ' ').trim(),
        img: img ? { src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0, w: Math.round(img.getBoundingClientRect().width / (sr.width / 1920)) } : null,
        centerOffset: Math.round(((br.left + br.right) / 2 - (sr.left + sr.right) / 2) / (sr.width / 1920)),
        overlap,
        logoLeftOfName: img ? img.getBoundingClientRect().right <= brand.querySelector('span:not([aria-hidden])').getBoundingClientRect().left : null,
    };
});

(async () => {
    await startServer();
    await sleep(500);
    const browser = await chromium.launch();
    const api = makeFakeApi();
    api.players = Array.from({ length: 6 }, (_, i) => player(i + 1));
    const admin = await openAdmin(browser, api);
    const errors = [];
    admin.on('pageerror', e => { if (!/not valid JSON/.test(e.message)) errors.push(e.message); });
    const shot = (n) => admin.screenshot({ path: path.join(ROOT, 'pw', `logo-${n}.png`) });
    const panel = () => text(admin, 'section[aria-label="大会ロゴ"]');
    const logoInput = admin.locator('input[aria-label="大会ロゴの画像"]');

    console.log('L1 大会準備に大会ロゴの面（大会名の下）');
    await click(admin, /^大会準備/);
    await sleep(1500);
    const order = await admin.evaluate(() => [...document.querySelectorAll('main section')].map(s => s.getAttribute('aria-label')));
    check('大会名のすぐ下に大会ロゴの面', order.indexOf('大会ロゴ') === order.indexOf('大会名') + 1, JSON.stringify(order));
    check('未登録は「未設定」', /未設定/.test(await panel()), await panel());
    check('見本に大会名が出る', /abc Fortior/.test(await text(admin, '[aria-label="クイズ画面での見え方"]')));
    check('画面が 1440×900 に収まる', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));

    console.log('L2 形式違いは断る・大きい画像は縮める');
    await logoInput.setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    await sleep(500);
    check('SVG は理由を出して断る', /PNG・WebP・JPEG の画像を選んでください/.test(await panel()) && api.posts.length === 0, await panel());
    await logoInput.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: png(2400, 1200) });
    await sleep(1200);
    check('大きい画像は 1600×800 に縮めて「登録前」', /登録前（1600×800）/.test(await panel()), await panel());
    check('見本にロゴが出る', await admin.locator('[aria-label="クイズ画面での見え方"] img').count() === 1);
    check('まだ送っていない', api.posts.length === 0);
    check('画面が収まる（登録前）', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('pending');
    await click(admin, /^やめる$/);
    await sleep(300);
    check('［やめる］で未設定に戻る', /未設定/.test(await panel()) && api.posts.length === 0, await panel());

    console.log('L3 登録する');
    await logoInput.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: png(2400, 1200) });
    await sleep(1200);
    await admin.getByRole('button', { name: '登録する', exact: true }).dblclick();
    await sleep(1200);
    check('二度押しでも送信は1回・PNG のまま', api.posts.length === 1 && api.posts[0].startsWith('data:image/png'), JSON.stringify(api.posts));
    check('サーバに 1600×800 で保存', api.logo && api.logo.width === 1600 && api.logo.height === 800);
    check('「✓ 登録済み（1600×800）」', /✓ 登録済み（1600×800）/.test(await panel()), await panel());
    check('プレビューに登録済みの画像', await admin.evaluate(() => { const i = document.querySelector('[aria-label="大会ロゴのプレビュー"] img'); return !!i && i.complete && i.naturalWidth > 0; }));
    await shot('saved');

    console.log('L4 Main のクイズ画面: 見出しの中央に 左ロゴ・右大会名');
    const main = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    main.on('pageerror', e => { if (!/not valid JSON/.test(e.message)) errors.push(e.message); });
    await api.install(main, { main: true });
    await main.goto(`${BASE}/main`);
    await sleep(1500);
    const ctl = await socketClient();
    let cover = { rev: 0 };
    ctl.on('update_main_cover', c => { cover = c; });
    ctl.emit('change_mode', 'secondRound');
    await sleep(800);
    ctl.emit('change_2nd_round_state', { group: 1, view: 'quiz' });
    ctl.emit('request_main_cover_sync');
    await sleep(500);
    // Admin（2nd Round）の進行ボタンで待機画面 → ブランク → クイズ画面
    await next(admin, /待機画面を消す/);
    await sleep(800);
    await next(admin, /を始める|を表示する/);
    await sleep(500);
    let b = null;
    for (let i = 0; i < 40 && !(b && b.img && b.img.loaded); i++) { await sleep(150); b = await brandInfo(main); }
    check('見出しにロゴと大会名', b && b.img && b.img.loaded && /abc Fortior/.test(b.text), JSON.stringify(b));
    check('左がロゴ・右が大会名', b && b.logoLeftOfName === true, JSON.stringify(b));
    check('画面の左右中央（ずれ 2px 以内）', b && Math.abs(b.centerOffset) <= 2, JSON.stringify(b));
    check('ロゴの横幅は 260px まで', b && b.img && b.img.w <= 260, JSON.stringify(b));
    check('左右の見出しの文字と重ならない', b && b.overlap.length === 0, JSON.stringify(b));
    await main.screenshot({ path: path.join(ROOT, 'pw', 'logo-main.png') });
    // 最長の大会名（全角12文字）でも重ならない
    api.name = '全国高等学校クイズ選手権大';
    api.name = api.name.slice(0, 12);
    ctl.emit('tournament_state_changed');
    await sleep(1500);
    b = await brandInfo(main);
    check('全角12文字の大会名でも中央・重ならない', b && b.text.includes(api.name) && b.overlap.length === 0 && Math.abs(b.centerOffset) <= 2, JSON.stringify(b));
    await main.screenshot({ path: path.join(ROOT, 'pw', 'logo-main-long.png') });
    api.name = 'abc Fortior';
    ctl.emit('tournament_state_changed');
    await sleep(1200);

    console.log('L5 差し替え・削除が表示中の画面に反映される');
    const src1 = b && b.img ? b.img.src : '';
    // （Admin は 2nd Round を表示中なので、別の Admin から差し替えた場合と同じく、保存＋合図で再現する）
    const sq = png(300, 300, [0, 180, 255, 255]);
    api.logo = { buf: sq, mime: 'image/png', ...pngSize(sq) }; api.version++;
    ctl.emit('tournament_state_changed');
    await sleep(2000);
    b = await brandInfo(main);
    check('差し替えたロゴに変わる（版が変わる）', b && b.img && b.img.loaded && b.img.src !== src1, JSON.stringify(b));
    check('正方形のロゴは高さ 84px（横幅 84px）', b && b.img && b.img.w === 84, JSON.stringify(b));
    api.logo = null; api.version++;
    ctl.emit('tournament_state_changed');
    await sleep(2000);
    b = await brandInfo(main);
    check('削除すると大会名だけ（中央のまま）', b && b.img === null && /abc Fortior/.test(b.text) && Math.abs(b.centerOffset) <= 2, JSON.stringify(b));

    console.log('L6 大会名・ロゴが読めない Main: 任意なので許可すれば進める');
    api.failMainState = true;
    await main.reload();
    await sleep(800);
    const health = () => text(admin, 'body');
    const okProblem = await waitText(admin, 'body', /大会名・ロゴを読み込めていません（任意）/, 8000);
    check('Admin に「大会名・ロゴを読み込めていません（任意）」', okProblem, (await health()).slice(0, 300));
    check('Main は黒い舞台のまま', (await text(main)).trim() === '', (await text(main)).slice(0, 100));
    await admin.getByRole('button', { name: '大会名・ロゴなしで進める', exact: true }).click();
    check('許可すると、大会名・ロゴなしでクイズ画面が出る', await waitText(main, 'body', /2nd Round/, 4000) && !(await main.locator('[data-brand]').count()), (await text(main)).slice(0, 100));
    api.failMainState = false;

    console.log('L7 Admin の［削除］（確認つき）');
    api.logo = { buf: png(800, 400), mime: 'image/png', width: 800, height: 400 }; api.version++;
    ctl.emit('tournament_state_changed');
    await click(admin, /^大会準備/);
    await sleep(1500);
    check('登録済み（800×400）が出る', /✓ 登録済み（800×400）/.test(await panel()), await panel());
    await admin.getByRole('button', { name: '削除', exact: true }).click();
    await sleep(1200);
    check('削除される・未設定に戻る', api.deletes === 1 && api.logo === null && /未設定/.test(await panel()), await panel());

    check('画面のエラーなし', errors.length === 0, errors.join(' | '));
    ctl.close();
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('E2E ERROR', e); await stopServer(); process.exit(2); });
