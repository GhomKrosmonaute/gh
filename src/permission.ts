export const LEVELS = ["none", "read", "triage", "write", "maintain", "admin"] as const;

export type Level = (typeof LEVELS)[number];

export function rank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function isLevel(value: unknown): value is Level {
  return LEVELS.includes(value as Level);
}

/** The `permissions` object GitHub attaches to a repository for the authenticated user. */
export interface RepoPermissions {
  admin?: boolean;
  maintain?: boolean;
  push?: boolean;
  triage?: boolean;
  pull?: boolean;
}

export function levelFromPermissions(permissions: RepoPermissions | undefined): Level {
  // Some tokens (GitHub Apps, old Enterprise servers) see the repository without a permissions
  // object: seeing it at all means read access.
  if (!permissions) return "read";
  if (permissions.admin) return "admin";
  if (permissions.maintain) return "maintain";
  if (permissions.push) return "write";
  if (permissions.triage) return "triage";
  if (permissions.pull) return "read";
  return "none";
}

export interface AccountCheck {
  host: string;
  login: string;
  level: Level;
  note?: string;
}

/**
 * The account with the highest permission, at least `minimum`. `checks` is in priority order, so
 * among equals the account listed first wins.
 */
export function pickBest<T extends AccountCheck>(checks: T[], minimum: Level = "read"): T | null {
  let best: T | null = null;
  for (const check of checks) {
    if (rank(check.level) < rank(minimum)) continue;
    if (!best || rank(check.level) > rank(best.level)) best = check;
  }
  return best;
}
