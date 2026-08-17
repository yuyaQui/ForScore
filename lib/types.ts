/**
 * アプリ全体で共有する型の置き場。
 *
 * Prisma の生成型はここから再エクスポートし、app/ 配下は @prisma/client を
 * 直接 import しない。import に type を書き忘れると DB クライアント本体を
 * ブラウザ側へ読み込むことになるため、その参照を1箇所に閉じている。
 */

// schema.prisma から Prisma が生成した型。
// Player は全列が Int / String / Boolean で DateTime を持たないため、
// API のレスポンス（JSON）を経由しても型がずれない。
// DateTime 列を足すと JSON では string になり、ここでの再定義が必要になる。
export type { Player, ThirdRoundCourse } from '@prisma/client';

/**
 * 2nd Round の進行状態。
 * server/ModeHandler.js がメモリに保持し、update_second_round_state で配信する。
 */
export type SecondRoundState = {
    /** 何組目か（1〜4） */
    group: number;
    /** turnOver = 選手紹介、quiz = 正誤判定 */
    view: 'turnOver' | 'quiz';
};

/**
 * 3rd Round の15分タイマー。コースごとに1本ずつ持つ。
 * server/ThirdRoundHandler.js がメモリに保持し、update_third_round_timer で配信する。
 *
 * 「コース N が稼働中か」は runningOrder === N で導出できるため、コースごとの
 * 稼働フラグは持たない。0秒到達も「時計が止まった」だけでコースの終了ではないので、
 * 専用の状態を持たない（remainings[N] === 0 で判定できる）。
 */
export type ThirdRoundTimer = {
    /**
     * コースごとの残り秒数。キーは quizOrder(1〜4)。
     * まだ一度も動かしていないコースはキー自体が存在しない（＝制限時間のまま）。
     */
    remainings: Record<number, number>;
    /** 走っているコースの quizOrder。停止中は null */
    runningOrder: number | null;
};
