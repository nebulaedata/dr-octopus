/**
 * @author Codex
 * @description Select bounded user evidence and explicit save intent without replaying historical runs.
 */
import type { MemorySource } from '../definitions/types.js';

/**
 * Recognize direct save requests; negation wins and historical questions are not save commands.
 */
export function memorySaveIntent(text: string): 'explicit' | 'declined' | 'automatic' {
  if (
    /不要.{0,8}(?:记住|保存|记下)|别.{0,4}(?:记住|保存|记下)|无需.{0,4}(?:记住|保存)|\b(?:do not|don't|never)\s+(?:remember|save|store)\b/iu.test(
      text
    )
  ) {
    return 'declined';
  }
  if (
    /^(?:你|您)(?:还|已经)?记住.+(?:了吗|了没|没有)[？?]?$|\b(?:do|did|have)\s+you\s+remember(?:ed)?\b/iu.test(
      text.trim()
    )
  ) {
    return 'automatic';
  }
  if (
    /记住(?:我|这|以下|上述|上面|：|:)|(?:请|帮我|替我).{0,8}(?:记住|记下)|(?:保存|存入|写入|加入|记录).{0,16}(?:长期记忆|记忆库)|以后.{0,12}遵循|\b(?:please\s+)?remember\s+(?:me|this|that|these|my|the following)\b|\b(?:save|store|add)\b.{0,60}\b(?:long.term memory|memory)\b/iu.test(
      text
    )
  ) {
    return 'explicit';
  }
  return 'automatic';
}

/**
 * New evidence triggers evaluation; only an explicit request may reference recent branch history.
 * A refusal also bounds subsequent lookback so a later request cannot silently resurrect that text.
 */
export function selectMemoryRun(sources: MemorySource[], baseline: ReadonlySet<string>) {
  const fresh = sources.filter((source) => !baseline.has(source.entryId));
  const intent = memorySaveIntent(fresh.map((source) => source.evidence).join('\n'));
  if (!fresh.length || intent === 'declined') {
    return { intent, sources: [] };
  }
  if (intent !== 'explicit') {
    return { intent, sources: fresh.slice(-8) };
  }
  let boundary = -1;
  for (let index = sources.length - 1; index >= 0; index--) {
    if (memorySaveIntent(sources[index]!.evidence) === 'declined') {
      boundary = index;
      break;
    }
  }
  return { intent, sources: sources.slice(boundary + 1).slice(-8) };
}
