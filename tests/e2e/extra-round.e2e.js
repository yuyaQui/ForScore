// Extra Round の運営コンソール（載せ替え後）を、実ブラウザ(Chromium)で運営者の操作どおりに動かすテスト。
// DB は使えないので、Extra Round の API だけ画面側で差し替えた偽物(メモリ上)で動かす。
// 実行: リポジトリのルートで  node tests/e2e/extra-round.e2e.js   （Playwright と socket.io-client が必要）
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

// ---- 偽の Extra Round API ----
function makeFakeApi() {
    const players = [];
    for (let i = 1; i <= 48; i++) {
        players.push({
            id: i, entryNo: i, paperRank: i, school: '高校', grade: '高2', name: `選手 ${i}`,
            secondRoundGroupNumber: ((i - 1) % 4) + 1, secondRoundPoint: 0, secondRoundWrongCount: 0,
            secondRoundDoubleChance: false, secondRoundRank: i <= 20 ? i : -1, thirdRoundCourseName: null,
            thirdRoundCorrectCount: 0, thirdRoundWrongCount: 0, thirdRoundUpDownPoint: 0, thirdRoundSwedishCross: 0,
            thirdRoundFreezeRest: 0, thirdRoundRank: i <= 8 ? i : (i <= 20 ? -1 : 0), extraRoundSecondStep: false, extraRoundCorrectCount: 0,
            extraRoundRank: 0, semifinalPoint: 0, semifinalRank: 0, finalCorrectCount: 0, finalWrongCount: 0,
            finalSetsWon: 0, finalRank: 0, nickname: '',
        });
    }
    const questions = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, text: `テスト問題文 ${i + 1} です`, answer: `解答${i + 1}`, altAnswer: i % 2 ? '別解あり' : '' }));
    const api = { players, calls: { score: 0, undo: 0, entrants: 0 }, history: [], delay: 0 };
    api.install = async (page) => {
        await page.route('**/api/secondRound/loadPlayers', r => r.fulfill({ json: { success: true, allPlayers: players } }));
        await page.route('**/api/tournamentState', r => r.fulfill({ json: { success: true, state: { extraRoundNoRevival: false, tournamentName: 'テスト大会' } } }));
        await page.route('**/api/thirdRound/courses', r => r.fulfill({ json: { success: true, courses: [] } }));
        await page.route(/\/api\/extraRound\/questions(\?|$)/, r => r.fulfill({ json: { success: true, questions } }));
        await page.route('**/api/extraRound/secondStepEntrants', async r => {
            api.calls.entrants++;
            const { entryNos } = JSON.parse(r.request().postData());
            players.forEach(p => { p.extraRoundSecondStep = entryNos.includes(p.entryNo); });
            r.fulfill({ json: { success: true, allPlayers: players, singleWinner: entryNos.length === 1 } });
        });
        await page.route('**/api/extraRound/secondStep/updateScore', async r => {
            api.calls.score++;
            const { playerId, action } = JSON.parse(r.request().postData());
            api.history.push(JSON.stringify(players));
            const p = players.find(x => x.id === playerId);
            if (action === 'correct') { p.extraRoundCorrectCount += 1; if (p.extraRoundCorrectCount >= 5) { p.extraRoundRank = 1; players.filter(x => x.extraRoundSecondStep && x !== p && x.extraRoundRank === 0).forEach(x => { x.extraRoundRank = -1; }); } }
            else p.extraRoundRank = -1;
            if (api.delay) await sleep(api.delay);
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
        await page.route('**/api/extraRound/secondStep/undo', async r => {
            api.calls.undo++;
            const h = api.history.pop();
            if (!h) return r.fulfill({ status: 400, json: { error: '取り消せる操作がありません' } });
            JSON.parse(h).forEach(s => Object.assign(players.find(x => x.id === s.id), s));
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
        await page.route('**/api/extraRound/reset', async r => {
            players.forEach(p => Object.assign(p, { extraRoundSecondStep: false, extraRoundCorrectCount: 0, extraRoundRank: 0 }));
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
    };
    return api;
}

// ---- サーバの起動・停止 ----
let serverProc = null;
function startServer() {
    return new Promise((resolve) => {
        serverProc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3100', KQK_STATE_FILE: path.join(ROOT, 'state4.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const sc = await socketClient();

    console.log('S1 Extra Round を開く → 待機画面 → ブランク → 問題取込');
    await click(admin, /^Extra Round/);
    check('待機画面 NEXT Extra Round が会場に出る', await waitText(main, 'body', /NEXT Extra Round PLEASE STAND BY/));
    check('運営コンソールの枠(上のバー)で表示される', (await admin.locator('header').count()) === 1);
    await sleep(650);
    await click(admin, /待機画面を消す/);
    await sleep(1200);
    check('会場はブランク', (await text(main)) === '', await text(main));
    check('進行ボタンは「Extra Round を始める ▶」', /Extra Round を始める ▶/.test(await header(admin)), await header(admin));
    await sleep(650);
    await click(admin, /Extra Round を始める/);
    await sleep(1200);
    check('問題取込の画面(登録済みの問題を使える)', /登録済み 20問/.test(await text(admin)) && (await admin.getByRole('button', { name: /登録済みの問題を使う/ }).count()) === 1, (await text(admin)).slice(0, 200));
    check('画面が収まる(問題取込)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await click(admin, /登録済みの問題を使う/);
    await sleep(1000);

    console.log('S2 First Step: 問題を表示 → 次へ（二度押しで飛ばない）');
    check('First Step の画面(進行ボタンは「問題を表示 ▶」)', /問題を表示 ▶/.test(await header(admin)), await header(admin));
    check('問題文と解答が運営画面に出る', /テスト問題文 1 です/.test(await text(admin)) && /解答1/.test(await text(admin)));
    check('画面が収まる(First Step)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await sleep(900);
    const reveal = admin.getByRole('button', { name: /問題を表示/ });
    await reveal.click(); await sleep(40);
    await reveal.click({ force: true, timeout: 500 }).catch(() => {});
    await sleep(1200);
    check('二度押しでも「問題 1」のまま(先へ飛ばない)', /問題 1/.test(await header(admin)) && /次へ（問題 2） ▶/.test(await header(admin)), await header(admin));
    await sleep(900);
    await click(admin, /次へ（問題 2）/);
    await sleep(1000);
    check('問題 2 に進む(未表示)', /問題 2/.test(await header(admin)) && /問題を表示 ▶/.test(await header(admin)), await header(admin));
    await click(admin, /◀ 戻る/);
    await sleep(1000);
    check('戻ると 問題 1(表示済み)', /問題 1/.test(await header(admin)) && /次へ（問題 2） ▶/.test(await header(admin)), await header(admin));

    console.log('S3 フェーズの最後の解答 → 次のフェーズへ／進出者決定');
    await click(admin, /表示の切り替え/);
    await admin.locator('select').selectOption('19');
    await sleep(800);
    await click(admin, /^閉じる$/);
    check('解答 10 の位置(解答を表示 ▶)', /解答を表示 ▶/.test(await header(admin)), await header(admin));
    await sleep(900);
    await click(admin, /解答を表示/);
    await sleep(1000);
    check('進出者決定と次のフェーズへが出る', /Second Step 進出者決定 ▶/.test(await header(admin)) && /次のフェーズへ ▶/.test(await header(admin)), await header(admin));
    check('お知らせが出る(フェーズ終了)', /終了。進出者を決めるか/.test(await text(admin)));
    check('画面が収まる(フェーズ最後)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await sleep(900);
    await click(admin, /進出者決定/);
    await sleep(1200);

    console.log('S4 進出者選択: 3名選んで確定');
    check('進行ボタンは「進出者を選んでください」', /進出者を選んでください/.test(await header(admin)), await header(admin));
    const rows = await admin.locator('button[aria-pressed]').count();
    check('候補が並ぶ(3rd Round 通過の8名を除いた40名)', rows === 40, `rows=${rows}`);
    check('画面が収まる(進出者選択・40名)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.locator('button[aria-pressed]').nth(0).click();
    await admin.locator('button[aria-pressed]').nth(1).click();
    await admin.locator('button[aria-pressed]').nth(2).click();
    await sleep(300);
    check('進行ボタンは「Second Step へ（3名） ▶」', /Second Step へ（3名） ▶/.test(await header(admin)), await header(admin));
    await admin.getByPlaceholder('名前・学校・エントリーNoで検索').fill('選手 4');
    await sleep(300);
    check('検索で絞り込める', (await admin.locator('button[aria-pressed]').count()) >= 1 && (await admin.locator('button[aria-pressed]').count()) < 40);
    await admin.getByPlaceholder('名前・学校・エントリーNoで検索').fill('');
    await sleep(900);
    await click(admin, /Second Step へ（3名）/);
    await sleep(1200);
    check('API が 1 回呼ばれた', api.calls.entrants === 1, `entrants=${api.calls.entrants}`);
    check('3名が出場者になった', api.players.filter(p => p.extraRoundSecondStep).length === 3);

    console.log('S5 Second Step: 待機中は採点できない → 始める → 採点・二度押し・Undo');
    await sleep(500);
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
    check('出場者3名がカードで並ぶ', (await admin.getByRole('button', { name: '正解' }).count()) === 3);
    check('画面が収まる(Second Step)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    sc.emit('set_question_cursor', { round: 'extraSecondStep', serial: 1 });
    await sleep(600);
    api.delay = 700; api.calls.score = 0;
    const ok = admin.getByRole('button', { name: '正解' }).first();
    await ok.click(); await sleep(80); await ok.click({ force: true, timeout: 500 }).catch(() => {});
    await sleep(1600);
    api.delay = 0;
    check('API は 1 回だけ呼ばれた', api.calls.score === 1, `calls=${api.calls.score}`);
    check('正解数は 1', api.players.filter(p => p.extraRoundSecondStep)[0].extraRoundCorrectCount === 1);
    check('Undo に直前の操作名が出る', /直前: .+ 正解/.test(await header(admin)), (await header(admin)).slice(0, 160));
    await sleep(500);
    await click(admin, /Undo/);
    await sleep(1200);
    check('Undo で正解数が 0 に戻る', api.players.filter(p => p.extraRoundSecondStep)[0].extraRoundCorrectCount === 0);
    check('操作の記録に「取り消し」が出る', /取り消し/.test(await text(admin, 'aside')));
    await sleep(500);
    await admin.getByRole('button', { name: '誤答' }).nth(1).click();
    await sleep(900);
    check('誤答で即 LOST', /LOST/.test(await text(admin)) && api.players.filter(p => p.extraRoundSecondStep)[1].extraRoundRank === -1);
    await click(admin, /スルー/);
    await sleep(500);
    { const t = await text(admin); const m = t.match(/.{0,60}(更新に失敗|反映されていません).{0,40}/); check('スルーでエラーが出ない', !m, m ? m[0] : ''); }

    console.log('S6 敗者復活が決まる → クイズを終了 → 待機画面');
    const p0 = api.players.filter(p => p.extraRoundSecondStep)[0];
    p0.extraRoundRank = 1; p0.extraRoundCorrectCount = 5;
    api.players.filter(p => p.extraRoundSecondStep && p !== p0).forEach(p => { p.extraRoundRank = -1; });
    sc.emit('broadcast_scores', api.players);
    await sleep(900);
    check('敗者復活の表示と WIN が出る', /WIN/.test(await text(admin)) && new RegExp(p0.name).test(await text(admin)));
    check('進行ボタンは「クイズを終了する ▶」', /クイズを終了する ▶/.test(await header(admin)), await header(admin));
    await sleep(650);
    await click(admin, /クイズを終了する/);
    await sleep(900);
    check('会場はブランク', (await text(main)) === '', await text(main));
    await sleep(650);
    await click(admin, /待機画面を表示する/);
    check('待機画面 NEXT Semi-Final が会場に出る', await waitText(main, 'body', /NEXT Semi-Final/), await text(main));

    console.log('S7 データ修正(リセット)と再読み込み');
    await click(admin, /^データ修正/);
    await click(admin, /Extra Round の結果をリセット/);
    await sleep(1000);
    check('結果がリセットされる', api.players.every(p => !p.extraRoundSecondStep));
    await admin.reload(); await admin.waitForTimeout(2800);
    check('再読み込みしても Extra Round のまま', await admin.getByRole('button', { name: /^Extra Round/ }).getAttribute('aria-current') === 'page');

    check('画面でエラー(未処理の例外)が出ていない', errors.length === 0, errors.slice(0, 3).join(' / '));
    await admin.screenshot({ path: path.join(ROOT, 'pw', 'extra-admin.png') });
    sc.close();
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('E2E ERROR', e); await stopServer(); process.exit(2); });
