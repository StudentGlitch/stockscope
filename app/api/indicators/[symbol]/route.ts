import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateRSI, calculateMACD, calculateFundamentals } from '@/services/analysis';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol.toUpperCase();
    const session = await getServerSession(authOptions);
    
    // Authorization check for premium metrics
    // Premium metrics include EV/EBITDA. Let's get user plan.
    let isPremium = false;
    if (session?.user?.email) {
       const user = await prisma.user.findUnique({ where: { email: session.user.email } });
       if (user?.plan === 'premium' || user?.plan === 'pro') {
         isPremium = true;
       }
    }

    // Fetch facts up to 1 year back
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    const facts = await prisma.dailyFact.findMany({
      where: {
        ticker: symbol,
        date: { gte: oneYearAgo }
      },
      orderBy: { date: 'asc' }
    });

    if (facts.length === 0) {
      return NextResponse.json({ error: 'No data found' }, { status: 404 });
    }

    const labels = facts.map(f => f.date.toISOString().split('T')[0]);
    const closes = facts.map(f => f.close);

    // Calculate TA-Lib
    const rsi = await calculateRSI(closes, 14);
    const macdData = await calculateMACD(closes);
    
    // Fundamentals for the latest date
    const latestFundamentals = await calculateFundamentals(symbol, facts[facts.length - 1].date);
    
    // Secure premium metrics
    if (!isPremium && latestFundamentals) {
      latestFundamentals.evEbitda = null;
      (latestFundamentals as any).premiumRequired = true;
    }

    const payload = {
      ticker: symbol,
      labels,
      datasets: {
        price: closes,
        rsi,
        macd: macdData
      },
      fundamentals: latestFundamentals,
      isPremium
    };

    return NextResponse.json(payload);

  } catch (error) {
    console.error('Error fetching indicators:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
