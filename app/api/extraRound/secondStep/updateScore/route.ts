import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';
import { applySecondStepScore } from '@/lib/extraRoundScoring';

export async function POST(request: Request) {
  try {
    const { playerId, action } = await request.json();

    if (!playerId || (action !== 'correct' && action !== 'wrong')) {
      return NextResponse.json({ error: 'Missing playerId or action' }, { status: 400 });
    }

    // Second Step 出場者（通過者選択で選ばれた最大12名）を取得
    const entrants = await prisma.player.findMany({
      where: { extraRoundSecondStep: true }
    });

    // 出場者でない選手・すでに結果が出ている選手への操作は受け付けない。
    // 受け付けると、何も変わらない履歴だけが積まれてUndoの手数がずれる。
    const target = entrants.find(p => p.id === playerId);
    if (!target) {
      return NextResponse.json({ error: 'Second Step の出場者ではありません' }, { status: 400 });
    }
    // 勝ち抜け者が決まった後は採点を止める（残りの選手が5問正解すると勝者が2名になるため）
    if (entrants.some(p => p.extraRoundRank > 0)) {
      return NextResponse.json({ error: '勝ち抜け者がすでに決まっています' }, { status: 400 });
    }
    if (target.extraRoundRank !== 0) {
      return NextResponse.json({ error: 'この選手の結果はすでに確定しています' }, { status: 400 });
    }

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
