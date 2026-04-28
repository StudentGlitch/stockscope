import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateRSI } from '@/services/analysis';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { redisClient } from '@/lib/redis';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { ticker, indicator, operator, threshold, initialCapital = 10000000 } = await request.json();

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) {
       return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const isPremium = user.plan === 'premium' || user.plan === 'pro';

    // Rate Limiting (5 per month for free tier)
    if (!isPremium && redisClient) {
      const month = new Date().toISOString().slice(0, 7); // YYYY-MM
      const rateLimitKey = `backtest:count:${user.id}:${month}`;

      const count = await redisClient.get(rateLimitKey);
      if (count && parseInt(count, 10) >= 5) {
        return NextResponse.json({
          error: 'Rate limit exceeded. Free tier allows 5 simulations per month.',
          premiumRequired: true
        }, { status: 429 });
      }

      // Increment and set expiry to ~31 days if it's new
      const multi = redisClient.multi();
      multi.incr(rateLimitKey);
      multi.expire(rateLimitKey, 60 * 60 * 24 * 31);
      await multi.exec();
    }

    // Backtest Logic
    const facts = await prisma.dailyFact.findMany({
      where: { ticker },
      orderBy: { date: 'asc' }
    });

    if (facts.length < 50) {
      return NextResponse.json({ error: 'Insufficient data for backtesting' }, { status: 400 });
    }

    const closes = facts.map(f => f.close);
    let signalData: (number | null)[] = [];

    if (indicator === 'RSI') {
      signalData = await calculateRSI(closes, 14);
    } else {
      return NextResponse.json({ error: 'Indicator not supported yet' }, { status: 400 });
    }

    // Engine Simulation
    let state: 'CASH' | 'STOCK' = 'CASH';
    let capital = initialCapital;
    let shares = 0;
    const trades: any[] = [];

    for (let i = 0; i < facts.length; i++) {
      const sigValue = signalData[i];
      if (sigValue === null) continue; // Skip padding

      const price = closes[i];
      const dateStr = facts[i].date.toISOString().split('T')[0];

      if (state === 'CASH') {
        const entryCondition = operator === '<' ? sigValue < threshold : sigValue > threshold;
        if (entryCondition) {
          // BUY
          shares = capital / price;
          capital = 0;
          state = 'STOCK';
          trades.push({ type: 'BUY', date: dateStr, price, value: signalData[i], reason: `Signal ${sigValue.toFixed(2)} ${operator} ${threshold}` });
        }
      } else if (state === 'STOCK') {
        // Simple Default Exit Condition: Reverse threshold logic
        // E.g. if we buy when RSI < 30, we sell when RSI > 70
        const defaultExitThreshold = operator === '<' ? (100 - threshold) : (100 - threshold); // naive assumption for typical RSI
        const exitCondition = operator === '<' ? sigValue > defaultExitThreshold : sigValue < defaultExitThreshold;

        if (exitCondition || i === facts.length - 1) { // Sell on last day to realize P&L
          // SELL
          capital = shares * price;
          shares = 0;
          state = 'CASH';
          trades.push({ type: 'SELL', date: dateStr, price, value: signalData[i], reason: `Signal ${sigValue.toFixed(2)} trigger` });
        }
      }
    }

    const finalValue = state === 'STOCK' ? shares * closes[closes.length - 1] : capital;
    const roi = ((finalValue - initialCapital) / initialCapital) * 100;

    return NextResponse.json({
      initialCapital,
      finalCapital: finalValue,
      roi,
      totalTrades: Math.floor(trades.length / 2),
      trades
    });

  } catch (error: any) {
    console.error('Backtest error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
