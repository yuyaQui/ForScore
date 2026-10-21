/**
 * 文字が徐々に現れるアニメーション（Extra Round の問題文・解答）の純関数と定数。
 * 描画は app/components/Main/RevealText.tsx。
 */

/** 「表示する」を押してから最初の文字が出るまでの間（ms） */
export const REVEAL_START_DELAY_MS = 450;

/** 最後の文字が出きる（フェードが終わる）のを待つ時間（ms）。これが過ぎたら通常の表示に戻す */
export const REVEAL_TAIL_MS = 600;

/**
 * 文字（書記素クラスタ）単位に分割する。
 * 濁点が分離した文字（NFD）や絵文字の結合を途中で切ると、アニメーション中だけ表示が
 * 崩れるため、Array.from（コードポイント単位）ではなく Intl.Segmenter を使う。
 * 使えない環境ではコードポイント単位に落とす。
 */
export function splitGraphemes(text: string): string[] {
    if (text === '') return [];
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        return Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text), s => s.segment);
    }
    return Array.from(text);
}

/**
 * 1文字あたりの表示間隔（ms）。
 * 短い文は maxStepMs でゆっくり、長い文は全体が totalMaxMs に収まるよう速くする
 * （長い問題文で数十秒待たされないため）。ただし速すぎて「現れる」動きに見えなくなる
 * のを避けるため minStepMs 未満にはしない。
 */
export function revealStepMs(count: number, maxStepMs: number, totalMaxMs: number, minStepMs = 10): number {
    if (!Number.isFinite(count) || count <= 0) return maxStepMs;
    return Math.max(minStepMs, Math.min(maxStepMs, Math.floor(totalMaxMs / count)));
}
