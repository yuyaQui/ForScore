import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST: Extra Round の結果を全選手ぶんリセットする
 *
 * extraRoundRank・extraRoundCorrectCount・extraRoundSecondStep を初期値に戻す。
 * ExtraRoundHistory（Undo用の履歴）も一緒に削除する。履歴を残したままだと、
 * リセット後に古い履歴でUndoしてしまい、矛盾した状態に戻る事故につながるため。
 *
 * 進行状態（server/ExtraRoundHandler.js が持つ questionNumber・mode 等）は
 * ここでは触らない。あくまで選手データのリセットに限定する。
 */
export async function POST() {
    try {
        await prisma.$transaction([
            prisma.player.updateMany({
                data: {
                    extraRoundRank: 0,
                    extraRoundCorrectCount: 0,
                    extraRoundSecondStep: false
                }
            }),
            prisma.extraRoundHistory.deleteMany({})
        ]);

        const allPlayers = await prisma.player.findMany({ orderBy: { paperRank: 'asc' } });

        return NextResponse.json({ success: true, allPlayers });
    } catch (error) {
        console.error('Extra Round reset error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
