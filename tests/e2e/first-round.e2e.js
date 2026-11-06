// 1st Round（タイマー・名簿の取り込み）の運営コンソール（載せ替え後）を、実ブラウザ(Chromium)で運営者の操作どおりに動かすテスト。
// DB は使えないので、名簿の API だけ画面側で差し替えた偽物(メモリ上)で動かす。
// 実行: リポジトリのルートで  node tests/e2e/first-round.e2e.js   （Playwright と socket.io-client が必要）
// 事前: 3100 番が空いていること。サーバはこのスクリプトが起動・停止する（保存先は $KQK_ROOT/state7.json）。
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

// ---- 偽の名簿 API ----
function makeFakeApi() {
    const players = [];
    const api = { players, posts: [], needConfirm: false, failNext: false, delay: 0 };
    const mk = (r) => ({
        id: r[0] * 1, entryNo: r[1] * 1, paperRank: r[0] * 1, school: r[2], grade: r[3], name: r[4],
        secondRoundGroupNumber: 1, secondRoundPoint: 0, secondRoundWrongCount: 0, secondRoundDoubleChance: false, secondRoundRank: 0,
        thirdRoundCourseName: null, thirdRoundCorrectCount: 0, thirdRoundWrongCount: 0, thirdRoundUpDownPoint: 0, thirdRoundSwedishCross: 0,
        thirdRoundFreezeRest: 0, thirdRoundRank: 0, extraRoundSecondStep: false, extraRoundCorrectCount: 0, extraRoundRank: 0,
        semifinalPoint: 0, semifinalRank: 0, finalCorrectCount: 0, finalWrongCount: 0, finalSetsWon: 0, finalRank: 0, nickname: '',
    });
    api.install = async (page) => {
        await page.route('**/api/secondRound/loadPlayers', r => r.fulfill({ json: { success: true, allPlayers: players } }));
        await page.route('**/api/tournamentState', r => r.fulfill({ json: { success: true, state: { extraRoundNoRevival: false, tournamentName: 'テスト大会' } } }));
        await page.route('**/api/thirdRound/courses', r => r.fulfill({ json: { success: true, courses: [] } }));
        await page.route('**/api/firstRound', async r => {
            const b = JSON.parse(r.request().postData());
            api.posts.push(b);
            if (api.delay) await sleep(api.delay);
            if (api.failNext) { api.failNext = false; return r.fulfill({ status: 500, json: { error: 'テスト用の失敗' } }); }
            if (api.needConfirm && b.confirmClearHistory !== true) return r.fulfill({ status: 409, json: { error: '履歴が残っています', needsConfirmation: true } });
            players.length = 0;
            b.players.forEach(row => players.push(mk(row)));
            r.fulfill({ json: { success: true, count: players.length, allPlayers: players, courses: [] } });
        });
    };
    return api;
}

