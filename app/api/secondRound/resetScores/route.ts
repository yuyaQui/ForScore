import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ADVANTAGE_RANGES } from '@/lib/advantage';
import { resetRoundsFrom } from '@/lib/roundReset';

export async function POST(request: Request) {
    try {
        // リクエストボディからグループ番号を取得
        const { secondRoundState } = await request.json();
        const group = secondRoundState?.group;

        if (!group) {
            return NextResponse.json({ error: 'Missing group number' }, { status: 400 });
        }

        // 指定された組（グループ）のプレイヤーだけを初期化する。
        //
        // ポイントは 0 ではなく「アドバンテージ点」に戻す必要がある。
        // 0 埋めしてしまうと、リセットのたびに上位6名のアドバンテージが消える。
        //
        // updateMany は行ごとに異なる値を書けないため、
        // アドバンテージ点ごと（3pt / 2pt / 1pt / 0pt）に分けて実行する。
        // paperRank の範囲がそのまま配点の境界になっている。
        await prisma.$transaction(async (tx) => {
            let lowerBound = 0; // 直前の範囲の上限（この値より大きい順位が対象）

            for (const range of ADVANTAGE_RANGES) {
                await tx.player.updateMany({
                    where: {
                        secondRoundGroupNumber: group,
                        paperRank: { gt: lowerBound, lte: range.maxPaperRank }
                    },
                    data: {
                        secondRoundPoint: range.point,
                        secondRoundWrongCount: 0,
                        secondRoundDoubleChance: false,
                        secondRoundRank: 0,
                    }
                });
                lowerBound = range.maxPaperRank;
            }

            // 残り（アドバンテージなしの下位陣）は 0 ポイントスタート（このあと続く）
            await tx.player.updateMany({
                where: {
                    secondRoundGroupNumber: group,
                    paperRank: { gt: lowerBound }
                },
                data: {
                    secondRoundPoint: 0,
                    secondRoundWrongCount: 0,
                    secondRoundDoubleChance: false,
                    secondRoundRank: 0,
                }
            });

            // 2026-10-22: その組の Undo 履歴も消す（リセット後の Undo で古い途中経過が戻らないように）
            await tx.secondRoundHistory.deleteMany({ where: { secondRoundGroupNumber: group } });

            // 2026-10-22: 勝ち抜け者が変わり得るので、3rd Round 以降を丸ごと初期化する。
            // Semi-Final 進出者が決まる前のフェーズなので、二つ名と写真も消す（docs/linear-progress-design.md 6章）
            await resetRoundsFrom(tx, 'thirdRound', { clearProfiles: true });
        });

        // 最新のプレイヤー一覧を取得
        const allPlayers = await prisma.player.findMany({
            orderBy: { paperRank: 'asc' },
        });

        // 3rd Round の抽選結果も戻したので、コースも返す（Admin が配信する）
        const courses = await prisma.thirdRoundCourse.findMany({ orderBy: [{ playOrder: 'asc' }, { id: 'asc' }] });

        return NextResponse.json({
            success: true,
            allPlayers,
            courses
        });
    } catch (error) {
        console.error('Reset scores API error:', error);
        return NextResponse.json({ error: 'Failed to reset scores' }, { status: 500 });
    }
}
