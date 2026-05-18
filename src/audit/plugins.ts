import { CLAUDE_BIN } from "../paths";

export interface PluginInfo {
  name: string;
  version: string;
  enabled: boolean;
}

export interface PluginsAudit {
  installed: PluginInfo[];
}

export function getPluginsAudit(): PluginsAudit {
  try {
    const proc = Bun.spawnSync({
      cmd: [CLAUDE_BIN, "plugin", "list"],
      stdout: "pipe",
      stderr: "ignore",
      timeout: 5000,
    });
    const output = proc.stdout.toString("utf-8");
    const installed: PluginInfo[] = [];

    for (const line of output.split("\n")) {
      const m = line.match(/^\s+([\w@/-]+)\s+([\d.]+|—)?\s*(enabled|disabled)?/i);
      if (m) {
        installed.push({
          name: m[1],
          version: m[2] ?? "",
          enabled: (m[3] ?? "enabled").toLowerCase() !== "disabled",
        });
      }
    }
    return { installed };
  } catch {
    return { installed: [] };
  }
}
