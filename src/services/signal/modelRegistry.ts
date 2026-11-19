import fs from 'fs';
import path from 'path';

export interface ModalityEngineStatus {
  modality: 'image' | 'video' | 'text' | 'audio';
  activeContentPipeline: string[];
  optionalProvenancePipeline: string[];
  localTrainedWeights: {
    expectedModels: string[];
    weightsPresent: boolean;
    status: string;
  };
  benchmarkDatasets: {
    expectedDatasets: string[];
    datasetsPresent: boolean;
    status: string;
  };
}

export function getDetectionSystemStatus(): {
  geminiConfigured: boolean;
  ffmpegAvailable: boolean;
  modalities: ModalityEngineStatus[];
} {
  const cwd = process.cwd();
  const modelsDir = path.join(cwd, 'models');
  const datasetsDir = path.join(cwd, 'datasets');

  const checkDirHasFiles = (dir: string, subdirs: string[]) => {
    if (!fs.existsSync(dir)) return false;
    return subdirs.some((s) => {
      const p = path.join(dir, s);
      return fs.existsSync(p) && fs.readdirSync(p).length > 0;
    });
  };

  const imgWeights = checkDirHasFiles(modelsDir, ['image', 'efficientnet', 'xception']);
  const vidWeights = checkDirHasFiles(modelsDir, ['video', 'faceforensics', 'dfdc']);
  const txtWeights = checkDirHasFiles(modelsDir, ['text', 'roberta', 'deberta']);
  const audWeights = checkDirHasFiles(modelsDir, ['audio', 'wav2vec2', 'rawnet2', 'ast']);

  const imgData = checkDirHasFiles(datasetsDir, ['cifake', 'genimage']);
  const vidData = checkDirHasFiles(datasetsDir, ['faceforensics', 'dfdc', 'celeb-df']);
  const txtData = checkDirHasFiles(datasetsDir, ['hc3', 'raid']);
  const audData = checkDirHasFiles(datasetsDir, ['asvspoof', 'wavefake']);

  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );
  const ffmpegAvailable = fs.existsSync('/usr/bin/ffmpeg');

  return {
    geminiConfigured,
    ffmpegAvailable,
    modalities: [
      {
        modality: 'image',
        activeContentPipeline: [
          '2D-FFT Frequency & Checkerboard Spectrum Analyzer',
          'Laplacian Pixel Noise & Local Patch Variance Analyzer',
          'Q85 12x Error Level Analysis (ELA) Residual Map',
          geminiConfigured
            ? 'Gemini Visual Artifact Analyzer (3.1 Flash Lite / 4 Hydrogen)'
            : 'Gemini (Not Configured)',
        ],
        optionalProvenancePipeline: ['EXIF/XMP Header Reader', 'C2PA JUMBF & IPTC Scanner'],
        localTrainedWeights: {
          expectedModels: ['EfficientNet', 'XceptionNet'],
          weightsPresent: imgWeights,
          status: imgWeights
            ? 'Local weights detected'
            : 'No local PyTorch/ONNX weights mounted (using Signal + Gemini content pipeline)',
        },
        benchmarkDatasets: {
          expectedDatasets: ['CIFAKE', 'GenImage'],
          datasetsPresent: imgData,
          status: imgData ? 'Dataset mounted' : 'Dataset not mounted in ./datasets',
        },
      },
      {
        modality: 'video',
        activeContentPipeline: [
          ffmpegAvailable ? 'FFmpeg Keyframe & Stream Extractor' : 'Browser Keyframe Sampler',
          'Inter-Frame Temporal MAD, Luminance & FFT Consistency Analyzer',
          geminiConfigured
            ? 'Gemini Temporal & Facial Sequence Analyzer (3.1 Flash Lite / 4 Hydrogen)'
            : 'Gemini (Not Configured)',
        ],
        optionalProvenancePipeline: ['Container Atom Encoder Scan', 'C2PA JUMBF Scanner'],
        localTrainedWeights: {
          expectedModels: ['XceptionNet', 'EfficientNet + Temporal LSTM / 3D CNN'],
          weightsPresent: vidWeights,
          status: vidWeights
            ? 'Local weights detected'
            : 'No local PyTorch/ONNX weights mounted (using Temporal Signal + Gemini pipeline)',
        },
        benchmarkDatasets: {
          expectedDatasets: ['FaceForensics++', 'DFDC', 'Celeb-DF'],
          datasetsPresent: vidData,
          status: vidData ? 'Dataset mounted' : 'Dataset not mounted in ./datasets',
        },
      },
      {
        modality: 'text',
        activeContentPipeline: [
          'Deterministic Stylometry (Burstiness, TTR, Hapax, N-gram Repetition)',
          'Document Text Extractor (PDF/DOCX/UTF-8)',
          geminiConfigured
            ? 'Gemini Linguistic & Predictability Analyzer (3.1 Flash Lite / 4 Hydrogen)'
            : 'Gemini (Not Configured)',
        ],
        optionalProvenancePipeline: ['Document Metadata & Encoding Check'],
        localTrainedWeights: {
          expectedModels: ['RoBERTa', 'DeBERTa'],
          weightsPresent: txtWeights,
          status: txtWeights
            ? 'Local weights detected'
            : 'No local PyTorch/ONNX weights mounted (using Stylometry + Gemini pipeline)',
        },
        benchmarkDatasets: {
          expectedDatasets: ['HC3', 'RAID'],
          datasetsPresent: txtData,
          status: txtData ? 'Dataset mounted' : 'Dataset not mounted in ./datasets',
        },
      },
      {
        modality: 'audio',
        activeContentPipeline: [
          ffmpegAvailable ? 'FFmpeg 16kHz PCM Audio Decoder' : 'Web Audio PCM Decoder',
          'STFT Spectrogram, 13-Band MFCC, Spectral Flatness & Flux Analyzer',
          geminiConfigured
            ? 'Gemini Prosody & Vocoder Analyzer (3.1 Flash Lite / 4 Hydrogen)'
            : 'Gemini (Not Configured)',
        ],
        optionalProvenancePipeline: ['C2PA / TTS Header Signature Scanner'],
        localTrainedWeights: {
          expectedModels: ['RawNet2', 'Wav2Vec2', 'Audio Spectrogram Transformer (AST)'],
          weightsPresent: audWeights,
          status: audWeights
            ? 'Local weights detected'
            : 'No local PyTorch/ONNX weights mounted (using MFCC/STFT + Gemini pipeline)',
        },
        benchmarkDatasets: {
          expectedDatasets: ['ASVspoof', 'WaveFake'],
          datasetsPresent: audData,
          status: audData ? 'Dataset mounted' : 'Dataset not mounted in ./datasets',
        },
      },
    ],
  };
}
