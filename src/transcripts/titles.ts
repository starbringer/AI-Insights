const MAX = 75;

export function extractTitle(content: unknown): string {
  if (typeof content === "string") {
    return content.slice(0, MAX).replace(/\s+/g, " ").trim() || "Untitled";
  }
  if (Array.isArray(content)) {
    for (const block of content as unknown[]) {
      if (block && typeof block === "object" && (block as Record<string, unknown>)["type"] === "text") {
        const text = (block as Record<string, unknown>)["text"];
        if (typeof text === "string") return text.slice(0, MAX).replace(/\s+/g, " ").trim() || "Untitled";
      }
    }
  }
  return "Untitled";
}
