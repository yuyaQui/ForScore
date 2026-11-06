// 大会準備（大会名・案内テキスト・問題データ）の運営コンソール（載せ替え後）を、実ブラウザ(Chromium)で運営者の操作どおりに動かすテスト。
// DB は使えないので、大会名・問題データの API だけ画面側で差し替えた偽物(メモリ上)で動かす。
// 実行: リポジトリのルートで  node tests/e2e/preparation.e2e.js   （Playwright と socket.io-client が必要）
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

// ---- 偽の API（メモリ上） ----
function makeFakeApi() {
    const api = { name: '', pool: [], posts: { name: [], pool: [] }, delay: 0, failNameNext: false, players: [] };
    const summary = () => api.pool.length === 0 ? { count: 0, min: null, max: null, missing: [] }
        : { count: api.pool.length, min: api.pool[0], max: api.pool[api.pool.length - 1], missing: [] };
    api.install = async (page) => {
        await page.route('**/api/secondRound/loadPlayers', r => r.fulfill({ json: { success: true, allPlayers: api.players } }));
        await page.route('**/api/thirdRound/courses', r => r.fulfill({ json: { success: true, courses: [] } }));
        await page.route('**/api/tournamentState', async r => {
            if (r.request().method() === 'POST') {
                const b = JSON.parse(r.request().postData());
                api.posts.name.push(b.tournamentName);
                if (api.delay) await sleep(api.delay);
                if (api.failNameNext) { api.failNameNext = false; return r.fulfill({ status: 503, json: { error: 'テスト用の失敗' } }); }
                api.name = b.tournamentName;
            }
            r.fulfill({ json: { success: true, state: { extraRoundNoRevival: false, tournamentName: api.name } } });
        });
        await page.route('**/api/questionPool', async r => {
            if (r.request().method() === 'POST') {
                const b = JSON.parse(r.request().postData());
                api.posts.pool.push(b.confirmReplace === true);
                if (api.delay) await sleep(api.delay);
                if (api.pool.length > 0 && b.confirmReplace !== true) return r.fulfill({ status: 409, json: { error: '登録済み', needsConfirmation: true, existing: api.pool.length } });
                api.pool = b.csvText.split(/\r?\n/).filter(l => /^\d+,/.test(l)).map(l => Number(l.split(',')[0]));
            }
            r.fulfill({ json: { success: true, summary: summary() } });
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
const GOOD = '番号,問題,解答,別解\n1,日本で一番高い山は？,富士山,\n2,首都は？,東京,とうきょう\n3,元素記号 H は？,水素,\n';
const BAD = '番号,問題,解答,別解\n1,日本で一番高い山は？,富士山,\nx,首都は？,東京,\n1,重複,答え,\n4,,空の解答,\n';
const csvFile = (name, content) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(content, 'utf8') });

// ---- サーバの起動・停止 ----
let serverProc = null;
function startServer() {
    try { require('fs').rmSync(path.join(ROOT, 'state9.json'), { force: true }); } catch {}
    return new Promise((resolve) => {
        serverProc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3100', KQK_STATE_FILE: path.join(ROOT, 'state9.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
(async () => {
    await startServer();
    await sleep(500);
    const browser = await chromium.launch();
    const api = makeFakeApi();
    const admin = await openAdmin(browser, api);
    const main = await openMain(browser, api);
    const errors = [];
    admin.on('pageerror', e => { if (!/not valid JSON/.test(e.message)) errors.push(e.message); });
    main.on('pageerror', e => { if (!/not valid JSON/.test(e.message)) errors.push(e.message); });
    const shot = (n) => admin.screenshot({ path: path.join(ROOT, 'pw', `prep-${n}.png`) });
    const body_ = () => text(admin, 'body');
    const mainTxt = () => text(admin, 'main');

    console.log('W1 大会準備を開く');
    await click(admin, /^大会準備/);
    await sleep(1500);
    check('運営コンソールの枠(上のバー)で表示される', (await admin.locator('header').count()) === 1);
    check('バーに「大会準備」', /大会準備/.test(await header(admin)), await header(admin));
    check('大会名・案内テキスト・問題データの3つの面', (await admin.locator('section').count()) === 3);
    check('選手が未登録のときの進行ボタンは「1st Round へ ▶」', /1st Round へ ▶/.test(await header(admin)), await header(admin));
    check('大会名は未設定・問題データは未登録', /未設定/.test(await mainTxt()) && /未登録/.test(await mainTxt()), await mainTxt());
    check('画面が 1440×900 に収まる', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('p1');

    console.log('W2 大会名');
    const nameInput = admin.getByRole('textbox', { name: '大会名', exact: true });
    check('何も入力していないと保存は押せない', await admin.getByRole('button', { name: '保存', exact: true }).isDisabled());
    await nameInput.fill('a'.repeat(41));
    check('41文字は保存できない（理由が出る）', await admin.getByRole('button', { name: '保存', exact: true }).isDisabled() && /40文字まで/.test(await mainTxt()), await mainTxt());
    api.failNameNext = true;
    await nameInput.fill('abc Fortior');
    await admin.getByRole('button', { name: '保存', exact: true }).click();
    await sleep(900);
    check('失敗は画面の上に出る', /テスト用の失敗/.test(await body_()), (await body_()).slice(0, 200));
    api.delay = 700;
    await admin.getByRole('button', { name: '保存', exact: true }).dblclick();
    await sleep(2200);
    api.delay = 0;
    check('二度押しでも保存の送信は1回', api.posts.name.filter(n => n === 'abc Fortior').length === 2 && api.name === 'abc Fortior', JSON.stringify(api.posts.name));
    check('左上のサイドバーに大会名が出る', /abc Fortior/.test(await text(admin, 'nav')), await text(admin, 'nav'));
    check('保存後は保存ボタンが押せない（変更なし）', await admin.getByRole('button', { name: '保存', exact: true }).isDisabled());

    console.log('W3 案内テキスト');
    check('反映するは空だと押せない', await admin.getByRole('button', { name: '反映する', exact: true }).isDisabled());
    await admin.getByRole('textbox', { name: '案内テキスト', exact: true }).fill('まもなく開始します\nしばらくお待ちください');
    await admin.getByRole('button', { name: '反映する', exact: true }).click();
    await sleep(900);
    check('Main に案内テキストが出る', /まもなく開始します/.test(await text(main)), await text(main));
    check('Admin にも「Main に表示中」と文言が出る', /Main に表示中/.test(await mainTxt()) && /まもなく開始します/.test(await mainTxt()));
    check('同じ文言は再反映できない', await admin.getByRole('button', { name: '反映する', exact: true }).isDisabled());
    check('画面が収まる(案内テキスト反映後)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.reload(); await admin.waitForTimeout(2800);
    check('再読み込みしても、いま出している案内が出る', /まもなく開始します/.test(await mainTxt()), (await mainTxt()).slice(0, 200));

    console.log('W4 問題データ');
    const file = admin.locator('input[type=file]');
    await file.setInputFiles(csvFile('bad.csv', BAD));
    await sleep(600);
    check('誤りの行が出て、登録は押せない', /取り込めません/.test(await mainTxt()) && /重複/.test(await mainTxt()) && await admin.getByRole('button', { name: '登録', exact: true }).isDisabled(), (await mainTxt()).slice(0, 300));
    await shot('bad');
    await file.setInputFiles(csvFile('good.csv', GOOD));
    await sleep(600);
    check('正しい CSV: プレビューに3問・登録が押せる', (await admin.locator('table tbody tr').count()) === 3 && !(await admin.getByRole('button', { name: '登録', exact: true }).isDisabled()));
    check('画面が収まる(プレビュー)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('good');
    await admin.getByRole('button', { name: '登録', exact: true }).click();
    await sleep(1000);
    check('登録され「登録済み 3問」になる', api.pool.length === 3 && /登録済み 3問/.test(await mainTxt()), await mainTxt());
    await file.setInputFiles(csvFile('again.csv', GOOD));
    await sleep(500);
    api.delay = 600;
    await admin.getByRole('button', { name: '登録', exact: true }).dblclick();
    await sleep(2200);
    api.delay = 0;
    check('登録済みのときは入れ替えの確認(409)に了承して登録。二度押しでも1回', api.posts.pool.filter(x => x).length === 1, JSON.stringify(api.posts.pool));

    console.log('W5 進行ボタン');
    await next(admin, /1st Round へ/);
    await sleep(1500);
    check('1st Round の画面に進む', await admin.getByRole('button', { name: /^1st Round/ }).getAttribute('aria-current') === 'page');
    api.players = Array.from({ length: 20 }, (_, i) => player(i + 1, { secondRoundRank: i < 3 ? i + 1 : 0 }));
    await admin.reload(); await admin.waitForTimeout(2800);
    await click(admin, /^大会準備/);
    await sleep(1500);
    check('結果のあるラウンドがあれば、進行ボタンはそのラウンドへ（2nd Round）', /2nd Round へ ▶/.test(await header(admin)), await header(admin));
    check('進行の状況が見出しに出る', /2nd Round 勝ち抜け 3/.test(await mainTxt()), await mainTxt());
    await next(admin, /2nd Round へ/);
    await sleep(1500);
    check('2nd Round へ進み、Main は「この画面を表示する」待ちのブランク（再開）', await admin.getByRole('button', { name: /^2nd Round/ }).getAttribute('aria-current') === 'page' && /この画面を表示する ▶/.test(await header(admin)), await header(admin));

    check('画面でエラー(未処理の例外)が出ていない', errors.length === 0, errors.slice(0, 3).join(' / '));
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('E2E ERROR', e); await stopServer(); process.exit(2); });
