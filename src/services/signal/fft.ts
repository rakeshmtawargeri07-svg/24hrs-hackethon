// Pure TypeScript Cooley-Tukey Radix-2 FFT, 2D Image Spectral Analyzer, and Audio STFT + MFCC Engine

export interface ComplexArray {
  re: Float64Array;
  im: Float64Array;
}

export function fft1DInPlace(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n <= 1 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be a power of 2, got ${n}`);
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (sign * 2 * Math.PI) / len;
    const wStepRe = Math.cos(angle);
    const wStepIm = Math.sin(angle);

    for (let start = 0; start < n; start += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k++) {
        const idx1 = start + k;
        const idx2 = idx1 + half;
        const tRe = wRe * re[idx2] - wIm * im[idx2];
        const tIm = wRe * im[idx2] + wIm * re[idx2];

        re[idx2] = re[idx1] - tRe;
        im[idx2] = im[idx1] - tIm;
        re[idx1] += tRe;
        im[idx1] += tIm;

        const nextRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextRe;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export interface ImageSpectralMetrics {
  gridSize: number;
  highFreqEnergyRatio: number; // fraction of energy in outer 45% of radius
  periodicGridPeakRatio: number; // peak energy on checkerboard/upsampling axes vs median
  radialDecaySlope: number; // linear log-power slope
  spectralEntropy: number; // normalized 0..1
}

/**
 * Computes 2D FFT magnitude spectrum on a square power-of-2 grayscale buffer (e.g. 128x128).
 */
export function analyzeImageSpectrum(grayPixels: Uint8Array | Float64Array, size = 128): ImageSpectralMetrics {
  const n = size;
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);

  // Subtract mean DC + apply 2D Hann window to reduce edge-leakage artifacts
  let mean = 0;
  for (let i = 0; i < n * n; i++) {
    mean += grayPixels[i];
  }
  mean /= Math.max(1, n * n);

  for (let y = 0; y < n; y++) {
    const wy = 0.5 * (1 - Math.cos((2 * Math.PI * y) / (n - 1)));
    for (let x = 0; x < n; x++) {
      const wx = 0.5 * (1 - Math.cos((2 * Math.PI * x) / (n - 1)));
      const idx = y * n + x;
      re[idx] = (grayPixels[idx] - mean) * wx * wy;
    }
  }

  // Row FFTs
  const rowRe = new Float64Array(n);
  const rowIm = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    const offset = y * n;
    for (let x = 0; x < n; x++) {
      rowRe[x] = re[offset + x];
      rowIm[x] = 0;
    }
    fft1DInPlace(rowRe, rowIm);
    for (let x = 0; x < n; x++) {
      re[offset + x] = rowRe[x];
      im[offset + x] = rowIm[x];
    }
  }

  // Column FFTs
  const colRe = new Float64Array(n);
  const colIm = new Float64Array(n);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const idx = y * n + x;
      colRe[y] = re[idx];
      colIm[y] = im[idx];
    }
    fft1DInPlace(colRe, colIm);
    for (let y = 0; y < n; y++) {
      const idx = y * n + x;
      re[idx] = colRe[y];
      im[idx] = colIm[y];
    }
  }

  const half = n / 2;
  const maxRadius = Math.sqrt(half * half + half * half);
  const radialBins = 16;
  const binSums = new Float64Array(radialBins);
  const binCounts = new Float64Array(radialBins);

  let totalPower = 0;
  let highFreqPower = 0;
  const highPowers: number[] = [];

  // Checkerboard / upsampling axis frequencies (half-Nyquist & Nyquist)
  let gridSpikePower = 0;

  for (let u = 0; u < n; u++) {
    const su = u <= half ? u : u - n;
    for (let v = 0; v < n; v++) {
      const sv = v <= half ? v : v - n;
      if (su === 0 && sv === 0) continue;
      const idx = u * n + v;
      const pwr = re[idx] * re[idx] + im[idx] * im[idx];
      const r = Math.sqrt(su * su + sv * sv);
      const normR = r / maxRadius;

      totalPower += pwr;
      if (normR >= 0.45) {
        highFreqPower += pwr;
        highPowers.push(pwr);
      }

      const bin = Math.min(radialBins - 1, Math.floor(normR * radialBins));
      binSums[bin] += pwr;
      binCounts[bin] += 1;

      // Check Nyquist & half-Nyquist axis harmonics (typical of GAN/diffusion upsampling)
      const isGridCoord =
        (Math.abs(su) === half && sv === 0) ||
        (su === 0 && Math.abs(sv) === half) ||
        (Math.abs(su) === half && Math.abs(sv) === half) ||
        (Math.abs(su) === half / 2 && Math.abs(sv) === half / 2);
      if (isGridCoord && pwr > gridSpikePower) {
        gridSpikePower = pwr;
      }
    }
  }

  highPowers.sort((a, b) => a - b);
  const medianHigh = highPowers.length > 0 ? highPowers[Math.floor(highPowers.length / 2)] : 1;
  const periodicGridPeakRatio = Number(
    (gridSpikePower / Math.max(1e-6, medianHigh)).toFixed(2)
  );

  // Compute radial power slope in log-log space
  const xs: number[] = [];
  const ys: number[] = [];
  for (let b = 1; b < radialBins; b++) {
    if (binCounts[b] > 0) {
      const avg = binSums[b] / binCounts[b];
      xs.push(Math.log(b + 0.5));
      ys.push(Math.log(avg + 1e-6));
    }
  }

  let slope = 0;
  if (xs.length >= 2) {
    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - meanX) * (ys[i] - meanY);
      den += (xs[i] - meanX) * (xs[i] - meanX);
    }
    slope = den > 0 ? num / den : 0;
  }

  // Normalized radial spectral entropy
  let entropy = 0;
  const binTotal = binSums.reduce((a, b) => a + b, 0);
  if (binTotal > 0) {
    for (let b = 0; b < radialBins; b++) {
      const prob = binSums[b] / binTotal;
      if (prob > 1e-12) {
        entropy -= prob * Math.log2(prob);
      }
    }
    entropy /= Math.log2(radialBins);
  }

  return {
    gridSize: size,
    highFreqEnergyRatio: Number((highFreqPower / Math.max(1e-9, totalPower)).toFixed(4)),
    periodicGridPeakRatio,
    radialDecaySlope: Number(slope.toFixed(3)),
    spectralEntropy: Number(entropy.toFixed(3)),
  };
}

export interface AudioSpectralMfccMetrics {
  sampleRate: number;
  durationSec: number;
  frameCount: number;
  waveformPeaks: number[];
  rmsMean: number;
  rmsVariance: number;
  zeroCrossingRate: number;
  silenceRatio: number;
  noiseFloorDb: number;
  spectralCentroidHz: number;
  spectralFlatness: number;
  highFreqCutoffRatio: number; // fraction of energy > 6kHz
  mfccMean: number[]; // 13 MFCC coefficients
  mfccStd: number[]; // 13 MFCC std deviations
  spectralFluxSpikes: Array<{ timestampSec: number; fluxRatio: number }>;
  abruptTransitions: Array<{ timestampSec: number; deltaRatio: number }>;
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Extracts STFT spectrogram features, 26-band Mel filterbank -> 13 MFCCs, and temporal flux from mono PCM float samples.
 */
export function extractAudioSpectralAndMfcc(
  samples: Float32Array,
  sampleRate: number
): AudioSpectralMfccMetrics {
  const durationSec = samples.length / Math.max(1, sampleRate);
  const fftSize = 512;
  const hopSize = 256;
  const numBins = fftSize / 2 + 1;
  const numMelFilters = 26;
  const numMfcc = 13;

  // Waveform peaks (80 bins) + RMS + ZCR
  const peakBins = 80;
  const peakBlock = Math.max(1, Math.floor(samples.length / peakBins));
  const waveformPeaks: number[] = [];
  const rmsBins: number[] = [];
  let totalZcr = 0;
  let silentBins = 0;

  for (let b = 0; b < peakBins; b++) {
    const s = b * peakBlock;
    const e = Math.min(samples.length, s + peakBlock);
    let peak = 0;
    let sumSq = 0;
    for (let i = s; i < e; i++) {
      const v = samples[i];
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
      sumSq += v * v;
      if (i > s && ((samples[i - 1] >= 0 && v < 0) || (samples[i - 1] < 0 && v >= 0))) {
        totalZcr++;
      }
    }
    const rms = Math.sqrt(sumSq / Math.max(1, e - s));
    waveformPeaks.push(Number(peak.toFixed(3)));
    rmsBins.push(rms);
    if (rms < 0.006) silentBins++;
  }

  const rmsMean = rmsBins.reduce((a, b) => a + b, 0) / Math.max(1, rmsBins.length);
  const rmsVariance =
    rmsBins.reduce((acc, v) => acc + Math.pow(v - rmsMean, 2), 0) / Math.max(1, rmsBins.length);

  const sortedRms = [...rmsBins].sort((a, b) => a - b);
  const p10Rms = sortedRms[Math.floor(sortedRms.length * 0.1)] || 1e-6;
  const noiseFloorDb = Number((20 * Math.log10(Math.max(1e-6, p10Rms))).toFixed(1));

  const abruptTransitions: Array<{ timestampSec: number; deltaRatio: number }> = [];
  for (let i = 1; i < rmsBins.length; i++) {
    const prev = Math.max(0.005, rmsBins[i - 1]);
    const ratio = rmsBins[i] / prev;
    if (ratio > 5.5 && rmsBins[i] > 0.08) {
      abruptTransitions.push({
        timestampSec: Number(((i / peakBins) * durationSec).toFixed(2)),
        deltaRatio: Number(ratio.toFixed(2)),
      });
    }
  }

  // Build Mel filterbank matrix
  const melLow = hzToMel(50);
  const melHigh = hzToMel(sampleRate / 2);
  const melPoints: number[] = [];
  for (let i = 0; i < numMelFilters + 2; i++) {
    const mel = melLow + ((melHigh - melLow) * i) / (numMelFilters + 1);
    melPoints.push(Math.floor(((fftSize + 1) * melToHz(mel)) / sampleRate));
  }

  const filterBank: Float64Array[] = [];
  for (let m = 1; m <= numMelFilters; m++) {
    const f = new Float64Array(numBins);
    const left = melPoints[m - 1];
    const center = melPoints[m];
    const right = melPoints[m + 1];
    for (let k = left; k < center && k < numBins; k++) {
      if (center > left) f[k] = (k - left) / (center - left);
    }
    for (let k = center; k <= right && k < numBins; k++) {
      if (right > center) f[k] = (right - k) / (right - center);
    }
    filterBank.push(f);
  }

  // Precompute Hann window
  const hann = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const maxFrames = Math.min(
    600,
    Math.max(0, Math.floor((samples.length - fftSize) / hopSize) + 1)
  );
  const frameStep =
    samples.length > maxFrames * hopSize + fftSize
      ? Math.max(hopSize, Math.floor((samples.length - fftSize) / maxFrames))
      : hopSize;

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const prevMag = new Float64Array(numBins);

  let centroidSum = 0;
  let flatnessSum = 0;
  let highCutoffSum = 0;
  let totalSpecSum = 0;
  let frameCount = 0;

  const fluxValues: Array<{ timestampSec: number; flux: number }> = [];
  const mfccFrames: number[][] = [];
  const cutoffBin = Math.floor((6000 * fftSize) / Math.max(1, sampleRate));

  for (let pos = 0; pos + fftSize <= samples.length; pos += frameStep) {
    for (let i = 0; i < fftSize; i++) {
      re[i] = samples[pos + i] * hann[i];
      im[i] = 0;
    }
    fft1DInPlace(re, im);

    let frameEnergy = 0;
    let weightedFreq = 0;
    let logMagSum = 0;
    let highEnergy = 0;
    let flux = 0;

    const powerSpec = new Float64Array(numBins);
    for (let k = 0; k < numBins; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const pwr = mag * mag;
      powerSpec[k] = pwr;
      frameEnergy += pwr;
      weightedFreq += ((k * sampleRate) / fftSize) * pwr;
      logMagSum += Math.log(Math.max(1e-10, pwr));
      if (k >= cutoffBin) highEnergy += pwr;
      if (frameCount > 0) {
        const diff = mag - prevMag[k];
        if (diff > 0) flux += diff * diff;
      }
      prevMag[k] = mag;
    }

    if (frameEnergy > 1e-8) {
      centroidSum += weightedFreq / frameEnergy;
      const arithMean = frameEnergy / numBins;
      const geomMean = Math.exp(logMagSum / numBins);
      flatnessSum += geomMean / Math.max(1e-10, arithMean);
      highCutoffSum += highEnergy / frameEnergy;
      totalSpecSum++;
    }

    if (frameCount > 0) {
      fluxValues.push({
        timestampSec: Number((pos / Math.max(1, sampleRate)).toFixed(2)),
        flux: Math.sqrt(flux),
      });
    }

    // Mel energies + DCT-II -> 13 MFCCs
    const melLog = new Float64Array(numMelFilters);
    for (let m = 0; m < numMelFilters; m++) {
      let e = 0;
      const fb = filterBank[m];
      for (let k = 0; k < numBins; k++) {
        e += powerSpec[k] * fb[k];
      }
      melLog[m] = Math.log(Math.max(1e-10, e));
    }

    const mfcc: number[] = [];
    for (let c = 0; c < numMfcc; c++) {
      let sum = 0;
      for (let m = 0; m < numMelFilters; m++) {
        sum += melLog[m] * Math.cos((Math.PI * c * (m + 0.5)) / numMelFilters);
      }
      mfcc.push(sum);
    }
    mfccFrames.push(mfcc);
    frameCount++;
  }

  // MFCC means & stds
  const mfccMean = new Array(numMfcc).fill(0);
  const mfccStd = new Array(numMfcc).fill(0);
  if (mfccFrames.length > 0) {
    for (const f of mfccFrames) {
      for (let c = 0; c < numMfcc; c++) mfccMean[c] += f[c];
    }
    for (let c = 0; c < numMfcc; c++) mfccMean[c] /= mfccFrames.length;
    for (const f of mfccFrames) {
      for (let c = 0; c < numMfcc; c++) {
        const d = f[c] - mfccMean[c];
        mfccStd[c] += d * d;
      }
    }
    for (let c = 0; c < numMfcc; c++) {
      mfccMean[c] = Number(mfccMean[c].toFixed(2));
      mfccStd[c] = Number(Math.sqrt(mfccStd[c] / mfccFrames.length).toFixed(2));
    }
  }

  // Identify spectral flux spikes (> 4x median flux)
  const sortedFlux = fluxValues.map((f) => f.flux).sort((a, b) => a - b);
  const medianFlux = sortedFlux.length > 0 ? sortedFlux[Math.floor(sortedFlux.length / 2)] : 1;
  const spectralFluxSpikes = fluxValues
    .filter((f) => medianFlux > 0 && f.flux / medianFlux > 4.2)
    .slice(0, 6)
    .map((f) => ({
      timestampSec: f.timestampSec,
      fluxRatio: Number((f.flux / Math.max(1e-6, medianFlux)).toFixed(2)),
    }));

  const denom = Math.max(1, totalSpecSum);
  return {
    sampleRate,
    durationSec: Number(durationSec.toFixed(2)),
    frameCount,
    waveformPeaks,
    rmsMean: Number(rmsMean.toFixed(4)),
    rmsVariance: Number(rmsVariance.toFixed(6)),
    zeroCrossingRate: Number((totalZcr / Math.max(1, samples.length)).toFixed(4)),
    silenceRatio: Number((silentBins / peakBins).toFixed(3)),
    noiseFloorDb,
    spectralCentroidHz: Math.round(centroidSum / denom),
    spectralFlatness: Number((flatnessSum / denom).toFixed(4)),
    highFreqCutoffRatio: Number((highCutoffSum / denom).toFixed(4)),
    mfccMean,
    mfccStd,
    spectralFluxSpikes,
    abruptTransitions: abruptTransitions.slice(0, 6),
  };
}
