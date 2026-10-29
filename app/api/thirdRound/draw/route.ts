import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { THIRD_ROUND_COURSE_NAMES } from '@/lib/thirdRoundCourses';
import { resetRoundsFrom } from '@/lib/roundReset';
import { guardRound } from '@/lib/roundGuard';

const TOTAL_COURSES = THIRD_ROUND_COURSE_NAMES.length; // 4

/** 現在のコース一覧を実施順で取得する */
async function loadCourses() {
    return prisma.thirdRoundCourse.findMany({
        orderBy: [{ playOrder: 'asc' }, { id: 'asc' }]
    });
}

/**
 * POST: コースを1つ抽選する
 *
 * 1回の抽選で1コースだけ決める。
 *   1回目: 未抽選の4コースから1つ → playOrder = 1
 *   2回目: 残り3コースから1つ     → playOrder = 2
 *   3回目: 残り2コースから1つ     → playOrder = 3
 *   4回目: 残り1コース（抽選の余地なし）→ playOrder = 4
 *
 * 乱数はここ（サーバ側）で引く。クライアント側で引くと、
 * Main と Admin で違う結果が表示されてしまう。
 * アニメーションは「確定した結果」を演出するだけで、結果を決めてはいけない。
 */
export async function POST() {
    try {
        // 2nd Round が完了していなければ抽選しない（提案C）
        const blocked = await guardRound('thirdRound');
        if (blocked) return blocked;

        const courses = await loadCourses();

        if (courses.length !== TOTAL_COURSES) {
            return NextResponse.json(
                { error: `コースが ${courses.length} 件しかありません。マイグレーションを確認してください。` },
                { status: 500 }
            );
        }

        // まだ実施順が決まっていないコース
        const remaining = courses.filter(c => c.playOrder === null);

        if (remaining.length === 0) {
            return NextResponse.json(
                { error: '4コースすべて抽選済みです。やり直す場合はリセットしてください。', isDrawn: true },
                { status: 409 }
            );
        }

        // 残りから1つをランダムに選ぶ
        const picked = remaining[Math.floor(Math.random() * remaining.length)];

        // 何番目かは「すでに決まっている数 + 1」で求まる。
        // 抽選の回数を別途保持する必要はない。
        const nextPlayOrder = TOTAL_COURSES - remaining.length + 1;

        await prisma.thirdRoundCourse.update({
            where: { name: picked.name },
            data: { playOrder: nextPlayOrder }
        });

        const updated = await loadCourses();

        return NextResponse.json({
            success: true,
            // 今回引いたコース。Main のルーレット演出はこれを目標に回す
            drawn: { name: picked.name, playOrder: nextPlayOrder },
            courses: updated,
            isDrawn: updated.every(c => c.playOrder !== null)
        });
    } catch (error) {
        console.error('Third round draw error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * DELETE: 抽選をリセットする
 *
 * 全コースの playOrder を null に戻し、最初から引き直せるようにする。
 *
 * 画面側の確認ダイアログは API を直接叩かれると素通りするため、
 * ここでも force: true を要求する。
 */
export async function DELETE(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));

        if (body?.force !== true) {
            return NextResponse.json(
                { error: 'リセットするには force: true を指定してください。' },
                { status: 400 }
            );
        }

        // 2026-10-22: 抽選のリセットは 3rd Round 全体（抽選結果・全員の所属コース・スコア・履歴）と、
        // Extra Round 以降を丸ごと初期化する。Semi-Final 進出者が決まる前なので二つ名と写真も消す。
        // 片方だけ残る矛盾を作らないよう、1つのトランザクションで行う。
        await prisma.$transaction(async (tx) => {
            await resetRoundsFrom(tx, 'thirdRound', { clearProfiles: true });
        });

        const courses = await loadCourses();
        const allPlayers = await prisma.player.findMany({ orderBy: { paperRank: 'asc' } });

        return NextResponse.json({
            success: true,
            courses,
            isDrawn: false,
            // 所属コースもクリアしたので、選手データの配信にも使えるよう返す
            allPlayers
        });
    } catch (error) {
        console.error('Third round draw reset error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
