import { NextResponse } from 'next/server';
import { loadTournamentState } from '@/lib/roundGuard';

/** GET: 大会の状態（Extra Round の「敗者復活者なし」の確定など。2026-10-22 新設） */
export async function GET() {
    try {
        return NextResponse.json({ success: true, state: await loadTournamentState() });
    } catch (error) {
        console.error('Tournament state error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
