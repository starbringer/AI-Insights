import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PRICING_PATH } from "./paths";

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheWrite5mMult: number;
  cacheWrite1hMult: number;
  cacheReadMult: number;
}

export interface PricingTable {
  models: Record<string, ModelPricing>;
}

const DEFAULT: PricingTable = {
  models: {
    // Claude 4 Opus — $5/$25 per 1M tokens (source: anthropic.com/pricing, May 2026)
    "claude-opus-4-7":              { inputPer1M: 5,   outputPer1M: 25, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, cacheReadMult: 0.1 },
    "claude-opus-4-5":              { inputPer1M: 5,   outputPer1M: 25, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, cacheReadMult: 0.1 },
    // Claude 4 Sonnet — $3/$15
    "claude-sonnet-4-6":            { inputPer1M: 3,   outputPer1M: 15, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, cacheReadMult: 0.1 },
    "claude-sonnet-4-5":            { inputPer1M: 3,   outputPer1M: 15, cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, cacheReadMult: 0.1 },
    // Claude 4 Haiku — $1/$5
    "claude-haiku-4-5":             { inputPer1M: 1,   outputPer1M: 5,  cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, cacheReadMult: 0.1 },
    "claude-haiku-4-5-20251001":    { inputPer1M: 1,   outputPer1M: 5,  cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, cacheReadMult: 0.1 },
    // Claude 3.5 Haiku — $0.80/$4
    "claude-haiku-3-5":             { inputPer1M: 0.8, outputPer1M: 4,  cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, cacheReadMult: 0.1 },
    "claude-3-5-haiku-20241022":    { inputPer1M: 0.8, outputPer1M: 4,  cacheWrite5mMult: 1.25, cacheWrite1hMult: 2, cacheReadMult: 0.1 },
  },
};

let _cache: PricingTable | null = null;

export function getPricing(): PricingTable {
  if (_cache) return _cache;
  if (existsSync(PRICING_PATH)) {
    try { _cache = JSON.parse(readFileSync(PRICING_PATH, "utf-8")) as PricingTable; return _cache; }
    catch { /* fall through */ }
  }
  _cache = structuredClone(DEFAULT);
  return _cache;
}

export function savePricing(t: PricingTable): void {
  _cache = t;
  writeFileSync(PRICING_PATH, JSON.stringify(t, null, 2));
}

export function getModelPricing(model: string): ModelPricing {
  const p = getPricing();
  return p.models[model] ?? p.models["claude-sonnet-4-6"] ?? Object.values(p.models)[0]!;
}

export interface TokenCost {
  inputCost: number;
  outputCost: number;
  cacheWrite5mCost: number;
  cacheWrite1hCost: number;
  cacheReadCost: number;
  total: number;
}

export function computeCost(
  model: string,
  input: number,
  output: number,
  cw5m: number,
  cw1h: number,
  cr: number,
): TokenCost {
  const m = getModelPricing(model);
  const div = 1_000_000;
  const inputCost       = (input / div) * m.inputPer1M;
  const outputCost      = (output / div) * m.outputPer1M;
  const cacheWrite5mCost = (cw5m / div) * m.inputPer1M * m.cacheWrite5mMult;
  const cacheWrite1hCost = (cw1h / div) * m.inputPer1M * m.cacheWrite1hMult;
  const cacheReadCost   = (cr / div) * m.inputPer1M * m.cacheReadMult;
  return { inputCost, outputCost, cacheWrite5mCost, cacheWrite1hCost, cacheReadCost,
    total: inputCost + outputCost + cacheWrite5mCost + cacheWrite1hCost + cacheReadCost };
}
