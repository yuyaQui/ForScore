/**
 * 大会共通の問題群（通し番号つき）の解析と範囲選択
 *
 * 2nd Round 以降（2nd / 3rd Round・Extra Round Second Step・準決勝・決勝）は同じ問題群を使い、
 * 「通し番号」で問題を指定する（2026-10-10 ユーザー決定）。2026-10-22 から、問題群は大会前に
 * Admin（待機画面）で CSV を取り込み、DB（QuestionPoolItem）に保存する（POST /api/questionPool）。
 * このファイルは CSV の解析・範囲選択・登録状況のまとめ（API と画面の両方で使う純関数）。
 * 検証用サンプル `test_questions.csv` は取込画面で読み込ませる見本として残している。
 *
 * CSV の列: 1列目 通し番号 / 2列目 問題文 / 3列目 解答 / 4列目 別解・正誤判定基準（空でもよい）
 */

import { parseCsvRows } from './extraRoundCsv';

export type PoolQuestion = {
    serial: number;
    text: string;
    answer: string;
    /** 別解・正誤判定基準。Admin 専用（Main には渡さない） */
    altAnswer: string;
};

/** Main に渡してよい項目だけ */
export type PublicPoolQuestion = Omit<PoolQuestion, 'altAnswer'>;

/** 1回に取得できる最大問題数（誤入力で巨大な範囲を指定したときの歯止め） */
export const QUESTION_RANGE_MAX = 300;

/** 「12」「１２」（全角）を整数にする。正の整数でなければ NaN */
function parseSerial(raw: string): number {
    const half = raw.trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (!/^\d+$/.test(half)) return NaN;
    const n = parseInt(half, 10);
    return n >= 1 ? n : NaN;
}

/**
 * CSV 本文を問題の一覧にする。先頭行の1列目が数字でなければ見出し行として読み飛ばす。
 * 通し番号の重複・不正、空の問題文・解答はエラーとして返す（その行は一覧に含めない）。
 */
export function parseQuestionPoolCsv(text: string): { questions: PoolQuestion[]; errors: string[] } {
    const rows = parseCsvRows(text);
    const errors: string[] = [];
    const questions: PoolQuestion[] = [];
    const seen = new Set<number>();

    rows.forEach((row, index) => {
        const serial = parseSerial(row[0] ?? '');
        if (index === 0 && Number.isNaN(serial)) return; // 見出し行
        const line = index + 1;
        if (Number.isNaN(serial)) {
            errors.push(`${line}行目: 通し番号が正の整数ではありません`);
            return;
        }
        if (seen.has(serial)) {
            errors.push(`${line}行目: 通し番号 ${serial} が重複しています`);
            return;
        }
        const qText = (row[1] ?? '').trim();
        const answer = (row[2] ?? '').trim();
        if (qText === '' || answer === '') {
            errors.push(`${line}行目: 問題文または解答が空です`);
            return;
        }
        seen.add(serial);
        questions.push({ serial, text: qText, answer, altAnswer: (row[3] ?? '').trim() });
    });

    questions.sort((a, b) => a.serial - b.serial);
    return { questions, errors };
}

/** 範囲指定の検証結果 */
export type QuestionRangeResult =
    | { ok: true; questions: PoolQuestion[] }
    | { ok: false; error: string };

/**
 * 通し番号 from〜to（両端を含む）の問題を返す。
 * 範囲が不正、または範囲内に登録のない番号が1つでもあればエラー（振り返りで抜けが出ないように）。
 */
export function selectQuestionRange(pool: PoolQuestion[], from: number, to: number): QuestionRangeResult {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
        return { ok: false, error: '通し番号は1以上の整数で指定してください' };
    }
    if (from > to) return { ok: false, error: '開始の番号が終了より大きくなっています' };
    if (to - from + 1 > QUESTION_RANGE_MAX) return { ok: false, error: `一度に指定できるのは${QUESTION_RANGE_MAX}問までです` };

    const bySerial = new Map(pool.map(q => [q.serial, q]));
    const missing: number[] = [];
    const questions: PoolQuestion[] = [];
    for (let s = from; s <= to; s++) {
        const q = bySerial.get(s);
        if (q) questions.push(q);
        else missing.push(s);
    }
    if (missing.length > 0) {
        const shown = missing.slice(0, 5).join(', ') + (missing.length > 5 ? ' ほか' : '');
        return { ok: false, error: `登録されていない通し番号があります（${shown}）` };
    }
    return { ok: true, questions };
}

/** 問題データの登録状況（GET /api/questionPool） */
export type QuestionPoolSummary = {
    count: number;
    /** 最小・最大の通し番号。未登録なら null */
    min: number | null;
    max: number | null;
    /** min〜max の間で抜けている通し番号（多すぎるときは先頭から20件まで） */
    missing: number[];
};

/** 登録済みの通し番号（昇順）から登録状況をまとめる */
export function summarizeQuestionPool(serials: number[]): QuestionPoolSummary {
    if (serials.length === 0) return { count: 0, min: null, max: null, missing: [] };
    const min = serials[0];
    const max = serials[serials.length - 1];
    const set = new Set(serials);
    const missing: number[] = [];
    for (let s = min; s <= max && missing.length < 20; s++) if (!set.has(s)) missing.push(s);
    return { count: serials.length, min, max, missing };
}
