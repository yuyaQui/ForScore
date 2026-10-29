import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PLAYERS_PER_COURSE } from '@/lib/thirdRoundCourses';
import { selectCourseParticipants, sortByCoursePriority } from '@/lib/courseAssignment';
import { resetRoundsFrom, THIRD_ROUND_SCORE_DEFAULTS } from '@/lib/roundReset';
import { guardRound } from '@/lib/roundGuard';

/** 2nd Round を勝ち抜けた20名を取得する */
async function loadWinners() {
    return prisma.player.findMany({
        where: { secondRoundRank: { gte: 1 } }
    });
}

/** 全選手の最新状態を返す（Socket 配信でそのまま使う） */
async function loadAllPlayers() {
    return prisma.player.findMany({ orderBy: { paperRank: 'asc' } });
}

/**
 * POST: 出場者を確定する
 *
 * スタッフが入力するのは「誰がプレートを掲げていたか」だけ。
 * 上位5名の選抜と、不足分を優先順位下位から補充する処理はここで計算する。
 * 優先順位の暗算をスタッフにさせない。
 */
export async function POST(request: Request) {
    try {
        const { courseName, raisedIds } = await request.json();

        if (!courseName) {
            return NextResponse.json({ error: 'コース名が指定されていません' }, { status: 400 });
        }
        if (!Array.isArray(raisedIds)) {
            return NextResponse.json({ error: 'raisedIds が配列ではありません' }, { status: 400 });
        }

        // 2nd Round が完了していなければ出場者を確定しない（提案C）
        const blocked = await guardRound('thirdRound');
        if (blocked) return blocked;

        // コースが存在し、実施順が決まっているか
        const course = await prisma.thirdRoundCourse.findUnique({ where: { name: courseName } });
        if (!course) {
            return NextResponse.json({ error: `コース「${courseName}」が見つかりません` }, { status: 400 });
        }
        if (course.playOrder === null) {
            return NextResponse.json(
                { error: 'このコースはまだ抽選されていません' },
                { status: 400 }
            );
        }

        const winners = await loadWinners();

        // すでにこのコースの出場者が決まっていないか
        const already = winners.filter(p => p.thirdRoundCourseName === courseName);
        if (already.length > 0) {
            return NextResponse.json(
                { error: 'このコースの出場者はすでに確定しています。やり直す場合は取り消してください。' },
                { status: 409 }
            );
        }

        const unassigned = winners.filter(p => p.thirdRoundCourseName === null);

        if (unassigned.length < PLAYERS_PER_COURSE) {
            return NextResponse.json(
                { error: `未割当の選手が ${unassigned.length} 名しかいません（${PLAYERS_PER_COURSE}名必要）` },
                { status: 400 }
            );
        }

        // 掲げた人として渡されたIDが、すべて未割当の勝ち抜け者か確認する。
        // 他コースの選手や存在しないIDが混ざっていたら、入力ミスとして弾く。
        const unassignedIds = new Set(unassigned.map(p => p.id));
        const invalidIds = raisedIds.filter((id: number) => !unassignedIds.has(id));
        if (invalidIds.length > 0) {
            return NextResponse.json(
                { error: `未割当でない選手が含まれています (id: ${invalidIds.join(', ')})` },
                { status: 400 }
            );
        }

        // 割当を計算する
        const { participants, forcedIds } = selectCourseParticipants(
            unassigned,
            raisedIds,
            PLAYERS_PER_COURSE
        );

        // 5名の所属コースをまとめて保存する。
        // 途中で失敗して「3名だけ割り当てられた」状態になるのを防ぐ。
        await prisma.$transaction(
            participants.map(p =>
                prisma.player.update({
                    where: { id: p.id },
                    data: { thirdRoundCourseName: courseName }
                })
            )
        );

        const allPlayers = await loadAllPlayers();

        return NextResponse.json({
            success: true,
            courseName,
            // 掲げた／強制出場の区別。スタッフが割当を目視で検算するために返す。
            // DB には保存しない（大会結果に影響しない確認用の情報）。
            assigned: participants.map(p => ({
                id: p.id,
                entryNo: p.entryNo,
                name: p.name,
                secondRoundRank: p.secondRoundRank,
                paperRank: p.paperRank,
                forced: forcedIds.includes(p.id)
            })),
            allPlayers
        });
    } catch (error) {
        console.error('Third round assign error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * DELETE: 指定コースの出場者確定を取り消す
 *
 * チェックの付け間違いに備えた復旧手段。
 * 抽選結果（playOrder）には触らず、所属コースだけを解除する。
 */
export async function DELETE(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const courseName = body?.courseName;

        if (!courseName) {
            return NextResponse.json({ error: 'コース名が指定されていません' }, { status: 400 });
        }
        // 画面側の確認ダイアログは API を直接叩かれると素通りするため、ここでも要求する
        if (body?.force !== true) {
            return NextResponse.json(
                { error: '取り消すには force: true を指定してください。' },
                { status: 400 }
            );
        }

        // 2026-10-22: そのコースの所属に加えて、そのコースのスコアと Undo 履歴も戻し、
        // Extra Round 以降を丸ごと初期化する（二つ名と写真も消す）。1つのトランザクションで行う
        const result = await prisma.$transaction(async (tx) => {
            const cleared = await tx.player.updateMany({
                where: { thirdRoundCourseName: courseName },
                data: { thirdRoundCourseName: null, ...THIRD_ROUND_SCORE_DEFAULTS }
            });
            await tx.thirdRoundHistory.deleteMany({ where: { course: courseName } });
            await resetRoundsFrom(tx, 'extraRound', { clearProfiles: true });
            return cleared;
        });

        const allPlayers = await loadAllPlayers();

        return NextResponse.json({
            success: true,
            courseName,
            clearedCount: result.count,
            allPlayers
        });
    } catch (error) {
        console.error('Third round assign reset error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/** GET: 未割当の選手を優先順位順で返す（Admin のチェック欄用） */
export async function GET() {
    try {
        const winners = await loadWinners();
        const unassigned = sortByCoursePriority(
            winners.filter(p => p.thirdRoundCourseName === null)
        );
        return NextResponse.json({ success: true, unassigned });
    } catch (error) {
        console.error('Fetch unassigned players error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
