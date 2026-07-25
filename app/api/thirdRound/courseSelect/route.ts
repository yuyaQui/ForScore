import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const winners = await prisma.player.findMany({
      where: {
        secondRoundRank: {
          gte: 1
        }
      },
      orderBy: [
        { secondRoundRank: 'asc' },
        { paperRank: 'asc' }
      ]
    });

    return NextResponse.json({
      success: true,
      winners
    });
  } catch (error) {
    console.error('Fetch 3rd round winners error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
