const MAX = 75;

/**
 * Derive a human title from a user message. Framework wrappers (IDE state,
 * command caveats, system reminders) are stripped first — a first message
 * that is nothing but injected context yields null so the caller can try
 * the next user line instead of titling the run "<ide_selection>The user…".
 */
export function extractTitle(content: unknown): string | null {
  const raw = typeof content === "string" ? content : firstTextBlock(content);
  if (!raw) return null;

  // Slash command → use the command itself as the title
  const cmd = raw.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = raw.match(/<command-args>([^<]*)<\/command-args>/)?.[1]?.trim() ?? "";
    return clip(`${cmd[1]?.trim() ?? ""} ${args}`);
  }

  const stripped = raw
    .replace(/<(ide_selection|ide_opened_file|ide_diagnostics|system-reminder|local-command-stdout|local-command-caveat|command-message|command-contents)>[\s\S]*?<\/\1>/g, "")
    .replace(/<[a-z-_]+>[\s\S]*$/g, m => (m.includes("</") ? m : ""))  // unclosed trailing wrapper
    .trim();
  return clip(stripped) || null;
}

function firstTextBlock(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content as unknown[]) {
    if (block && typeof block === "object" && (block as Record<string, unknown>)["type"] === "text") {
      const text = (block as Record<string, unknown>)["text"];
      if (typeof text === "string" && text.trim()) return text;
    }
  }
  return null;
}

function clip(s: string): string {
  return s.slice(0, MAX).replace(/\s+/g, " ").trim();
}
