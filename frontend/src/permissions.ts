import type { User } from "./types";

export type Area = "projects" | "knowledge" | "settings";
export type Level = "none" | "read" | "write";
export type Permissions = Record<Area, Level>;

export const AREAS: { key: Area; label: string }[] = [
  { key: "projects", label: "Projects" },
  { key: "knowledge", label: "Knowledge Base" },
  { key: "settings", label: "Settings" },
];

const RANK: Record<Level, number> = { none: 0, read: 1, write: 2 };
const NONE: Permissions = { projects: "none", knowledge: "none", settings: "none" };

// Sessions from before configurable roles carry only the old role name.
const LEGACY: Record<string, Permissions> = {
  Admin: { projects: "write", knowledge: "write", settings: "write" },
  Administrator: { projects: "write", knowledge: "write", settings: "write" },
  Analyst: { projects: "write", knowledge: "read", settings: "none" },
  Viewer: { projects: "read", knowledge: "read", settings: "none" },
};

export function permissionsOf(user: Pick<User, "role_name" | "permissions"> | null | undefined): Permissions {
  if (!user) return NONE;
  if (user.permissions) return { ...NONE, ...user.permissions };
  return LEGACY[user.role_name] ?? NONE;
}

export function can(user: Pick<User, "role_name" | "permissions"> | null | undefined, area: Area, need: Level = "read"): boolean {
  return RANK[permissionsOf(user)[area]] >= RANK[need];
}
