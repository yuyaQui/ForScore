// ブラウザ(Chromium)で運営画面と会場画面を開いて、運営者の操作を再現するテスト。
// 実行: リポジトリのルートで  node tests/e2e/second-round.e2e.js   （Playwright と socket.io-client が必要。DB は使わない）
// 事前: 3100 番が空いていること。サーバはこのスクリプトが起動・停止・再起動する（保存先は $KQK_ROOT/state.json）。
// 開発サーバ(next dev)は再起動すると画面を自動で読み込み直すため、再起動の場面は待ち時間を長めにしてある。
// 実ブラウザ(Chromium)で Admin と Main を開き、運営者の操作を再現するテスト。
// DB は使えないので、2nd Round の API だけ画面側で差し替えた偽物(メモリ上)で動かす。
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

// ---- 偽の 2nd Round API ----
function makeFakeApi() {
    const players = [];
    for (let i = 1; i <= 48; i++) {
        players.push({
            id: i, entryNo: i, paperRank: i, school: '高校', grade: '高2', name: `選手 ${i}`,
            secondRoundGroupNumber: ((i - 1) % 4) + 1, secondRoundPoint: 0, secondRoundWrongCount: 0,
            secondRoundDoubleChance: false, secondRoundRank: 0, thirdRoundCourseName: null,
            thirdRoundCorrectCount: 0, thirdRoundWrongCount: 0, thirdRoundUpDownPoint: 0, thirdRoundSwedishCross: 0,
            thirdRoundFreezeRest: 0, thirdRoundRank: 0, extraRoundSecondStep: false, extraRoundCorrectCount: 0,
            extraRoundRank: 0, semifinalPoint: 0, semifinalRank: 0, finalCorrectCount: 0, finalWrongCount: 0,
            finalSetsWon: 0, finalRank: 0, nickname: '',
        });
    }
    const api = { players, calls: { score: 0, undo: 0 }, undoGroups: [], history: {}, delay: 0 };
    api.install = async (page) => {
        await page.route('**/api/secondRound/loadPlayers', r => r.fulfill({ json: { success: true, allPlayers: players } }));
        await page.route('**/api/secondRound/updateScores', async r => {
            api.calls.score++;
            const { playerId, action } = JSON.parse(r.request().postData());
            const p = players.find(x => x.id === playerId);
            const g = p.secondRoundGroupNumber;
            (api.history[g] ||= []).push(JSON.stringify(players.filter(x => x.secondRoundGroupNumber === g)));
            if (action === 'correct') p.secondRoundPoint += 1; else p.secondRoundWrongCount += 1;
            if (api.delay) await sleep(api.delay);
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
        await page.route('**/api/secondRound/undo', async r => {
            api.calls.undo++;
            const { secondRoundState } = JSON.parse(r.request().postData());
            api.undoGroups.push(secondRoundState.group);
            const h = api.history[secondRoundState.group] || [];
            if (!h.length) return r.fulfill({ status: 400, json: { error: '取り消せる操作がありません' } });
            for (const s of JSON.parse(h.pop())) Object.assign(players.find(x => x.id === s.id), s);
            r.fulfill({ json: { success: true, allPlayers: players } });
        });
    };
    return api;
}

// ---- サーバの起動・停止(再起動の再現) ----
let serverProc = null;
function startServer() {
    return new Promise((resolve) => {
        serverProc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3100', KQK_STATE_FILE: path.join(ROOT, 'state.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
async function waitText(page, sel, re, ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (re.test(await text(page, sel))) return true; await sleep(100); }
    return false;
}
function socketClient() {
    return new Promise((resolve) => { const s = io(BASE, { transports: ['websocket'], forceNew: true }); s.on('connect', () => resolve(s)); });
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

    console.log('S1 ラウンドを開く → 待機画面 → ブランク → 本編（二度押しで飛ばない）');
    await click(admin, /^2nd Round/);
    check('待機画面 NEXT 2nd Round が会場に出る', await waitText(main, 'body', /NEXT 2nd Round PLEASE STAND BY/));
    check('進行ボタンは「待機画面を消す ▶」', /待機画面を消す ▶/.test(await header(admin)));
    await sleep(650);   // 画面が変わってから人が押すまでの間
    // 二度押し(間隔 40ms)
    const dismiss = admin.getByRole('button', { name: /待機画面を消す/ });
    await dismiss.click(); await sleep(40);
    await dismiss.click({ force: true, timeout: 500 }).catch(() => {});
    await sleep(1200);
    check('会場はブランク(待機画面も本編も出ない)', (await text(main)) === '', await text(main));
    check('進行ボタンは「ターンオーバーを始める ▶」で止まっている', /ターンオーバーを始める ▶/.test(await header(admin)), await header(admin));
    await sleep(650);
    await click(admin, /ターンオーバーを始める/);
    check('本編(ターンオーバー)が会場に出る', await waitText(main, 'body', /選手|Turn|位/));

    console.log('S2 組を切り替えて会場を再読み込み → 切り替えた組の表示(取り直し)');
    await click(admin, /表示の切り替え/);
    await click(admin, /^3組目$/);
    await click(admin, /^クイズ画面$/);
    await sleep(600);
    check('会場に Set 3 のクイズ画面', await waitText(main, 'body', /Set 3/));
    await main.reload(); await main.waitForTimeout(2500);
    check('会場を再読み込みしても Set 3(初期値の Set 1 に戻らない)', /Set 3/.test(await text(main)) && !/Set 1/.test(await text(main)), (await text(main)).slice(0, 120));

    console.log('S3 運営画面を再読み込み → 組の状態を引き継ぐ');
    await admin.reload(); await admin.waitForTimeout(2500);
    check('運営画面は 3組目のまま', /2nd Round\s*3組目/.test(await header(admin)), (await header(admin)).slice(0, 100));
    check('モードが 2nd Round のまま(大会準備に戻らない)', await admin.getByRole('button', { name: /^2nd Round/ }).getAttribute('aria-current') === 'page');

    console.log('S4 手動の待機画面 → 外すと元の表示に戻る');
    await click(admin, /^待機画面$/);
    check('会場は PLEASE STAND BY だけ(NEXT なし)', await waitText(main, 'body', /^PLEASE STAND BY$/), await text(main));
    check('進行ボタンは「待機画面を消す ▶」', /待機画面を消す ▶/.test(await header(admin)));
    await sleep(700);
    await click(admin, /待機画面を消す/);
    check('元の Set 3 のクイズ画面に戻る', await waitText(main, 'body', /Set 3/));

    console.log('S5 採点の二度押し(通信が遅いとき)で二重に入らない');
    api.delay = 700; api.calls.score = 0;
    const ok = admin.getByRole('button', { name: '正解' }).first();
    await ok.click(); await sleep(80); await ok.click({ force: true, timeout: 500 }).catch(() => {});
    await sleep(1600);
    check('API は 1 回だけ呼ばれた', api.calls.score === 1, `calls=${api.calls.score}`);
    check('得点は 1 点(2 点ではない)', api.players.find(p => p.secondRoundGroupNumber === 3 && p.secondRoundPoint > 0)?.secondRoundPoint === 1);
    api.delay = 0;

    console.log('S6 待機中は採点できず、理由が画面に出る');
    await sleep(700);
    await click(admin, /^待機画面$/);
    await sleep(900);
    api.calls.score = 0;
    await admin.getByRole('button', { name: '誤答' }).first().click();
    await sleep(600);
    check('API は呼ばれない', api.calls.score === 0);
    check('理由が画面に出る', /Main が待機中のため採点できません/.test(await text(admin)));
    await click(admin, /待機画面を消す/);
    await sleep(900);

    console.log('S7 覆いの強制解除(行き止まりの脱出口)');
    await click(admin, /^待機画面$/);
    await sleep(500);
    await sleep(700);
    // 手動の待機画面 → 通常の戻し方ではなく、強制解除で外す
    await click(admin, /覆いを外す/);
    check('強制解除で本編が出る', await waitText(main, 'body', /Set 3/));
    check('「覆いを外す」ボタンは消える', (await admin.getByRole('button', { name: /覆いを外す/ }).count()) === 0);

    console.log('S8 次の組へ進めた後の Undo → 前の組まで戻り、会場はブランクで再開待ち');
    // 組 3 の採点が 1 件ある状態。サーバに「直前の操作は g3」と記録し、運営画面は 4 組目の待機画面にする
    const sc = await socketClient();
    sc.emit('set_question_cursor', { round: 'secondRound', serial: 5 });
    await sleep(300);
    sc.emit('finish_question', { round: 'secondRound', serial: 5, scope: 'g3', scored: true });
    await sleep(300);
    // 次の組へ(待機画面 NEXT 2nd Round / Set 4)
    sc.emit('change_2nd_round_state', { group: 4, view: 'turnOver', turnOverStep: 0, turnOverPhase: 'collapsed' });
    await sleep(300);
    const rev = await new Promise(res => { sc.once('update_main_cover', c => res(c.rev)); sc.emit('request_main_cover_sync'); });
    sc.emit('change_main_cover', { cover: { kind: 'standby', at: 'start', title: '2nd Round', sub: 'Set 4', startLabel: 'ターンオーバーを始める' }, expectRev: rev });
    await sleep(900);
    check('Undo が押せる(次の組へ進めた後でも)', await admin.getByRole('button', { name: /Undo/ }).isEnabled());
    api.undoGroups.length = 0;
    await click(admin, /Undo/);
    await sleep(1500);
    check('取り消し先は前の組(3組目)', api.undoGroups[0] === 3, `groups=${api.undoGroups}`);
    check('運営画面は 3組目のクイズに戻る', /2nd Round\s*3組目/.test(await header(admin)), (await header(admin)).slice(0, 100));
    check('会場はブランク(戻した画面をいきなり出さない)', (await text(main)) === '', await text(main));
    check('進行ボタンは「クイズを再開する ▶」', /クイズを再開する ▶/.test(await header(admin)), await header(admin));
    await sleep(700);
    await click(admin, /クイズを再開する/);
    check('押すと 3組目のクイズが会場に出る', await waitText(main, 'body', /Set 3/));
    sc.close();

    console.log('S9 サーバ停止 → 接続切れの帯 → 操作は送られない → 再起動で元の状態に戻る');
    await sleep(800);
    await click(admin, /^待機画面$/);          // 手動の待機画面(再起動後も戻るか)
    await sleep(900);
    await stopServer();
    check('接続切れの帯が出る', await waitText(admin, 'body', /サーバとの接続が切れています/, 8000));
    await admin.getByRole('button', { name: /待機画面を消す/ }).click().catch(() => {});
    await sleep(500);
    check('切断中の操作は送られなかったと知らせる', /送られませんでした/.test(await text(admin)));
    await startServer();
    check('つながると接続切れの帯が消える', await waitText(admin, 'body', /^((?!サーバとの接続が切れています).)*$/, 25000));
    // 開発サーバは再起動すると画面を自動で読み込み直し、最初の表示にコンパイルの時間がかかるので、数秒待つ
    check('再起動後も手動の待機画面のまま(切断中の「消す」は実行されていない)', await waitText(main, 'body', /^PLEASE STAND BY$/, 25000), (await text(main)).slice(0, 100));
    check('再起動後も 3組目', await waitText(admin, 'header', /2nd Round\s*3組目/, 25000), (await header(admin)).slice(0, 100));
    await sleep(700);
    // 開発サーバの自動再読み込みが遅れて来ることがあるので、表示が落ち着くのを待ってから押す
    for (let i = 0; i < 3; i++) { await waitText(admin, 'header', /3組目.*待機画面を消す/, 25000); await sleep(1500); }
    const before = await header(admin);
    await click(admin, /待機画面を消す/);
    const okAfter = await waitText(main, 'body', /Set 3/, 25000);   // 会場の再接続は最大で数秒かかる
    check('再起動後の操作も通る', okAfter, `header=${before.slice(0,120)} / main=${(await text(main)).slice(0,80)} / notice=${(await text(admin)).slice(0,160)}`);

    check('画面でエラー(未処理の例外)が出ていない', errors.length === 0, errors.slice(0, 3).join(' / '));
    await admin.screenshot({ path: path.join(ROOT, 'e2e-final-admin.png') });
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('E2E ERROR', e); await stopServer(); process.exit(2); });
