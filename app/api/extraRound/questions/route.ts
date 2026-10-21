import { NextResponse } from "next/server";
import { prisma } from '@/lib/prisma';
import { validateExtraRoundRows } from '@/lib/extraRoundCsv';

// 登録済みの問題を番号順に返す。取込画面で「今何問登録済みか」を出すのと、
// Admin の First Step 進行画面で問題・解答・別解を表示するのに使う。
// 2026-10-11 のユーザー指示で、別解・正誤判定基準（altAnswer）も Main の解答表示に出すことになった
export async function GET(request: Request) {
  try {
    const questions = await prisma.extraRoundQuestion.findMany({
      orderBy: { number: 'asc' }
    });
    // ?public=1（Main 画面用）は、Main で使う項目（問題文・解答・別解・正誤判定基準）だけを返す。
    // 2026-10-11 のユーザー指示で、別解・正誤判定基準も解答と一緒に Main に出すようになった
    if (new URL(request.url).searchParams.get('public') === '1') {
      return NextResponse.json({
        success: true,
        questions: questions.map(({ id, number, text, answer, altAnswer }) => ({ id, number, text, answer, altAnswer }))
      });
    }
    return NextResponse.json({ success: true, questions });
  } catch (error) {
    console.log('Extra Round Questions Load Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// CSV（番号,問題文,模範解答,別解・正誤判定基準）で丸ごと取り込む。
// 1st Round の取込と同じく、全件を置き換える。
// 画面側でも検証しているが、古い画面や直接呼び出しで不完全なデータが
// 入ると First Step の途中で問題が表示できなくなるため、ここでも同じ検証をする
export async function POST(request: Request) {
  try {
    const { questions } = await request.json();

    const result = validateExtraRoundRows(questions);
    if (result.errors.length > 0) {
      return NextResponse.json(
        { error: '問題データに誤りがあります', details: result.errors },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.extraRoundQuestion.deleteMany({});
      // 1件ずつ create すると往復が問題数だけ発生する。createMany なら1回で済む
      await tx.extraRoundQuestion.createMany({ data: result.questions });
    });

    // 何問取り込んだかを返す。取り違えに気づけるようにする
    return NextResponse.json({ success: true, count: result.questions.length });
  } catch (error) {
    console.log('Extra Round Questions Upload Error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
