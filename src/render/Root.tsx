import React from 'react';
import {Composition, getInputProps} from 'remotion';
import {ORVYQVideo, type RenderInput} from './ORVYQVideo';

export const Root: React.FC = () => {
  const input = getInputProps() as unknown as RenderInput;
  return <Composition<any, RenderInput> id="ORVYQVideo" component={ORVYQVideo} width={1920} height={1080} fps={input.plan?.fps ?? 30} durationInFrames={input.plan?.duration_frames ?? 300} defaultProps={input} calculateMetadata={({props}: {props: RenderInput}) => ({fps: props.plan.fps, durationInFrames: props.plan.duration_frames, width: 1920, height: 1080})}/>;
};
