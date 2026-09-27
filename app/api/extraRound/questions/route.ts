import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';

// 登録済みの問題を番号順に返す。取込画面で「今何問登録済みか」を出すのに使う
export async function GET() {
  try {
    const questions = await prisma.extraRoundQuestion.findMany({
      orderBy: { number: 'asc' }
    });
    return NextResponse.json({ success: true, questions });
  } catch (error) {
    console.log('Extra Round Questions Load Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// CSV（番号,問題文,正解）で丸ごと取り込む。1st Round の取込と同じく、全件を置き換える
export async function POST(request: Request) {
  try {
    const { questions } = await request.json();

    const rows = questions.map((q: string[]) => ({
      number: parseInt(q[0], 10),
      text: q[1],
      answer: q[2]
    }));

    await prisma.$transaction(async (tx) => {
      await tx.extraRoundQuestion.deleteMany({});
      // 1件ずつ create すると往復が問題数だけ発生する。createMany なら1回で済む
      await tx.extraRoundQuestion.createMany({ data: rows });
    });

    // 何問取り込んだかを返す。取り違えに気づけるようにする
    return NextResponse.json({ success: true, count: rows.length });
  } catch (error) {
    console.log('Extra Round Questions Upload Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
