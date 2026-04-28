/**
 * Event Ingestion API
 * 
 * Collects product analytics events from web and mobile clients
 * Validates against Event Taxonomy V1
 * 
 * Sprint 4, Task SP4-01: Event Ingestion API
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { prisma } from '@/lib/prisma'

// =============================================================================
// ADMIN AUTHORIZATION
// =============================================================================

async function isAdmin(email: string): Promise<boolean> {
  // TODO: Add isAdmin field to User model
  // For now, check email domain
  return email.endsWith('@stockscope.com')
}

async function requireAdmin(req: NextRequest) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.email) {
    return { authorized: false, error: 'Unauthorized', status: 401 }
  }

  const admin = await isAdmin(session.user.email)

  if (!admin) {
    return { authorized: false, error: 'Forbidden: Admin access required', status: 403 }
  }

  return { authorized: true, email: session.user.email }
}

// Event Taxonomy V1 - Allowed event names
const VALID_EVENT_NAMES = [
  // Session events
  'session_start',
  'session_end',
  
  // Page view
  'page_view',
  
  // Auth events
  'auth_signin_clicked',
  'auth_signin_completed',
  'auth_signup_completed',
  'auth_signout_clicked',
  
  // Screener events
  'screener_viewed',
  'screener_filter_applied',
  'screener_filter_cleared',
  'screener_sort_changed',
  'screener_view_toggled',
  'screener_stock_clicked',
  'screener_export_clicked',
  
  // Stock detail events
  'stock_detail_viewed',
  'stock_chart_timeframe_changed',
  'stock_ownership_viewed',
  
  // Watchlist events
  'watchlist_viewed',
  'watchlist_created',
  'watchlist_stock_added',
  'watchlist_stock_removed',
  'watchlist_reordered',
  'watchlist_deleted',
  
  // Saved screener events
  'saved_screener_created',
  'saved_screener_loaded',
  'saved_screener_deleted',
  
  // Alert events
  'alert_created',
  'alert_deleted',
  'alert_triggered',
  
  // Payment events
  'payment_checkout_initiated',
  'payment_method_selected',
  'payment_completed',
  'payment_failed',
  'subscription_cancelled',
  
  // Upgrade/paywall events
  'upgrade_modal_viewed',
  'upgrade_button_clicked',
  'feature_locked_viewed',
  
  // Experiment events (A/B testing)
  'experiment_interaction',
  
  // Search events
  'search_query_entered',
  'search_result_clicked',
  
  // Error events
  'error_occurred',
  'api_error'
]

interface EventPayload {
  eventName: string
  timestamp?: string
  sessionId: string
  userId?: string
  anonymousId?: string
  
  // Context
  platform?: string
  deviceType?: string
  locale?: string
  viewportWidth?: number
  viewportHeight?: number
  
  // Page context
  pageUrl?: string
  pageTitle?: string
  referrer?: string
  
  // UTM parameters
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  
  // Event properties
  properties?: Record<string, any>
}

/**
 * POST /api/events/track
 * Track a single analytics event
 * 
 * Body: EventPayload (see interface above)
 */
