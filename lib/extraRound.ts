/**
 * Extra Round First Step の問題番号からフェーズを導出する純関数。
 *
 * フェーズは questionNumber から機械的に決まる（設計メモ 3.3 の対応表）ので、
 * 状態としては持たず、表示のたびにここで導出する。
 */
export type ExtraRoundPhase = 'phase1' | 'phase2' | 'survival';

export function getExtraRoundPhase(questionNumber: number): ExtraRoundPhase {
    if (questionNumber <= 10) return 'phase1';   // 1〜10問
    if (questionNumber <= 15) return 'phase2';   // 11〜15問
    return 'survival';                            // 16問〜
}

// フェーズの表示名（Admin / Main の見出しに使う）
export function getExtraRoundPhaseLabel(questionNumber: number): string {
    const phase = getExtraRoundPhase(questionNumber);
    if (phase === 'phase1') return 'Phase 1';
    if (phase === 'phase2') return 'Phase 2';
    return 'Survival';
}

// 現在の問題が属するフェーズの [開始番号, 終了番号]。
// 「解答表示ありの2周目」を始めるとき、このフェーズの先頭に戻るボタンで使う
export function getExtraRoundPhaseRange(questionNumber: number): [number, number] {
    const phase = getExtraRoundPhase(questionNumber);
    if (phase === 'phase1') return [1, 10];
    if (phase === 'phase2') return [11, 15];
    return [16, 20];
}
