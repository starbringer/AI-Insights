import { readFileSync, existsSync } from "node:fs";
import { SETTINGS_PATH } from "../paths";
import type { Status } from "../thresholds";

export interface SettingsAudit {
  status: Status;
  model: string | null;
  effortLevel: string | null;
  permissionsAllow: number;
  permissionsDeny: number;
  permissionsCount: number;
  hasAutoApprove: boolean;
}

const EMPTY: Omit<SettingsAudit, "status"> = {
  model: null, effortLevel: null,
  permissionsAllow: 0, permissionsDeny: 0, permissionsCount: 0,
  hasAutoApprove: false,
};

export function getSettingsAudit(): SettingsAudit {
  if (!existsSync(SETTINGS_PATH)) {
    return { status: "ok", ...EMPTY };
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
  } catch {
    return { status: "warn", ...EMPTY };
  }

  const model = (settings["model"] as string | undefined) ?? null;
  const effortLevel = (settings["effortLevel"] as string | undefined) ?? null;
  const perms = settings["permissions"];
  const permsObj = perms && typeof perms === "object" ? perms as Record<string, unknown> : {};
  const allow = Array.isArray(permsObj["allow"]) ? (permsObj["allow"] as unknown[]).length : 0;
  const deny  = Array.isArray(permsObj["deny"])  ? (permsObj["deny"]  as unknown[]).length : 0;
  const hasAutoApprove = Boolean(settings["autoApproveAll"] ?? settings["dangerouslySkipPermissions"]);

  const status: Status = hasAutoApprove ? "warn" : "ok";

  return {
    status, model, effortLevel,
    permissionsAllow: allow, permissionsDeny: deny, permissionsCount: allow + deny,
    hasAutoApprove,
  };
}
