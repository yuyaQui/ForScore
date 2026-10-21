/**
 * Extra Round 問題CSVの解析と検証（Admin の取込画面と API の両方で使う）
 *
 * 列の形式（取り決め）:
 *   1列目 問題番号 / 2列目 問題文 / 3列目 模範解答 / 4列目 別解・正誤判定基準（空でもよい）
 *
 * 問題文に「,」や改行が入ることがあるため、単純な split(',') ではなく、
 * ダブルクォートで囲まれたセル（"" は " のエスケープ）に対応した解析をする。
 * Excel が付ける BOM と、CRLF／CR の改行も受け付ける。
 */

import { EXTRA_ROUND_QUESTION_COUNT } from './extraRound';

export type ExtraRoundQuestionInput = {
    number: number;
    text: string;
    answer: string;
    altAnswer: string;
};

export type ExtraRoundCsvResult = {
    questions: ExtraRoundQuestionInput[];
    /** 取り込めない理由。1件でもあれば登録してはいけない */
    errors: string[];
};

/** CSV本文を行×セルに分解する（引用符・改行入りセルに対応。空行は捨てる） */
export function parseCsvRows(text: string): string[][] {
    const src = text.replace(/^﻿/, '');
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(cell);
            cell = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += ch;
        }
    }
    // 末尾に改行がないファイルの最終行
    if (cell !== '' || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    // 空行（全セルが空白）は捨てる
    return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** 「1」「１」（全角）のような整数表記を数値にする。整数でなければ NaN */
function parseQuestionNumber(raw: string): number {
    const half = raw
        .trim()
        .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    return /^\d+$/.test(half) ? parseInt(half, 10) : NaN;
}

/**
 * セル配列（parseCsvRows の結果、または API に届いた配列）を検証して問題の一覧にする。
 * 先頭行の1列目が数字でなければ見出し行とみなして読み飛ばす。
 * 1〜20問がすべて揃っていることを求める（足りない・重複・範囲外はエラー）。
 */
export function validateExtraRoundRows(rows: unknown): ExtraRoundCsvResult {
    const errors: string[] = [];
    if (!Array.isArray(rows)) {
        return { questions: [], errors: ['問題データの形式が正しくありません'] };
    }

    const cells: string[][] = rows.map(r =>
        Array.isArray(r) ? r.map(c => (typeof c === 'string' ? c : c == null ? '' : String(c))) : []
    );

    // 見出し行（「問題番号,問題文,…」など）を読み飛ばす
    if (cells.length > 0 && Number.isNaN(parseQuestionNumber(cells[0][0] ?? ''))) {
        cells.shift();
    }

    if (cells.length === 0) {
        return { questions: [], errors: ['問題が1件も見つかりませんでした'] };
    }

    const byNumber = new Map<number, ExtraRoundQuestionInput>();
    cells.forEach((cols, index) => {
        const lineLabel = `${index + 1}行目`;
        const number = parseQuestionNumber(cols[0] ?? '');
        if (Number.isNaN(number)) {
            errors.push(`${lineLabel}: 問題番号が数字ではありません（「${(cols[0] ?? '').trim()}」）`);
            return;
        }
        if (number < 1 || number > EXTRA_ROUND_QUESTION_COUNT) {
            errors.push(`${lineLabel}: 問題番号 ${number} は 1〜${EXTRA_ROUND_QUESTION_COUNT} の範囲外です`);
            return;
        }
        if (byNumber.has(number)) {
            errors.push(`${lineLabel}: 問題番号 ${number} が重複しています`);
            return;
        }
        const text = (cols[1] ?? '').trim();
        const answer = (cols[2] ?? '').trim();
        if (text === '') errors.push(`${lineLabel}: 問題 ${number} の問題文が空です`);
        if (answer === '') errors.push(`${lineLabel}: 問題 ${number} の模範解答が空です`);
        byNumber.set(number, {
            number,
            text,
            answer,
            altAnswer: (cols[3] ?? '').trim(),
        });
    });

    const missing: number[] = [];
    for (let n = 1; n <= EXTRA_ROUND_QUESTION_COUNT; n++) {
        if (!byNumber.has(n)) missing.push(n);
    }
    if (missing.length > 0) {
        errors.push(`問題 ${missing.join('、')} がありません（${EXTRA_ROUND_QUESTION_COUNT}問すべて必要です）`);
    }

    const questions = [...byNumber.values()].sort((a, b) => a.number - b.number);
    return { questions, errors };
}

/** CSV本文をそのまま検証する（parseCsvRows + validateExtraRoundRows） */
export function parseExtraRoundCsv(text: string): ExtraRoundCsvResult {
    return validateExtraRoundRows(parseCsvRows(text));
}
