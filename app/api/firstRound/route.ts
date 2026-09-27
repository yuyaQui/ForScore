import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';
import { getAdvantage } from '@/lib/advantage';
import { getSecondRoundGroup } from '@/lib/secondRound';

export async function POST(request: Request) {
  try {
    const { players } = await request.json();

    // 1st Round には約200名が参加する。2nd Round に進むのは上位48名だけで、
    // 49位以降は組番号もアドバンテージも持たない。
    // 「48名まで」という判断は getSecondRoundGroup に閉じている。
    const rows = players.map((p: string[]) => {
      const paperRank = parseInt(p[0], 10);
      // 参加組を決定（紙落ちは null）
      const group = getSecondRoundGroup(paperRank);

      return {
        paperRank,
        entryNo: parseInt(p[1], 10),
        school: p[2],
        grade: p[3],
        name: p[4],
        secondRoundGroupNumber: group,
        // 各組の1R上位6名はアドバンテージを持った状態でスタートする。
        // 2nd Round に出ない選手には付けない。
        secondRoundPoint: group === null ? 0 : getAdvantage(paperRank)
      };
    });

    await prisma.$transaction(async (tx) => {
      await tx.player.deleteMany({});
      // 1件ずつ create すると{player数}件で往復が{player数}回になる。createMany なら1回で済む
      await tx.player.createMany({ data: rows });
    });

    // 何名取り込んだかを返す。48名のつもりが200名だった、という取り違えに気づける
    return NextResponse.json({ success: true, count: rows.length });
  } catch (error) {
    console.log('CSV Upload Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
