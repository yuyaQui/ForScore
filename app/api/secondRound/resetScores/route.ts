import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ADVANTAGE_RANGES } from '@/lib/advantage';

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

            // 残り（アドバンテージなしの下位陣）は 0 ポイントスタート
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
        });

        // 最新のプレイヤー一覧を取得
        const allPlayers = await prisma.player.findMany({
            orderBy: { paperRank: 'asc' },
        });

        return NextResponse.json({
            success: true,
            allPlayers
        });
    } catch (error) {
        console.error('Reset scores API error:', error);
        return NextResponse.json({ error: 'Failed to reset scores' }, { status: 500 });
    }
}
