// Main の表示の準備（必要なデータがそろうまで出さない・Admin に原因と対処を出す）のテスト（2026-11-06）。
// Final を例に、Main 未接続・必須（選手データ）の失敗・任意（写真・二つ名）の失敗と許可・表示中の失敗・
// Main の再読み込みを、実ブラウザで運営者の操作どおりに確かめる。
// DB は使えないので、API は画面側で差し替えた偽物(メモリ上)で動かし、失敗も偽物で起こす。
// 実行: リポジトリのルートで  node tests/e2e/main-ready.e2e.js   （Playwright と socket.io-client が必要）
// 事前: 3100 番が空いていること。サーバはこのスクリプトが起動・停止する（保存先は $KQK_ROOT/state10.json）。
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

// ---- 偽の Final API ----
function makeFakeApi() {
    const mk = (id, extra) => ({
        id, entryNo: id, paperRank: id, school: '高校', grade: '高2', name: `選手 ${id}`,
        secondRoundGroupNumber: 1, secondRoundPoint: 0, secondRoundWrongCount: 0, secondRoundDoubleChance: false, secondRoundRank: id,
        thirdRoundCourseName: null, thirdRoundCorrectCount: 0, thirdRoundWrongCount: 0, thirdRoundUpDownPoint: 0, thirdRoundSwedishCross: 0,
        thirdRoundFreezeRest: 0, thirdRoundRank: 0, extraRoundSecondStep: false, extraRoundCorrectCount: 0, extraRoundRank: 0,
        semifinalPoint: 0, semifinalRank: 0, finalCorrectCount: 0, finalWrongCount: 0, finalSetsWon: 0, finalRank: 0, nickname: '', ...extra,
    });
    const names = ['10 up-down', 'Freeze 10', 'Swedish 10', '10 by 10'];
    const players = [];
    for (let i = 1; i <= 8; i++) players.push(mk(i, { thirdRoundCourseName: names[Math.floor((i - 1) / 2)], thirdRoundRank: ((i - 1) % 2) + 1, semifinalRank: i <= 2 ? i : -1 }));
    players.push(mk(9, { extraRoundSecondStep: true, extraRoundRank: 1, secondRoundRank: -1, semifinalRank: 3 }));
    const courses = names.map((name, i) => ({ id: i + 1, name, playOrder: i + 1 }));
    const finalists = () => players.filter(p => p.semifinalRank > 0).sort((a, b) => a.semifinalRank - b.semifinalRank);
    const setOver = () => finalists().some(p => p.finalCorrectCount >= 7) || finalists().filter(p => p.finalWrongCount >= 3).length >= 2;
    const api = { players, courses, calls: { score: 0, undo: 0, reset: 0, nextSet: 0 }, history: [], delay: 0, failNext: false };
    api.install = async (page) => {
        await page.route('**/api/secondRound/loadPlayers', r => r.fulfill({ json: { success: true, allPlayers: players } }));
        await page.route('**/api/tournamentState', r => r.fulfill({ json: { success: true, state: { extraRoundNoRevival: false, tournamentName: 'テスト大会' } } }));
        await page.route('**/api/thirdRound/courses', r => r.fulfill({ json: { success: true, courses } }));
        await page.route('**/api/semifinal/profiles', r => r.fulfill({ json: { success: true, profiles: players.map(p => ({ playerId: p.id, nickname: p.id === 1 ? '最速の男' : '', photoVersion: null })) } }));
        await page.route(/\/api\/questions\?/, r => {
            const u = new URL(r.request().url());
            const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
            const qs = [];
            for (let s = from; s <= to; s++) qs.push({ serial: s, text: `問題 ${s} の本文です。`, answer: `答え${s}`, altAnswer: '' });
            r.fulfill({ json: { success: true, questions: qs } });
        });
        await page.route('**/api/final/updateScore', async r => {
            api.calls.score++;
            if (api.delay) await sleep(api.delay);
            if (api.failNext) { api.failNext = false; return r.fulfill({ json: { success: false, error: 'テスト用の失敗' } }); }
            const b = JSON.parse(r.request().postData());
            const f = finalists();
            let added = false;
            if (b.action === 'nextSet') {
                api.calls.nextSet++;
                if (setOver()) { api.history.push(JSON.stringify(players)); f.forEach(p => { p.finalCorrectCount = 0; p.finalWrongCount = 0; }); added = true; }
            } else if (!setOver()) {
                const p = players.find(x => x.id === b.playerId);
                if (p.finalRank === 0 && p.finalWrongCount < 3) {
                    api.history.push(JSON.stringify(players));
                    added = true;
                    if (b.action === 'correct') p.finalCorrectCount++; else p.finalWrongCount++;
                    let winner = f.find(x => x.finalCorrectCount >= 7);
                    if (!winner && f.filter(x => x.finalWrongCount >= 3).length >= 2) winner = f.find(x => x.finalWrongCount < 3);
                    if (winner) {
                        winner.finalSetsWon++;
                        if (winner.finalSetsWon >= 3) {
                            winner.finalRank = 1;
                            f.filter(x => x.id !== winner.id).forEach((x, i) => { x.finalRank = i + 2; });
                        }
                    }
                }
            }
            r.fulfill({ json: { success: true, allPlayers: players, historyAdded: added } });
        });
        await page.route('**/api/final/undo', async r => {
            api.calls.undo++;
            const h = api.history.pop();
            if (!h) return r.fulfill({ status: 400, json: { error: '取り消せる操作がありません' } });
            JSON.parse(h).forEach(s => Object.assign(players.find(x => x.id === s.id), s));
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
        await page.route('**/api/final/reset', async r => {
            api.calls.reset++;
            api.history.length = 0;
            players.forEach(p => { p.finalCorrectCount = 0; p.finalWrongCount = 0; p.finalSetsWon = 0; p.finalRank = 0; });
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
    };
    return api;
}

// ---- サーバの起動・停止 ----
let serverProc = null;
function startServer() {
    try { require('fs').rmSync(path.join(ROOT, 'state10.json'), { force: true }); } catch {}
    return new Promise((resolve) => {
        serverProc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3100', KQK_STATE_FILE: path.join(ROOT, 'state10.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
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

/** 失敗を起こせる API（後から登録した route が優先される） */
async function installFailures(page, api, fail) {
    await api.install(page);
    const counts = fail.counts;
    await page.route('**/api/secondRound/loadPlayers', r => {
        counts.players++;
        if (fail.players) return r.fulfill({ status: 500, body: 'error' });
        r.fulfill({ json: { success: true, allPlayers: api.players } });
    });
    await page.route('**/api/semifinal/profiles', r => {
        counts.profiles++;
        if (fail.profiles) return r.fulfill({ json: { success: false, error: 'テスト用の失敗' } });
        r.fulfill({ json: { success: true, profiles: api.players.map(p => ({ playerId: p.id, nickname: p.id === 1 ? '最速の男' : '', photoVersion: null })) } });
    });
}
const panel = async (admin) => {
    const el = admin.locator('section[aria-label="Main の表示の問題"]');
    return (await el.count()) === 0 ? '' : norm(await el.innerText());
};
/** Main の舞台（1920×1080）の文字。舞台がなければ null */
const stageText = (main) => main.evaluate(() => {
    const st = document.querySelector('div[style*="width: 1920px"][style*="scale("]');
    return st ? (st.innerText || '').replace(/\s+/g, ' ').trim() : null;
});

(async () => {
    await startServer();
    await sleep(500);
    const browser = await chromium.launch();
    const api = makeFakeApi();
    const fail = { players: true, profiles: true, counts: { players: 0, profiles: 0 } };
    const admin = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    admin.on('dialog', d => d.accept());
    await api.install(admin);
    await admin.goto(`${BASE}/admin`);
    await admin.waitForTimeout(2200);
    const errors = [];
    admin.on('pageerror', e => { if (!/not valid JSON/.test(e.message)) errors.push(e.message); });

    console.log('R0 Main がつながっていない: 覆いを外せず、原因と対処が出る');
    await click(admin, /^Final/);
    await sleep(1200);
    await next(admin, /待機画面を消す/);
    await sleep(1200);
    check('進行ボタンの所は「Main 未接続」（押せない）', /Main 未接続/.test(await header(admin)) && (await admin.getByRole('button', { name: /を始める|を表示する/ }).count()) === 0, await header(admin));
    let pn = await panel(admin);
    check('帯に原因（Main の画面がつながっていません）と対処（会場の PC で開く）', /Main の画面がつながっていません/.test(pn) && /原因/.test(pn) && /対処.*会場の PC で Main の画面を開いて/.test(pn), pn);
    check('強制の「覆いを外す」は残っている（行き止まりの脱出口）', (await admin.getByRole('button', { name: '覆いを外す', exact: true }).count()) === 1);
    check('帯が出ても 1440×900 に収まる', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'ready-nomain.png') });

    console.log('R1 必須（選手データ）が読めない: 外せない → 直して［再取得］で外せる');
    const main = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    main.on('pageerror', e => { if (!/not valid JSON/.test(e.message)) errors.push(e.message); });
    let mainLoads = 0;
    main.on('load', () => { mainLoads++; });
    await installFailures(main, api, fail);
    await main.goto(`${BASE}/main`);
    check('Main を開くと「Main 未接続」が消え、選手データの失敗が出る', await waitText(admin, 'header', /Main：選手データを読み込めません/, 8000), await header(admin));
    pn = await panel(admin);
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'ready-players.png') });
    check('原因にサーバの応答（500）、対処に［再取得］', /選手データを読み込めません（サーバの応答 500）/.test(pn) && /自動で取り直し中/.test(pn) && (await admin.getByRole('button', { name: '再取得', exact: true }).count()) >= 1, pn);
    check('必須のデータには「なしで進める」が出ない', !/選手データなしで進める/.test(pn), pn);
    check('Main はブランクのまま', (await stageText(main)) === '', String(await stageText(main)));
    await sleep(5000);   // 取り直しの間隔が広がるまで待つ
    check('失敗が続くと、サーバの再起動まで案内する', /サーバを再起動/.test(await panel(admin)), await panel(admin));
    fail.players = false;
    const before = fail.counts.players;
    await admin.getByRole('button', { name: '再取得', exact: true }).first().click();
    await sleep(600);
    check('［再取得］で、待たずにすぐ取り直す', fail.counts.players > before, `${before} → ${fail.counts.players}`);
    check('選手データの問題が消え、残りは写真・二つ名（任意）の確認待ち', await waitText(admin, 'header', /Main：写真・二つ名の確認待ち/, 3000), await header(admin));

    console.log('R2 任意（写真・二つ名）が読めない: 許可すれば、なしで進める');
    pn = await panel(admin);
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'ready-profiles.png') });
    check('帯に［写真・二つ名なしで進める］と説明', /なしで進めるなら［写真・二つ名なしで進める］/.test(pn) && (await admin.getByRole('button', { name: '写真・二つ名なしで進める', exact: true }).count()) === 1, pn);
    await admin.getByRole('button', { name: '写真・二つ名なしで進める', exact: true }).click();
    check('許可すると、覆いを外す進行ボタンが押せる', await waitText(admin, 'header', /を始める ▶|を表示する ▶/, 3000), await header(admin));
    check('帯は消える', (await panel(admin)) === '', await panel(admin));
    // クイズ画面の状態にしてから外す（Main に出る画面が分かるように）
    const ctl = await socketClient();
    ctl.emit('change_final_state', { set: 1, view: 'quiz', introIndex: 0, resultRank: 0 });
    await sleep(400);
    await next(admin, /を始める|を表示する/);
    check('外すと、写真なしで本物の画面が出る（SET 1・選手）', await waitText(main, 'body', /SET 1.*選手 1/, 4000), String(await stageText(main)));

    console.log('R3 表示中に必須が読めない: 勝手に出さず黒のまま → ［再取得］で出る');
    fail.players = true;
    await main.reload();
    await sleep(800);
    const seen = new Set();
    for (let i = 0; i < 25; i++) { seen.add(await stageText(main)); await sleep(200); }
    check('5秒たっても、黒い舞台のまま（既定の画面を出さない）', [...seen].every(t => t === '' || t === null), JSON.stringify([...seen]));
    check('Admin に表示中の失敗が出る', /選手データを読み込めていません/.test(await panel(admin)), await panel(admin));
    fail.players = false;
    await admin.getByRole('button', { name: '再取得', exact: true }).first().click();
    check('［再取得］で本物の画面が出る', await waitText(main, 'body', /SET 1.*選手 1/, 3000), String(await stageText(main)));
    check('帯が消える', await (async () => { for (let i = 0; i < 30; i++) { if ((await panel(admin)) === '') return true; await sleep(100); } return false; })(), await panel(admin));

    console.log('R4 Main が別の画面のまま: ［Main を再読み込み］で Main を読み直す');
    const fake = await socketClient();
    let fakeReload = 0;
    fake.on('main_reload', () => { fakeReload++; });
    fake.emit('main_ready_report', { mode: 'semifinal', items: [] });
    check('2台目が切り替わっていないと出る（少し待つと）', await waitText(admin, 'section[aria-label="Main の表示の問題"]', /Main（2台目）\s*が Final に切り替わっていません/, 7000).catch(() => false), await panel(admin));
    const loadsBefore = mainLoads;
    await admin.getByRole('button', { name: 'Main を再読み込み', exact: true }).first().click();
    await sleep(1500);
    check('［Main を再読み込み］が Main に届き、ページが読み直される', fakeReload === 1 && mainLoads > loadsBefore, `fake=${fakeReload} loads ${loadsBefore}→${mainLoads}`);
    fake.close();
    check('2台目が切れると帯が消える', await (async () => { for (let i = 0; i < 40; i++) { if ((await panel(admin)) === '') return true; await sleep(100); } return false; })(), await panel(admin));
    check('読み直した Main にも本物の画面が出る', await waitText(main, 'body', /SET 1.*選手 1/, 5000), String(await stageText(main)));

    console.log('R5 モードを変えると「なしで進める」の許可は消える');
    fail.profiles = true;
    ctl.emit('change_mode', 'semifinal');
    await sleep(1500);
    await next(admin, /待機画面を消す/);
    check('Semi-Final では写真・二つ名の確認待ちに戻る', await waitText(admin, 'header', /写真・二つ名の確認待ち/, 6000), await header(admin));

    check('画面のエラーなし', errors.length === 0, errors.join(' | '));
    ctl.close();
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('E2E ERROR', e); await stopServer(); process.exit(2); });
