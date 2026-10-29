import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resetRoundsFrom, THIRD_ROUND_SCORE_DEFAULTS } from '@/lib/roundReset';

/**
 * POST: 3rd Round の1コース分のスコアを初期状態に戻す（2026-10-11 ユーザー承認済み）
 *
 * 2nd Round の resetScores（組ごとのリセット）と同じ位置づけ。
 * - 対象は指定コースに割り当てられた選手だけ。他のコース・他のラウンドには触れない。
 * - 戻すのはスコア6項目（正解数・誤答数・10 up-down のポイント・Swedish の×・
 *   Freeze の休み・勝ち抜け/失格の順位）。所属コース（thirdRoundCourseName）と
 *   コースの抽選結果（playOrder）は変えない。
 * - タイマーはサーバのメモリにあり DB に無いので、ここでは扱わない（RESET で戻す）。
 * - そのコースの Undo 履歴も削除する。リセット後に Undo で古い途中経過が
 *   復活しないようにするため（ユーザー確認済み）。
 * - 2026-10-22: Extra Round 以降を丸ごと初期化する（二つ名と写真も消す。docs/linear-progress-design.md）。
 */
export async function POST(request: Request) {
    try {
        const { courseName } = await request.json();

        if (!courseName || typeof courseName !== 'string') {
            return NextResponse.json({ error: 'コース名が指定されていません' }, { status: 400 });
        }

        const course = await prisma.thirdRoundCourse.findUnique({ where: { name: courseName } });
        if (!course) {
            return NextResponse.json({ error: 'コースが見つかりません' }, { status: 400 });
        }

        // スコアの初期化と履歴の削除は同じトランザクションで行う。
        // 片方だけ成功すると、Undo で古い途中経過が戻せる状態が残る。
        await prisma.$transaction(async (tx) => {
            await tx.player.updateMany({
                where: { thirdRoundCourseName: courseName },
                data: THIRD_ROUND_SCORE_DEFAULTS
            });
            await tx.thirdRoundHistory.deleteMany({ where: { course: courseName } });
            await resetRoundsFrom(tx, 'extraRound', { clearProfiles: true });
        });

        const allPlayers = await prisma.player.findMany({ orderBy: { paperRank: 'asc' } });

        return NextResponse.json({ success: true, allPlayers });
    } catch (error) {
        console.error('Third round reset scores error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
