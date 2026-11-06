// ペーパー上位100名の発表の運営コンソール（載せ替え後）を、実ブラウザ(Chromium)で運営者の操作どおりに動かすテスト。
// DB は使えないので、選手一覧の API だけ画面側で差し替えた偽物(メモリ上)で動かす。
// 実行: リポジトリのルートで  node tests/e2e/paper-top.e2e.js   （Playwright と socket.io-client が必要）
// 事前: 3100 番が空いていること。サーバはこのスクリプトが起動・停止する（保存先は $KQK_ROOT/state8.json）。
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

// ---- 偽の選手一覧 API（100名） ----
function makeFakeApi() {
    const players = [];
    for (let i = 1; i <= 100; i++) players.push({
        id: i, entryNo: i, paperRank: i, school: `${i}高校`, grade: '高2', name: `選手 ${i}`,
        secondRoundGroupNumber: null, secondRoundPoint: 0, secondRoundWrongCount: 0, secondRoundDoubleChance: false, secondRoundRank: 0,
        thirdRoundCourseName: null, thirdRoundCorrectCount: 0, thirdRoundWrongCount: 0, thirdRoundUpDownPoint: 0, thirdRoundSwedishCross: 0,
        thirdRoundFreezeRest: 0, thirdRoundRank: 0, extraRoundSecondStep: false, extraRoundCorrectCount: 0, extraRoundRank: 0,
        semifinalPoint: 0, semifinalRank: 0, finalCorrectCount: 0, finalWrongCount: 0, finalSetsWon: 0, finalRank: 0, nickname: '',
    });
    const api = { players };
    api.install = async (page) => {
        await page.route('**/api/secondRound/loadPlayers', r => r.fulfill({ json: { success: true, allPlayers: players } }));
        await page.route('**/api/tournamentState', r => r.fulfill({ json: { success: true, state: { extraRoundNoRevival: false, tournamentName: 'テスト大会' } } }));
        await page.route('**/api/thirdRound/courses', r => r.fulfill({ json: { success: true, courses: [] } }));
    };
    return api;
}

