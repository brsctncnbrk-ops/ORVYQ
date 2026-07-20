import {Config} from '@remotion/cli/config';

const browserExecutable = process.env.ORVYQ_BROWSER_EXECUTABLE;
if (!browserExecutable) {
  throw new Error('ORVYQ_BROWSER_EXECUTABLE is required; refusing browser auto-download fallback');
}
Config.setBrowserExecutable(browserExecutable);
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
