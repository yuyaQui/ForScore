// lib/coverFlow.js の遷移表のテスト。実行: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/coverFlow.js');

// 6つの形を代表する覆い
const T = {
    N: { kind: 'none' },
    BS: { kind: 'blank', at: 'start', startLabel: 'クイズを始める' },
    BE: { kind: 'blank', at: 'end' },
    SS: { kind: 'standby', at: 'start', title: '2nd Round', sub: 'Set 2', startLabel: 'ターンオーバーを始める' },
    SE: { kind: 'standby', at: 'end', title: '3rd Round' },
    M: { kind: 'standby', at: 'manual' },
};
const KEYS = Object.keys(T);

/** その形の状態を作る（N からの最短手順で） */
function stateOf(key) {
    let s = F.initialState();
    if (key === 'N') return s;
    const path = { BS: ['BS'], BE: ['BE'], SS: ['SS'], SE: ['SE'], M: ['M'] }[key];
    for (const k of path) {
        const r = F.applyRequest(s, { cover: T[k], expectRev: s.rev });
        assert.ok(r.ok, `N→${k} が通らない`);
        s = r.state;
    }
    return s;
}
const req = (s, to, extra = {}) => F.applyRequest(s, { cover: T[to], expectRev: s.rev, ...extra });

test('全状態×全行き先: ALLOWED の表どおりに通り、それ以外は forbidden になる', () => {
    for (const from of KEYS) {
        for (const to of KEYS) {
            const s = stateOf(from);
            const r = req(s, to);
            const expected = F.ALLOWED[from].includes(to);
            assert.equal(r.ok, expected, `${from}→${to}`);
            if (!expected) {
                assert.equal(r.reason, 'forbidden', `${from}→${to}`);
                assert.deepEqual(r.state, s, '断られたら状態は変わらない');
            } else {
                assert.equal(r.state.rev, s.rev + 1, `${from}→${to} は版が1つ進む`);
            }
        }
    }
});

test('行き止まりがない: どの形からでも、通常の操作だけで N に戻れる', () => {
    for (const from of KEYS) {
        // 幅優先で N までの道を探す
        const seen = new Set([from]);
        let frontier = [from];
        while (frontier.length && !seen.has('N')) {
            const next = [];
            for (const k of frontier) for (const t of F.ALLOWED[k]) if (!seen.has(t)) { seen.add(t); next.push(t); }
            frontier = next;
        }
        assert.ok(seen.has('N'), `${from} から N に戻れない`);
    }
});

test('force（強制解除）はどの形からでも N に戻す。すでに N なら版を進めない', () => {
    for (const from of KEYS) {
        const s = stateOf(from);
        const r = F.applyRequest(s, { force: true, expectRev: s.rev });
        assert.ok(r.ok);
        assert.equal(F.keyOf(r.state.cover), 'N');
        assert.equal(r.state.under, null);
        assert.equal(r.state.rev, from === 'N' ? s.rev : s.rev + 1);
    }
});

test('連打: 同じ版の要求は2回目から必ず stale で断られ、結果は1回分だけ', () => {
    for (const from of KEYS) {
        for (const to of F.ALLOWED[from]) {
            const s = stateOf(from);
            const first = req(s, to);
            assert.ok(first.ok);
            const second = F.applyRequest(first.state, { cover: T[to], expectRev: s.rev });
            assert.equal(second.ok, false, `${from}→${to} の二度押しが通った`);
            assert.equal(second.reason, 'stale');
            assert.deepEqual(second.state, first.state);
        }
    }
});

test('二つの Admin: 同じ版から別々の操作を送ると、先の1つだけが通る', () => {
    const s = stateOf('BE');
    const a = req(s, 'BS');
    const b = req(s, 'SS');
    assert.ok(a.ok);
    const bAfter = F.applyRequest(a.state, { cover: T.SS, expectRev: s.rev });
    assert.equal(bAfter.ok, false);
    assert.equal(b.ok, true, '単独なら通る操作でも、版が古ければ通さない');
    assert.equal(bAfter.reason, 'stale');
});

test('expectRev が無い・文字列・小数の要求は通さない', () => {
    const s = stateOf('N');
    for (const bad of [undefined, null, '0', 0.5, NaN, -1, 99]) {
        const r = F.applyRequest(s, { cover: T.BE, expectRev: bad });
        assert.equal(r.ok, false, String(bad));
    }
    for (const bad of [null, undefined, 1, 'x', []]) assert.equal(F.applyRequest(s, bad).ok, false);
});

