// 3rd Round の運営コンソール（載せ替え後）を、実ブラウザ(Chromium)で運営者の操作どおりに動かすテスト。
// DB は使えないので、3rd Round の API だけ画面側で差し替えた偽物(メモリ上)で動かす。
// 実行: リポジトリのルートで  node tests/e2e/third-round.e2e.js   （Playwright と socket.io-client が必要）
// 事前: 3100 番が空いていること。サーバはこのスクリプトが起動・停止する（保存先は $KQK_ROOT/state.json）。
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

// ---- 偽の 3rd Round API ----
const COURSE_NAMES = ['10 up-down', 'Freeze 10', 'Swedish 10', '10 by 10'];
function makeFakeApi() {
    const players = [];
    for (let i = 1; i <= 48; i++) {
        players.push({
            id: i, entryNo: i, paperRank: i, school: '高校', grade: '高2', name: `選手 ${i}`,
            secondRoundGroupNumber: ((i - 1) % 4) + 1, secondRoundPoint: 0, secondRoundWrongCount: 0,
            secondRoundDoubleChance: false, secondRoundRank: i <= 20 ? i : -1, thirdRoundCourseName: null,
            thirdRoundCorrectCount: 0, thirdRoundWrongCount: 0, thirdRoundUpDownPoint: 0, thirdRoundSwedishCross: 0,
            thirdRoundFreezeRest: 0, thirdRoundRank: 0, extraRoundSecondStep: false, extraRoundCorrectCount: 0,
            extraRoundRank: 0, semifinalPoint: 0, semifinalRank: 0, finalCorrectCount: 0, finalWrongCount: 0,
            finalSetsWon: 0, finalRank: 0, nickname: '',
        });
    }
    const courses = COURSE_NAMES.map((name, i) => ({ id: i + 1, name, playOrder: null }));
    const api = { players, courses, calls: { score: 0, undo: 0, draw: 0, assign: 0 }, history: [], delay: 0, undoCourses: [] };
    const winners = () => players.filter(p => p.secondRoundRank >= 1).sort((a, b) => a.secondRoundRank - b.secondRoundRank);
    api.install = async (page) => {
        await page.route('**/api/secondRound/loadPlayers', r => r.fulfill({ json: { success: true, allPlayers: players } }));
        await page.route('**/api/tournamentState', r => r.fulfill({ json: { success: true, state: { extraRoundNoRevival: false, tournamentName: 'テスト大会' } } }));
        await page.route('**/api/thirdRound/courses', r => r.fulfill({ json: { success: true, courses } }));
        await page.route('**/api/thirdRound/courseSelect', r => r.fulfill({ json: { success: true, winners: winners() } }));
        await page.route('**/api/thirdRound/draw', async r => {
            if (r.request().method() !== 'POST') return r.fulfill({ json: { success: true, courses, allPlayers: players } });
            api.calls.draw++;
            const rest = courses.filter(c => c.playOrder === null);
            const next = rest[0];
            next.playOrder = courses.filter(c => c.playOrder !== null).length + 1;
            r.fulfill({ json: { success: true, courses } });
        });
        await page.route('**/api/thirdRound/assignCourse', async r => {
            if (r.request().method() !== 'POST') return r.fulfill({ json: { success: true, allPlayers: players, courses } });
            api.calls.assign++;
            const { courseName, raisedIds } = JSON.parse(r.request().postData());
            const free = winners().filter(p => !p.thirdRoundCourseName);
            const raised = free.filter(p => raisedIds.includes(p.id));
            const rest = free.filter(p => !raisedIds.includes(p.id));
            const pick = [...raised, ...rest].slice(0, 5);
            pick.forEach(p => { p.thirdRoundCourseName = courseName; });
            r.fulfill({ json: { success: true, allPlayers: players, assigned: pick.map(p => ({ id: p.id, entryNo: p.entryNo, name: p.name, secondRoundRank: p.secondRoundRank, paperRank: p.paperRank, forced: !raisedIds.includes(p.id) })) } });
        });
        await page.route('**/api/thirdRound/updateScores', async r => {
            api.calls.score++;
            const { playerId, action, courseName } = JSON.parse(r.request().postData());
            api.history.push({ courseName, snap: JSON.stringify(players) });
            const p = players.find(x => x.id === playerId);
            if (p && action === 'correct') { p.thirdRoundCorrectCount += 1; p.thirdRoundUpDownPoint += 1; }
            if (p && action === 'wrong') p.thirdRoundWrongCount += 1;
            if (api.delay) await sleep(api.delay);
            r.fulfill({ json: { success: true, allPlayers: players, shouldStopTimer: false, historyAdded: true } });
        });
        await page.route('**/api/thirdRound/undo', async r => {
            api.calls.undo++;
            const { courseName } = JSON.parse(r.request().postData());
            api.undoCourses.push(courseName);
            const idx = [...api.history].map(h => h.courseName).lastIndexOf(courseName);
            if (idx < 0) return r.fulfill({ status: 400, json: { error: '取り消せる操作がありません' } });
            const [h] = api.history.splice(idx, 1);
            JSON.parse(h.snap).forEach(s => Object.assign(players.find(x => x.id === s.id), s));
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
        await page.route('**/api/thirdRound/resetScores', async r => {
            players.forEach(p => Object.assign(p, { thirdRoundCorrectCount: 0, thirdRoundWrongCount: 0, thirdRoundUpDownPoint: 0, thirdRoundSwedishCross: 0, thirdRoundFreezeRest: 0, thirdRoundRank: 0 }));
            r.fulfill({ json: { success: true, allPlayers: players, courses } });
        });
    };
    return api;
}

// ---- サーバの起動・停止 ----
let serverProc = null;
function startServer() {
    return new Promise((resolve) => {
        serverProc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3100', KQK_STATE_FILE: path.join(ROOT, 'state3.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
/** 画面が 1440×900 に収まっているか（ページ全体・採点面・バーのはみ出し） */
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

    console.log('S1 3rd Round を開く → 待機画面 → ブランク → コース選択（二度押しで飛ばない）');
    await click(admin, /^3rd Round/);
    check('待機画面 NEXT 3rd Round が会場に出る', await waitText(main, 'body', /NEXT 3rd Round PLEASE STAND BY/));
    check('運営コンソールの枠(上のバー)で表示される', (await admin.locator('header').count()) === 1);
    check('進行ボタンは「待機画面を消す ▶」', /待機画面を消す ▶/.test(await header(admin)), await header(admin));
    await sleep(650);
    const dismiss = admin.getByRole('button', { name: /待機画面を消す/ });
    await dismiss.click(); await sleep(40);
    await dismiss.click({ force: true, timeout: 500 }).catch(() => {});
    await sleep(1200);
    check('会場はブランク', (await text(main)) === '', await text(main));
    check('進行ボタンは「コースの抽選を始める ▶」で止まっている', /コースの抽選を始める ▶/.test(await header(admin)), await header(admin));
    await sleep(650);
    await click(admin, /コースの抽選を始める/);
    await sleep(1200);
    check('進行ボタンは「1番目のコースを抽選 ▶」', /1番目のコースを抽選 ▶/.test(await header(admin)), await header(admin));
    check('画面が 1440×900 に収まる(コース選択・抽選前)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));

    console.log('S2 4コースを抽選して、挙手を選んで、出場者を確定する');
    for (let k = 1; k <= 4; k++) {
        await click(admin, new RegExp(`^${k}番目のコースを抽選`));
        await sleep(900);
        check(`${k}番目: 抽選された(API 1 回ずつ)`, api.calls.draw === k, `draw=${api.calls.draw}`);
        if (k === 4) {
            // 最後のコース（残り1つ）は回転を短く（3秒。2026-11-11）。光の輪が出るまでの時間で確かめる
            const t0 = Date.now();
            const landed = await main.waitForFunction(() => document.querySelectorAll('[data-reel-land-ring]').length === 2, null, { timeout: 8000, polling: 50 }).then(() => true, () => false);
            const ms = Date.now() - t0;
            check('4番目: 回転が短く、約3秒で止まる', landed && ms < 4500, `ms=${ms}`);
        }
        if (k === 1) {
            // ルーレットが止まった瞬間の演出（2026-11-11 B案）。回っている間は出ず、止まったら光の輪が2枚出て、少しして消える
            check('回っている間は止まった演出が出ない', (await main.locator('[data-reel-land-ring]').count()) === 0);
            const landed = await main.waitForFunction(() => document.querySelectorAll('[data-reel-land-ring]').length === 2, null, { timeout: 17000, polling: 50 }).then(() => true, () => false);
            check('止まった瞬間に演出(光の輪2枚)が出る', landed);
            // 部品が出るだけでなく、実際に光っている（動きの定義が届いていて、透明のままではない）
            const lit = await main.evaluate(() => [...document.querySelectorAll('[data-reel-land-ring]')].some(e => Number(getComputedStyle(e).opacity) > 0.3));
            check('光の輪が実際に光っている(透明のままではない)', lit);
            if (process.env.SHOT_DIR) { await sleep(120); await main.screenshot({ path: `${process.env.SHOT_DIR}/third-reel-landed.png` }); }
            const gone = await main.waitForFunction(() => document.querySelectorAll('[data-reel-land-ring]').length === 0, null, { timeout: 4500 }).then(() => true, () => false);
            check('演出は約2.8秒で消える', gone);
        }
        await click(admin, /エントリー締切/);
        await sleep(700);
        const rows = await admin.locator('button[aria-pressed]').count();
        check(`${k}番目: エントリー一覧に未割当の選手が並ぶ(${20 - 5 * (k - 1)}名)`, rows === 20 - 5 * (k - 1), `rows=${rows}`);
        if (k === 1) {
            check('画面が収まる(エントリー一覧・20名)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
            await admin.locator('button[aria-pressed]').nth(2).click();
            await admin.locator('button[aria-pressed]').nth(4).click();
            await sleep(200);
            check('挙手2名・強制3名と進行ボタンに出る', /出場者を確定（挙手 2名＋強制 3名）/.test(await header(admin)), await header(admin));
        }
        await click(admin, /出場者を確定/);
        await sleep(900);
        check(`${k}番目: 出場者が5名確定`, api.players.filter(p => p.thirdRoundCourseName === api.courses.find(c => c.playOrder === k).name).length === 5);
        if (k === 1) {
            const body = await text(admin);
            check('確定した出場者に「挙手」「強制」が付く', /挙手/.test(body) && /強制/.test(body));
            check('画面が収まる(確定後)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
        }
    }
    check('4コースそろうと「1コース目（…）へ ▶」', /1コース目（.+）へ ▶/.test(await header(admin)), await header(admin));

    console.log('S3 クイズ開始: 会場はブランク → 待機中は採点できない → 始める');
    await sleep(650);
    await click(admin, /1コース目（.+）へ/);
    await sleep(1000);
    check('進行ボタンは「クイズを始める ▶」', /クイズを始める ▶/.test(await header(admin)), await header(admin));
    check('会場はブランク', (await text(main)) === '', await text(main));
    api.calls.score = 0;
    await admin.getByRole('button', { name: '正解' }).first().click();
    await sleep(500);
    check('待機中は採点の API が呼ばれない', api.calls.score === 0);
    check('理由が画面に出る', /Main が待機中のため採点できません/.test(await text(admin)));
    await sleep(700);
    await click(admin, /クイズを始める/);
    await sleep(1200);
    check('バーにタイマーが出る(15:00 と START/STOP)', /15:00/.test(await header(admin)) && (await admin.getByRole('button', { name: 'START' }).count()) === 1);
    check('画面が収まる(クイズ中・タイマー付きのバー)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));

    console.log('S4 採点の二度押し(通信が遅いとき)で二重に入らない・Undo で戻る');
    api.delay = 700; api.calls.score = 0;
    const ok = admin.getByRole('button', { name: '正解' }).first();
    await ok.click(); await sleep(80); await ok.click({ force: true, timeout: 500 }).catch(() => {});
    await sleep(1600);
    check('API は 1 回だけ呼ばれた', api.calls.score === 1, `calls=${api.calls.score}`);
    check('正解数は 1(2 ではない)', api.players.find(p => p.thirdRoundCorrectCount > 0)?.thirdRoundCorrectCount === 1);
    api.delay = 0;
    check('Undo に直前の操作名が出る', /直前: .+ 正解/.test(await header(admin)), (await header(admin)).slice(0, 160));
    check('操作の記録に残る', /正解/.test(await text(admin, 'aside')));
    await sleep(500);
    await click(admin, /Undo/);
    await sleep(1200);
    check('Undo で正解数が 0 に戻る', api.players.every(p => p.thirdRoundCorrectCount === 0));
    check('操作の記録に「取り消し」が出る', /取り消し/.test(await text(admin, 'aside')));

    console.log('S5 誤答・スルー・タイマー・サドンデスの画面切り替え');
    await admin.getByRole('button', { name: '誤答' }).first().click();
    await sleep(900);
    check('誤答が入る', api.players.some(p => p.thirdRoundWrongCount === 1));
    await click(admin, /スルー/);
    await sleep(500);
    check('スルーでエラーが出ない', !/失敗/.test(await text(admin)));
    await click(admin, 'START');
    await sleep(1800);
    check('タイマーが動く(15:00 ではなくなる)', !/15:00/.test(await header(admin)) && /14:5\d/.test(await header(admin)), (await header(admin)).slice(0, 120));
    await click(admin, 'STOP');
    await sleep(500);
    await click(admin, /表示の切り替え/);
    await click(admin, /^サドンデス$/);
    await sleep(900);
    check('サドンデスの画面に切り替わる', /サドンデス/.test(await header(admin)), await header(admin));
    check('画面が収まる(サドンデス)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await click(admin, /表示の切り替え/);   // 閉じる
    await click(admin, /表示の切り替え/);
    await click(admin, /^(10 up-down|Freeze 10|Swedish 10|10 by 10)$/);
    await sleep(600);

    console.log('S6 データ修正の引き出し(リセット)');
    await click(admin, /^データ修正/);
    check('引き出しに抽選・タイマー・コースの結果が並ぶ', /抽選・出場者/.test(await text(admin)) && /タイマー/.test(await text(admin)) && /の結果/.test(await text(admin)));
    check('画面が収まる(引き出しを開いた状態)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await click(admin, /^リセット（/);
    await sleep(900);
    check('コースの結果がリセットされる(誤答 0)', api.players.every(p => p.thirdRoundWrongCount === 0));

    console.log('S7 運営画面を再読み込みしても、いまのコースのまま');
    await admin.reload(); await admin.waitForTimeout(2800);
    check('3rd Round 1コース目のまま', /3rd Round\s*1コース目/.test(await header(admin)), (await header(admin)).slice(0, 100));
    check('モードが 3rd Round のまま', await admin.getByRole('button', { name: /^3rd Round/ }).getAttribute('aria-current') === 'page');

    console.log('S8 手動の待機画面 → 採点できない → 外す / 強制解除');
    await sleep(700);
    await click(admin, /^待機画面$/);
    await sleep(900);
    api.calls.score = 0;
    await admin.getByRole('button', { name: '正解' }).first().click();
    await sleep(500);
    check('手動の待機中は採点されない', api.calls.score === 0);
    await click(admin, /覆いを外す/);
    await sleep(900);
    check('強制解除で覆いが消える', (await admin.getByRole('button', { name: /覆いを外す/ }).count()) === 0);

    console.log('S9 コースの決着 → クイズを終了 → 待機画面 → 次のコース');
    // 1コース目の5名に 10 正解の勝ち抜け2名・失格3名を作る
    const course1 = api.courses.find(c => c.playOrder === 1).name;
    const ps = api.players.filter(p => p.thirdRoundCourseName === course1).sort((a, b) => a.paperRank - b.paperRank);
    ps[0].thirdRoundRank = 1; ps[1].thirdRoundRank = 2; ps[2].thirdRoundRank = -1; ps[3].thirdRoundRank = -1; ps[4].thirdRoundRank = -1;
    const sc = await socketClient();
    sc.emit('broadcast_scores', api.players);
    await sleep(900);
    check('進行ボタンは「クイズを終了する ▶」', /クイズを終了する ▶/.test(await header(admin)), (await header(admin)).slice(0, 140));
    check('終了条件のお知らせが出る', /終了条件成立/.test(await text(admin)));
    check('勝ち抜けに 1st・2nd と LOST が出る', /1st/.test(await text(admin)) && /LOST/.test(await text(admin)));
    await sleep(650);
    await click(admin, /クイズを終了する/);
    await sleep(900);
    check('会場はブランク', (await text(main)) === '', await text(main));
    await sleep(650);
    await click(admin, /待機画面を表示する/);
    await sleep(900);
    check('待機画面 NEXT 3rd Round が会場に出る(次のコース名つき)', await waitText(main, 'body', /NEXT 3rd Round/), await text(main));
    check('運営画面は 2コース目', /3rd Round\s*2コース目/.test(await header(admin)), (await header(admin)).slice(0, 100));
    sc.close();

    check('画面でエラー(未処理の例外)が出ていない', errors.length === 0, errors.slice(0, 3).join(' / '));
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'third-admin.png') });
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('E2E ERROR', e); await stopServer(); process.exit(2); });
