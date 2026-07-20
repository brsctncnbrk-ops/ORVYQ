import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import type {AuditResult, NarrationTimeline, ProductionPlan} from '../types.js';
import {exists} from './io.js';

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {encoding: 'utf8'});
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status !== 0) throw new Error(`${command} failed: ${combined}`);
  return combined;
}

function numberMatch(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

export async function renderedMediaAuditFor(
  video: string,
  expectedFrames: number,
  fps: number,
  id = 'rendered-media-qa',
): Promise<AuditResult> {
  const failures: string[] = [];
  const warnings: string[] = [];
  if (!(await exists(video))) return {id, pass: false, applicable: true, measurements: {video}, thresholds: {}, failures: [`Missing rendered video: ${video}`], warnings};
  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-count_frames', '-of', 'json', video])) as any;
  const videoStream = probe.streams?.find((s: any) => s.codec_type === 'video');
  const audioStream = probe.streams?.find((s: any) => s.codec_type === 'audio');
  const duration = Number(probe.format?.duration);
  const expectedDuration = expectedFrames / fps;
  const frameCount = Number(videoStream?.nb_read_frames ?? videoStream?.nb_frames ?? Math.round(duration * fps));
  if (!Number.isFinite(duration) || Math.abs(duration - expectedDuration) > Math.max(0.25, 2 / fps)) failures.push(`duration ${duration} does not match expected ${expectedDuration}`);
  if (!Number.isFinite(frameCount) || Math.abs(frameCount - expectedFrames) > 2) failures.push(`frame count ${frameCount} does not match ${expectedFrames}`);
  if (videoStream?.width !== 1920 || videoStream?.height !== 1080) failures.push(`resolution must be 1920x1080, got ${videoStream?.width}x${videoStream?.height}`);
  if (!['h264', 'hevc'].includes(videoStream?.codec_name)) failures.push(`unexpected video codec ${videoStream?.codec_name}`);
  if (!audioStream) failures.push('audio stream missing');

  const detect = run('ffmpeg', ['-hide_banner', '-i', video, '-vf', 'blackdetect=d=1:pix_th=0.005', '-af', 'silencedetect=n=-45dB:d=2,volumedetect', '-f', 'null', '-']);
  const blackDurations = [...detect.matchAll(/black_duration:([0-9.]+)/g)].map((m) => Number(m[1]));
  const silenceDurations = [...detect.matchAll(/silence_duration: ([0-9.]+)/g)].map((m) => Number(m[1]));
  const meanVolume = numberMatch(detect, /mean_volume:\s*(-?[0-9.]+) dB/);
  const maxVolume = numberMatch(detect, /max_volume:\s*(-?[0-9.]+) dB/);
  const longBlack = blackDurations.filter((d) => d >= 1);
  const longSilence = silenceDurations.filter((d) => d > 5);
  if (longBlack.length > 0) failures.push(`detected ${longBlack.length} black-screen interval(s) >= 1s`);
  if (longSilence.length > 0) failures.push(`detected ${longSilence.length} silence interval(s) > 5s`);
  if (maxVolume === null || meanVolume === null) failures.push('audio loudness metrics could not be calculated');
  if (maxVolume !== null && maxVolume > -1) failures.push(`audio peak ${maxVolume}dB is too high`);
  if (meanVolume !== null && meanVolume < -30) failures.push(`mean audio level ${meanVolume}dB is too low`);
  if (silenceDurations.length > 0 && longSilence.length === 0) warnings.push(`${silenceDurations.length} intentional/short silence interval(s) detected`);

  return {
    id, pass: failures.length === 0, applicable: true,
    measurements: {duration, expectedDuration, frameCount, codec: videoStream?.codec_name, width: videoStream?.width, height: videoStream?.height, audio_codec: audioStream?.codec_name, black_durations: blackDurations, silence_durations: silenceDurations, mean_volume_db: meanVolume, peak_db: maxVolume},
    thresholds: {duration_tolerance_seconds: Math.max(0.25, 2 / fps), frame_tolerance: 2, resolution: '1920x1080', codecs: ['h264', 'hevc'], max_black_seconds: 1, max_silence_seconds: 5, minimum_mean_volume_db: -30, maximum_peak_db: -1}, failures, warnings,
  };
}

export async function renderedMediaAudit(video: string, plan: ProductionPlan, _timeline: NarrationTimeline): Promise<AuditResult> {
  return renderedMediaAuditFor(video, plan.duration_frames, plan.fps, 'rendered-media-qa');
}

export async function renderedSpeechEndingAuditFor(transcriptFile: string, expectedWord: string, id = 'rendered-speech-ending'): Promise<AuditResult> {
  const failures: string[] = [];
  if (!(await exists(transcriptFile))) return {id, pass: false, applicable: true, measurements: {}, thresholds: {}, failures: [`Missing transcript: ${transcriptFile}`], warnings: []};
  const transcript = JSON.parse(await readFile(transcriptFile, 'utf8')) as {text?: string; words?: Array<{word: string}>};
  const text = (transcript.text ?? '').trim();
  const lastWord = transcript.words?.at(-1)?.word?.replace(/[^\p{L}\p{N}'-]/gu, '') ?? text.split(/\s+/).at(-1)?.replace(/[^\p{L}\p{N}'-]/gu, '') ?? '';
  if (lastWord.toLocaleLowerCase() !== expectedWord.toLocaleLowerCase()) failures.push(`last spoken word ${lastWord} != ${expectedWord}`);
  if (!/[.!?]["'’”)]?$/.test(text)) failures.push('rendered speech does not end with completed sentence punctuation');
  return {id, pass: failures.length === 0, applicable: true, measurements: {lastWord, transcript_end: text.slice(-120)}, thresholds: {final_word: expectedWord, completed_punctuation: true}, failures, warnings: []};
}

export async function renderedSpeechEndingAudit(transcriptFile: string, timeline: NarrationTimeline): Promise<AuditResult> {
  return renderedSpeechEndingAuditFor(transcriptFile, timeline.final_word, 'rendered-speech-ending');
}
