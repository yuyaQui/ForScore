import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Player } from '@/lib/types';

/** 全選手の最新状態を返す（Socket 配信でそのまま使う） */
async function loadAllPlayers() {
    return prisma.player.findMany({ orderBy: { paperRank: 'asc' } });
}

/**
 * POST: 3rd Round のスコア更新を1手戻す
 *
 * updateScores が保存したスナップショット（更新「前」のコース5名）を復元する。
 * 履歴はコース単位なので、あるコースの Undo が他のコースに影響することはない。
 *
 * 復元するのは 3rd Round のスコア6項目だけ。thirdRoundCourseName は戻さない。
 * 所属コースを決めるのはコース選択フェーズの仕事で、スコアの Undo が出場者の割当を
 * 巻き戻すのは筋が違う（取り消しには assignCourse の DELETE がある）。
 *
 * タイマーも戻らない。サーバのメモリにあり DB に無いため、別系統で操作する。
 */
export async function POST(request: Request) {
    try {
        const { courseName } = await request.json();

        if (!courseName) {
            return NextResponse.json({ error: 'コース名が指定されていません' }, { status: 400 });
        }

        // そのコースの最新の履歴を取る。
        // createdAt ではなく id の降順で取るのは、同じ秒に複数手が入っても
        // 順序が一意に定まるため。
        const latest = await prisma.thirdRoundHistory.findFirst({
            where: { course: courseName },
            orderBy: { id: 'desc' }
        });

        if (!latest) {
            return NextResponse.json(
                { error: '戻せる操作がありません' },
                { status: 400 }
            );
        }

        const playersToRestore: Player[] = JSON.parse(latest.snapshot);

        // 復元と履歴行の削除は同じトランザクションで行う。
        // 片方だけ成功すると、同じ履歴で二重に戻せる状態になる。
        await prisma.$transaction([
            ...playersToRestore.map(p =>
                prisma.player.update({
                    where: { id: p.id },
                    data: {
                        thirdRoundCorrectCount: p.thirdRoundCorrectCount,
                        thirdRoundWrongCount: p.thirdRoundWrongCount,
                        thirdRoundUpDownPoint: p.thirdRoundUpDownPoint,
                        thirdRoundSwedishCross: p.thirdRoundSwedishCross,
                        thirdRoundFreezeRest: p.thirdRoundFreezeRest,
                        thirdRoundRank: p.thirdRoundRank
                    }
                })
            ),
            prisma.thirdRoundHistory.delete({ where: { id: latest.id } })
        ]);

        const allPlayers = await loadAllPlayers();

        return NextResponse.json({ success: true, allPlayers });
    } catch (error) {
        console.error('Third round undo error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
