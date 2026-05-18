import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { THRESHOLDS_PATH } from "./paths";

export interface Thresholds {
  claudeMdWordsWarn: number;
  claudeMdWordsError: number;
  userPromptSubmitHooks: number;
  sessionStartHooks: number;
  mcpServers: number;
  mcpSchemaTokens: number;
  cacheHitRateMin: number;
  singleTurnTokensWarn: number;
  singleSessionTokensWarn: number;
}

const DEFAULTS: Thresholds = {
  claudeMdWordsWarn: 1200,
  claudeMdWordsError: 1800,
  userPromptSubmitHooks: 2,
  sessionStartHooks: 3,
  mcpServers: 8,
  mcpSchemaTokens: 8000,
  cacheHitRateMin: 50,
  singleTurnTokensWarn: 50_000,
  singleSessionTokensWarn: 500_000,
};

let _cache: Thresholds | null = null;

export function getThresholds(): Thresholds {
  if (_cache) return _cache;
  if (existsSync(THRESHOLDS_PATH)) {
    try { const loaded = { ...DEFAULTS, ...JSON.parse(readFileSync(THRESHOLDS_PATH, "utf-8")) } as Thresholds; _cache = loaded; return loaded; }
    catch { /* fall through */ }
  }
  _cache = { ...DEFAULTS };
  return _cache;
}

export function saveThresholds(partial: Partial<Thresholds>): Thresholds {
  _cache = { ...getThresholds(), ...partial };
  writeFileSync(THRESHOLDS_PATH, JSON.stringify(_cache, null, 2));
  return _cache;
}

export type Status = "ok" | "warn" | "error";

export function statusForValue(value: number, warn: number, error?: number): Status {
  if (error !== undefined && value >= error) return "error";
  if (value >= warn) return "warn";
  return "ok";
}

export function statusForMin(value: number, min: number): Status {
  return value < min ? "warn" : "ok";
}
