import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseQuestionPoolCsv, selectQuestionRange } from '@/lib/questionPool';

// 大会共通の問題群から、通し番号の範囲で問題を返す。
//   GET /api/questions?from=1&to=30          … Admin 用（別解・正誤判定基準を含む）
//   GET /api/questions?from=1&to=30&public=1 … Main 用（問題文と解答だけ）
//
// 問題群の取り込み方法は未決（lib/questionPool.ts 冒頭）。いまは検証用サンプル
// test_questions.csv をそのまま読む。取込方法が決まったら、この読み込み元だけを差し替える。
const SAMPLE_FILE = path.join(process.cwd(), 'test_questions.csv');

export async function GET(request: Request) {
    try {
        const params = new URL(request.url).searchParams;
        const from = Number(params.get('from'));
        const to = Number(params.get('to'));

        const { questions: pool, errors } = parseQuestionPoolCsv(await readFile(SAMPLE_FILE, 'utf-8'));
        if (errors.length > 0) {
            return NextResponse.json({ error: '問題データに誤りがあります', details: errors }, { status: 500 });
        }

        const result = selectQuestionRange(pool, from, to);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

        const questions = params.get('public') === '1'
            ? result.questions.map(({ serial, text, answer }) => ({ serial, text, answer }))
            : result.questions;
        return NextResponse.json({ success: true, questions });
    } catch (error) {
        console.error('Questions load error:', error);
        return NextResponse.json({ error: '問題データを読み込めません' }, { status: 500 });
    }
}
