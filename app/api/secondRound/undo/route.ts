import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const { secondRoundState } = await request.json();
    const group = secondRoundState?.group;

    if (!group) {
      return NextResponse.json({ error: 'Missing group number' }, { status: 400 });
    }

    // 1. 指定されたグループの最新の履歴（スナップショット）を取得する
    const latestHistory = await prisma.secondRoundHistory.findFirst({
      where: { secondRoundGroupNumber: group },
      orderBy: { id: 'desc' }
    });

    if (!latestHistory) {
      return NextResponse.json({ error: 'No history found to undo' }, { status: 400 });
    }

    // 2. スナップショットをデシリアライズする
    const playersToRestore = JSON.parse(latestHistory.snapshot);

    // 3. トランザクション処理でプレイヤーデータの復元と履歴レコードの削除を行う
    await prisma.$transaction(async (tx) => {
      for (const p of playersToRestore) {
        await tx.player.update({
          where: { id: p.id },
          data: {
            secondRoundPoint: p.secondRoundPoint,
            secondRoundWrongCount: p.secondRoundWrongCount,
            secondRoundDoubleChance: p.secondRoundDoubleChance,
            secondRoundRank: p.secondRoundRank
          }
        });
      }

      // 4. 復元に使用した履歴レコードを削除する
      await tx.secondRoundHistory.delete({
        where: { id: latestHistory.id }
      });
    });

    // 5. 更新後の全プレイヤーの最新状態を取得
    const allPlayers = await prisma.player.findMany({
      orderBy: { paperRank: 'asc' },
    });

    return NextResponse.json({
      success: true,
      allPlayers
    });

  } catch (error) {
    console.error('Undo API error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
