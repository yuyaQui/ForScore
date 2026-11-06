// Main 画面の「ブランク → 実際の画面」切り替えで、他の画面が一瞬大きく映る不具合の退行テスト（2026-11-06）。
// 覆いを外した直後の描画を毎フレーム記録し、(1) 最初のコマから正しい倍率であること
// (2) 状態が届く前の既定の画面（別の画面）が映らず、黒 → 本物の画面の順になることを確かめる。
// DB は使えないので、選手・コース・写真の API だけ画面側で差し替えた偽物で動かす。
// 実行: リポジトリのルートで  node tests/e2e/main-flash.e2e.js   （Playwright と socket.io-client が必要）
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
        await page.route('**/api/semifinal/profiles', r => r.fulfill({ json: { success: true, profiles: [] } }));
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

const INIT = `
window.__frames = [];
(function loop() {
  const stage = document.querySelector('div[style*="width: 1920px"][style*="scale("]');
  let rec = null;
  if (stage) {
    const m = /scale\\(([0-9.]+)\\)/.exec(stage.getAttribute('style') || '');
    rec = { scale: m ? Number(m[1]) : null, text: (stage.innerText || '').replace(/\\s+/g, ' ').slice(0, 60) };
  } else rec = { scale: null, text: '(stageなし)' };
  const last = window.__frames[window.__frames.length - 1];
  if (!last || last.scale !== rec.scale || last.text !== rec.text) window.__frames.push({ t: Math.round(performance.now()), ...rec });
  requestAnimationFrame(loop);
})();
`;
const EXPECT_SCALE = 800 / 1920; // ウィンドウ 800×450

async function runCase(browser, api, { mode, label, prep, real }) {
    const main = await browser.newPage({ viewport: { width: 800, height: 450 } });
    await main.addInitScript(INIT);
    await api.install(main);
    await main.goto(`${BASE}/main`);
    await sleep(1200);
    const ctl = await socketClient();
    let cover = { rev: 0 };
    ctl.on('update_main_cover', c => { cover = c; });
    ctl.emit('request_main_cover_sync');
    await sleep(300);
    ctl.emit('change_mode', { mode, resume: true });          // 結果のあるラウンドへ戻る → ブランク
    await sleep(600);
    if (prep) { prep(ctl); await sleep(600); }
    check(`${label}: 覆いはブランクになっている`, cover.kind === 'blank', `kind=${cover.kind}`);
    await main.evaluate(() => { window.__frames.length = 0; window.__t0 = performance.now(); });
    ctl.emit('change_main_cover', { cover: { kind: 'none', at: null, title: null, sub: null, startLabel: null }, expectRev: cover.rev });
    await sleep(3200);
    const frames = await main.evaluate(() => { const t0 = window.__t0; return window.__frames.map(f => ({ ...f, t: f.t - Math.round(t0) })); });
    frames.forEach(f => console.log(`    +${String(f.t).padStart(4)}ms scale=${f.scale} 「${f.text}」`));
    check(`${label}: 描画されたどのコマも倍率が正しい（${EXPECT_SCALE.toFixed(3)}）`,
        frames.length > 0 && frames.every(f => f.scale !== null && Math.abs(f.scale - EXPECT_SCALE) < 0.001),
        JSON.stringify(frames.map(f => f.scale)));
    // 黒（文字なし）のコマ以外は、必ず本物の画面の文字であること（既定の別画面が混ざらない）
    const nonBlank = frames.filter(f => f.text !== '');
    check(`${label}: 黒でないコマはすべて本物の画面`, nonBlank.every(f => real.test(f.text)), JSON.stringify(nonBlank.map(f => f.text)));
    check(`${label}: 本物の画面が表示された`, nonBlank.length > 0 && real.test(nonBlank[nonBlank.length - 1].text), JSON.stringify(frames.map(f => f.text)));
    ctl.close();
    await main.close();
}

(async () => {
    await startServer();
    await sleep(500);
    const browser = await chromium.launch();
    const api = makeFakeApi();
    api.players = Array.from({ length: 3 }, (_, i) => player(i + 1));
    console.log('Semi-Final（状態は quiz）');
    await runCase(browser, api, { mode: 'semifinal', label: 'Semi-Final', prep: ctl => ctl.emit('change_semifinal_state', { view: 'quiz' }), real: /Semifinal|SET/ });
    console.log('3rd Round');
    await runCase(browser, api, { mode: 'thirdRound', label: '3rd Round', real: /3rd Round/ });
    console.log('Final（状態は quiz）');
    await runCase(browser, api, { mode: 'final', label: 'Final', prep: ctl => ctl.emit('change_final_state', { set: 1, view: 'quiz', introIndex: 0, resultRank: 0 }), real: /SET|Final|決勝/ });
    console.log('2nd Round');
    await runCase(browser, api, { mode: 'secondRound', label: '2nd Round', real: /./ });
    await browser.close();
    await stopServer();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('ERROR', e); await stopServer(); process.exit(2); });
