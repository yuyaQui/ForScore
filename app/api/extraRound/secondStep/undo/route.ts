import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';
import { NO_HISTORY_MESSAGE, allSnapshotPlayersExist } from '@/lib/undoHistory';
import { guardUndo } from '@/lib/roundGuard';

export async function POST() {
  try {
    // 後のラウンドが始まっていたら Undo しない（2026-10-22 提案B）
    const blocked = await guardUndo('extraRound');
    if (blocked) return blocked;

    // Second Step にはグループ分けがないため、2nd Round と違い絞り込みなしで
    // 最新1件を取ればよい
    const latestHistory = await prisma.extraRoundHistory.findFirst({
      orderBy: { id: 'desc' }
    });

    if (!latestHistory) {
      return NextResponse.json({ error: NO_HISTORY_MESSAGE }, { status: 400 });
    }

    const playersToRestore = JSON.parse(latestHistory.snapshot);

    // 選手名簿の取り込み直しなどで、履歴が参照する選手がもう存在しない場合は、
    // 復元しようとして落ちる前に中止する（履歴行は消さない）。
    if (!(await allSnapshotPlayersExist(playersToRestore.map((p: { id: number }) => p.id)))) {
      return NextResponse.json({ error: NO_HISTORY_MESSAGE }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      for (const p of playersToRestore) {
        await tx.player.update({
          where: { id: p.id },
          data: {
            extraRoundCorrectCount: p.extraRoundCorrectCount,
            extraRoundRank: p.extraRoundRank
          }
        });
      }

      // 復元に使用した履歴レコードを削除する
      await tx.extraRoundHistory.delete({
        where: { id: latestHistory.id }
      });
    });

    const allPlayers = await prisma.player.findMany({
      orderBy: { paperRank: 'asc' }
    });

    return NextResponse.json({ success: true, allPlayers });
  } catch (error) {
    console.log('Extra Round Second Step Undo Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
