import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NO_HISTORY_MESSAGE, allSnapshotPlayersExist } from '@/lib/undoHistory';
import { guardUndo } from '@/lib/roundGuard';

export async function POST(request: Request) {
  try {
    const { secondRoundState } = await request.json();
    // 後のラウンドが始まっていたら Undo しない（2026-10-22 提案B）
    const blocked = await guardUndo('secondRound');
    if (blocked) return blocked;
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
      return NextResponse.json({ error: NO_HISTORY_MESSAGE }, { status: 400 });
    }

    // 2. スナップショットをデシリアライズする
    const playersToRestore = JSON.parse(latestHistory.snapshot);

    // 選手名簿の取り込み直しなどで、履歴が参照する選手がもう存在しない場合は、
    // 復元しようとして落ちる前に中止する（履歴行は消さない）。
    if (!(await allSnapshotPlayersExist(playersToRestore.map((p: { id: number }) => p.id)))) {
      return NextResponse.json({ error: NO_HISTORY_MESSAGE }, { status: 400 });
    }

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
