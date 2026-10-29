import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resetRoundsFrom } from '@/lib/roundReset';

/**
 * POST: 準決勝の結果を全選手ぶんリセットする（2026-10-17 ユーザー承認済み）
 *
 * 2nd / 3rd / Extra Round のリセットと同じ位置づけ。
 * - semifinalPoint（累計ポイント）と semifinalRank（勝ち抜けたセット・敗退）を 0 に戻す。
 *   準決勝の出場者以外は常に 0 なので、絞り込まずに全選手を対象にする。
 * - SemifinalHistory（Undo 用の履歴）も一緒に削除する。残すと、リセット後の Undo で
 *   古い途中経過が戻ってしまうため（他のラウンドと同じ）。
 * - 二つ名・写真（Player.nickname・PlayerPhoto）は消さない。
 * - 2026-10-22: 決勝の成績も一緒に初期化する（一本道の前提。docs/linear-progress-design.md）。
 * - 進行状態（セット・表示・タイマー）はサーバのメモリにあるので、Admin が
 *   reset_round_progress { from: 'semifinal' } を送って戻す。
 */
export async function POST() {
    try {
        // スコアの初期化と履歴の削除は同じトランザクションで行う（片方だけ成功すると Undo で古い状態に戻れてしまう）
        await prisma.$transaction(async (tx) => {
            await resetRoundsFrom(tx, 'semifinal', { clearProfiles: false });
        });

        const allPlayers = await prisma.player.findMany({ orderBy: { paperRank: 'asc' } });

        return NextResponse.json({ success: true, allPlayers });
    } catch (error) {
        console.error('Semifinal reset error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
