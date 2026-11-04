// Main を覆う表示（待機画面・ブランク）の「遷移表」。サーバと Admin(TypeScript) の両方がこの1つの定義を使う。
// 純関数だけで書いてあり、Socket.IO も DB も知らない（tests/coverFlow.test.js が全状態×全操作を確かめる）。
//
// 覆いの6つの形（キー）:
//   N   なし（ラウンドの画面を出す）
//   BS  ブランク・これから始まる場面（startLabel のボタンで外す）
//   BE  ブランク・早押しが終わった後
//   SS  待機画面 NEXT ○○・これから始まる場面
//   SE  待機画面 NEXT ○○・終わった後（次のラウンドへ移るまで）
//   M   手動の待機画面 PLEASE STAND BY（割り込み。外すと必ず元の覆い(under)に戻る）
//
// 約束（テストで確かめている）:
//   1. 許可された遷移以外は受け付けない（不正な組み合わせの覆いは作れない）
//   2. 受け付ける要求は「Admin が見ていた版(rev)」と一致したときだけ。連打・古い画面・2つ目の Admin の
//      操作は、2回目以降が必ず断られる（二重実行されない）
//   3. どの状態からでも force（強制解除）で N に戻れる = 行き止まりがない
//   4. M は N への遷移で「割り込む前の覆い」に戻る。割り込みが元の進行を壊さない

const KINDS = ['none', 'blank', 'standby'];
const ATS = ['start', 'end', 'manual'];
const TEXT_MAX = 40;

/** @typedef {{kind:'none'|'blank'|'standby', at:'start'|'end'|'manual'|null, title:string|null, sub:string|null, startLabel:string|null}} Cover */
/** @typedef {{cover:Cover, under:Cover|null, rev:number}} FlowState */

const NONE = Object.freeze({ kind: 'none', at: null, title: null, sub: null, startLabel: null });

/** 覆いの形のキー。不正な組み合わせなら null */
function keyOf(c) {
    if (!c || typeof c !== 'object') return null;
    if (c.kind === 'none') return 'N';
    if (c.kind === 'blank') return c.at === 'start' ? 'BS' : c.at === 'end' ? 'BE' : null;
    if (c.kind === 'standby') return c.at === 'start' ? 'SS' : c.at === 'end' ? 'SE' : c.at === 'manual' ? 'M' : null;
    return null;
}

/** 許可された遷移（from → to のキー）。これが「ありうる操作」のすべて */
const ALLOWED = {
    N: ['BE', 'BS', 'SS', 'SE', 'M'],
    BE: ['N', 'BS', 'SS', 'SE', 'M'],
    BS: ['N', 'SS', 'BS', 'M'],
    SS: ['SS', 'BS', 'SE', 'M'],
    SE: ['BS', 'SS', 'M'],
    M: ['N'],
};

function text(v) {
    return typeof v === 'string' && v.trim() !== '' && v.length <= TEXT_MAX ? v : null;
}

/** Admin から届いた覆いを、決まった形に整える。不正なら null */
function normalizeTarget(t) {
    if (!t || typeof t !== 'object' || !KINDS.includes(t.kind)) return null;
    if (t.kind === 'none') return { ...NONE };
    const at = ATS.includes(t.at) ? t.at : null;
    if (at === null) return null;
    if (t.kind === 'blank' && at === 'manual') return null;
    return {
        kind: t.kind,
        at,
        title: at === 'manual' ? null : text(t.title),
        sub: at === 'manual' ? null : text(t.sub),
        startLabel: at === 'manual' ? null : text(t.startLabel),
    };
}

function initialState() {
    return { cover: { ...NONE }, under: null, rev: 0 };
}

/**
 * Admin の要求を適用する。
 * @param {FlowState} state 今のサーバの状態
 * @param {{cover?:any, expectRev?:number, force?:boolean}} req
 *   cover     … 変えたい先の覆い
 *   expectRev … Admin が見ていた版。省略した要求は受け付けない（古い画面からの操作を通さないため）
 *   force     … 強制解除（覆いを外して N に戻す。行き止まりの脱出口）
 * @returns {{ok:true, state:FlowState} | {ok:false, reason:'stale'|'invalid'|'forbidden', state:FlowState}}
 */
function applyRequest(state, req) {
    if (!req || typeof req !== 'object') return { ok: false, reason: 'invalid', state };
    if (!Number.isInteger(req.expectRev) || req.expectRev !== state.rev) return { ok: false, reason: 'stale', state };

    if (req.force === true) {
        // すでに覆っていないなら何も変えない（版も進めない）
        if (state.cover.kind === 'none') return { ok: true, state };
        return { ok: true, state: { cover: { ...NONE }, under: null, rev: state.rev + 1 } };
    }

    const target = normalizeTarget(req.cover);
    if (!target) return { ok: false, reason: 'invalid', state };
    const from = keyOf(state.cover);
    const to = keyOf(target);
    if (!from || !to || !ALLOWED[from].includes(to)) return { ok: false, reason: 'forbidden', state };

    // M から N: 割り込む前の覆いに戻る
    if (from === 'M' && to === 'N') {
        return { ok: true, state: { cover: state.under ? { ...state.under } : { ...NONE }, under: null, rev: state.rev + 1 } };
    }
    // N/BE/BS/SS/SE から M: 今の覆いを退避して割り込む
    if (to === 'M') {
        return { ok: true, state: { cover: target, under: { ...state.cover }, rev: state.rev + 1 } };
    }
    return { ok: true, state: { cover: target, under: null, rev: state.rev + 1 } };
}

/** サーバが決める覆い（ラウンドを切り替えたときの自動の待機画面）。割り込み中でも置き換える */
function applyAuto(state, cover) {
    const target = cover ? normalizeTarget(cover) : { ...NONE };
    return { cover: target || { ...NONE }, under: null, rev: state.rev + 1 };
}

/** 保存されていた値を、検証してから状態に戻す。壊れていたら初期値 */
function restoreState(saved) {
    if (!saved || typeof saved !== 'object') return initialState();
    const cover = normalizeTarget(saved.cover);
    if (!cover) return initialState();
    let under = null;
    if (keyOf(cover) === 'M') under = normalizeTarget(saved.under) || { ...NONE };
    const rev = Number.isInteger(saved.rev) && saved.rev >= 0 ? saved.rev : 0;
    return { cover, under, rev };
}

module.exports = { NONE, ALLOWED, keyOf, normalizeTarget, initialState, applyRequest, applyAuto, restoreState };
