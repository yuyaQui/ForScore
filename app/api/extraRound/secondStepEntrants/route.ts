import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';
import { EXTRA_ROUND_MAX_ENTRANTS } from '@/lib/extraRound';

/**
 * Second Step 出場者（First Step 通過者）の確定。
 *
 * 毎回「選ばれた人だけ true、それ以外は false」に全員分を洗い替えるので、選び直しても
 * 矛盾なく上書きできる。
 *
 * 1名だけが選ばれた場合は早押しをする相手がいないため、Second Step を飛ばして
 * その1名を敗者復活（extraRoundRank = 1）として確定する（準決勝5番席に入る）。
 *
 * すでに Second Step の採点が進んでいる状態で出場者を選び直すと、旧い正解数や順位が
 * 新しい出場者に混ざってしまう。そのため採点済みの結果・履歴があるときは、画面側の
 * 確認（confirmReset）を得たうえで、Extra Round の結果をすべて初期化してから登録する。
 */
export async function POST(request: Request) {
  try {
    const { entryNos, confirmReset } = await request.json();

    // ---- 入力の検証 ----
    if (
      !Array.isArray(entryNos) ||
      !entryNos.every((n: unknown) => Number.isInteger(n))
    ) {
      return NextResponse.json({ error: '出場者の指定が正しくありません' }, { status: 400 });
    }
    const uniqueEntryNos: number[] = Array.from(new Set<number>(entryNos));
    if (uniqueEntryNos.length === 0) {
      return NextResponse.json({ error: '出場者を1名以上選んでください' }, { status: 400 });
    }
    if (uniqueEntryNos.length > EXTRA_ROUND_MAX_ENTRANTS) {
      return NextResponse.json(
        { error: `出場者は最大${EXTRA_ROUND_MAX_ENTRANTS}名までです` },
        { status: 400 }
      );
    }

    const selected = await prisma.player.findMany({
      where: { entryNo: { in: uniqueEntryNos } },
      select: { entryNo: true, name: true, thirdRoundRank: true }
    });
    if (selected.length !== uniqueEntryNos.length) {
      return NextResponse.json({ error: '存在しない選手が含まれています' }, { status: 400 });
    }

    // 3rd Round 通過者（thirdRoundRank > 0）は Second Step の対象にしない。
    // Admin 側の候補一覧でもすでに除外しているが、古い画面状態から送られてくる
    // 余地が残るため、ここでも防ぐ（「3rd Round通過」と「Extra Round敗者復活」が
    // 同じ選手に両方付き、準決勝の座席が重複する事故を避ける）。
    const passed = selected.filter(p => p.thirdRoundRank > 0);
    if (passed.length > 0) {
      return NextResponse.json(
        { error: `3rd Round 通過者は選べません（${passed.map(p => p.name).join('、')}）` },
        { status: 400 }
      );
    }

    // ---- 採点済みかの確認 ----
    const [scoredCount, historyCount, semifinalHistoryCount] = await Promise.all([
      prisma.player.count({
        where: { OR: [{ extraRoundRank: { not: 0 } }, { extraRoundCorrectCount: { gt: 0 } }] }
      }),
      prisma.extraRoundHistory.count(),
      prisma.semifinalHistory.count()
    ]);
    const hasScoring = scoredCount > 0 || historyCount > 0;

    if (hasScoring && confirmReset !== true) {
      return NextResponse.json(
        {
          error: 'Second Step の採点結果が残っています',
          needsConfirmation: true,
          // 準決勝がすでに始まっている場合は、画面の確認文でその旨を強調する
          semifinalStarted: semifinalHistoryCount > 0
        },
        { status: 409 }
      );
    }

    const isSingle = uniqueEntryNos.length === 1;

    await prisma.$transaction(async (tx) => {
      if (hasScoring) {
        await tx.extraRoundHistory.deleteMany({});
        await tx.player.updateMany({
          data: { extraRoundRank: 0, extraRoundCorrectCount: 0 }
        });
      }
      await tx.player.updateMany({
        where: { entryNo: { in: uniqueEntryNos } },
        data: { extraRoundSecondStep: true }
      });
      await tx.player.updateMany({
        where: { entryNo: { notIn: uniqueEntryNos } },
        data: { extraRoundSecondStep: false }
      });
      if (isSingle) {
        // 通過者が1名だけ。早押しの相手がいないので、そのまま敗者復活
        await tx.player.update({
          where: { entryNo: uniqueEntryNos[0] },
          data: { extraRoundRank: 1 }
        });
      }
    });

    // 更新後、全選手の最新状態を返す（Admin/Main への配信に使う）
    const allPlayers = await prisma.player.findMany({
      orderBy: { paperRank: 'asc' }
    });

    return NextResponse.json({ success: true, allPlayers, singleWinner: isSingle });
  } catch (error) {
    console.log('Extra Round Second Step Entrants Update Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
