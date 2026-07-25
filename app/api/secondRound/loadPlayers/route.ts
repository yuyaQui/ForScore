import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// DB にいる全員のデータをペーパー順位順に取得する API
export async function GET() {
  try {
    const allPlayers = await prisma.player.findMany({
      orderBy: { paperRank: 'asc' }, // エントリーNo順
    });

    return NextResponse.json({
      success: true,
      allPlayers
    });
  } catch (error) {
    console.error('Fetch players error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
