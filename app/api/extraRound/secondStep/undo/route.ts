import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';

export async function POST() {
  try {
    // Second Step にはグループ分けがないため、2nd Round と違い絞り込みなしで
    // 最新1件を取ればよい
    const latestHistory = await prisma.extraRoundHistory.findFirst({
      orderBy: { id: 'desc' }
    });

    if (!latestHistory) {
      return NextResponse.json({ error: 'No history found to undo' }, { status: 400 });
    }

    const playersToRestore = JSON.parse(latestHistory.snapshot);

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
