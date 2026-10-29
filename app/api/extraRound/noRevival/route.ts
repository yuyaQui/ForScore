import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardRound, loadRoundStatuses, isTournamentStateClientReady, TOURNAMENT_STATE_NOT_READY } from '@/lib/roundGuard';
import { isTableMissingError } from '@/lib/questionPoolDb';

/**
 * POST: Extra Round の「敗者復活者なし」を確定する／取り消す（2026-10-22 新設。docs/linear-progress-design.md 6章）
 *
 * First Step で全員が脱落した場合に、敗者復活者なしで Semi-Final（8名）に進めるようにする。
 * body: { value: boolean }
 * - 確定（true）: 3rd Round が完了していて、敗者復活者がまだいないときだけ。
 * - 取り消し（false）: Semi-Final が始まる前だけ（始まった後に戻すときは Extra Round のリセットを使う）。
 */
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        if (typeof body?.value !== 'boolean') {
            return NextResponse.json({ error: 'value（true / false）を指定してください' }, { status: 400 });
        }
        const value: boolean = body.value;
        if (!isTournamentStateClientReady()) {
            return NextResponse.json({ error: TOURNAMENT_STATE_NOT_READY }, { status: 503 });
        }

        const blocked = await guardRound('extraRound');
        if (blocked) return blocked;

        const statuses = await loadRoundStatuses();
        if (value) {
            const revived = await prisma.player.count({ where: { extraRoundRank: 1 } });
            if (revived > 0) {
                return NextResponse.json({ error: '敗者復活者が決まっています' }, { status: 409 });
            }
            // Second Step の出場者がいるなら、敗者復活者は Second Step で決まる
            const entrants = await prisma.player.count({ where: { extraRoundSecondStep: true } });
            if (entrants > 0) {
                return NextResponse.json(
                    { error: 'Second Step の出場者が登録されています。Extra Round をリセットしてから確定してください' },
                    { status: 409 }
                );
            }
        } else if (statuses.semifinal.started) {
            return NextResponse.json(
                { error: 'Semi-Final が始まっているため取り消せません。Extra Round のリセットを使ってください' },
                { status: 409 }
            );
        }

        const state = await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: { extraRoundNoRevival: value },
            create: { id: 1, extraRoundNoRevival: value },
        });

        return NextResponse.json({ success: true, state: { extraRoundNoRevival: state.extraRoundNoRevival } });
    } catch (error) {
        if (isTableMissingError(error)) {
            return NextResponse.json({ error: TOURNAMENT_STATE_NOT_READY }, { status: 503 });
        }
        console.error('Extra Round no-revival error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
