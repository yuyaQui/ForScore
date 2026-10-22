import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseQuestionPoolCsv, summarizeQuestionPool } from '@/lib/questionPool';
import { QUESTION_POOL_NOT_READY, isQuestionPoolClientReady, isTableMissingError } from '@/lib/questionPoolDb';

// 大会共通の問題群の取り込み（2026-10-22 追加。docs/question-display-design.md 3.2）。
//   GET  /api/questionPool … 登録状況（件数・最小／最大の通し番号・欠番）
//   POST /api/questionPool … { csvText, confirmReplace? } を検証して全件入れ替える

/** 登録状況を返す */
async function loadSummary() {
    const rows = await prisma.questionPoolItem.findMany({ select: { serial: true }, orderBy: { serial: 'asc' } });
    return summarizeQuestionPool(rows.map(r => r.serial));
}

/** 問題データの表がまだ使えないときの応答（503。やることを書いたメッセージを返す） */
function notReady() {
    return NextResponse.json({ error: QUESTION_POOL_NOT_READY, notReady: true }, { status: 503 });
}

export async function GET() {
    try {
        if (!isQuestionPoolClientReady()) return notReady();
        return NextResponse.json({ success: true, summary: await loadSummary() });
    } catch (error) {
        if (isTableMissingError(error)) return notReady();
        console.error('Question pool summary error:', error);
        return NextResponse.json({ error: '問題データを読み込めません' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        if (!isQuestionPoolClientReady()) return notReady();
        const body = await request.json();
        if (!body || typeof body.csvText !== 'string') {
            return NextResponse.json({ error: 'CSV の内容がありません' }, { status: 400 });
        }

        // 画面と同じ検証（lib/questionPool.ts）。1行でも誤りがあれば何も変えない
        const { questions, errors } = parseQuestionPoolCsv(body.csvText);
        if (errors.length > 0) {
            return NextResponse.json({ error: 'CSV に誤りがあります', details: errors }, { status: 400 });
        }
        if (questions.length === 0) {
            return NextResponse.json({ error: '問題が1問もありません' }, { status: 400 });
        }

        // すでに登録があるときは、利用者が確認した（confirmReplace）場合だけ入れ替える
        const existing = await prisma.questionPoolItem.count();
        if (existing > 0 && body.confirmReplace !== true) {
            return NextResponse.json(
                { error: '登録済みの問題データがあります', needsConfirmation: true, existing },
                { status: 409 }
            );
        }

        // 削除と登録を同じトランザクションで行う（片方だけ成功した状態を作らない）
        await prisma.$transaction([
            prisma.questionPoolItem.deleteMany({}),
            prisma.questionPoolItem.createMany({
                data: questions.map(q => ({ serial: q.serial, text: q.text, answer: q.answer, altAnswer: q.altAnswer })),
            }),
        ]);

        return NextResponse.json({ success: true, summary: await loadSummary() });
    } catch (error) {
        if (isTableMissingError(error)) return notReady();
        console.error('Question pool import error:', error);
        return NextResponse.json({ error: '問題データを登録できません' }, { status: 500 });
    }
}
