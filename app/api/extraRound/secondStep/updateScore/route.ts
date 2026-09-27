import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';
import { applySecondStepScore } from '@/lib/extraRoundScoring';

export async function POST(request: Request) {
  try {
    const { playerId, action } = await request.json();

    if (!playerId || !action) {
      return NextResponse.json({ error: 'Missing playerId or action' }, { status: 400 });
    }

    // Second Step 出場者（通過者選択で選ばれた最大12名）を取得
    const entrants = await prisma.player.findMany({
      where: { extraRoundSecondStep: true }
    });

    // Undo 用のスナップショット（更新「前」の状態）を先に固める
    const snapshot = JSON.stringify(entrants);

    // 純関数で採点を適用する
    const scored = applySecondStepScore({ players: entrants, playerId, action });

    await prisma.$transaction(async (tx) => {
      // 0. 更新前の状態を履歴に保存
      await tx.extraRoundHistory.create({ data: { snapshot } });

      // 1. 出場者全員ぶんを反映する。
      // 「残り1名で自動敗者復活」は対象者以外の rank も変えるため、全員分を書き戻す
      for (const p of scored) {
        await tx.player.update({
          where: { id: p.id },
          data: {
            extraRoundCorrectCount: p.extraRoundCorrectCount,
            extraRoundRank: p.extraRoundRank
          }
        });
      }
    });

    // 更新後、全選手の最新状態を返す（Admin/Main への配信に使う）
    const allPlayers = await prisma.player.findMany({
      orderBy: { paperRank: 'asc' }
    });

    return NextResponse.json({ success: true, allPlayers });
  } catch (error) {
    console.log('Extra Round Second Step Score Update Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
