// Admin route authorization middleware.
//
// Resolves the caller's identity from the forwarded Databricks token via the
// SCIM /Me endpoint, then checks against the ADMIN_USERS allow-list.
// Results are cached per token hash to avoid repeated identity lookups within
// the same server lifetime.

import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import type { AppConfig } from "../config";

interface ScimMeResponse {
  userName?: string;
  emails?: Array<{ value?: string; primary?: boolean }>;
}

// In-memory cache: token SHA-256 -> resolved lowercase email.
const identityCache = new Map<string, string>();

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
}

async function resolveUserEmail(
  token: string,
  config: AppConfig
): Promise<string | null> {
  const hash = tokenHash(token);
  const cached = identityCache.get(hash);
  if (cached) return cached;

  const host = config.databricksHost.replace(/\/$/, "");
  const res = await fetch(`${host}/api/2.0/preview/scim/v2/Me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as ScimMeResponse;

  // Prefer primary email, fall back to userName (which is typically email).
  const email =
    data.emails?.find((e) => e.primary)?.value ??
    data.emails?.[0]?.value ??
    data.userName ??
    null;

  if (!email) return null;

  const normalized = email.trim().toLowerCase();
  identityCache.set(hash, normalized);
  return normalized;
}

/**
 * Express middleware factory. Returns a middleware that rejects requests
 * from users not listed in config.adminUsers.
 *
 * If ADMIN_USERS is empty (unconfigured), ALL authenticated users are allowed
 * so the app works out of the box in dev/demo mode.
 */
export function requireAdmin(config: AppConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // If no allow-list is configured, skip gating (open admin for dev/demo).
    if (config.adminUsers.length === 0) {
      next();
      return;
    }

    const token = req.header("x-forwarded-access-token")?.trim();
    if (!token) {
      res.status(401).json({
        error: "Authentication required.",
        detail: "No user token found. Refresh the Databricks App and try again.",
      });
      return;
    }

    // In demo mode (no host), skip gating.
    if (!config.databricksHost) {
      next();
      return;
    }

    try {
      const email = await resolveUserEmail(token, config);
      if (!email || !config.adminUsers.includes(email)) {
        res.status(403).json({
          error: "Access denied.",
          detail: "You do not have permission to access admin functions.",
        });
        return;
      }
      next();
    } catch {
      res.status(502).json({
        error: "Could not verify admin access.",
        detail: "Identity lookup failed. Try again later.",
      });
    }
  };
}

/**
 * Lightweight check: returns whether the caller is an admin.
 * Used by the frontend to conditionally show the Admin tab.
 */
export async function isCallerAdmin(
  token: string | undefined,
  config: AppConfig
): Promise<boolean> {
  // No allow-list means everyone is an admin.
  if (config.adminUsers.length === 0) return true;
  if (!token || !config.databricksHost) return config.adminUsers.length === 0;

  try {
    const email = await resolveUserEmail(token, config);
    return !!email && config.adminUsers.includes(email);
  } catch {
    return false;
  }
}
