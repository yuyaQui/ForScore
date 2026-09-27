import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';

// First Step 通過者（Second Step 出場者）の登録。
// 毎回「選ばれた人だけ true、それ以外は false」に全員分を洗い替えるので、
// 選び直しても矛盾なく上書きできる
export async function POST(request: Request) {
  try {
    const { entryNos } = await request.json();

    // 3rd Round 通過者（thirdRoundRank > 0）は Second Step の対象にしない。
    // Admin 側の候補一覧でもすでに除外しているが、古い画面状態から送られてくる
    // 余地が残るため、ここでも防ぐ（「3rd Round通過」と「Extra Round敗者復活」が
    // 同じ選手に両方付き、準決勝の座席が重複する事故を避ける）。
    const validEntryNos = (
      await prisma.player.findMany({
        where: { entryNo: { in: entryNos }, thirdRoundRank: { lte: 0 } },
        select: { entryNo: true }
      })
    ).map(p => p.entryNo);

    await prisma.$transaction([
      prisma.player.updateMany({
        where: { entryNo: { in: validEntryNos } },
        data: { extraRoundSecondStep: true }
      }),
      prisma.player.updateMany({
        where: { entryNo: { notIn: validEntryNos } },
        data: { extraRoundSecondStep: false }
      })
    ]);

    // 更新後、全選手の最新状態を返す（Admin/Main への配信に使う）
    const allPlayers = await prisma.player.findMany({
      orderBy: { paperRank: 'asc' }
    });

    return NextResponse.json({ success: true, allPlayers });
  } catch (error) {
    console.log('Extra Round Second Step Entrants Update Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
