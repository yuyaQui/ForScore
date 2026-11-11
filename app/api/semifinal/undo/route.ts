import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NO_HISTORY_MESSAGE, allSnapshotPlayersExist } from '@/lib/undoHistory';
import { guardUndo } from '@/lib/roundGuard';
import type { Player } from '@/lib/types';

/**
 * POST: 準決勝のスコア更新を1手戻す
 *
 * SemifinalHistory はコースや組のような区分を持たない単一グループ（Extra Round と
 * 同じ形）なので、絞り込みなしで最新1件を取ればよい。
 *
 * 復元するのは semifinalPoint / semifinalRank / semifinalLostSet の3項目だけ。この3つ以外は
 * 準決勝の操作で変わらない。semifinalLostSet を持たない古い履歴（2026-11-11 より前）は 0 に戻す。
 */
export async function POST() {
    try {
        // 後のラウンドが始まっていたら Undo しない（2026-10-22 提案B）
        const blocked = await guardUndo('semifinal');
        if (blocked) return blocked;

        const latest = await prisma.semifinalHistory.findFirst({
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
                        semifinalPoint: p.semifinalPoint,
                        semifinalRank: p.semifinalRank,
                        semifinalLostSet: p.semifinalLostSet ?? 0
                    }
                })
            ),
            prisma.semifinalHistory.delete({ where: { id: latest.id } })
        ]);

        const allPlayers = await prisma.player.findMany({ orderBy: { paperRank: 'asc' } });

        return NextResponse.json({ success: true, allPlayers });
    } catch (error) {
        console.error('Semifinal undo error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
