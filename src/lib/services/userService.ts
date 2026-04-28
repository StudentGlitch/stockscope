/**
 * User service layer
 * Separation of Concerns: User/plan data and persistence
 */
import type { Plan } from "@/lib/auth/types";
import { userQueries } from "@/lib/mongodb";

/**
 * Get user plan from database. Returns 'free' if user not found.
 */
export async function getUserPlan(userId: string): Promise<Plan> {
  const user = await userQueries.findById(userId);
  return user?.plan ?? "free";
}

/**
 * Check if user is an admin
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const user = await userQueries.findById(userId);
  return !!user?.isAdmin;
}

/**
 * Upgrade user's plan to premium after successful payment.
 */
export async function upgradePlan(userId: string): Promise<void> {
  await userQueries.updatePlan(userId, "premium");
}

/**
 * Ensure user exists in database. Creates with plan 'free' if new.
 */
export async function ensureUser(
  id: string,
  email: string | null,
  name: string | null,
  image: string | null,
): Promise<void> {
  await userQueries.upsertUser(id, email, name, image);
}
