// Payment Transaction Management API
// Handles transaction creation, queries, and idempotency checks
// SP5-02: Payment Transactions with Idempotency

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/prisma';
import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

type TransactionStatus = 'pending' | 'success' | 'failed' | 'refunded' | 'expired';
type TransactionType = 'subscription' | 'upgrade' | 'renewal' | 'refund';
type PaymentMethod = 'qris' | 'bank_transfer' | 'credit_card' | 'gopay' | 'shopeepay' | 'indomaret' | 'alfamart';

interface CreateTransactionBody {
  amount: number;
  planId: string;
  transactionType: TransactionType;
  paymentMethod?: PaymentMethod;
  subscriptionId?: string;
  idempotencyKey?: string; // Optional: auto-generate if not provided
  metadata?: Record<string, any>;
}

interface QueryTransactionsParams {
  userId?: string;
  status?: TransactionStatus;
  subscriptionId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

// =============================================================================
// POST /api/transactions - Create Transaction with Idempotency
// =============================================================================

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const body: CreateTransactionBody = await req.json();

    // Validate required fields
    if (!body.amount || body.amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount. Must be greater than 0.' },
        { status: 400 }
      );
    }

    if (!body.planId || !['premium', 'pro'].includes(body.planId)) {
      return NextResponse.json(
        { error: 'Invalid planId. Must be "premium" or "pro".' },
        { status: 400 }
      );
    }

    if (!body.transactionType || !['subscription', 'upgrade', 'renewal', 'refund'].includes(body.transactionType)) {
      return NextResponse.json(
        { error: 'Invalid transactionType.' },
        { status: 400 }
      );
    }

    // Generate or use provided idempotency key
    const idempotencyKey = body.idempotencyKey || `${user.id}-${Date.now()}-${uuidv4()}`;

    // Check for existing transaction with this idempotency key
    const existingTransaction = await prisma.paymentTransaction.findUnique({
      where: { idempotencyKey }
    });

    if (existingTransaction) {
      // Idempotent response: return existing transaction
      console.log(`[IDEMPOTENCY] Returning existing transaction: ${existingTransaction.id}`);
      return NextResponse.json({
        transaction: existingTransaction,
        idempotent: true,
        message: 'Transaction already exists'
      }, { status: 200 });
    }

    // Generate unique order ID for Midtrans
    const orderId = `ORDER-${user.id.slice(-8)}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Capture request context for audit trail
    const ipAddress = req.headers.get('x-forwarded-for') || 
                     req.headers.get('x-real-ip') || 
                     'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // Create new transaction
    const transaction = await prisma.paymentTransaction.create({
      data: {
        userId: user.id,
        idempotencyKey,
        orderId,
        amount: body.amount,
        currency: 'IDR',
        status: 'pending',
        transactionType: body.transactionType,
        paymentMethod: body.paymentMethod || null,
        planId: body.planId,
        subscriptionId: body.subscriptionId || null,
        ipAddress,
        userAgent,
        metadata: body.metadata || null,
      }
    });

    console.log(`[TRANSACTION] Created: ${transaction.id} | Order: ${orderId} | User: ${user.email}`);

    return NextResponse.json({
      transaction,
      idempotent: false,
      message: 'Transaction created successfully'
    }, { status: 201 });

  } catch (error: any) {
    console.error('[TRANSACTION ERROR]', error);
    
    // Handle Prisma unique constraint violation
    if (error.code === 'P2002') {
      // This should not happen due to findUnique check, but handle it anyway
      return NextResponse.json(
        { error: 'Transaction with this idempotency key already exists.' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// =============================================================================
// GET /api/transactions - Query Transactions (Admin + User)
// =============================================================================

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const queryUserId = searchParams.get('userId');
    const status = searchParams.get('status') as TransactionStatus | null;
    const subscriptionId = searchParams.get('subscriptionId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Authorization check
    // Regular users can only see their own transactions
    // Admin users (TODO: add isAdmin field) can see all transactions
    const isAdmin = user.email.endsWith('@stockscope.com'); // Temporary admin check
    const targetUserId = isAdmin && queryUserId ? queryUserId : user.id;

    // Build query filter
    const where: any = {
      userId: targetUserId
    };

    if (status) {
      where.status = status;
    }

    if (subscriptionId) {
      where.subscriptionId = subscriptionId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    // Execute query
    const [transactions, totalCount] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100), // Max 100 per page
        skip: offset,
        select: {
          id: true,
          orderId: true,
          amount: true,
          currency: true,
          status: true,
          transactionType: true,
          paymentMethod: true,
          paymentChannel: true,
          planId: true,
          fraudStatus: true,
          settlementTime: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          // Exclude sensitive fields
          // metadata: false (contains full Midtrans payload)
          // ipAddress: false
          // userAgent: false
        }
      }),
      prisma.paymentTransaction.count({ where })
    ]);

    return NextResponse.json({
      transactions,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + transactions.length < totalCount
      },
      filters: {
        userId: targetUserId,
        status,
        subscriptionId,
        startDate,
        endDate
      }
    }, { status: 200 });

  } catch (error: any) {
    console.error('[TRANSACTION QUERY ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// =============================================================================
// PUT /api/transactions - Update Transaction Status (Webhook only)
// =============================================================================
// NOTE: This should only be called by webhook handler (SP5-04)
// Regular users cannot update transactions

export async function PUT(req: NextRequest) {
  try {
    // Webhook-only endpoint
    // Verify webhook signature (TODO: SP5-04)
    
    return NextResponse.json(
      { error: 'Not implemented. Use webhook handler.' },
      { status: 501 }
    );
  } catch (error: any) {
    console.error('[TRANSACTION UPDATE ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
