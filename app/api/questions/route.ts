import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { selectQuestionRange } from '@/lib/questionPool';
import { QUESTION_POOL_NOT_READY, isQuestionPoolClientReady, isTableMissingError } from '@/lib/questionPoolDb';

// 大会共通の問題群から、通し番号の範囲で問題を返す。
//   GET /api/questions?from=1&to=30          … Admin 用（別解・正誤判定基準を含む）
//   GET /api/questions?from=1&to=30&public=1 … Main 用（問題文と解答だけ）
//
// 2026-10-22: 読み込み元を検証用 test_questions.csv から DB（QuestionPoolItem）に差し替えた。
// 問題データは Admin の待機画面の「問題データ」で取り込む（POST /api/questionPool）。
export async function GET(request: Request) {
    try {
        // 問題データの表がまだ使えない（migrate 前）ときは、やることを書いたメッセージで返す
        if (!isQuestionPoolClientReady()) return NextResponse.json({ error: QUESTION_POOL_NOT_READY }, { status: 503 });
        const params = new URL(request.url).searchParams;
        const from = Number(params.get('from'));
        const to = Number(params.get('to'));

        // 範囲の検証（selectQuestionRange）が済むまでは DB を広く読まない
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
            const check = selectQuestionRange([], from, to);
            return NextResponse.json({ error: check.ok ? '通し番号の範囲が不正です' : check.error }, { status: 400 });
        }
        const pool = await prisma.questionPoolItem.findMany({
            where: { serial: { gte: from, lte: to } },
            orderBy: { serial: 'asc' },
        });
        if (pool.length === 0 && (await prisma.questionPoolItem.count()) === 0) {
            return NextResponse.json({ error: '問題データが登録されていません（待機画面の Admin で取り込んでください）' }, { status: 400 });
        }

        const result = selectQuestionRange(pool, from, to);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

        const questions = params.get('public') === '1'
            ? result.questions.map(({ serial, text, answer }) => ({ serial, text, answer }))
            : result.questions;
        return NextResponse.json({ success: true, questions });
    } catch (error) {
        if (isTableMissingError(error)) return NextResponse.json({ error: QUESTION_POOL_NOT_READY }, { status: 503 });
        console.error('Questions load error:', error);
        return NextResponse.json({ error: '問題データを読み込めません' }, { status: 500 });
    }
}
