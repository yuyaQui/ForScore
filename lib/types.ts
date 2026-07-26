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
