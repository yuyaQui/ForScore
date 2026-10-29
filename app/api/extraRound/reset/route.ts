import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resetRoundsFrom } from '@/lib/roundReset';

/**
 * POST: Extra Round の結果を全選手ぶんリセットする
 *
 * extraRoundRank・extraRoundCorrectCount・extraRoundSecondStep を初期値に戻す。
 * ExtraRoundHistory（Undo用の履歴）も一緒に削除する。履歴を残したままだと、
 * リセット後に古い履歴でUndoしてしまい、矛盾した状態に戻る事故につながるため。
 *
 * 2026-10-22: 「敗者復活者なし」の確定と、Semi-Final 以降も丸ごと初期化する。
 * Semi-Final 進出者が決まる前のフェーズなので、二つ名と写真も消す（docs/linear-progress-design.md）。
 *
 * 進行状態（server/ExtraRoundHandler.js が持つ stage・cursor）は、Admin が
 * reset_round_progress を送って戻す。
 */
export async function POST() {
    try {
        await prisma.$transaction(async (tx) => {
            await resetRoundsFrom(tx, 'extraRound', { clearProfiles: true });
        });

        const allPlayers = await prisma.player.findMany({ orderBy: { paperRank: 'asc' } });

        return NextResponse.json({ success: true, allPlayers });
    } catch (error) {
        console.error('Extra Round reset error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
