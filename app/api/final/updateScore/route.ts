import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    applyFinalScore,
    resetForNextSet,
    type FinalAction
} from '@/lib/finalScoring';
import type { Player } from '@/lib/types';
import { guardRound } from '@/lib/roundGuard';

/**
 * このルートが受け付ける操作。
 *
 * 正解/誤答・次のセットへは、スナップショット・履歴保存・
 * 変化検出・配信の流れがすべて同じなので、準決勝の updateScore と同じく
 * 1本のルートにまとめる。
 */
type UpdateScoreBody =
    | { action: 'correct' | 'wrong'; playerId: number }
    | { action: 'nextSet' };

const VALID_ACTIONS = ['correct', 'wrong', 'nextSet'];

/**
 * 決勝の対象3名を取得する。
 *
 * 新しい列は持たない。準決勝の勝ち抜け（semifinalRank > 0）から都度導出する
 * （設計メモ 4「参加者の表示順」）。表示順もこの並びをそのまま使う。
 */
async function loadFinalPlayers() {
    return prisma.player.findMany({
        where: { semifinalRank: { gt: 0 } },
        orderBy: { semifinalRank: 'asc' }
    });
}

/** 全選手の最新状態を返す（Socket 配信でそのまま使う） */
async function loadAllPlayers() {
    return prisma.player.findMany({ orderBy: { paperRank: 'asc' } });
}

export async function POST(request: Request) {
    try {
        const body = (await request.json()) as UpdateScoreBody;

        // 前のラウンドが完了していなければ採点しない（2026-10-22 提案C。docs/linear-progress-design.md）
        const blocked = await guardRound('final');
        if (blocked) return blocked;

        if (!VALID_ACTIONS.includes(body.action)) {
            return NextResponse.json({ error: 'action が不正です' }, { status: 400 });
        }

        const finalPlayers = await loadFinalPlayers();

        // Undo 用のスナップショット（更新「前」の状態）を、読んだ直後に固める。
        const snapshot = JSON.stringify(finalPlayers);

        let updated: Player[];

        switch (body.action) {
            case 'correct':
            case 'wrong': {
                if (typeof body.playerId !== 'number') {
                    return NextResponse.json({ error: 'playerId が不正です' }, { status: 400 });
                }
                const action: FinalAction = body.action;
                updated = applyFinalScore({ players: finalPlayers, playerId: body.playerId, action });
                break;
            }
            case 'nextSet': {
                updated = resetForNextSet(finalPlayers);
                break;
            }
        }

        // 変化した選手だけを書き戻す。id で突き合わせる（並び順に頼らない）。
        const before = new Map(finalPlayers.map(p => [p.id, JSON.stringify(p)]));
        const changed = updated.filter(p => before.get(p.id) !== JSON.stringify(p));

        // 何も変わらなかった操作（決着前のnextSetなど）では履歴を残さない。
        // 残すと Undo を押しても何も起きない空振りの1手ができる。
        if (changed.length > 0) {
            await prisma.$transaction([
                prisma.finalHistory.create({ data: { snapshot } }),
                ...changed.map(p =>
                    prisma.player.update({
                        where: { id: p.id },
                        data: {
                            finalCorrectCount: p.finalCorrectCount,
                            finalWrongCount: p.finalWrongCount,
                            finalSetsWon: p.finalSetsWon,
                            finalRank: p.finalRank
                        }
                    })
                )
            ]);
        }

        const allPlayers = await loadAllPlayers();

        return NextResponse.json({ success: true, allPlayers });
    } catch (error) {
        console.error('Final score update error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
