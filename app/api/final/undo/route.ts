import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NO_HISTORY_MESSAGE, allSnapshotPlayersExist } from '@/lib/undoHistory';
import type { Player } from '@/lib/types';

/**
 * POST: 決勝のスコア更新を1手戻す
 *
 * FinalHistory はコースや組のような区分を持たない単一グループ（Extra Round・
 * 準決勝と同じ形）なので、絞り込みなしで最新1件を取ればよい。
 *
 * 復元するのは finalCorrectCount / finalWrongCount / finalSetsWon / finalRank の
 * 4項目だけ。この4つ以外は決勝の操作で変わらない。
 */
export async function POST() {
    try {
        const latest = await prisma.finalHistory.findFirst({
            orderBy: { id: 'desc' }
        });

        if (!latest) {
            return NextResponse.json({ error: NO_HISTORY_MESSAGE }, { status: 400 });
        }

        const playersToRestore: Player[] = JSON.parse(latest.snapshot);

        // 選手名簿の取り込み直しなどで、履歴が参照する選手がもう存在しない場合は、
        // 復元しようとして落ちる前に中止する（履歴行は消さない）。
        if (!(await allSnapshotPlayersExist(playersToRestore.map((p: { id: number }) => p.id)))) {
            return NextResponse.json({ error: NO_HISTORY_MESSAGE }, { status: 400 });
        }

        // 復元と履歴行の削除は同じトランザクションで行う。
        // 片方だけ成功すると、同じ履歴で二重に戻せる状態になる。
        await prisma.$transaction([
            ...playersToRestore.map(p =>
                prisma.player.update({
                    where: { id: p.id },
                    data: {
                        finalCorrectCount: p.finalCorrectCount,
                        finalWrongCount: p.finalWrongCount,
                        finalSetsWon: p.finalSetsWon,
                        finalRank: p.finalRank
                    }
                })
            ),
            prisma.finalHistory.delete({ where: { id: latest.id } })
        ]);

        const allPlayers = await prisma.player.findMany({ orderBy: { paperRank: 'asc' } });

        return NextResponse.json({ success: true, allPlayers });
    } catch (error) {
        console.error('Final undo error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
