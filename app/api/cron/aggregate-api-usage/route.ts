import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// =============================================================================
// CRON: Aggregate API Usage Hourly
// =============================================================================
// Vercel Cron: Schedule daily at top of every hour
// cron: "0 * * * *"
// 
// This job aggregates raw API usage metrics into hourly summaries.
// The actual aggregation happens in real-time via middleware (upsert pattern),
// so this job primarily serves as:
// 1. Verification that aggregations are running
// 2. Cleanup of old raw metrics (if we were storing them separately)
// 3. Health check for metrics pipeline

export async function GET(req: NextRequest) {
  try {
    // Verify cron secret (Vercel Cron authentication)
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startTime = Date.now();

    // Get current hour (rounded down)
    const currentHour = new Date();
    currentHour.setMinutes(0, 0, 0);

    // Get previous hour for aggregation
    const previousHour = new Date(currentHour);
    previousHour.setHours(previousHour.getHours() - 1);

    // Count usage records for previous hour
    const usageCount = await prisma.apiUsageHourly.count({
      where: {
        hour: previousHour,
      },
    });

    // Get top endpoints by request count
    const topEndpoints = await prisma.apiUsageHourly.findMany({
      where: {
        hour: previousHour,
      },
      select: {
        endpoint: true,
        requestCount: true,
        errorCount: true,
        avgResponseTime: true,
      },
      orderBy: {
        requestCount: 'desc',
      },
      take: 10,
    });

    // Calculate total requests for previous hour
    const totalRequests = topEndpoints.reduce(
      (sum, record) => sum + record.requestCount,
      0
    );

    // Calculate total errors
    const totalErrors = topEndpoints.reduce(
      (sum, record) => sum + record.errorCount,
      0
    );

    // Calculate average response time (weighted by request count)
    const totalResponseTime = topEndpoints.reduce(
      (sum, record) => sum + record.avgResponseTime * record.requestCount,
      0
    );
    const avgResponseTime =
      totalRequests > 0 ? totalResponseTime / totalRequests : 0;

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: 'API usage aggregation complete',
      summary: {
        hour: previousHour.toISOString(),
        uniqueEndpoints: usageCount,
        totalRequests,
        totalErrors,
        errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
        avgResponseTime: Math.round(avgResponseTime),
        topEndpoints: topEndpoints.slice(0, 5).map((e) => ({
          endpoint: e.endpoint,
          requests: e.requestCount,
          errors: e.errorCount,
          avgResponseTime: Math.round(e.avgResponseTime),
        })),
      },
      performance: {
        durationMs: duration,
      },
    });
  } catch (error) {
    console.error('Error in API usage aggregation cron:', error);
    return NextResponse.json(
      {
        error: 'Aggregation failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// =============================================================================
// HELPER: Recalculate average response times (if needed)
// =============================================================================

/**
 * Recalculate accurate average response times
 * This is needed because incremental averaging can drift
 *
 * Called periodically (e.g., daily) to fix drift
 */
async function recalculateAverages(_hour: Date): Promise<void> {
  // TODO: Implement drift correction if raw request logs are ever stored.
  // Currently, accurate averaging is handled in real-time via middleware upserts.
}

// =============================================================================
// CLEANUP: Delete old usage data (retention policy)
// =============================================================================

export async function DELETE(req: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Delete usage data older than 90 days
    const retentionDays = 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await prisma.apiUsageHourly.deleteMany({
      where: {
        hour: {
          lt: cutoffDate,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: `Deleted API usage data older than ${retentionDays} days`,
      deletedRecords: result.count,
      cutoffDate: cutoffDate.toISOString(),
    });
  } catch (error) {
    console.error('Error in API usage cleanup:', error);
    return NextResponse.json(
      {
        error: 'Cleanup failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
