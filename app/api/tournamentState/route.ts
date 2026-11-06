import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loadTournamentState, isTournamentStateClientReady, isColumnMissingError, TOURNAMENT_STATE_NOT_READY } from '@/lib/roundGuard';
import { isTableMissingError } from '@/lib/questionPoolDb';
import { validateTournamentName } from '@/lib/tournamentName';
import { loadTournamentLogoInfo } from '@/lib/tournamentLogoDb';

/**
 * 大会の状態と大会ロゴの情報（画像は含めない。2026-11-06）。
 * ロゴの表がまだ無い（migrate dev 前）・読めないときは logo: null として、大会名などは返す
 */
async function loadStateWithLogo() {
    const [state, logo] = await Promise.all([
        loadTournamentState(),
        loadTournamentLogoInfo().catch((error) => { console.error('Tournament logo info error:', error); return null; }),
    ]);
    return { ...state, logo };
}

/** GET: 大会の状態（Extra Round の「敗者復活者なし」の確定、大会名、大会ロゴの情報。2026-10-22 新設、11-02 大会名、11-06 ロゴを追加） */
export async function GET() {
    try {
        return NextResponse.json({ success: true, state: await loadStateWithLogo() });
    } catch (error) {
        console.error('Tournament state error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * POST: 大会名を保存する { tournamentName }（2026-11-02 追加。Admin の「大会準備」から）。
 * 前後の空白を除き、全角12文字（半角24文字）まで・改行不可（2026-11-06 に 40文字から変更）。空文字は「未設定に戻す」。
 * 大会名は一本道のリセット・選手 CSV の取り込みでは消さない（lib/roundReset.ts はこの列に触れない）
 */
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const name = validateTournamentName(body?.tournamentName);
        if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });

        if (!isTournamentStateClientReady()) return NextResponse.json({ error: TOURNAMENT_STATE_NOT_READY }, { status: 503 });
        await prisma.tournamentState.upsert({
            where: { id: 1 },
            update: { tournamentName: name.value },
            create: { id: 1, tournamentName: name.value },
        });
        return NextResponse.json({ success: true, state: await loadStateWithLogo() });
    } catch (error) {
        // migrate dev 前（表・列が無い、またはクライアントが古い）
        if (isTableMissingError(error) || isColumnMissingError(error)) {
            return NextResponse.json({ error: TOURNAMENT_STATE_NOT_READY }, { status: 503 });
        }
        console.error('Tournament name save error:', error);
        return NextResponse.json({ error: '大会名を保存できません' }, { status: 500 });
    }
}
