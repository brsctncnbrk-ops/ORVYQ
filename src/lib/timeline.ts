import type {EditorialPause, NarrationTimeline} from '../types.js';
import {timelineDigest} from './hash.js';

export function transformedSecond(sourceSecond: number, pauses: EditorialPause[]): number {
  const inserted = pauses.filter((pause) => pause.after_source_second <= sourceSecond).reduce((sum, pause) => sum + pause.duration_seconds, 0);
  return sourceSecond + inserted;
}

export function validateTimeline(timeline: NarrationTimeline, fps: number): string[] {
  const failures: string[] = [];
  if (!Number.isFinite(timeline.source_audio_duration_seconds) || timeline.source_audio_duration_seconds <= 0) failures.push('source_audio_duration_seconds must be finite and > 0');
  for (const [index, pause] of timeline.editorial_pauses.entries()) {
    if (!Number.isFinite(pause.duration_seconds) || pause.duration_seconds < 0) failures.push(`pause ${index} has invalid duration`);
    if (!Number.isFinite(pause.after_source_second) || pause.after_source_second < 0) failures.push(`pause ${index} has invalid source time`);
  }
  const expectedOutput = timeline.source_audio_duration_seconds + timeline.editorial_pauses.reduce((s, p) => s + p.duration_seconds, 0);
  if (Math.abs(expectedOutput - timeline.output_duration_seconds) > 1 / fps) failures.push(`output_duration_seconds mismatch: expected ${expectedOutput}, got ${timeline.output_duration_seconds}`);
  const expectedHash = timelineDigest(timeline);
  if (timeline.timeline_sha256 !== expectedHash) failures.push('timeline_sha256 does not match canonical timeline payload');
  return failures;
}
