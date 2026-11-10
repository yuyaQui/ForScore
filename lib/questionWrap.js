// 問題の通し番号の折り返し（2026-11-11 ユーザー承認）。app/ と server/ の両方から使うので CommonJS。
//
// 大会準備で取り込んだ問題のうち、一番小さい通し番号を「最初」、一番大きい通し番号を「上限」とする。
//   ・クイズ画面: 上限の問題が終わったら、次に読む問題を最初に戻す。◀前・次▶ も折り返す
//   ・Semi-Final の振り返り: 終了の番号が開始より小さい範囲は、上限で折り返す範囲とみなす
//     （例: 最初 1・上限 100 で 98〜3 → 98, 99, 100, 1, 2, 3）
// bounds（{ min, max }）が分からないとき（取り込み状況をまだ読めていない）は折り返さない（従来どおり）。

/** 一度に振り返れる問題の数（lib/questionPool.ts の QUESTION_RANGE_MAX と同じ） */
const RANGE_MAX = 300;

function isSerial(v) {
    return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100000;
}

/** { min, max } が正しければそのまま、そうでなければ null */
function cleanBounds(b) {
    if (!b || typeof b !== "object" || !isSerial(b.min) || !isSerial(b.max) || b.min > b.max) return null;
    return { min: b.min, max: b.max };
}

/** 次の通し番号。上限（以上）なら最初に戻る */
function nextSerial(serial, bounds) {
    const b = cleanBounds(bounds);
    if (b && serial >= b.max) return b.min;
    return serial + 1;
}

/** 前の通し番号。最初（以下）なら上限へ。bounds が無いときは 1 より前には行かない（null） */
function prevSerial(serial, bounds) {
    const b = cleanBounds(bounds);
    if (b && serial <= b.min) return b.max;
    return serial > 1 ? serial - 1 : null;
}

/**
 * 振り返り範囲の通し番号の並び。範囲として使えなければ { ok: false, error }。
 * range: { from, to, min?, max? }（min・max は折り返すときの最初と上限）
 */
function rangeSerials(range) {
    if (!range || !isSerial(range.from) || !isSerial(range.to)) return { ok: false, error: "通し番号は1以上の整数で入れてください" };
    const { from, to } = range;
    let serials = [];
    if (from <= to) {
        if (to - from + 1 > RANGE_MAX) return { ok: false, error: `一度に振り返れるのは${RANGE_MAX}問までです` };
        for (let s = from; s <= to; s++) serials.push(s);
    } else {
        const b = cleanBounds(range);
        if (!b) return { ok: false, error: "開始の番号が終了より大きくなっています（問題データの登録状況を読めていないため、折り返す範囲にできません）" };
        if (from > b.max) return { ok: false, error: `開始の番号が、登録されている最後の問題（No.${b.max}）より大きくなっています` };
        if (to < b.min) return { ok: false, error: `終了の番号が、登録されている最初の問題（No.${b.min}）より小さくなっています` };
        const count = (b.max - from + 1) + (to - b.min + 1);
        if (count > RANGE_MAX) return { ok: false, error: `一度に振り返れるのは${RANGE_MAX}問までです（いまの範囲は ${count}問。折り返しを含む）` };
        for (let s = from; s <= b.max; s++) serials.push(s);
        for (let s = b.min; s <= to; s++) serials.push(s);
    }
    return { ok: true, serials };
}

/** 振り返り範囲の説明（例「No.98〜No.100、No.1〜No.3（6問）」「No.31〜No.45（15問）」） */
function describeRange(range) {
    const r = rangeSerials(range);
    if (!r.ok) return null;
    if (range.from <= range.to) return `No.${range.from}〜No.${range.to}（${r.serials.length}問）`;
    return `No.${range.from}〜No.${range.max}、No.${range.min}〜No.${range.to}（${r.serials.length}問）`;
}

/** 前のセットの振り返りの続き（次のセットの開始の初期値）。上限を超えたら最初 */
function continueFrom(prevTo, bounds) {
    return nextSerial(prevTo, bounds);
}

module.exports = { RANGE_MAX, cleanBounds, nextSerial, prevSerial, rangeSerials, describeRange, continueFrom };
