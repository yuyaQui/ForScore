import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isTableMissingError } from '@/lib/questionPoolDb';
import { validateLogoUpload } from '@/lib/tournamentLogo';
import { isTournamentLogoClientReady, loadTournamentLogoInfo, TOURNAMENT_LOGO_NOT_READY } from '@/lib/tournamentLogoDb';

/**
 * 大会ロゴ（2026-11-06 追加）。Admin の「大会準備」で登録し、Main のクイズ画面の見出しに出す。
 *
 *   GET            … 画像そのもの（<img src="/api/tournamentLogo?v=版">）。未登録なら 404
 *   POST {dataUrl} … 登録・差し替え（PNG・WebP・JPEG、長い辺 1600px・2MB まで。中身から幅・高さを読んで確かめる）
 *   DELETE         … 削除
 * 保存・削除のあとは、画面側が tournament_state_changed を送り、Admin と Main が読み直す。
 * 一本道のリセット・選手 CSV の取り込みでは消さない。
 */

export async function GET() {
    try {
        if (!isTournamentLogoClientReady()) return NextResponse.json({ error: TOURNAMENT_LOGO_NOT_READY }, { status: 503 });
        const logo = await prisma.tournamentLogo.findUnique({ where: { id: 1 } });
        if (!logo) return NextResponse.json({ error: '大会ロゴは登録されていません' }, { status: 404 });
        // URL に版（v=最終更新時刻）を付けて呼ぶので、同じ URL の中身は変わらない
        return new Response(new Uint8Array(logo.data), {
            headers: { 'Content-Type': logo.mimeType, 'Cache-Control': 'private, max-age=86400' },
        });
    } catch (error) {
        if (isTableMissingError(error)) return NextResponse.json({ error: TOURNAMENT_LOGO_NOT_READY }, { status: 503 });
        console.error('Tournament logo GET error:', error);
        return NextResponse.json({ error: '大会ロゴを読み込めません' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        const checked = validateLogoUpload(body?.dataUrl);
        if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
        if (!isTournamentLogoClientReady()) return NextResponse.json({ error: TOURNAMENT_LOGO_NOT_READY }, { status: 503 });
        const values = { mimeType: checked.mimeType, data: Buffer.from(checked.data), width: checked.width, height: checked.height };
        await prisma.tournamentLogo.upsert({ where: { id: 1 }, create: { id: 1, ...values }, update: values });
        return NextResponse.json({ success: true, logo: await loadTournamentLogoInfo() });
    } catch (error) {
        if (isTableMissingError(error)) return NextResponse.json({ error: TOURNAMENT_LOGO_NOT_READY }, { status: 503 });
        console.error('Tournament logo POST error:', error);
        return NextResponse.json({ error: '大会ロゴを保存できません' }, { status: 500 });
    }
}

export async function DELETE() {
    try {
        if (!isTournamentLogoClientReady()) return NextResponse.json({ error: TOURNAMENT_LOGO_NOT_READY }, { status: 503 });
        await prisma.tournamentLogo.deleteMany({ where: { id: 1 } });
        return NextResponse.json({ success: true, logo: null });
    } catch (error) {
        if (isTableMissingError(error)) return NextResponse.json({ error: TOURNAMENT_LOGO_NOT_READY }, { status: 503 });
        console.error('Tournament logo DELETE error:', error);
        return NextResponse.json({ error: '大会ロゴを削除できません' }, { status: 500 });
    }
}