export async function POST(request: NextRequest) {
  try {
    const body: EventPayload = await request.json()
    const {
      eventName,
      timestamp,
      sessionId,
      userId,
      anonymousId,
      platform,
      deviceType,
      locale,
      viewportWidth,
      viewportHeight,
      pageUrl,
      pageTitle,
      referrer,
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      utmTerm,
      properties
    } = body

    // Validation: Required fields
    if (!eventName || !sessionId) {
      return NextResponse.json(
        { error: 'Missing required fields: eventName, sessionId' },
        { status: 400 }
      )
    }

    // Validation: Event name must be in taxonomy
    if (!VALID_EVENT_NAMES.includes(eventName)) {
      return NextResponse.json(
        { 
          error: 'Invalid event name. Must match Event Taxonomy V1',
          validEvents: VALID_EVENT_NAMES
        },
        { status: 400 }
      )
    }

    // Extract user-agent and IP for context
    const userAgent = request.headers.get('user-agent') || undefined
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     request.headers.get('x-real-ip') ||
                     undefined

    // Store event in database
    const event = await prisma.analyticsEvent.create({
      data: {
        eventName,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        sessionId,
        userId: userId || null,
        anonymousId: anonymousId || null,
        platform: platform || 'web',
        deviceType: deviceType || 'desktop',
        locale: locale || 'en',
        viewportWidth: viewportWidth || null,
        viewportHeight: viewportHeight || null,
        userAgent,
        ipAddress,
        pageUrl: pageUrl || null,
        pageTitle: pageTitle || null,
        referrer: referrer || null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        utmContent: utmContent || null,
        utmTerm: utmTerm || null,
        properties: properties || null,
        processedAt: new Date()
      }
    })

    return NextResponse.json({
      success: true,
      eventId: event.id
    }, { status: 201 })

  } catch (error) {
    console.error('POST /api/events/track error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/events/batch
 * Track multiple events at once (batch upload)
 * 
 * Body: { events: EventPayload[] }
 */
export async function PUT(request: NextRequest) {
  try {
    const { events } = await request.json()

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid events array' },
        { status: 400 }
      )
    }

    // Validate all events first
    for (const event of events) {
      if (!event.eventName || !event.sessionId) {
        return NextResponse.json(
          { error: 'Each event must have eventName and sessionId' },
          { status: 400 }
        )
      }

      if (!VALID_EVENT_NAMES.includes(event.eventName)) {
        return NextResponse.json(
          { 
            error: `Invalid event name: ${event.eventName}`,
            validEvents: VALID_EVENT_NAMES
          },
          { status: 400 }
        )
      }
    }

    // Extract context once (same for all events in batch)
    const userAgent = request.headers.get('user-agent') || undefined
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     request.headers.get('x-real-ip') ||
                     undefined

    // Batch insert (use createMany for performance)
    const result = await prisma.analyticsEvent.createMany({
      data: events.map(event => ({
        eventName: event.eventName,
        timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
        sessionId: event.sessionId,
        userId: event.userId || null,
        anonymousId: event.anonymousId || null,
        platform: event.platform || 'web',
        deviceType: event.deviceType || 'desktop',
        locale: event.locale || 'en',
        viewportWidth: event.viewportWidth || null,
        viewportHeight: event.viewportHeight || null,
        userAgent,
        ipAddress,
        pageUrl: event.pageUrl || null,
        pageTitle: event.pageTitle || null,
        referrer: event.referrer || null,
        utmSource: event.utmSource || null,
        utmMedium: event.utmMedium || null,
        utmCampaign: event.utmCampaign || null,
        utmContent: event.utmContent || null,
        utmTerm: event.utmTerm || null,
        properties: event.properties || null,
        processedAt: new Date()
      }))
    })

    return NextResponse.json({
      success: true,
      eventsCreated: result.count
    }, { status: 201 })

  } catch (error) {
    console.error('POST /api/events/batch error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/events/track
 * Query analytics events (for admin/debugging)
 * 
 * Query params:
 *   - eventName: Filter by event name
 *   - sessionId: Filter by session
 *   - userId: Filter by user
 *   - startDate: Date range start
 *   - endDate: Date range end
 *   - limit: Max records (default: 100, max: 1000)
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const { searchParams } = new URL(request.url)
    
    const eventName = searchParams.get('eventName')
    const sessionId = searchParams.get('sessionId')
    const userId = searchParams.get('userId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limitParam = searchParams.get('limit')

    // Build filter
    const where: any = {}

    if (eventName) where.eventName = eventName
    if (sessionId) where.sessionId = sessionId
    if (userId) where.userId = userId

    if (startDate || endDate) {
      where.timestamp = {}
      if (startDate) where.timestamp.gte = new Date(startDate)
      if (endDate) where.timestamp.lte = new Date(endDate)
    }

    const limit = Math.min(
      parseInt(limitParam || '100', 10),
      1000
    )

    const events = await prisma.analyticsEvent.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: {
        id: true,
        eventName: true,
        timestamp: true,
        sessionId: true,
        userId: true,
        platform: true,
        deviceType: true,
        locale: true,
        pageUrl: true,
        properties: true,
        receivedAt: true
      }
    })

    return NextResponse.json({
      success: true,
      count: events.length,
      events
    })

  } catch (error) {
    console.error('GET /api/events/track error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
