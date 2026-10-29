import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resetRoundsFrom } from '@/lib/roundReset';

/**
 * POST: 決勝の結果を全選手ぶんリセットする（2026-10-22 新設。docs/linear-progress-design.md）
 *
 * 正解数・誤答数・獲得セット数・最終順位を 0 に戻し、Undo 履歴も消す。
 * 二つ名・写真は消さない。進行状態（セット・表示）は Admin が reset_round_progress を送って戻す。
 */
export async function POST() {
    try {
        await prisma.$transaction(async (tx) => {
            await resetRoundsFrom(tx, 'final', { clearProfiles: false });
        });

        const allPlayers = await prisma.player.findMany({ orderBy: { paperRank: 'asc' } });

        return NextResponse.json({ success: true, allPlayers });
    } catch (error) {
        console.error('Final reset error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
