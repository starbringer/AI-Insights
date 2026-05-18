import { getEncoding, type Tiktoken } from "js-tiktoken";

let _enc: Tiktoken | null = null;

function enc(): Tiktoken {
  if (!_enc) _enc = getEncoding("cl100k_base");
  return _enc;
}

export function countTokens(text: string): number {
  try {
    return enc().encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export function countTokensInObject(obj: unknown): number {
  return countTokens(JSON.stringify(obj));
}
