// Rate Limiting Utilities
// Sliding window rate limiting with Redis

import { redisClient } from './redis';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp (seconds)
  retryAfter?: number; // Seconds until reset
}

/**
 * Check rate limit using sliding window algorithm
 * 
 * @param key - Unique identifier (e.g., apiKeyId)
 * @param limit - Maximum requests allowed in window
 * @param windowSeconds - Time window in seconds (default: 3600 = 1 hour)
 * @returns Rate limit result
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number = 3600
): Promise<RateLimitResult> {
  if (!redisClient) {
    // Fallback: Allow all requests if Redis unavailable
    console.warn('Redis unavailable, rate limiting disabled');
    return {
      allowed: true,
      limit,
      remaining: limit,
      reset: Math.floor(Date.now() / 1000) + windowSeconds,
    };
  }

  try {
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    const rateLimitKey = `ratelimit:${key}`;

    // Use Redis sorted set for sliding window
    // Score = timestamp, Member = unique request ID
    
    // Remove old entries outside the window
    await redisClient.zremrangebyscore(rateLimitKey, 0, windowStart);

    // Count requests in current window
    const requestCount = await redisClient.zcard(rateLimitKey);

    // Calculate reset time (end of current window)
    const oldestRequest = await redisClient.zrange(rateLimitKey, 0, 0, 'WITHSCORES');
    const oldestTimestamp = oldestRequest.length > 0 ? parseInt(oldestRequest[1]) : now;
    const reset = Math.floor((oldestTimestamp + (windowSeconds * 1000)) / 1000);

    if (requestCount >= limit) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((oldestTimestamp + (windowSeconds * 1000) - now) / 1000);
      
      return {
        allowed: false,
        limit,
        remaining: 0,
        reset,
        retryAfter: Math.max(retryAfter, 1), // At least 1 second
      };
    }

    // Allow request and add to window
    const requestId = `${now}-${Math.random().toString(36).substr(2, 9)}`;
    await redisClient.zadd(rateLimitKey, now, requestId);

    // Set expiration on the key (cleanup)
    await redisClient.expire(rateLimitKey, windowSeconds + 60);

    return {
      allowed: true,
      limit,
      remaining: limit - requestCount - 1,
      reset,
    };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // On error, allow request (fail open)
    return {
      allowed: true,
      limit,
      remaining: limit,
      reset: Math.floor(Date.now() / 1000) + windowSeconds,
    };
  }
}

/**
 * Get current rate limit status without incrementing counter
 * Useful for status checks
 */
export async function getRateLimitStatus(
  key: string,
  limit: number,
  windowSeconds: number = 3600
): Promise<RateLimitResult> {
  if (!redisClient) {
    return {
      allowed: true,
      limit,
      remaining: limit,
      reset: Math.floor(Date.now() / 1000) + windowSeconds,
    };
  }

  try {
    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);
    const rateLimitKey = `ratelimit:${key}`;

    // Remove old entries
    await redisClient.zremrangebyscore(rateLimitKey, 0, windowStart);

    // Count requests in window
    const requestCount = await redisClient.zcard(rateLimitKey);

    // Calculate reset
    const oldestRequest = await redisClient.zrange(rateLimitKey, 0, 0, 'WITHSCORES');
    const oldestTimestamp = oldestRequest.length > 0 ? parseInt(oldestRequest[1]) : now;
    const reset = Math.floor((oldestTimestamp + (windowSeconds * 1000)) / 1000);

    return {
      allowed: requestCount < limit,
      limit,
      remaining: Math.max(0, limit - requestCount),
      reset,
      retryAfter: requestCount >= limit 
        ? Math.ceil((oldestTimestamp + (windowSeconds * 1000) - now) / 1000)
        : undefined,
    };
  } catch (error) {
    console.error('Rate limit status check failed:', error);
    return {
      allowed: true,
      limit,
      remaining: limit,
      reset: Math.floor(Date.now() / 1000) + windowSeconds,
    };
  }
}

/**
 * Reset rate limit for a key (admin function)
 */
export async function resetRateLimit(key: string): Promise<void> {
  if (!redisClient) return;

  try {
    const rateLimitKey = `ratelimit:${key}`;
    await redisClient.del(rateLimitKey);
  } catch (error) {
    console.error('Rate limit reset failed:', error);
  }
}

/**
 * Cache validated API key (1-hour TTL)
 * Solves bcrypt O(n) bottleneck
 */
export async function cacheValidatedApiKey(
  apiKey: string,
  keyData: any,
  ttlSeconds: number = 3600
): Promise<void> {
  if (!redisClient) return;

  try {
    const cacheKey = `apikey:validated:${apiKey}`;
    await redisClient.setex(cacheKey, ttlSeconds, JSON.stringify(keyData));
  } catch (error) {
    console.error('Failed to cache validated API key:', error);
  }
}

/**
 * Get cached validated API key
 * Returns null if not found or expired
 */
export async function getCachedApiKey(apiKey: string): Promise<any | null> {
  if (!redisClient) return null;

  try {
    const cacheKey = `apikey:validated:${apiKey}`;
    const cached = await redisClient.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    return null;
  } catch (error) {
    console.error('Failed to get cached API key:', error);
    return null;
  }
}

/**
 * Invalidate cached API key (on revoke/delete)
 */
export async function invalidateCachedApiKey(apiKey: string): Promise<void> {
  if (!redisClient) return;

  try {
    const cacheKey = `apikey:validated:${apiKey}`;
    await redisClient.del(cacheKey);
  } catch (error) {
    console.error('Failed to invalidate cached API key:', error);
  }
}
