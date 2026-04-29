// Admin Billing Dashboard API
// Provides transaction, revenue, fraud, and subscription analytics
// SP5-05: Billing Admin Read Endpoints

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/prisma';

// =============================================================================
// ADMIN AUTHORIZATION
// =============================================================================

async function isAdmin(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email } });
  return user?.isAdmin ?? false;
}


async function requireAdmin(req: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.email) {
    return { authorized: false, error: 'Unauthorized', status: 401 };
  }

  const admin = await isAdmin(session.user.email);
  
  if (!admin) {
    return { authorized: false, error: 'Forbidden: Admin access required', status: 403 };
  }

  return { authorized: true, email: session.user.email };
}

// =============================================================================
// GET /api/admin/billing - Dashboard Overview
// =============================================================================

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') || 'overview';

    // Route to specific view
    switch (view) {
      case 'overview':
        return getOverview(searchParams);
      case 'transactions':
        return getTransactions(searchParams);
      case 'revenue':
        return getRevenue(searchParams);
      case 'fraud':
        return getFraud(searchParams);
      case 'subscriptions':
        return getSubscriptions(searchParams);
      default:
        return NextResponse.json({ error: 'Invalid view parameter' }, { status: 400 });
    }

  } catch (error: any) {
    console.error('[ADMIN BILLING ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// =============================================================================
// VIEW: Overview Dashboard
// =============================================================================

async function getOverview(searchParams: URLSearchParams) {
  const days = parseInt(searchParams.get('days') || '30');
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Parallel queries for performance
  const [
    totalRevenue,
    totalTransactions,
    successfulPayments,
    failedPayments,
    pendingPayments,
    activeSubscriptions,
    cancelledSubscriptions,
    fraudAlerts
  ] = await Promise.all([
    // Total revenue (settled payments)
    prisma.paymentTransaction.aggregate({
      where: {
        status: 'success',
        settlementTime: { gte: startDate }
      },
      _sum: { amount: true },
      _count: true
    }),
    
    // Total transactions
    prisma.paymentTransaction.count({
      where: { createdAt: { gte: startDate } }
    }),
    
    // Successful payments
    prisma.paymentTransaction.count({
      where: {
        status: 'success',
        createdAt: { gte: startDate }
      }
    }),
    
    // Failed payments
    prisma.paymentTransaction.count({
      where: {
        status: 'failed',
        createdAt: { gte: startDate }
      }
    }),
    
    // Pending payments
    prisma.paymentTransaction.count({
      where: {
        status: 'pending',
        createdAt: { gte: startDate }
      }
    }),
    
    // Active subscriptions
    prisma.subscription.count({
      where: { status: 'active' }
    }),
    
    // Cancelled subscriptions
    prisma.subscription.count({
      where: {
        status: 'cancelled',
        cancelledAt: { gte: startDate }
      }
    }),
    
    // Fraud alerts
    prisma.paymentTransaction.count({
      where: {
        fraudStatus: { in: ['deny', 'challenge'] },
        createdAt: { gte: startDate }
      }
    })
  ]);

  // Calculate metrics
  const conversionRate = totalTransactions > 0 
    ? (successfulPayments / totalTransactions * 100).toFixed(2)
    : '0.00';
    
  const averageOrderValue = successfulPayments > 0
    ? (totalRevenue._sum.amount || 0) / successfulPayments
    : 0;

  return NextResponse.json({
    period: {
      days,
      startDate,
      endDate: new Date()
    },
    revenue: {
      total: totalRevenue._sum.amount || 0,
      currency: 'IDR',
      transactionCount: totalRevenue._count,
      averageOrderValue: Math.round(averageOrderValue)
    },
    transactions: {
      total: totalTransactions,
      successful: successfulPayments,
      failed: failedPayments,
      pending: pendingPayments,
      conversionRate: parseFloat(conversionRate)
    },
    subscriptions: {
      active: activeSubscriptions,
      cancelled: cancelledSubscriptions,
      churnRate: activeSubscriptions > 0
        ? (cancelledSubscriptions / (activeSubscriptions + cancelledSubscriptions) * 100).toFixed(2)
        : '0.00'
    },
    fraud: {
      alerts: fraudAlerts,
      riskLevel: fraudAlerts > 10 ? 'HIGH' : fraudAlerts > 5 ? 'MEDIUM' : 'LOW'
    }
  });
}

// =============================================================================
// VIEW: Transactions List
// =============================================================================

async function getTransactions(searchParams: URLSearchParams) {
  const status = searchParams.get('status');
  const userId = searchParams.get('userId');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
  const offset = parseInt(searchParams.get('offset') || '0');

  // Build filter
  const where: any = {};
  
  if (status) where.status = status;
  if (userId) where.userId = userId;
  
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  // Query transactions
  const [transactions, totalCount] = await Promise.all([
    prisma.paymentTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    }),
    prisma.paymentTransaction.count({ where })
  ]);

  // Fetch user details for each transaction
  const userIds = [...new Set(transactions.map(tx => tx.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      email: true,
      name: true,
      plan: true
    }
  });

  const userMap = new Map(users.map(u => [u.id, u]));

  // Enrich transactions with user data
  const enrichedTransactions = transactions.map(tx => ({
    ...tx,
    user: userMap.get(tx.userId) || null
  }));

  return NextResponse.json({
    transactions: enrichedTransactions,
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + transactions.length < totalCount
    },
    filters: {
      status,
      userId,
      startDate,
      endDate
    }
  });
}