test('割り込み(M): 外すと、割り込む前の覆いにそのまま戻る', () => {
    for (const under of ['N', 'BS', 'BE', 'SS', 'SE']) {
        const s0 = stateOf(under);
        const m = req(s0, 'M');
        assert.ok(m.ok, `${under}→M`);
        assert.deepEqual(m.state.under, s0.cover);
        const back = req(m.state, 'N');
        assert.ok(back.ok);
        assert.deepEqual(back.state.cover, s0.cover, `${under} に戻る`);
        assert.equal(back.state.under, null);
    }
});

test('割り込み中は N への解除以外を受け付けない（裏で進めさせない）', () => {
    const m = stateOf('M');
    for (const to of ['BS', 'BE', 'SS', 'SE', 'M']) assert.equal(req(m, to).reason, 'forbidden', to);
});

test('不正な覆いは invalid: 未知の kind、blank の manual、at の欠落', () => {
    const s = stateOf('N');
    const bads = [
        { kind: 'foo' }, { kind: 'blank', at: 'manual' }, { kind: 'blank' }, { kind: 'standby', at: 'later' },
        null, 'standby', 3, {},
    ];
    for (const b of bads) {
        const r = F.applyRequest(s, { cover: b, expectRev: s.rev });
        assert.equal(r.ok, false, JSON.stringify(b));
        assert.equal(r.reason, 'invalid');
    }
});

test('文字列は40文字まで・空は null・手動の待機画面は文字を持たない', () => {
    const long = 'あ'.repeat(41);
    const n = F.normalizeTarget({ kind: 'standby', at: 'start', title: long, sub: '  ', startLabel: 'ok' });
    assert.equal(n.title, null);
    assert.equal(n.sub, null);
    assert.equal(n.startLabel, 'ok');
    const m = F.normalizeTarget({ kind: 'standby', at: 'manual', title: 'x', sub: 'y', startLabel: 'z' });
    assert.deepEqual([m.title, m.sub, m.startLabel], [null, null, null]);
});

test('ラウンドを切り替えたときの自動の覆いは、割り込み中でも置き換える', () => {
    const m = stateOf('M');
    const a = F.applyAuto(m, T.SS);
    assert.equal(F.keyOf(a.cover), 'SS');
    assert.equal(a.under, null);
    assert.equal(a.rev, m.rev + 1);
    assert.equal(F.keyOf(F.applyAuto(m, null).cover), 'N');
});

test('保存した状態の復元: 壊れた値は初期値、M は under を補う', () => {
    for (const bad of [null, undefined, 'x', 1, {}, { cover: { kind: 'blank', at: 'manual' } }]) {
        assert.deepEqual(F.restoreState(bad), F.initialState());
    }
    const r = F.restoreState({ cover: T.M, rev: 7 });
    assert.equal(F.keyOf(r.cover), 'M');
    assert.equal(F.keyOf(r.under), 'N');
    assert.equal(r.rev, 7);
    const ok = F.restoreState({ cover: T.BE, under: T.SS, rev: 3 });
    assert.equal(ok.under, null, 'M 以外は under を持たない');
});

test('乱択: 3万回の要求を浴びせても、不変条件が一度も破れない', () => {
    let seed = 12345;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    let s = F.initialState();
    const junk = [{ kind: 'x' }, null, { kind: 'blank', at: 'manual' }, 'a'];
    for (let i = 0; i < 30000; i++) {
        const before = s;
        const roll = rnd(10);
        let r;
        if (roll === 0) r = F.applyRequest(s, { force: true, expectRev: rnd(2) ? s.rev : s.rev - 1 });
        else if (roll === 1) r = F.applyRequest(s, { cover: junk[rnd(junk.length)], expectRev: s.rev });
        else r = F.applyRequest(s, { cover: T[KEYS[rnd(KEYS.length)]], expectRev: rnd(5) === 0 ? s.rev + 1 : s.rev });
        s = r.state;
        const k = F.keyOf(s.cover);
        assert.ok(k, '覆いの形が壊れた');
        assert.equal(s.under !== null, k === 'M', 'under は M のときだけ持つ');
        assert.ok(s.rev === before.rev || s.rev === before.rev + 1, '版は0か1しか進まない');
        if (!r.ok) assert.deepEqual(s, before, '断られたら何も変わらない');
        if (s.under) assert.notEqual(F.keyOf(s.under), 'M', '割り込みは入れ子にならない');
    }
});