// ---- サーバの起動・停止 ----
let serverProc = null;
function startServer() {
    try { require('fs').rmSync(path.join(ROOT, 'state7.json'), { force: true }); } catch {}
    return new Promise((resolve) => {
        serverProc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3100', KQK_STATE_FILE: path.join(ROOT, 'state7.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
const GOOD = '順位,番号,学校,学年,氏名\n1,101,A高校,高2,選手 一\n2,102,B高校,高1,選手 二\n3,103,C高校,高3,選手 三\n4,104,D高校,高2,選手 四\n5,105,E高校,高1,選手 五\n';
const BAD = '順位,番号,学校,学年,氏名\n1,101,A高校,高2,選手 一\nx,102,B高校,高1,選手 二\n1,103,C高校,高3,選手 三\n4,104\n';
const csvFile = (name, content) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(content, 'utf8') });

(async () => {
    await startServer();
    await sleep(500);
    const browser = await chromium.launch();
    const api = makeFakeApi();
    const admin = await openAdmin(browser, api);
    const main = await openMain(browser, api);
    const ctl = await socketClient();
    const errors = [];
    admin.on('pageerror', e => { if (!/not valid JSON/.test(e.message)) errors.push(e.message); });
    main.on('pageerror', e => { if (!/not valid JSON/.test(e.message)) errors.push(e.message); });
    const shot = (n) => admin.screenshot({ path: path.join(ROOT, 'pw', `first-${n}.png`) });

    console.log('F1 1st Round を開く → タイマーの開始・停止');
    await click(admin, /^1st Round/);
    await sleep(1200);
    check('運営コンソールの枠(上のバー)で表示される', (await admin.locator('header').count()) === 1);
    check('バーに「1st Round」', /1st Round/.test(await header(admin)), await header(admin));
    check('進行ボタンは「タイマーを開始 ▶」', /タイマーを開始 ▶/.test(await header(admin)), await header(admin));
    check('大きな残り時間 20:00', /20:00/.test(await text(admin, 'main')));
    check('Main にも 20:00', /20:00/.test(await text(main)), await text(main));
    check('STOP は押せない(開始前)', await admin.getByRole('button', { name: 'STOP', exact: true }).isDisabled());
    check('画面が 1440×900 に収まる(開始前)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('timer');
    await admin.getByRole('button', { name: 'START', exact: true }).dblclick();
    await sleep(2600);
    check('計測中になり、残り時間が減っている', /計測中/.test(await text(admin, 'main')) && !/20:00/.test(await text(admin, 'role=timer').catch(() => '')) , await text(admin, 'main'));
    check('進行ボタンは「計測中（残り …）」(押せない)', /計測中（残り/.test(await header(admin)) && (await admin.locator('header button', { hasText: /計測中/ }).count()) === 0, await header(admin));
    check('START は押せず、STOP が押せる', await admin.getByRole('button', { name: 'START', exact: true }).isDisabled() && !(await admin.getByRole('button', { name: 'STOP', exact: true }).isDisabled()));
    check('Main の時間も減っている', !/20:00/.test(await text(main)), await text(main));
    check('画面が収まる(計測中)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.getByRole('button', { name: 'STOP', exact: true }).click();
    await sleep(3500);
    const t1 = await text(admin, '[role=timer]');
    await sleep(2000);
    check('STOP で止まる(時間が変わらない)', t1 === (await text(admin, '[role=timer]')), t1);
    check('停止中・進行ボタンは「タイマーを再開 ▶」', /停止中/.test(await text(admin, 'main')) && /タイマーを再開 ▶/.test(await header(admin)), await header(admin));
    check('操作の記録に開始と停止', /タイマー開始/.test(await text(admin, 'aside')) && /タイマー停止/.test(await text(admin, 'aside')), await text(admin, 'aside'));
    await next(admin, /タイマーを再開/);
    await sleep(2600);
    check('進行ボタンで再開できる', /計測中/.test(await text(admin, 'main')));
    await admin.getByRole('button', { name: 'STOP', exact: true }).click();
    await sleep(3200);

    console.log('F2 データ修正（時間の増減・リセット）');
    await click(admin, 'データ修正');
    const before = await text(admin, '[role=timer]');
    await admin.getByRole('button', { name: '−1分', exact: true }).click();
    await sleep(700);
    const after = await text(admin, '[role=timer]');
    const sec = (s) => Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]);
    check('−1分で 60 秒減る', sec(before) - sec(after) === 60, `${before} → ${after}`);
    check('操作の記録に時間の変更', /時間を −01:00/.test(await text(admin, 'aside')), await text(admin, 'aside'));
    check('画面が収まる(データ修正を開いた状態)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await admin.getByRole('button', { name: 'タイマーをリセット', exact: true }).click();
    await sleep(900);
    check('リセットで 20:00・開始前', (await text(admin, '[role=timer]')) === '20:00' && /開始前/.test(await text(admin, 'main')));

    console.log('F3 時間切れ → 集計結果の入力へ');
    ctl.emit('1R_edit_timer', 3);
    await sleep(600);
    check('3秒に直った', (await text(admin, '[role=timer]')) === '00:03', await text(admin, '[role=timer]'));
    await next(admin, /タイマーを(開始|再開)/);
    await sleep(5500);
    check('TIME UP になる', /TIME UP/.test(await text(admin, 'main')), await text(admin, 'main'));
    check('進行ボタンは「集計結果の入力へ ▶」', /集計結果の入力へ ▶/.test(await header(admin)), await header(admin));
    check('START は押せない(終了後)', await admin.getByRole('button', { name: 'START', exact: true }).isDisabled());
    await shot('timeup');
    await admin.reload(); await admin.waitForTimeout(2800);
    check('再読み込みしても TIME UP のまま・結果入力へ進める', /集計結果の入力へ ▶/.test(await header(admin)), await header(admin));
    await next(admin, /集計結果の入力へ/);
    await sleep(1200);

    console.log('F4 名簿の取り込み');
    check('集計結果の画面になる', /集計結果/.test(await header(admin)), await header(admin));
    check('進行ボタンは「CSV を選んでください」', /CSV を選んでください/.test(await header(admin)), await header(admin));
    check('Main は 2nd Round の待機画面', /2nd Round/i.test(await text(main)), await text(main));
    check('画面が収まる(取り込み前)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    const input = admin.locator('input[type=file]');
    await input.setInputFiles(csvFile('bad.csv', BAD));
    await sleep(600);
    check('誤りの行が3件まで画面に出る(数字でない順位・重複・列不足)', /3 行目/.test(await text(admin, 'main')) && /重複/.test(await text(admin, 'main')) && /列が足りません/.test(await text(admin, 'main')), (await text(admin, 'main')).slice(0, 300));
    check('進行ボタンは誤りの件数を出して押せない', /誤りがあります（3件）/.test(await header(admin)) && (await admin.locator('header button', { hasText: /誤り/ }).count()) === 0, await header(admin));
    check('見出し行を読み飛ばした旨が出る', /見出しとして読み飛ばしました/.test(await text(admin, 'main')));
    await shot('bad');
    await input.setInputFiles(csvFile('good.csv', GOOD));
    await sleep(600);
    check('正しい CSV: 「5名を登録する ▶」', /5名を登録する ▶/.test(await header(admin)), await header(admin));
    check('プレビューに5名', (await admin.locator('table tbody tr').count()) === 5);
    check('画面が収まる(プレビュー)', fitsAll(await fits(admin)), JSON.stringify(await fits(admin)));
    await shot('good');
    api.failNext = true;
    await next(admin, /5名を登録する/);
    await sleep(900);
    check('失敗は画面に出て、CSV は残る', /テスト用の失敗/.test(await text(admin, 'body')) && /5名を登録する ▶/.test(await header(admin)), await text(admin, 'body').then(t => t.slice(0, 200)));
    api.needConfirm = true; api.delay = 700;
    await sleep(800);
    await admin.locator('header button', { hasText: /5名を登録する/ }).dblclick();
    await sleep(2500);
    check('確認(409)に了承して登録される。二度押しでも取り込みは1回(確認つき)', api.posts.filter(p => p.confirmClearHistory).length === 1 && api.players.length === 5, JSON.stringify(api.posts.map(p => p.confirmClearHistory)));
    check('見出し行は送らない・5列の配列で送る', api.posts[api.posts.length - 1].players.length === 5 && api.posts[api.posts.length - 1].players[0].join('|') === '1|101|A高校|高2|選手 一');
    check('「登録しました（5名）」が出る', /登録しました（5名）/.test(await text(admin, 'body')));
    check('進行ボタンは「2nd Round へ ▶」', /2nd Round へ ▶/.test(await header(admin)), await header(admin));
    check('操作の記録に名簿の登録', /名簿を登録（5名）/.test(await text(admin, 'aside')));

    console.log('F5 タイマーへ戻る・2nd Round へ');
    await click(admin, /← タイマーへ/);
    await sleep(1200);
    check('1st Round のタイマー画面に戻る', /タイマー/.test(await header(admin)) && (await admin.locator('[role=timer]').count()) === 1, await header(admin));
    check('サイドバーは 1st Round が現在地', await admin.getByRole('button', { name: /^1st Round/ }).getAttribute('aria-current') === 'page');
    await admin.getByRole('button', { name: '表示の切り替え' }).click();
    await admin.getByRole('button', { name: '集計結果の入力へ', exact: true }).click();
    await sleep(1000);
    check('「表示の切り替え」からも集計結果へ進める', /集計結果/.test(await header(admin)), await header(admin));
    await next(admin, /2nd Round へ/);
    await sleep(1500);
    check('2nd Round へ進む', await admin.getByRole('button', { name: /^2nd Round/ }).getAttribute('aria-current') === 'page');

    check('画面でエラー(未処理の例外)が出ていない', errors.length === 0, errors.slice(0, 3).join(' / '));
    ctl.close();
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('E2E ERROR', e); await stopServer(); process.exit(2); });
