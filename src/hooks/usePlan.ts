"use client";

import { useCallback, useMemo } from "react";

import type { Plan } from "@/lib/auth/types";

import { useAuth } from "./useAuth";

export interface UsePlanReturn {
  plan: Plan;
  isPremium: boolean;
  canAccessTab: (tabId: string) => boolean;
  dataLimit: number;
  isLoading: boolean;
}

/**
 * Derives plan and access control from auth session.
 */
export function usePlan(): UsePlanReturn {
  const { user, status } = useAuth();

  const plan: Plan = useMemo(() => user?.plan ?? "free", [user?.plan]);

  const isPremium = true;
  const dataLimit = Number.POSITIVE_INFINITY;
  const canAccessTab = useCallback((tabId: string): boolean => {
    void tabId;
    return true;
  }, []);

  return {
    plan,
    isPremium,
    canAccessTab,
    dataLimit,
    isLoading: status === "loading",
  };
}