// =============================================================================
// VIEW: Revenue Analytics
// =============================================================================

async function getRevenue(searchParams: URLSearchParams) {
  const groupBy = searchParams.get('groupBy') || 'day'; // day, week, month
  const days = parseInt(searchParams.get('days') || '30');
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get all successful transactions
  const transactions = await prisma.paymentTransaction.findMany({
    where: {
      status: 'success',
      settlementTime: { gte: startDate }
    },
    select: {
      amount: true,
      settlementTime: true,
      planId: true,
      paymentMethod: true,
      createdAt: true
    },
    orderBy: { settlementTime: 'asc' }
  });

  // Group by time period
  const revenueByPeriod: { [key: string]: number } = {};
  const revenueByPlan: { [key: string]: number } = {};
  const revenueByMethod: { [key: string]: number } = {};

  transactions.forEach(tx => {
    const date = tx.settlementTime || tx.createdAt;
    let key: string;

    if (groupBy === 'day') {
      key = date.toISOString().split('T')[0];
    } else if (groupBy === 'week') {
      const week = Math.floor((date.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
      key = `Week ${week + 1}`;
    } else {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    revenueByPeriod[key] = (revenueByPeriod[key] || 0) + tx.amount;
    revenueByPlan[tx.planId || 'unknown'] = (revenueByPlan[tx.planId || 'unknown'] || 0) + tx.amount;
    revenueByMethod[tx.paymentMethod || 'unknown'] = (revenueByMethod[tx.paymentMethod || 'unknown'] || 0) + tx.amount;
  });

  // Calculate totals
  const totalRevenue = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const avgDailyRevenue = totalRevenue / days;

  return NextResponse.json({
    period: {
      days,
      startDate,
      endDate: new Date(),
      groupBy
    },
    summary: {
      totalRevenue,
      transactionCount: transactions.length,
      averageOrderValue: transactions.length > 0 ? totalRevenue / transactions.length : 0,
      averageDailyRevenue: Math.round(avgDailyRevenue)
    },
    timeSeries: Object.entries(revenueByPeriod).map(([date, amount]) => ({
      date,
      amount,
      formattedAmount: `IDR ${amount.toLocaleString()}`
    })),
    byPlan: Object.entries(revenueByPlan).map(([plan, amount]) => ({
      plan,
      amount,
      percentage: (amount / totalRevenue * 100).toFixed(2)
    })),
    byPaymentMethod: Object.entries(revenueByMethod).map(([method, amount]) => ({
      method,
      amount,
      percentage: (amount / totalRevenue * 100).toFixed(2)
    }))
  });
}

// =============================================================================
// VIEW: Fraud Monitoring
// =============================================================================

async function getFraud(searchParams: URLSearchParams) {
  const days = parseInt(searchParams.get('days') || '30');
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get fraud transactions
  const fraudTransactions = await prisma.paymentTransaction.findMany({
    where: {
      OR: [
        { fraudStatus: 'deny' },
        { fraudStatus: 'challenge' }
      ],
      createdAt: { gte: startDate }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Fetch user details
  const userIds = [...new Set(fraudTransactions.map(tx => tx.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true
    }
  });

  const userMap = new Map(users.map(u => [u.id, u]));

  // Group by fraud status
  const byStatus = {
    deny: fraudTransactions.filter(tx => tx.fraudStatus === 'deny').length,
    challenge: fraudTransactions.filter(tx => tx.fraudStatus === 'challenge').length
  };

  // Calculate potential loss (denied transactions)
  const potentialLoss = fraudTransactions
    .filter(tx => tx.fraudStatus === 'deny')
    .reduce((sum, tx) => sum + tx.amount, 0);

  // Find suspicious users (multiple fraud attempts)
  const userFraudCounts: { [userId: string]: number } = {};
  fraudTransactions.forEach(tx => {
    userFraudCounts[tx.userId] = (userFraudCounts[tx.userId] || 0) + 1;
  });

  const suspiciousUsers = Object.entries(userFraudCounts)
    .filter(([_, count]) => count >= 2)
    .map(([userId, count]) => ({ userId, attemptCount: count }));

  return NextResponse.json({
    period: {
      days,
      startDate,
      endDate: new Date()
    },
    summary: {
      totalAlerts: fraudTransactions.length,
      denied: byStatus.deny,
      underReview: byStatus.challenge,
      potentialLoss,
      suspiciousUserCount: suspiciousUsers.length
    },
    transactions: fraudTransactions.map(tx => {
      const user = userMap.get(tx.userId);
      return {
        id: tx.id,
        orderId: tx.orderId,
        amount: tx.amount,
        fraudStatus: tx.fraudStatus,
        status: tx.status,
        userId: tx.userId,
        userEmail: user?.email || 'unknown',
        ipAddress: tx.ipAddress,
        createdAt: tx.createdAt
      };
    }),
    suspiciousUsers
  });
}

// =============================================================================
// VIEW: Subscription Metrics
// =============================================================================

async function getSubscriptions(searchParams: URLSearchParams) {
  const status = searchParams.get('status');

  // Build filter
  const where: any = {};
  if (status) where.status = status;

  // Get subscriptions
  const subscriptions = await prisma.subscription.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  // Fetch user details
  const userIds = [...new Set(subscriptions.map(s => s.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      email: true,
      name: true
    }
  });

  const userMap = new Map(users.map(u => [u.id, u]));

  // Group by status
  const byStatus = {
    active: subscriptions.filter(s => s.status === 'active').length,
    cancelled: subscriptions.filter(s => s.status === 'cancelled').length,
    expired: subscriptions.filter(s => s.status === 'expired').length,
    past_due: subscriptions.filter(s => s.status === 'past_due').length,
    trialing: subscriptions.filter(s => s.status === 'trialing').length
  };

  // Group by plan
  const byPlan = {
    premium: subscriptions.filter(s => s.planId === 'premium').length,
    pro: subscriptions.filter(s => s.planId === 'pro').length,
    free: subscriptions.filter(s => s.planId === 'free').length
  };

  // Calculate MRR (Monthly Recurring Revenue)
  const activeSubs = subscriptions.filter(s => s.status === 'active');
  const premiumMRR = activeSubs.filter(s => s.planId === 'premium').length * 99000;
  const proMRR = activeSubs.filter(s => s.planId === 'pro').length * 149000;
  const totalMRR = premiumMRR + proMRR;

  // Upcoming renewals (next 7 days)
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  
  const upcomingRenewals = subscriptions.filter(s => 
    s.status === 'active' &&
    s.currentPeriodEnd &&
    s.currentPeriodEnd <= nextWeek &&
    s.currentPeriodEnd >= new Date()
  );

  return NextResponse.json({
    summary: {
      total: subscriptions.length,
      byStatus,
      byPlan,
      mrr: {
        total: totalMRR,
        premium: premiumMRR,
        pro: proMRR,
        currency: 'IDR'
      },
      upcomingRenewalsCount: upcomingRenewals.length
    },
    subscriptions: subscriptions.slice(0, 50).map(s => {
      const user = userMap.get(s.userId);
      return {
        id: s.id,
        userId: s.userId,
        userEmail: user?.email || 'unknown',
        planId: s.planId,
        status: s.status,
        startDate: s.startDate,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelledAt: s.cancelledAt,
        cancelReason: s.cancelReason,
        createdAt: s.createdAt
      };
    }),
    upcomingRenewals: upcomingRenewals.map(s => {
      const user = userMap.get(s.userId);
      return {
        id: s.id,
        userEmail: user?.email || 'unknown',
        planId: s.planId,
        renewalDate: s.currentPeriodEnd
      };
    })
  });
}