// ---- サーバの起動・停止 ----
let serverProc = null;
function startServer() {
    try { require('fs').rmSync(path.join(ROOT, 'state8.json'), { force: true }); } catch {}
    return new Promise((resolve) => {
        serverProc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3100', KQK_STATE_FILE: path.join(ROOT, 'state8.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const shot = (n) => admin.screenshot({ path: path.join(ROOT, 'pw', `paper-${n}.png`) });
    const mainTxt = () => text(admin, 'main');

    console.log('P1 発表を開く → 1画面目');
    await click(admin, /^上位100名発表/);
    await sleep(1500);
    check('運営コンソールの枠(上のバー)で表示される', (await admin.locator('header').count()) === 1);
    check('バーに「ペーパー上位100名の発表」と 1 / 17画面', /ペーパー上位100名の発表/.test(await header(admin)) && /1 \/ 17画面/.test(await header(admin)), await header(admin));
    check('進行ボタンは「名前を発表 ▶」', /名前を発表 ▶/.test(await header(admin)), await header(admin));
    check('◀ 戻る は押せない(最初)', await admin.getByRole('button', { name: '◀ 戻る' }).isDisabled());
    check('Main に表示中は 1〜4位、次の画面は 5〜10位', /Main に表示中（1〜4位）/.test(await mainTxt()) && /次の画面（5〜10位）/.test(await mainTxt()), (await mainTxt()).slice(0, 200));
    check('1位〜4位の選手が並ぶ', /選手 1\b/.test(await mainTxt()) && /選手 4\b/.test(await mainTxt()));
    check('画面が 1440×900 に収まる', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('p1');

    console.log('P2 名前を発表 → 次の画面 → 戻る');
    await next(admin, /名前を発表/);
    await sleep(900);
    check('名前を公開中・進行ボタンは「次の画面（5〜10位）▶」', /名前を公開中/.test(await header(admin)) && /次の画面（5〜10位）▶/.test(await header(admin)), await header(admin));
    check('操作の記録に「1〜4位 の名前を発表」', /1〜4位 の名前を発表/.test(await text(admin, 'aside')), await text(admin, 'aside'));
    await next(admin, /次の画面（5〜10位）/);
    await sleep(300);
    check('切り替え中は進行ボタンが押せない', /切り替え中/.test(await header(admin)) && (await admin.locator('header button', { hasText: /切り替え中/ }).count()) === 0, await header(admin));
    await sleep(1600);
    check('2 / 17画面（5〜10位・順位だけ表示中）', /2 \/ 17画面/.test(await header(admin)) && /順位だけ表示中/.test(await header(admin)), await header(admin));
    check('Main に表示中は 5〜10位', /Main に表示中（5〜10位）/.test(await mainTxt()) && /選手 10\b/.test(await mainTxt()));
    check('画面が収まる(5〜10位)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('p2');
    await admin.getByRole('button', { name: '◀ 戻る' }).click();
    await sleep(800);
    check('◀ 戻る: 前の画面（1〜4位）の名前を出した状態に戻る', /1 \/ 17画面/.test(await header(admin)) && /名前を公開中/.test(await header(admin)), await header(admin));
    await admin.getByRole('button', { name: '◀ 戻る' }).click();
    await sleep(800);
    check('◀ 戻る: 名前を出す前(順位だけ)に戻る', /順位だけ表示中/.test(await header(admin)), await header(admin));

    console.log('P3 表示の切り替え → 最後の画面 → 発表を終える');
    await click(admin, '表示の切り替え');
    check('画面の選択ボタンが17個', (await admin.locator('[role=dialog] button').count()) === 18, String(await admin.locator('[role=dialog] button').count()));
    check('画面が収まる(表示の切り替えを開いた状態)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('drawer');
    await admin.locator('[role=dialog] button', { hasText: '95〜100位' }).click();
    await sleep(900);
    check('95〜100位が表示される(17 / 17画面)', /17 \/ 17画面/.test(await header(admin)) && /Main に表示中（95〜100位）/.test(await mainTxt()), await header(admin));
    await next(admin, /名前を発表/);
    await sleep(800);
    check('最後の画面では「発表を終える ▶」', /発表を終える ▶/.test(await header(admin)), await header(admin));
    await next(admin, /発表を終える/);
    await sleep(2000);
    check('発表終了(全17画面)・進行ボタンは「発表終了」', /全17画面 · 発表終了/.test(await header(admin)) && /発表終了/.test(await header(admin)));
    check('Main に表示中（なし）', /Main に表示中（なし）/.test(await mainTxt()), await mainTxt());
    await admin.getByRole('button', { name: '◀ 戻る' }).click();
    await sleep(800);
    check('◀ 戻る: 最後の画面の名前を出した状態に戻る', /17 \/ 17画面/.test(await header(admin)) && /名前を公開中/.test(await header(admin)), await header(admin));

    console.log('P4 再読み込み・待機画面');
    await admin.reload(); await admin.waitForTimeout(2800);
    check('再読み込みしても同じ画面・状態(17 / 17・名前を公開中)', /17 \/ 17画面/.test(await header(admin)) && /名前を公開中/.test(await header(admin)), await header(admin));
    await click(admin, '待機画面');
    await sleep(800);
    check('手動の待機画面の間は進行ボタンが「待機画面を消す ▶」', /待機画面を消す ▶/.test(await header(admin)), await header(admin));
    await next(admin, /待機画面を消す/);
    await sleep(800);
    check('待機画面を消すと元の進行ボタンに戻る', !/待機画面を消す/.test(await header(admin)), await header(admin));

    check('画面でエラー(未処理の例外)が出ていない', errors.length === 0, errors.slice(0, 3).join(' / '));
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('E2E ERROR', e); await stopServer(); process.exit(2); });
