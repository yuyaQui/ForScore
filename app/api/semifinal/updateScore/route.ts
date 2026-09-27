import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    applySemifinalSetPoints,
    finalizeSetAdvance,
    finalizeSetElimination,
    applySemifinalPlayoffScore,
    getAdvanceTieGroup,
    getEliminateTieGroup,
    type SemifinalPointEntry,
    type SemifinalPlayoffPurpose,
    type SemifinalAction
} from '@/lib/semifinalScoring';
import type { Player } from '@/lib/types';

/**
 * このルートが受け付ける操作。
 *
 * 得点入力・勝ち抜け確定・失格確定・プレーオフ正誤は、スナップショット・履歴保存・
 * 変化検出・配信の流れがすべて同じなので、3rd Round の updateScores と同じく
 * 1本のルートにまとめる。分けると「勝ち抜け確定」だけ Undo できなくなる。
 */
type UpdateScoreBody =
    | { action: 'points'; entries: SemifinalPointEntry[] }
    | { action: 'finalizeAdvance'; set: number }
    | { action: 'finalizeEliminate' }
    | { action: 'playoff'; playerId: number; set: number; purpose: SemifinalPlayoffPurpose; playoffAction: SemifinalAction };

const VALID_ACTIONS = ['points', 'finalizeAdvance', 'finalizeEliminate', 'playoff'];

/**
 * 準決勝の対象9名を取得する。
 *
 * 席と同じく、参加者そのものも新しい列を持たない。3rd Round 通過（thirdRoundRank > 0）
 * と Extra Round 敗者復活（extraRoundRank === 1）から都度導出する（設計メモ 3.4）。
 */
async function loadSemifinalPlayers() {
    return prisma.player.findMany({
        where: { OR: [{ thirdRoundRank: { gt: 0 } }, { extraRoundRank: 1 }] },
        orderBy: { paperRank: 'asc' }
    });
}

/** 全選手の最新状態を返す（Socket 配信でそのまま使う） */
async function loadAllPlayers() {
    return prisma.player.findMany({ orderBy: { paperRank: 'asc' } });
}

export async function POST(request: Request) {
    try {
        const body = (await request.json()) as UpdateScoreBody;

        if (!VALID_ACTIONS.includes(body.action)) {
            return NextResponse.json({ error: 'action が不正です' }, { status: 400 });
        }

        const semifinalPlayers = await loadSemifinalPlayers();

        // Undo 用のスナップショット（更新「前」の状態）を、読んだ直後に固める。
        // 3rd Round と同じ規律（2nd Round で踏んだ「取得後に書き換えて履歴がずれる」
        // バグを避けるため、以降の純関数呼び出しより先に固定する）。
        const snapshot = JSON.stringify(semifinalPlayers);

        let updated: Player[];
        // 勝ち抜け・失格の確定操作で、境界が同点のまま決着しなかった場合に
        // Admin へ返す同点者一覧。空ならプレーオフ不要で確定済み。
        let tieGroup: Player[] = [];

        if (body.action === 'points') {
            if (!Array.isArray(body.entries)) {
                return NextResponse.json({ error: 'entries が不正です' }, { status: 400 });
            }
            updated = applySemifinalSetPoints(semifinalPlayers, body.entries);
        } else if (body.action === 'finalizeAdvance') {
            if (typeof body.set !== 'number') {
                return NextResponse.json({ error: 'set が不正です' }, { status: 400 });
            }
            updated = finalizeSetAdvance(semifinalPlayers, body.set);
            tieGroup = getAdvanceTieGroup(updated);
        } else if (body.action === 'finalizeEliminate') {
            updated = finalizeSetElimination(semifinalPlayers);
            tieGroup = getEliminateTieGroup(updated);
        } else {
            // action === 'playoff'
            if (typeof body.playerId !== 'number' || typeof body.set !== 'number') {
                return NextResponse.json({ error: 'playerId または set が不正です' }, { status: 400 });
            }
            updated = applySemifinalPlayoffScore({
                players: semifinalPlayers,
                playerId: body.playerId,
                set: body.set,
                purpose: body.purpose,
                action: body.playoffAction
            });
        }

        // 変化した選手だけを書き戻す。id で突き合わせる（並び順に頼らない）。
        const before = new Map(semifinalPlayers.map(p => [p.id, JSON.stringify(p)]));
        const changed = updated.filter(p => before.get(p.id) !== JSON.stringify(p));

        // 何も変わらなかった操作（同点で確定しなかった finalize など）では
        // 履歴を残さない。残すと Undo を押しても何も起きない空振りの1手ができる。
        if (changed.length > 0) {
            await prisma.$transaction([
                prisma.semifinalHistory.create({ data: { snapshot } }),
                ...changed.map(p =>
                    prisma.player.update({
                        where: { id: p.id },
                        data: {
                            semifinalPoint: p.semifinalPoint,
                            semifinalRank: p.semifinalRank
                        }
                    })
                )
            ]);
        }

        const allPlayers = await loadAllPlayers();

        return NextResponse.json({ success: true, allPlayers, tieGroup });
    } catch (error) {
        console.error('Semifinal score update error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
