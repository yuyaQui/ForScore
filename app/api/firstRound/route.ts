import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';
import { getAdvantage } from '@/lib/advantage';

export async function POST(request: Request) {
  try {
    const { players } = await request.json();
    await prisma.$transaction(async (tx) => {
      await tx.player.deleteMany({});
      for (const p of players) {
        const paperRank = parseInt(p[0], 10);
        await tx.player.create({
          data: {
            paperRank,
            entryNo: parseInt(p[1], 10),
            school: p[2],
            grade: p[3],
            name: p[4],
            secondRoundGroupNumber: (paperRank % 4) || 4,
            // 各組の1R上位6名はアドバンテージを持った状態でスタートする
            secondRoundPoint: getAdvantage(paperRank)
          }
        });
      }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log('CSV Upload Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}