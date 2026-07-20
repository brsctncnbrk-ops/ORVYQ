import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';

interface Shot {
  id: string;
  start_frame: number;
  end_frame: number;
  visual_type: string;
  asset: string;
  trim_in_seconds?: number;
  trim_out_seconds?: number;
  narration_text: string;
  source_line?: string;
  transition: {type: 'cut' | 'crossfade' | 'dip_to_black'; duration_frames: number};
}
interface Plan {
  fps: number;
  duration_frames: number;
  shots: Shot[];
  music_cues: Array<{id: string; asset: string; start_frame: number; end_frame: number; gain_db: number}>;
}
interface CaptionCue {start_frame: number; end_frame: number; text: string}
export interface RenderInput extends Record<string, unknown> {
  projectId: string;
  plan: Plan;
  narrationAsset: string;
  captionCues?: CaptionCue[];
}

const dbToLinear = (db: number) => Math.pow(10, db / 20);
const isVideo = (asset: string) => /\.(mp4|mov|mkv|webm)$/i.test(asset);

const ShotLayer: React.FC<{shot: Shot; fps: number; projectId: string}> = ({shot, fps, projectId}) => {
  const frame = useCurrentFrame();
  const duration = shot.end_frame - shot.start_frame;
  const fade = shot.transition.duration_frames;
  const opacity = shot.transition.type === 'cut' || fade === 0
    ? 1
    : interpolate(frame, [0, fade, Math.max(fade, duration - fade), duration], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const source = staticFile(`projects/${projectId}/${shot.asset}`);
  const progress = duration <= 1 ? 0 : frame / (duration - 1);
  const imageScale = interpolate(progress, [0, 1], shot.visual_type === 'source_graphic' ? [1.015, 1.055] : [1.04, 1.085], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const imageTranslate = interpolate(progress, [0, 1], [-8, 8], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{backgroundColor: '#05070a', opacity, overflow: 'hidden'}}>
      {isVideo(shot.asset) ? (
        <OffthreadVideo
          src={source}
          startFrom={Math.round((shot.trim_in_seconds ?? 0) * fps)}
          endAt={shot.trim_out_seconds ? Math.round(shot.trim_out_seconds * fps) : undefined}
          muted
          style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(1.025) translateX(${imageTranslate * 0.35}px)`}}
        />
      ) : (
        <Img src={source} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${imageScale}) translateX(${imageTranslate}px)`}} />
      )}
      <AbsoluteFill style={{background: 'radial-gradient(circle at 50% 44%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.42) 100%), linear-gradient(180deg, rgba(0,0,0,0.03), rgba(0,0,0,0.32))'}} />
      {shot.source_line ? <div style={{position: 'absolute', left: 54, bottom: 42, maxWidth: 1040, fontSize: 42, lineHeight: 1.25, color: '#d4d8df', background: 'rgba(5,7,10,0.72)', padding: '10px 14px', borderRadius: 6}}>{shot.source_line}</div> : null}
    </AbsoluteFill>
  );
};

export const ORVYQVideo: React.FC<RenderInput> = ({projectId, plan, narrationAsset, captionCues = []}) => {
  return (
    <AbsoluteFill style={{backgroundColor: '#05070a', color: '#f5f5f2', fontFamily: 'Arial, Helvetica, sans-serif'}}>
      {plan.shots.map((shot) => (
        <Sequence key={shot.id} from={shot.start_frame} durationInFrames={shot.end_frame - shot.start_frame} premountFor={plan.fps}>
          <ShotLayer shot={shot} fps={plan.fps} projectId={projectId} />
        </Sequence>
      ))}
      {plan.music_cues.map((cue) => (
        <Sequence key={cue.id} from={cue.start_frame} durationInFrames={cue.end_frame - cue.start_frame}>
          <Audio src={staticFile(`projects/${projectId}/${cue.asset}`)} volume={dbToLinear(cue.gain_db)} loop />
        </Sequence>
      ))}
      <Audio src={staticFile(narrationAsset)} volume={1} />
      {captionCues.map((cue, index) => (
        <Sequence key={`${cue.start_frame}-${index}`} from={cue.start_frame} durationInFrames={cue.end_frame - cue.start_frame}>
          <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', padding: '0 170px 78px'}}>
            <div style={{fontSize: 48, lineHeight: 1.22, fontWeight: 600, textAlign: 'center', textShadow: '0 3px 18px rgba(0,0,0,0.95)', background: 'rgba(5,7,10,0.58)', borderRadius: 10, padding: '14px 24px'}}>{cue.text}</div>
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
