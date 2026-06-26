import type { User } from "./types";

/**
 * UI permission gate — mirrors config.roles.can(). The backend already computes
 * the full permission map and returns it on the user (`user.can`), and every
 * privileged route re-checks server-side, so this is purely for hiding UI.
 */
export function can(user: User | null | undefined, permission: string): boolean {
  return !!user?.can?.[permission];
}

export const ROLE_LEVEL: Record<string, number> = {
  visitor: 0,
  employer: 1,
  admin: 2,
  super_admin: 3,
};

export function roleLevel(user: User | null | undefined): number {
  return user ? ROLE_LEVEL[user.role] ?? 0 : -1;
}
