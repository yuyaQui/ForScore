import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Player } from '@/lib/types';

/**
 * POST: 準決勝のスコア更新を1手戻す
 *
 * SemifinalHistory はコースや組のような区分を持たない単一グループ（Extra Round と
 * 同じ形）なので、絞り込みなしで最新1件を取ればよい。
 *
 * 復元するのは semifinalPoint / semifinalRank の2項目だけ。この2つ以外は
 * 準決勝の操作で変わらない。
 */
export async function POST() {
    try {
        const latest = await prisma.semifinalHistory.findFirst({
            orderBy: { id: 'desc' }
        });

        if (!latest) {
            return NextResponse.json({ error: '戻せる操作がありません' }, { status: 400 });
        }

        const playersToRestore: Player[] = JSON.parse(latest.snapshot);

        // 復元と履歴行の削除は同じトランザクションで行う。
        // 片方だけ成功すると、同じ履歴で二重に戻せる状態になる。
        await prisma.$transaction([
            ...playersToRestore.map(p =>
                prisma.player.update({
                    where: { id: p.id },
                    data: {
                        semifinalPoint: p.semifinalPoint,
                        semifinalRank: p.semifinalRank
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
