export interface ExtractedVideoData {
  durationSec: number;
  width: number;
  height: number;
  keyframes: Array<{ timestampSec: number; dataUrl: string }>;
}

export interface ExtractedAudioData {
  durationSec: number;
  sampleRate: number;
  channels: number;
  waveformPeaks: number[];
  rmsMean: number;
  rmsVariance: number;
  zeroCrossingRate: number;
  silenceRatio: number;
  abruptTransitions: Array<{ timestampSec: number; deltaRatio: number }>;
}

export async function extractVideoKeyframes(file: File, maxFrames = 6): Promise<ExtractedVideoData> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    const failSafe = window.setTimeout(() => {
      cleanup();
      resolve({ durationSec: 0, width: 0, height: 0, keyframes: [] });
    }, 10000);

    video.onerror = () => {
      window.clearTimeout(failSafe);
      cleanup();
      resolve({ durationSec: 0, width: 0, height: 0, keyframes: [] });
    };

    video.onloadedmetadata = async () => {
      const durationSec = Number.isFinite(video.duration) ? video.duration : 0;
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;

      if (!durationSec || !width || !height) {
        window.clearTimeout(failSafe);
        cleanup();
        resolve({ durationSec, width, height, keyframes: [] });
        return;
      }

      const count = Math.min(maxFrames, Math.max(2, Math.floor(durationSec) + 1));
      const keyframes: Array<{ timestampSec: number; dataUrl: string }> = [];
      const canvas = document.createElement('canvas');
      const targetWidth = Math.min(640, width);
      const targetHeight = Math.round((height / width) * targetWidth);
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      for (let i = 0; i < count; i++) {
        const ts = count === 1 ? 0 : (durationSec * 0.92 * i) / (count - 1) + durationSec * 0.04;
        try {
          await new Promise<void>((seekResolve) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              seekResolve();
            };
            video.addEventListener('seeked', onSeeked);
            video.currentTime = Math.min(durationSec - 0.05, Math.max(0, ts));
            window.setTimeout(seekResolve, 1200);
          });

          if (ctx) {
            ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
            keyframes.push({ timestampSec: Number(ts.toFixed(2)), dataUrl });
          }
        } catch {
          // skip failed frame
        }
      }

      window.clearTimeout(failSafe);
      cleanup();
      resolve({ durationSec, width, height, keyframes });
    };

    video.src = url;
  });
}

export async function extractAudioFeatures(file: File): Promise<ExtractedAudioData | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channelData = decoded.getChannelData(0);
    const durationSec = decoded.duration;
    const sampleRate = decoded.sampleRate;
    const channels = decoded.numberOfChannels;

    const binCount = 80;
    const blockSize = Math.max(1, Math.floor(channelData.length / binCount));
    const waveformPeaks: number[] = [];
    const rmsValues: number[] = [];

    let totalZeroCrossings = 0;
    let silentBins = 0;

    for (let b = 0; b < binCount; b++) {
      const start = b * blockSize;
      const end = Math.min(channelData.length, start + blockSize);
      let peak = 0;
      let sumSq = 0;

      for (let i = start; i < end; i++) {
        const val = channelData[i];
        const abs = Math.abs(val);
        if (abs > peak) peak = abs;
        sumSq += val * val;
        if (i > start && ((channelData[i - 1] >= 0 && val < 0) || (channelData[i - 1] < 0 && val >= 0))) {
          totalZeroCrossings++;
        }
      }

      const rms = Math.sqrt(sumSq / Math.max(1, end - start));
      waveformPeaks.push(Number(peak.toFixed(3)));
      rmsValues.push(rms);
      if (rms < 0.006) silentBins++;
    }

    const rmsMean = rmsValues.reduce((a, b) => a + b, 0) / Math.max(1, rmsValues.length);
    const rmsVariance =
      rmsValues.reduce((acc, v) => acc + Math.pow(v - rmsMean, 2), 0) /
      Math.max(1, rmsValues.length);

    const abruptTransitions: Array<{ timestampSec: number; deltaRatio: number }> = [];
    for (let i = 1; i < rmsValues.length; i++) {
      const prev = Math.max(0.005, rmsValues[i - 1]);
      const ratio = rmsValues[i] / prev;
      if (ratio > 5.5 && rmsValues[i] > 0.08) {
        abruptTransitions.push({
          timestampSec: Number(((i / binCount) * durationSec).toFixed(2)),
          deltaRatio: Number(ratio.toFixed(2)),
        });
      }
    }

    await ctx.close();

    return {
      durationSec: Number(durationSec.toFixed(2)),
      sampleRate,
      channels,
      waveformPeaks,
      rmsMean: Number(rmsMean.toFixed(4)),
      rmsVariance: Number(rmsVariance.toFixed(6)),
      zeroCrossingRate: Number((totalZeroCrossings / Math.max(1, channelData.length)).toFixed(4)),
      silenceRatio: Number((silentBins / binCount).toFixed(3)),
      abruptTransitions: abruptTransitions.slice(0, 6),
    };
  } catch {
    return null;
  }
}
