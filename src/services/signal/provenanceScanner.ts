// Optional Metadata, C2PA Content Credentials, and Watermark/Signature Scanner.
// NOTE: Provenance metadata is strictly optional context. Missing EXIF/C2PA/watermarks
// NEVER classify content as authentic OR AI-generated.

export interface ProvenanceScanResult {
  hasC2paCredentials: boolean;
  digitalSourceType: string | null;
  aiGeneratorSignatures: string[];
  hasWatermarkMarkers: boolean;
  provenanceSummary: string;
}

const KNOWN_AI_SIGNATURES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /midjourney/i, label: 'Midjourney' },
  { pattern: /dall-?e/i, label: 'DALL-E' },
  { pattern: /stable\s*diffusion|automatic1111|comfyui/i, label: 'Stable Diffusion / ComfyUI' },
  { pattern: /adobe\s*firefly/i, label: 'Adobe Firefly' },
  { pattern: /trainedAlgorithmicMedia/i, label: 'IPTC Trained Algorithmic Media' },
  { pattern: /compositeWithTrainedAlgorithmicMedia/i, label: 'IPTC AI Composite' },
  { pattern: /google\s*imagen|synthid/i, label: 'Imagen / SynthID Marker' },
  { pattern: /black\s*forest\s*labs|flux/i, label: 'FLUX Generator' },
  { pattern: /openai.*sora|\bsora\b/i, label: 'Sora' },
  { pattern: /runwayml|runway\s*gen/i, label: 'Runway' },
  { pattern: /kling\s*ai|\bkling\b/i, label: 'Kling' },
  { pattern: /luma\s*dream|\bpika\s*labs/i, label: 'Luma / Pika' },
  { pattern: /elevenlabs/i, label: 'ElevenLabs' },
  { pattern: /suno\s*ai|\budio\b/i, label: 'Suno / Udio' },
  { pattern: /coqui|xtts|\bbark\b/i, label: 'Coqui / XTTS / Bark' },
];

export function scanBufferProvenance(
  buffer: Buffer,
  extraMetadataStrings: string[] = []
): ProvenanceScanResult {
  // Scan head + tail + embedded XMP/PNG text regions without allocating huge UTF-8 copies
  const head = buffer.subarray(0, Math.min(buffer.length, 65536)).toString('latin1');
  const tail =
    buffer.length > 65536
      ? buffer.subarray(Math.max(65536, buffer.length - 32768)).toString('latin1')
      : '';
  const combined = `${head}\n${tail}\n${extraMetadataStrings.join('\n')}`;

  const hasC2paCredentials =
    combined.includes('c2pa') ||
    combined.includes('jumb') ||
    combined.includes('c2ma') ||
    combined.includes('c2pa.claim');

  let digitalSourceType: string | null = null;
  if (/compositeWithTrainedAlgorithmicMedia/i.test(combined)) {
    digitalSourceType = 'compositeWithTrainedAlgorithmicMedia';
  } else if (/trainedAlgorithmicMedia/i.test(combined)) {
    digitalSourceType = 'trainedAlgorithmicMedia';
  } else if (/digitalCapture/i.test(combined)) {
    digitalSourceType = 'digitalCapture';
  }

  const matched = new Set<string>();
  for (const sig of KNOWN_AI_SIGNATURES) {
    if (sig.pattern.test(combined)) {
      matched.add(sig.label);
    }
  }

  // PNG Stable Diffusion / ComfyUI tEXt parameter chunks
  if (
    head.startsWith('\x89PNG') &&
    (combined.includes('parameters\x00') ||
      combined.includes('Negative prompt:') ||
      combined.includes('"class_type"') ||
      combined.includes('Steps: '))
  ) {
    matched.add('Embedded Diffusion Prompt Chunk');
  }

  const aiGeneratorSignatures = Array.from(matched);
  const hasWatermarkMarkers =
    aiGeneratorSignatures.length > 0 ||
    digitalSourceType === 'trainedAlgorithmicMedia' ||
    digitalSourceType === 'compositeWithTrainedAlgorithmicMedia';

  let provenanceSummary = 'No embedded C2PA Content Credentials or AI generator metadata found.';
  if (hasC2paCredentials && hasWatermarkMarkers) {
    provenanceSummary = `C2PA Content Credentials and AI markers present (${aiGeneratorSignatures.join(', ')}).`;
  } else if (hasC2paCredentials) {
    provenanceSummary = 'C2PA Content Credentials container detected in file header.';
  } else if (hasWatermarkMarkers) {
    provenanceSummary = `Embedded generator/AI metadata detected (${aiGeneratorSignatures.join(', ')}).`;
  }

  return {
    hasC2paCredentials,
    digitalSourceType,
    aiGeneratorSignatures,
    hasWatermarkMarkers,
    provenanceSummary,
  };
}
