/* global CustomFunctions */

import { post } from "../shared/api-client";
import { cacheGet, cacheKey, cacheSet } from "../shared/cache";
import type {
  ClassifyRequest, ClassifyResponse,
  ExtractRequest, ExtractResponse,
  CleanRequest, CleanResponse,
  MatchRequest, MatchResponse,
  SummarizeRequest, SummarizeResponse,
  AskRequest, AskResponse,
} from "@aiexcel/shared";

const TTL = 5 * 60 * 1_000; // 5 min client-side cache

/**
 * Classify text into one of the given categories.
 * @customfunction
 * @param {string} text Text to classify.
 * @param {string} categories Comma-separated list of categories.
 * @returns {Promise<string>}
 */
export async function CLASSIFY(text: string, categories: string): Promise<string> {
  const key = cacheKey(["classify", text, categories]);
  const hit = cacheGet<string>(key);
  if (hit) return hit;

  const body: ClassifyRequest = { text, categories };
  const { result } = await post<ClassifyResponse>("/v1/classify", body);
  cacheSet(key, result, TTL);
  return result;
}

/**
 * Extract a specific field from text.
 * @customfunction
 * @param {string} text Source text.
 * @param {string} field Field to extract (e.g. "amount", "date", "sender").
 * @returns {Promise<string>}
 */
export async function EXTRACT(text: string, field: string): Promise<string> {
  const key = cacheKey(["extract", text, field]);
  const hit = cacheGet<string>(key);
  if (hit) return hit;

  const body: ExtractRequest = { text, field };
  const { result } = await post<ExtractResponse>("/v1/extract", body);
  cacheSet(key, result, TTL);
  return result;
}

/**
 * Clean and normalise financial text.
 * @customfunction
 * @param {string} text Text to clean.
 * @returns {Promise<string>}
 */
export async function CLEAN_AI(text: string): Promise<string> {
  const key = cacheKey(["clean", text]);
  const hit = cacheGet<string>(key);
  if (hit) return hit;

  const body: CleanRequest = { text };
  const { result } = await post<CleanResponse>("/v1/clean", body);
  cacheSet(key, result, TTL);
  return result;
}

/**
 * Fuzzy-match a value against a comma-separated list.
 * @customfunction
 * @param {string} value Value to match.
 * @param {string} list Comma-separated list of candidates.
 * @returns {Promise<string>}
 */
export async function MATCH_AI(value: string, list: string): Promise<string> {
  const key = cacheKey(["match", value, list]);
  const hit = cacheGet<string>(key);
  if (hit) return hit;

  const body: MatchRequest = { value, list };
  const { result } = await post<MatchResponse>("/v1/match", body);
  cacheSet(key, result, TTL);
  return result;
}

/**
 * Summarise a range of text values.
 * @customfunction
 * @param {string[][]} range A range of text values.
 * @returns {Promise<string>}
 */
export async function SUMMARIZE(range: string[][]): Promise<string> {
  const texts = range.flat().filter(Boolean);
  const key = cacheKey(["summarize", texts]);
  const hit = cacheGet<string>(key);
  if (hit) return hit;

  const body: SummarizeRequest = { texts };
  const { result } = await post<SummarizeResponse>("/v1/summarize", body);
  cacheSet(key, result, TTL);
  return result;
}

/**
 * Ask the AI a question and return the answer as a cell value.
 * @customfunction
 * @param {string} prompt The question to ask.
 * @returns {Promise<string>}
 */
export async function ASK(prompt: string): Promise<string> {
  const key = cacheKey(["ask", prompt]);
  const hit = cacheGet<string>(key);
  if (hit) return hit;

  const body: AskRequest = { prompt };
  const { result } = await post<AskResponse>("/v1/ask", body);
  cacheSet(key, result, TTL);
  return result;
}

CustomFunctions.associate("CLASSIFY", CLASSIFY);
CustomFunctions.associate("EXTRACT", EXTRACT);
CustomFunctions.associate("CLEAN", CLEAN_AI);
CustomFunctions.associate("MATCH", MATCH_AI);
CustomFunctions.associate("SUMMARIZE", SUMMARIZE);
CustomFunctions.associate("ASK", ASK);
