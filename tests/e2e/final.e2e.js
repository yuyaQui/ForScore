// Final の運営コンソール（載せ替え後）を、実ブラウザ(Chromium)で運営者の操作どおりに動かすテスト。
// DB は使えないので、Final の API だけ画面側で差し替えた偽物(メモリ上)で動かす。
// 実行: リポジトリのルートで  node tests/e2e/final.e2e.js   （Playwright と socket.io-client が必要）
// 事前: 3100 番が空いていること。サーバはこのスクリプトが起動・停止する（保存先は $KQK_ROOT/state6.json）。
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
        // 取り込んだ問題は No.1〜No.100（2026-11-11。上限の次は最初に戻る）
        await page.route('**/api/questionPool', r => r.fulfill({ json: { success: true, summary: { count: 100, min: 1, max: 100, missing: [] } } }));
        await page.route(/\/api\/questions\?/, r => {
            const u = new URL(r.request().url());
            const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
            // 番号を並べた指定（?serials=99,100,1。2026-11-11）にも答える
            const list = u.searchParams.get('serials') ? u.searchParams.get('serials').split(',').map(Number) : null;
            const serials = list || Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
            const qs = [];
            for (const s of serials) qs.push({ serial: s, text: `問題 ${s} の本文です。`, answer: `答え${s}`, altAnswer: '' });
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
    try { require('fs').rmSync(path.join(ROOT, 'state6.json'), { force: true }); } catch {}
    return new Promise((resolve) => {
        serverProc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3100', KQK_STATE_FILE: path.join(ROOT, 'state6.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const shot = (n) => admin.screenshot({ path: path.join(ROOT, 'pw', `final-${n}.png`) });
    const ok = (i) => admin.getByRole('button', { name: '正解', exact: true }).nth(i);
    const ng = (i) => admin.getByRole('button', { name: '誤答', exact: true }).nth(i);

    console.log('F1 Final を開く → 待機画面 → ブランク → 待機 → 選手紹介 → クイズ');
    await click(admin, /^Final/);
    await sleep(1200);
    check('運営コンソールの枠(上のバー)で表示される', (await admin.locator('header').count()) === 1);
    check('待機画面 NEXT Final が会場に出る', await waitText(main, 'body', /NEXT Final/i), await text(main));
    check('進行ボタンは「待機画面を消す ▶」', /待機画面を消す ▶/.test(await header(admin)), await header(admin));
    await next(admin, /待機画面を消す/);
    await sleep(1000);
    check('会場はブランク', (await text(main)) === '', await text(main));
    await next(admin, /を始める|を表示する/);
    await sleep(1200);
    check('待機: 選手紹介の順に3名が並ぶ(二つ名つき)', /1人目/.test(await text(admin, 'main')) && /最速の男/.test(await text(admin, 'main')));
    check('進行ボタンは「選手紹介（1人目）▶」', /選手紹介（1人目）▶/.test(await header(admin)), await header(admin));
    check('画面が 1440×900 に収まる(待機)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await next(admin, /選手紹介（1人目）/);
    await sleep(900);
    check('紹介 1 / 3 と「戻る」', /紹介\s*1 \/ 3/.test(await text(admin, 'main')) && (await admin.getByRole('button', { name: /◀ 戻る/ }).count()) === 1);
    check('画面が収まる(選手紹介)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('intro');
    await next(admin, /選手紹介（2人目）/);
    await sleep(700);
    await next(admin, /選手紹介（3人目）/);
    await sleep(700);
    check('3人目のあとは「クイズ画面へ ▶」', /クイズ画面へ ▶/.test(await header(admin)), await header(admin));
    await next(admin, /クイズ画面へ/);
    await sleep(1000);

    console.log('F2 クイズ: 3名の採点・二度押し・失格');
    check('正解・誤答ボタンが3名ぶん', (await admin.getByRole('button', { name: '正解', exact: true }).count()) === 3 && (await admin.getByRole('button', { name: '誤答', exact: true }).count()) === 3);
    check('画面が収まる(クイズ)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('quiz');
    api.delay = 700; api.calls.score = 0;
    await ok(0).click(); await sleep(80); await ok(0).click({ force: true, timeout: 500 }).catch(() => {});
    await sleep(1600);
    api.delay = 0;
    check('二度押しでも API は 1 回だけ', api.calls.score === 1, `calls=${api.calls.score}`);
    check('選手1の正解数は 1(2 ではない)', api.players[0].finalCorrectCount === 1);
    check('Undo に直前の操作名', /直前: 選手 1 正解/.test(await header(admin)), (await header(admin)).slice(0, 200));
    await sleep(500);
    await click(admin, /Undo/);
    await sleep(1000);
    check('Undo で正解数が 0 に戻る', api.players[0].finalCorrectCount === 0 && api.calls.undo === 1);
    check('操作の記録に「取り消し」', /取り消し/.test(await text(admin, 'aside')));
    api.failNext = true;
    await ok(0).click();
    await sleep(900);
    check('失敗が画面に出て、得点は入らない', /テスト用の失敗/.test(await text(admin)) && api.players[0].finalCorrectCount === 0);
    await click(admin, /スルー/);
    await sleep(500);
    check('スルーでエラーが出ない', !/失敗しました/.test(await text(admin)));
    console.log('  (手動の待機画面中は採点しない)');
    await sleep(700);
    await click(admin, /^待機画面$/);
    await sleep(800);
    api.calls.score = 0;
    await ok(0).click();
    await sleep(500);
    check('待機中は採点されない・理由が出る', api.calls.score === 0 && /Main が待機中のため採点できません/.test(await text(admin)));
    await click(admin, /覆いを外す/);
    await sleep(800);

    console.log('F3 セット決着(失格2名で残り1名) → 次のセットへ → Undo でセット番号も戻る');
    for (let k = 0; k < 3; k++) { await ng(1).click(); await sleep(450); }
    check('選手2がこのセット失格(失格の印・ボタン無効)', /失格/.test(await text(admin, 'main')) && (await ng(1).isDisabled()));
    for (let k = 0; k < 3; k++) { await ng(2).click(); await sleep(450); }
    check('失格2名で決着 → 選手1が第1セットを獲得', api.players[0].finalSetsWon === 1);
    check('進行ボタンは「第2セットへ ▶」', /第2セットへ ▶/.test(await header(admin)), (await header(admin)).slice(0, 200));
    check('採点ボタンは押せない(決着後)', await ok(0).isDisabled());
    check('画面が収まる(セット決着)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('setover');
    await next(admin, /第2セットへ/);
    await sleep(1200);
    check('第2セットになり、正解数・誤答数が 0 に戻る', /第2セット/.test(await header(admin)) && api.players.filter(p => p.semifinalRank > 0).every(p => p.finalCorrectCount === 0 && p.finalWrongCount === 0));
    check('獲得セット数(選手1=1)が残る', api.players[0].finalSetsWon === 1);
    check('Undo に「第2セットへ」', /直前: 第2セットへ/.test(await header(admin)), (await header(admin)).slice(0, 200));
    await sleep(500);
    await click(admin, /Undo/);
    await sleep(1200);
    check('Undo で得点が前のセットの決着に戻り、セット番号も第1セットに戻る', /第1セット/.test(await header(admin)) && api.players[0].finalSetsWon === 1 && api.players[1].finalWrongCount === 3, (await header(admin)).slice(0, 120));
    await next(admin, /第2セットへ/);
    await sleep(1200);

    console.log('F4 7問正解で第2・第3セットを取って優勝 → 最終成績');
    for (let k = 0; k < 7; k++) { await ok(0).click(); await sleep(450); }
    check('第2セットも選手1が獲得(獲得 2)', api.players[0].finalSetsWon === 2);
    await next(admin, /第3セットへ/);
    await sleep(1200);
    for (let k = 0; k < 7; k++) { await ok(0).click(); await sleep(450); }
    await sleep(800);
    check('選手1が優勝(3セット)・選手2が準優勝・選手3が3位', api.players[0].finalRank === 1 && api.players[1].finalRank === 2 && api.players[8].finalRank === 3);
    check('最終成績の3つのボタンがバーに出る', (await admin.getByRole('button', { name: '優勝者を表示', exact: true }).count()) === 1 && (await admin.getByRole('button', { name: '準優勝者を表示', exact: true }).count()) === 1 && (await admin.getByRole('button', { name: '3位を表示', exact: true }).count()) === 1);
    check('スルーは出ない(終了後)', (await admin.getByRole('button', { name: /^スルー/ }).count()) === 0);
    check('画面が収まる(優勝決定・バーに3ボタン)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('champion');
    await click(admin, '優勝者を表示');
    await sleep(1000);
    check('優勝者を表示すると最終成績の画面になる', /最終成績/.test(await header(admin)), (await header(admin)).slice(0, 160));
    check('Main に優勝者が出る', await waitText(main, 'body', /選手\s*1/, 4000), (await text(main)).slice(0, 80));
    check('画面が収まる(最終成績)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await sleep(500);
    await click(admin, /◀ クイズ画面に戻る/);
    await sleep(900);
    check('クイズ画面に戻れる', !/最終成績/.test(await header(admin)));

    console.log('F5 引き出し(表示の切り替え・データ修正)');
    await sleep(500);
    await click(admin, /表示の切り替え/);
    check('Main 表示の切り替えが並ぶ', /紹介（2人目）/.test(await text(admin, 'main')) && /待機/.test(await text(admin, 'main')));
    check('画面が収まる(表示の切り替えを開いた状態)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await click(admin, /^データ修正/);
    check('結果リセットが並ぶ', /Final の結果をリセット/.test(await text(admin, 'main')));
    await click(admin, /Final の結果をリセット/);
    await sleep(1400);
    check('リセットの API が呼ばれ、結果が 0 に戻る', api.calls.reset === 1 && api.players.every(p => p.finalSetsWon === 0 && p.finalRank === 0));

    console.log('F6 再読み込みしても Final のまま');
    await admin.reload(); await admin.waitForTimeout(2800);
    check('Final のまま・上のバーが出る', /Final/.test(await header(admin)), (await header(admin)).slice(0, 100));
    check('モードが Final のまま', await admin.getByRole('button', { name: /^Final/ }).getAttribute('aria-current') === 'page');

    check('画面でエラー(未処理の例外)が出ていない', errors.length === 0, errors.slice(0, 3).join(' / '));
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('E2E ERROR', e); await stopServer(); process.exit(2); });
