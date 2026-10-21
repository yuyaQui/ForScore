/**
 * Extra Round の進行まわりの純関数と定数。
 *
 * First Step（筆記）の進行は「何を表示しているか」を1つの数 cursor（0〜39）だけで持つ。
 * 問題番号・出題か解答発表か・フェーズ・「進出者決定ボタンを出す位置か」は、すべて
 * cursor から導出する。状態として別々に持つと食い違うので持たない。
 *
 * 進行順（ルールと運用の取り決め）:
 *   問題1 → … → 問題10 → 解答1 → … → 解答10          （Phase 1）
 *   問題11 → … → 問題15 → 解答11 → … → 解答15        （Phase 2）
 *   問題16 → … → 問題20 → 解答16 → … → 解答20        （Survival）
 */

import type { ExtraRoundState } from './types';
import {
    EXTRA_ROUND_QUESTION_COUNT,
    EXTRA_ROUND_FIRST_STEP_LENGTH,
    EXTRA_ROUND_MAX_ENTRANTS,
} from '../constants.js';

// 値の定義元は constants.js（server/ は CommonJS で、この TS ファイルを読めないため）。
export { EXTRA_ROUND_QUESTION_COUNT, EXTRA_ROUND_FIRST_STEP_LENGTH, EXTRA_ROUND_MAX_ENTRANTS };

export type ExtraRoundPhase = 'phase1' | 'phase2' | 'survival';

/** 問題番号 → フェーズ。1〜10 / 11〜15 / 16〜20 */
export function getExtraRoundPhase(questionNumber: number): ExtraRoundPhase {
    if (questionNumber <= 10) return 'phase1';
    if (questionNumber <= 15) return 'phase2';
    return 'survival';
}

/** フェーズの表示名（Admin / Main の見出しに使う） */
export function getExtraRoundPhaseLabel(questionNumber: number): string {
    const phase = getExtraRoundPhase(questionNumber);
    if (phase === 'phase1') return 'Phase 1';
    if (phase === 'phase2') return 'Phase 2';
    return 'Survival';
}

/** 問題番号が属するフェーズの [開始番号, 終了番号] */
export function getExtraRoundPhaseRange(questionNumber: number): [number, number] {
    const phase = getExtraRoundPhase(questionNumber);
    if (phase === 'phase1') return [1, 10];
    if (phase === 'phase2') return [11, 15];
    return [16, 20];
}

/** First Step の1ステップ。問題を出す(question)か、解答を発表する(answer)か */
export type FirstStepItem = {
    number: number;
    view: 'question' | 'answer';
};

/** First Step の全ステップ（長さ40）。cursor はこの配列の添字 */
export const FIRST_STEP_SEQUENCE: FirstStepItem[] = (() => {
    const items: FirstStepItem[] = [];
    for (const [start, end] of [[1, 10], [11, 15], [16, 20]] as const) {
        for (let n = start; n <= end; n++) items.push({ number: n, view: 'question' });
        for (let n = start; n <= end; n++) items.push({ number: n, view: 'answer' });
    }
    return items;
})();

/** cursor の最大値（最後のステップ = 解答20） */
export const FIRST_STEP_LAST_CURSOR = FIRST_STEP_SEQUENCE.length - 1;

/** 範囲外・小数・NaN を最も近い有効な cursor に丸める */
export function clampCursor(cursor: number): number {
    if (!Number.isFinite(cursor)) return 0;
    return Math.max(0, Math.min(FIRST_STEP_LAST_CURSOR, Math.trunc(cursor)));
}

export function getFirstStepItem(cursor: number): FirstStepItem {
    return FIRST_STEP_SEQUENCE[clampCursor(cursor)];
}

/**
 * cursor が「フェーズ最後の解答発表」（解答10 / 解答15 / 解答20）か。
 * このタイミングでだけ、Admin に「2nd Step 進出者決定」ボタン（と、次のフェーズがあれば
 * 「次のフェーズに進む」ボタン）を出す。ここで1st Stepを打ち切ることもできる。
 */
export function isPhaseEndAnswer(cursor: number): boolean {
    const item = getFirstStepItem(cursor);
    if (item.view !== 'answer') return false;
    return getExtraRoundPhaseRange(item.number)[1] === item.number;
}

/** 「次のフェーズに進む」ボタンを出すか。解答20の後には問題がないので出さない */
export function hasNextPhase(cursor: number): boolean {
    return isPhaseEndAnswer(cursor) && cursor < FIRST_STEP_LAST_CURSOR;
}

/** 「次のフェーズに進む」の遷移先 cursor（次のフェーズの最初の問題）。次が無ければ null */
export function getNextPhaseCursor(cursor: number): number | null {
    return hasNextPhase(cursor) ? clampCursor(cursor) + 1 : null;
}

/** 表示用ラベル。例: 「問題 3」「解答 3」 */
export function getFirstStepItemLabel(cursor: number): string {
    const item = getFirstStepItem(cursor);
    return `${item.view === 'question' ? '問題' : '解答'} ${item.number}`;
}

/**
 * サーバから届いた進行状態を画面で使う形に整える。
 * revealed を持たない（= 再起動していない古いサーバが返した）状態は「表示済み」として扱う。
 * 未表示扱いにすると、古いサーバには「表示する」の操作が届かず、Main が空のまま止まるため。
 * 古いサーバでは従来どおり、ステップを進めるとすぐ中身が出る動きになる。
 */
export function normalizeExtraRoundState(next: Partial<ExtraRoundState> & Pick<ExtraRoundState, 'stage' | 'cursor'>): ExtraRoundState {
    return {
        stage: next.stage,
        cursor: clampCursor(next.cursor),
        revealed: typeof next.revealed === 'boolean' ? next.revealed : true,
    };
}
