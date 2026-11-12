// Semi-Final の運営コンソール（載せ替え後）を、実ブラウザ(Chromium)で運営者の操作どおりに動かすテスト。
// DB は使えないので、Semi-Final の API だけ画面側で差し替えた偽物(メモリ上)で動かす。
// 実行: リポジトリのルートで  node tests/e2e/semifinal.e2e.js   （Playwright と socket.io-client が必要）
// 事前: 3100 番が空いていること。サーバはこのスクリプトが起動・停止する（保存先は $KQK_ROOT/state5.json）。
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

// ---- 偽の Semi-Final API ----
function makeFakeApi() {
    const mk = (id, extra) => ({
        id, entryNo: id, paperRank: id, school: '高校', grade: '高2', name: `選手 ${id}`,
        secondRoundGroupNumber: 1, secondRoundPoint: 0, secondRoundWrongCount: 0, secondRoundDoubleChance: false, secondRoundRank: id,
        thirdRoundCourseName: null, thirdRoundCorrectCount: 0, thirdRoundWrongCount: 0, thirdRoundUpDownPoint: 0, thirdRoundSwedishCross: 0,
        thirdRoundFreezeRest: 0, thirdRoundRank: 0, extraRoundSecondStep: false, extraRoundCorrectCount: 0, extraRoundRank: 0,
        semifinalPoint: 0, semifinalRank: 0, semifinalLostSet: 0, finalCorrectCount: 0, finalWrongCount: 0, finalSetsWon: 0, finalRank: 0, nickname: '', ...extra,
    });
    const names = ['10 up-down', 'Freeze 10', 'Swedish 10', '10 by 10'];
    const players = [];
    for (let i = 1; i <= 8; i++) players.push(mk(i, { thirdRoundCourseName: names[Math.floor((i - 1) / 2)], thirdRoundRank: ((i - 1) % 2) + 1 }));
    players.push(mk(9, { extraRoundSecondStep: true, extraRoundRank: 1, secondRoundRank: -1 }));
    const courses = names.map((name, i) => ({ id: i + 1, name, playOrder: i + 1 }));
    const api = { players, courses, calls: { score: 0, undo: 0, reset: 0 }, history: [], delay: 0, failNext: false };
    api.install = async (page) => {
        await page.route('**/api/secondRound/loadPlayers', r => r.fulfill({ json: { success: true, allPlayers: players } }));
        await page.route('**/api/tournamentState', r => r.fulfill({ json: { success: true, state: { extraRoundNoRevival: false, tournamentName: 'テスト大会' } } }));
        await page.route('**/api/thirdRound/courses', r => r.fulfill({ json: { success: true, courses } }));
        await page.route('**/api/semifinal/profiles', r => r.fulfill({ json: { success: true, profiles: players.map(p => ({ playerId: p.id, nickname: '', photoVersion: null })) } }));
        // 取り込んだ問題は No.1〜No.100（2026-11-11。上限の次は最初に戻る）
        await page.route('**/api/questionPool', r => r.fulfill({ json: { success: true, summary: { count: 100, min: 1, max: 100, missing: [] } } }));
        await page.route(/\/api\/questions\?/, r => {
            const u = new URL(r.request().url());
            const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
            // 番号を並べた指定（?serials=99,100,1。2026-11-11）にも答える
            const list = u.searchParams.get('serials') ? u.searchParams.get('serials').split(',').map(Number) : null;
            const serials = list || Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
            const qs = [];
            for (const s of serials) qs.push({ serial: s, text: `問題 ${s} の本文です。`, answer: `答え${s}`, altAnswer: s % 2 ? `別解${s}` : '' });
            r.fulfill({ json: { success: true, questions: qs } });
        });
        await page.route('**/api/semifinal/updateScore', async r => {
            api.calls.score++;
            if (api.delay) await sleep(api.delay);
            if (api.failNext) { api.failNext = false; return r.fulfill({ json: { success: false, error: 'テスト用の失敗' } }); }
            const b = JSON.parse(r.request().postData());
            api.history.push(JSON.stringify(players));
            if (b.action === 'points') {
                b.entries.forEach(e => { const p = players.find(x => x.id === e.playerId); p.semifinalPoint += e.delta; });
            } else if (b.action === 'judgeAdvance') {
                b.chosenIds.forEach(id => { const p = players.find(x => x.id === id); if (p.semifinalRank === 0) p.semifinalRank = b.set; });
            } else if (b.action === 'judgeEliminate') {
                b.chosenIds.forEach(id => { const p = players.find(x => x.id === id); if (p.semifinalRank === 0) { p.semifinalRank = -1; p.semifinalLostSet = b.set; } });
            }
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
        await page.route('**/api/semifinal/undo', async r => {
            api.calls.undo++;
            const h = api.history.pop();
            if (!h) return r.fulfill({ status: 400, json: { error: '取り消せる操作がありません' } });
            JSON.parse(h).forEach(s => Object.assign(players.find(x => x.id === s.id), s));
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
        await page.route('**/api/semifinal/reset', async r => {
            api.calls.reset++;
            api.history.length = 0;
            players.forEach(p => { p.semifinalPoint = 0; p.semifinalRank = 0; p.semifinalLostSet = 0; });
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
    };
    return api;
}

// ---- サーバの起動・停止 ----
let serverProc = null;
function startServer() {
    try { require('fs').rmSync(path.join(ROOT, 'state5.json'), { force: true }); } catch {}
    return new Promise((resolve) => {
        serverProc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3100', KQK_STATE_FILE: path.join(ROOT, 'state5.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
/** 得点集計の入力欄に、選手の id ごとに値を入れる（欄の並びは席順なので、名前から id を読む）。byId が関数なら (id, 小さい順の番号) で決める */
async function fillTally(admin, byId) {
    const inputs = admin.locator('input[aria-label$="の得点"]');
    const n = await inputs.count();
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(Number((await inputs.nth(i).getAttribute('aria-label')).match(/選手 (\d+)/)[1]));
    const sorted = [...ids].sort((x, y) => x - y);
    for (let i = 0; i < n; i++) await inputs.nth(i).fill(String(typeof byId === 'function' ? byId(ids[i], sorted.indexOf(ids[i])) : byId[ids[i]]));
    return n;
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

    console.log('S1 Semi-Final を開く → 待機画面 → ブランク → 準備(写真・二つ名)');
    await click(admin, /^Semi-Final/);
    await sleep(1200);
    check('運営コンソールの枠(上のバー)で表示される', (await admin.locator('header').count()) === 1);
    check('待機画面 NEXT Semi-Final が会場に出る', await waitText(main, 'body', /NEXT Semi-?Final/i), await text(main));
    check('進行ボタンは「待機画面を消す ▶」', /待機画面を消す ▶/.test(await header(admin)), await header(admin));
    await next(admin, /待機画面を消す/);
    await sleep(1000);
    check('会場はブランク', (await text(main)) === '', await text(main));
    check('進行ボタンは「…を始める ▶」', /を始める ▶|を表示する ▶/.test(await header(admin)), await header(admin));
    await next(admin, /を始める|を表示する/);
    await sleep(1200);
    check('準備中の会場は何も出ない(NEXT Semi-Final も出ない)', (await text(main)) === '', await text(main));
    check('準備: 進出者9名の登録欄が出る', /進出者\s*9名/.test(await text(admin)) && (await admin.getByRole('button', { name: /写真を選択/ }).count()) === 9);
    check('進行ボタンは「1人目へ ▶」', /(^|[^0-9])1人目へ ▶/.test(await header(admin)), await header(admin));
    check('バーにタイマーは出ない(準備)', (await admin.getByRole('button', { name: 'START', exact: true }).count()) === 0);
    check('画面が 1440×900 に収まる(準備)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'semi-prep.png') });

    console.log('S2 進出者紹介 → 選手カード表示 → 第1セット');
    await next(admin, /^1人目へ/);
    await sleep(900);
    check('紹介 1 / 9', /紹介\s*1 \/ 9/.test(await text(admin)), (await header(admin)).slice(0, 120));
    check('「戻る」がバーに出る', (await admin.getByRole('button', { name: /◀ 戻る/ }).count()) === 1);
    check('画面が収まる(進出者紹介)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'semi-intro.png') });
    for (let i = 0; i < 12; i++) { await sleep(850); if (/選手カードを表示 ▶/.test(await header(admin))) break; const btn = admin.locator('header button').filter({ hasText: /人目へ|写真・プロフィールを表示/ }).first(); await btn.click(); }
    await sleep(900);
    check('最後は「選手カードを表示 ▶」', /選手カードを表示 ▶/.test(await header(admin)), (await header(admin)).slice(0, 140));
    await next(admin, /選手カードを表示/);
    await sleep(900);
    check('選手カード表示中は「表示中…」で押せない', /表示中…/.test(await header(admin)), (await header(admin)).slice(0, 120));
    check('画面が収まる(選手カード表示)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    check('演出が終わると「第1セット クイズ画面へ ▶」', await waitText(admin, 'header', /第1セット クイズ画面へ ▶/, 45000), (await header(admin)).slice(0, 120));
    await next(admin, /第1セット クイズ画面へ/);
    await sleep(1000);

    console.log('S3 クイズ: タイマー → タイムアップ → 振り返り範囲 → 振り返り');
    check('バーにタイマー(5:00 と START/STOP)', /5:00/.test(await header(admin)) && (await admin.getByRole('button', { name: 'START', exact: true }).count()) === 1);
    check('選手9名のカードが並ぶ', ((await text(admin, 'main')).match(/選手/g) || []).length >= 9);
    check('画面が収まる(クイズ)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await next(admin, /タイマー START/);
    await sleep(1800);
    check('計測中になり、タイマーが進む', /計測中/.test(await header(admin)) && /4:5\d/.test(await header(admin)), (await header(admin)).slice(0, 140));
    await click(admin, /^STOP$/);
    await sleep(600);
    check('止めると「タイマー再開 ▶」', /タイマー再開 ▶/.test(await header(admin)), (await header(admin)).slice(0, 140));
    const sc = await socketClient();
    sc.emit('change_semifinal_timer', { action: 'edit', seconds: 0 });
    await sleep(900);
    check('タイムアップで範囲の入力欄が出る', (await admin.locator('main input[aria-label="開始の通し番号"]').count()) === 1);
    check('範囲が空のあいだ「問題振り返りへ ▶」は押せない', (await admin.locator('header button', { hasText: /問題振り返りへ/ }).count()) === 0 && /問題振り返りへ ▶/.test(await header(admin)));
    check('画面が収まる(範囲の入力)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.locator('main input[aria-label="開始の通し番号"]').fill('1');
    await admin.locator('main input[aria-label="終了の通し番号"]').fill('6');
    await sleep(300);
    await next(admin, /問題振り返りへ/);
    await sleep(1200);
    check('振り返り: 問題 1〜3 が別解つきで出る', /問題 1 の本文/.test(await text(admin, 'main')) && /別解1/.test(await text(admin, 'main')) && !/問題 4 の本文/.test(await text(admin, 'main')));
    check('画面が収まる(振り返り)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'semi-review.png') });
    await next(admin, /次の3問/);
    await sleep(900);
    check('2ページ目は 4〜6', /問題 4 の本文/.test(await text(admin, 'main')));
    check('「前の3問」で戻れる', (await admin.getByRole('button', { name: /◀ 前の3問/ }).count()) === 1);

    console.log('S4 得点集計: 未入力は確定できない → 入力 → 二度押しでも1回だけ → Undo → 再確定');
    await next(admin, /得点集計へ/);
    await sleep(900);
    check('「得点を確定 ▶」は入力するまで押せない', (await admin.locator('header button', { hasText: /得点を確定/ }).count()) === 0);
    check('9名分の入力欄', (await admin.locator('input[aria-label$="の得点"]').count()) === 9);
    check('画面が収まる(得点集計)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'semi-tally.png') });
    await fillTally(admin, id => 10 - id);
    await sleep(300);
    check('全員入れると押せる', (await admin.locator('header button', { hasText: /得点を確定/ }).count()) === 1);
    api.delay = 700; api.calls.score = 0;
    await next(admin, /得点を確定/);
    await sleep(100);
    await admin.locator('header button', { hasText: /得点を確定/ }).click({ force: true, timeout: 400 }).catch(() => {});
    await sleep(1800);
    api.delay = 0;
    check('得点の API は 1 回だけ', api.calls.score === 1, `calls=${api.calls.score}`);
    check('得点が入った(選手1=9, 選手9=1)', api.players[0].semifinalPoint === 9 && api.players[8].semifinalPoint === 1);
    check('Undo に直前の操作名', /直前: 第1セット 得点確定/.test(await header(admin)), (await header(admin)).slice(0, 200));
    check('進行ボタンは「点数発表へ ▶」', /点数発表へ ▶/.test(await header(admin)));
    await sleep(500);
    await click(admin, /Undo/);
    await sleep(1200);
    check('Undo で得点が 0 に戻る', api.players.every(p => p.semifinalPoint === 0) && api.calls.undo === 1);
    check('得点集計に戻り、入力欄が使える', /得点を確定 ▶/.test(await header(admin)) && (await admin.locator('input[aria-label$="の得点"]').first().isEnabled()));
    check('操作の記録に「取り消し」', /取り消し/.test(await text(admin, 'aside')));
    console.log('  (失敗したときは通知が出て、進まない)');
    api.failNext = true;
    await next(admin, /得点を確定/);
    await sleep(900);
    check('失敗が画面に出る', /テスト用の失敗/.test(await text(admin)), (await text(admin)).slice(0, 200));
    check('進行は進まない(まだ得点集計)', /得点を確定 ▶/.test(await header(admin)));
    await next(admin, /得点を確定/);
    await sleep(1200);
    check('再確定できる', api.players[0].semifinalPoint === 9);

    console.log('S5 点数発表 → 勝ち抜け判定 → 敗退判定 → 第2セット');
    await next(admin, /点数発表へ/);
    await sleep(900);
    check('発表中は押せない', /発表中\.\.\./.test(await header(admin)), (await header(admin)).slice(0, 120));
    // 得点は確定するまで出さず「?」を明滅させる（2026-11-12）。発表の初めは全員「?」、終わると「?」は残らない
    check('発表の初めは全員の得点の代わりに「?」', (await main.locator('[data-sf-score-wait]').count()) >= 2, String(await main.locator('[data-sf-score-wait]').count()));
    check('発表が終わると「勝ち抜け判定 ▶」', await waitText(admin, 'header', /勝ち抜け判定 ▶/, 45000), (await header(admin)).slice(0, 120));
    check('発表が終わると「?」は残らない', (await main.locator('[data-sf-score-wait]').count()) === 0);
    check('画面が収まる(点数発表)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await next(admin, /勝ち抜け判定/);
    await sleep(1200);
    check('選手1が勝ち抜け(第1セット)', api.players[0].semifinalRank === 1);
    check('「敗退判定 ▶」になる', /敗退判定 ▶/.test(await header(admin)));
    await next(admin, /敗退判定/);
    await sleep(1200);
    check('最下位2名(選手8・9)が敗退', api.players[7].semifinalRank === -1 && api.players[8].semifinalRank === -1);
    check('LOST と WIN が出る', /LOST/.test(await text(admin, 'main')) && /WIN/.test(await text(admin, 'main')));
    check('「第2セット クイズ画面へ ▶」', /第2セット クイズ画面へ ▶/.test(await header(admin)));
    check('敗退したセット(1)が記録される', api.players[7].semifinalLostSet === 1 && api.players[8].semifinalLostSet === 1);
    // 決着したセットのあいだは、会場にも出したまま（2026-11-11）
    check('第1セットのうちは決着した選手も会場に出る', (await main.locator('[data-sf-retired]').count()) === 0);
    await next(admin, /第2セット クイズ画面へ/);
    await sleep(1200);
    check('第2セットのクイズ画面', /第2セット/.test(await header(admin)) && /5:00/.test(await header(admin)));
    // 前のセットまでに決着した選手は会場から消す。場所は詰めない（2026-11-11）
    {
        const ok = await main.waitForFunction(() => document.querySelectorAll('[data-sf-retired]').length === 3, null, { timeout: 6000 }).then(() => true, () => false);
        const ids = await main.locator('[data-sf-retired]').evaluateAll(els => els.map(e => Number(e.getAttribute('data-sf-retired'))).sort((a, b) => a - b));
        check('第2セット: 選手1(勝ち抜け)・8・9(敗退)が会場から消える', ok && ids.join(',') === '1,8,9', ids.join(','));
        const boxes = await main.locator('[data-sf-retired]').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.width, getComputedStyle(e).visibility]; }));
        check('消した選手の場所は空けたまま(幅あり・見えない)', boxes.every(([w, v]) => w > 50 && v === 'hidden'), JSON.stringify(boxes));
        check('Admin では消さずに LOST が出たまま', /LOST/.test(await text(admin, 'main')));
    }

    console.log('S6 第2セット: 同点でサドンデス');
    sc.emit('change_semifinal_timer', { action: 'edit', seconds: 0 });
    await sleep(800);
    check('第2セットの開始の初期値は前のセットの続き(7)', (await admin.locator('main input[aria-label="開始の通し番号"]').inputValue()) === '7');
    // 上限(100)で折り返す範囲（2026-11-11）
    await admin.locator('main input[aria-label="開始の通し番号"]').fill('99');
    await admin.locator('main input[aria-label="終了の通し番号"]').fill('2');
    await sleep(300);
    check('折り返す範囲の中身が出る', /No\.99〜No\.100、No\.1〜No\.2（4問）/.test(await text(admin, 'main')), await text(admin, 'main'));
    await next(admin, /問題振り返りへ/);
    await sleep(1200);
    check('振り返り1ページ目は 99・100・1', /問題 99 の本文[\s\S]*問題 100 の本文[\s\S]*問題 1 の本文/.test(await text(admin, 'main')), (await text(admin, 'main')).slice(0, 200));
    check('会場にも 99・100・1', await waitText(main, 'body', /問題 99 の本文[\s\S]*問題 100 の本文[\s\S]*問題 1 の本文/), (await text(main)).slice(0, 200));
    check('メタに折り返す範囲', /No\.99〜No\.100、No\.1〜No\.2（4問）/.test(await header(admin)) || /No\.99〜No\.100、No\.1〜No\.2/.test(await text(admin)), '');
    await next(admin, /次の3問/);
    await sleep(900);
    check('2ページ目は 2 だけ', /問題 2 の本文/.test(await text(admin, 'main')) && !/問題 99 の本文/.test(await text(admin, 'main')));
    await next(admin, /得点集計へ/);
    await sleep(900);
    check('入力欄は勝ち抜け・敗退済みを除く6名', (await admin.locator('input[aria-label$="の得点"]').count()) === 6);
    // 選手2〜7 の累計: 8,7,6,5,4,3 → 選手2と3を同点(8)に
    await fillTally(admin, { 2: 0, 3: 1, 4: -1, 5: -1, 6: -1, 7: -1 });
    await next(admin, /得点を確定/);
    await sleep(1200);
    await next(admin, /点数発表へ/);
    await waitText(admin, 'header', /勝ち抜け判定 ▶/, 45000);
    await next(admin, /勝ち抜け判定/);
    await sleep(1200);
    check('同点なのでサドンデスに入る', /サドンデス/.test(await header(admin)), (await header(admin)).slice(0, 160));
    check('サドンデス中は押せない表示', /サドンデス中\.\.\./.test(await header(admin)));
    check('対象の2名だけが並ぶ(正解ボタン2つ)', (await admin.getByRole('button', { name: '正解' }).count()) === 2);
    check('勝ち抜けはまだ確定していない', api.players.every(p => p.semifinalRank !== 2));
    check('画面が収まる(サドンデス)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'semi-playoff.png') });
    console.log('  (手動の待機画面中は採点しない)');
    await sleep(700);
    await click(admin, /^待機画面$/);
    await sleep(800);
    await admin.getByRole('button', { name: '正解' }).first().click();
    await sleep(500);
    check('待機中は採点されない・理由が出る', /Main が待機中のため採点できません/.test(await text(admin)) && /サドンデス中\.\.\./.test(await header(admin)) === false);
    await click(admin, /覆いを外す/);
    await sleep(800);
    await admin.getByRole('button', { name: '誤答' }).first().click();
    await sleep(900);
    check('誤答で決着 → 「結果を確定 ▶」', /結果を確定 ▶/.test(await header(admin)), (await header(admin)).slice(0, 160));
    check('Undo に直前の操作名(サドンデス 誤答)', /直前: .+ サドンデス 誤答/.test(await header(admin)), (await header(admin)).slice(0, 200));
    await click(admin, /Undo/);
    await sleep(900);
    check('Undo でサドンデスの1手が戻り、また決着前', /サドンデス中\.\.\./.test(await header(admin)));
    await click(admin, /スルー/);
    await sleep(500);
    check('スルーでエラーが出ない', !/失敗/.test(await text(admin)));
    await admin.getByRole('button', { name: '正解' }).first().click();
    await sleep(900);
    await next(admin, /結果を確定/);
    await sleep(1400);
    check('サドンデスの勝者が勝ち抜け(第2セット)', api.players.some(p => p.semifinalRank === 2));
    check('結果の画面に戻り「敗退判定 ▶」', /敗退判定 ▶/.test(await header(admin)), (await header(admin)).slice(0, 140));
    await next(admin, /敗退判定/);
    await sleep(1200);
    check('第2セットの敗退2名が確定', api.players.filter(p => p.semifinalRank === -1).length === 4);
    check('「第3セット クイズ画面へ ▶」', /第3セット クイズ画面へ ▶/.test(await header(admin)));

    console.log('S7 第3セットを終えて Final へ');
    await next(admin, /第3セット クイズ画面へ/);
    await sleep(1200);
    sc.emit('change_semifinal_timer', { action: 'edit', seconds: 0 });
    await sleep(800);
    await admin.locator('main input[aria-label="開始の通し番号"]').fill('10');
    await admin.locator('main input[aria-label="終了の通し番号"]').fill('12');
    await next(admin, /問題振り返りへ/);
    await sleep(1000);
    await next(admin, /得点集計へ/);
    await sleep(900);
    check('入力欄は残り3名', (await admin.locator('input[aria-label$="の得点"]').count()) === 3);
    await fillTally(admin, (id, i) => [5, 3, 1][i]);
    await next(admin, /得点を確定/);
    await sleep(1200);
    await next(admin, /点数発表へ/);
    await waitText(admin, 'header', /勝ち抜け判定 ▶/, 45000);
    await next(admin, /勝ち抜け判定/);
    await sleep(1200);
    await next(admin, /敗退判定/);
    await sleep(1400);
    check('第3セットの判定が終わると「Final へ ▶」', /Final へ ▶/.test(await header(admin)), (await header(admin)).slice(0, 160));
    check('決勝進出者の確認が出る', /決勝進出者を確認/.test(await text(admin, 'main')) && /SET 1/.test(await text(admin, 'main')) && /SET 2/.test(await text(admin, 'main')) && /SET 3/.test(await text(admin, 'main')));
    check('画面が収まる(終了)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'semi-finish.png') });

    console.log('S8 引き出し(表示の切り替え・データ修正)');
    await sleep(500);
    await click(admin, /表示の切り替え/);
    check('セットと Main 表示の切り替えが並ぶ', /第1セット/.test(await text(admin, 'main')) && /点数発表/.test(await text(admin, 'main')) && /得点を入力し直す/.test(await text(admin, 'main')));
    check('画面が収まる(表示の切り替えを開いた状態)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await click(admin, /^データ修正/);
    check('タイマーと結果リセットが並ぶ', /RESET（5:00）/.test(await text(admin, 'main')) && /Semi-Final の結果をリセット/.test(await text(admin, 'main')));
    await click(admin, /Semi-Final の結果をリセット/);
    await sleep(1400);
    check('結果リセットの API が呼ばれ、得点が 0 に戻る', api.calls.reset === 1 && api.players.every(p => p.semifinalPoint === 0 && p.semifinalRank === 0));

    console.log('S9 再読み込みしても Semi-Final のまま');
    await admin.reload(); await admin.waitForTimeout(2800);
    check('Semi-Final のまま・上のバーが出る', /Semi-Final/.test(await header(admin)), (await header(admin)).slice(0, 100));
    check('モードが Semi-Final のまま', await admin.getByRole('button', { name: /^Semi-Final/ }).getAttribute('aria-current') === 'page');

    sc.close();
    check('画面でエラー(未処理の例外)が出ていない', errors.length === 0, errors.slice(0, 3).join(' / '));
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'semi-admin.png') });
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('E2E ERROR', e); await stopServer(); process.exit(2); });
