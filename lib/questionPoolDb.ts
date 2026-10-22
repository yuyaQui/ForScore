// 問題データの表（QuestionPoolItem）が使える状態かを確かめる（2026-10-22 追加。API 専用）。
//
// 表を追加した後、Mac で `npx prisma migrate dev` を実行していないと、次のどちらかで失敗する:
//   1. Prisma クライアントが作り直されていない → prisma.questionPoolItem が undefined
//      （開発サーバを起動したままだと、古いクライアントが globalThis に残り続けるので、再起動も必要）
//   2. クライアントはあるが DB に表が無い → Prisma のエラー P2021（table does not exist）
// どちらも「TypeError」のような分かりにくいエラーにせず、やることを書いたメッセージで返す。
import { prisma } from './prisma';

export const QUESTION_POOL_NOT_READY =
    '問題データの表がまだ使えません。Mac のターミナルで `npx prisma migrate dev` を実行してから、サーバを再起動してください';

/** Prisma クライアントに問題データの表があるか（1. の確認） */
export function isQuestionPoolClientReady(): boolean {
    return (prisma as unknown as Record<string, unknown>).questionPoolItem !== undefined;
}

/** DB に表が無いときのエラーか（2. の確認） */
export function isTableMissingError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2021';
}
