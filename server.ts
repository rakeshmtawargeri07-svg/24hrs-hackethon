import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createInvestigationRecord,
  deleteUserInvestigation,
  getInvestigationDetail,
  getUserDashboardData,
  getUserEvidenceItemById,
  insertEvidenceItemWithFindings,
  logUserActivity,
  replaceCrossModalCorrelations,
  updateInvestigationSynthesis,
} from './src/db/investigations.ts';
import { EvidenceModality } from './src/db/schema.ts';
import { updateUserSettings } from './src/db/users.ts';
import { AuthRequest, requireAuth } from './src/middleware/auth.ts';
import { analyzeAudioEvidence, AudioAcousticFeatures } from './src/services/analyzers/audioForensics.ts';
import { correlateInvestigationEvidence } from './src/services/analyzers/crossModalCorrelator.ts';
import { compareRealVsSuspiciousImages } from './src/services/analyzers/imageComparison.ts';
import { analyzeImageEvidence } from './src/services/analyzers/imageForensics.ts';
import { analyzeTextEvidence } from './src/services/analyzers/textForensics.ts';
import { analyzeVideoEvidence, VideoKeyframeInput } from './src/services/analyzers/videoForensics.ts';
import { getDetectionSystemStatus } from './src/services/signal/modelRegistry.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_ROOT = path.resolve(__dirname, 'uploads');
const EVIDENCE_DIR = path.join(UPLOADS_ROOT, 'evidence');
const ELA_DIR = path.join(UPLOADS_ROOT, 'ela');

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.mkdirSync(ELA_DIR, { recursive: true });

const ALLOWED_EXTENSIONS: Record<string, EvidenceModality> = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.txt': 'text',
  '.pdf': 'text',
  '.docx': 'text',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 60 * 1024 * 1024, // 60 MB max per file
    files: 12,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS[ext]) {
      cb(
        new Error(
          `Unsupported file format "${ext || file.mimetype}". Supported: JPG, JPEG, PNG, WEBP, MP4, MOV, AVI, MP3, WAV, M4A, TXT, PDF, DOCX.`
        )
      );
      return;
    }
    cb(null, true);
  },
});

async function startServer() {
  const app = express();
  const PORT =
    process.env.NODE_ENV === 'production' ? Number(process.env.PORT) || 3000 : 3000;

  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  // Serve preserved evidence artifacts and ELA heatmaps
  app.use('/uploads', express.static(UPLOADS_ROOT));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, service: 'TruthLens Forensics API' });
  });

  // Honest detection engines, weights, and dataset availability status
  app.get('/api/models/status', requireAuth, (_req: AuthRequest, res) => {
    res.json(getDetectionSystemStatus());
  });

  // Current authenticated analyst profile & settings
  app.get('/api/me', requireAuth, (req: AuthRequest, res) => {
    res.json({ user: req.dbUser });
  });

  app.patch('/api/me/settings', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const {
        displayName,
        analystOrganization,
        defaultConfidenceThreshold,
        includeLimitationsInExports,
      } = req.body ?? {};

      const updated = await updateUserSettings(dbUser.id, {
        ...(typeof displayName === 'string' ? { displayName: displayName.trim() } : {}),
        ...(typeof analystOrganization === 'string'
          ? { analystOrganization: analystOrganization.trim() || 'Independent Forensic Unit' }
          : {}),
        ...(typeof defaultConfidenceThreshold === 'number'
          ? { defaultConfidenceThreshold: Math.max(20, Math.min(95, Math.round(defaultConfidenceThreshold))) }
          : {}),
        ...(typeof includeLimitationsInExports === 'boolean'
          ? { includeLimitationsInExports }
          : {}),
      });

      await logUserActivity({
        userId: dbUser.id,
        actionType: 'settings_updated',
        description: 'Updated forensic workspace preferences and reporting thresholds.',
      });

      res.json({ user: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to update settings.' });
    }
  });

  // Dashboard metrics, investigation history, evidence index, and activity logs
  app.get('/api/dashboard', requireAuth, async (req: AuthRequest, res) => {
    try {
      const data = await getUserDashboardData(req.dbUser!.id);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load dashboard.' });
    }
  });

  // Single investigation detail
  app.get('/api/investigations/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid investigation ID.' });
      }
      const detail = await getInvestigationDetail(req.dbUser!.id, id);
      if (!detail) {
        return res.status(404).json({ error: 'Investigation not found.' });
      }
      res.json({ investigation: detail });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load investigation.' });
    }
  });

  // Delete investigation
  app.delete('/api/investigations/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid investigation ID.' });
      }
      const deleted = await deleteUserInvestigation(req.dbUser!.id, id);
      if (!deleted) {
        return res.status(404).json({ error: 'Investigation not found.' });
      }
      res.json({ deletedId: deleted.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to delete investigation.' });
    }
  });

  // Log PDF export
  app.post('/api/investigations/:id/log-export', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const detail = Number.isFinite(id)
        ? await getInvestigationDetail(req.dbUser!.id, id)
        : null;
      if (!detail) {
        return res.status(404).json({ error: 'Investigation not found.' });
      }
      await logUserActivity({
        userId: req.dbUser!.id,
        investigationId: detail.id,
        actionType: 'report_exported',
        description: `Exported forensic PDF dossier for ${detail.caseCode} (${detail.title}).`,
      });
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to log report export.' });
    }
  });

  // Re-run cross-modal correlation on existing investigation
  app.post('/api/investigations/:id/correlate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const detail = Number.isFinite(id)
        ? await getInvestigationDetail(req.dbUser!.id, id)
        : null;
      if (!detail) {
        return res.status(404).json({ error: 'Investigation not found.' });
      }

      const synthesis = await correlateInvestigationEvidence({
        title: detail.title,
        description: detail.description,
        items: detail.evidenceItems.map((e) => ({
          id: e.id,
          modality: e.modality,
          filename: e.filename,
          classification: e.classification,
          confidence: e.confidence,
          technicalSummary: e.technicalSummary,
          extractedText: e.extractedText,
          metadataJson: e.metadataJson,
        })),
      });

      await replaceCrossModalCorrelations(detail.id, synthesis.correlations);
      await updateInvestigationSynthesis(detail.id, {
        overallAssessment: synthesis.overallAssessment,
        overallConfidence: synthesis.overallConfidence,
        summary: synthesis.summary,
        limitations: synthesis.limitations,
        recommendations: synthesis.recommendations,
      });

      await logUserActivity({
        userId: req.dbUser!.id,
        investigationId: detail.id,
        actionType: 'analysis_completed',
        description: `Re-ran cross-modal correlation on ${detail.caseCode}.`,
      });

      const updated = await getInvestigationDetail(req.dbUser!.id, detail.id);
      res.json({ investigation: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Cross-modal correlation failed.' });
    }
  });

  // Compare a known Real Reference photo against a Suspicious photo
  app.post(
    '/api/images/compare',
    requireAuth,
    (req: AuthRequest, res, next) => {
      upload.fields([
        { name: 'realImage', maxCount: 1 },
        { name: 'suspiciousImage', maxCount: 1 },
      ])(req, res, (err: any) => {
        if (err) {
          return res.status(400).json({ error: err.message || 'Invalid image upload.' });
        }
        next();
      });
    },
    async (req: AuthRequest, res) => {
      try {
        const dbUser = req.dbUser!;
        const filesMap = (req.files as Record<string, Express.Multer.File[]>) ?? {};
        const realUpload = filesMap.realImage?.[0];
        const suspiciousUpload = filesMap.suspiciousImage?.[0];
        const realEvidenceId = Number(req.body?.realEvidenceId || 0);
        const suspiciousEvidenceId = Number(req.body?.suspiciousEvidenceId || 0);
        const notes = String(req.body?.notes || '').trim();

        const resolveImageSource = async (
          uploaded: Express.Multer.File | undefined,
          evidenceId: number,
          roleLabel: string
        ): Promise<{ buffer: Buffer; filename: string; mimeType: string; previewUrl: string }> => {
          if (uploaded) {
            const ext = path.extname(uploaded.originalname).toLowerCase();
            if (ALLOWED_EXTENSIONS[ext] !== 'image') {
              throw new Error(`${roleLabel} must be an image (JPG, PNG, or WEBP).`);
            }
            const hash = crypto.createHash('sha256').update(uploaded.buffer).digest('hex');
            const safeFilename = `${hash.slice(0, 16)}-${crypto.randomUUID().slice(0, 8)}${ext}`;
            await fs.promises.writeFile(path.join(EVIDENCE_DIR, safeFilename), uploaded.buffer);
            return {
              buffer: uploaded.buffer,
              filename: uploaded.originalname,
              mimeType: uploaded.mimetype,
              previewUrl: `/uploads/evidence/${safeFilename}`,
            };
          }

          if (Number.isFinite(evidenceId) && evidenceId > 0) {
            const item = await getUserEvidenceItemById(dbUser.id, evidenceId);
            if (!item || item.modality !== 'image') {
              throw new Error(`Selected ${roleLabel} could not be found in your saved checks.`);
            }
            const safeRel = item.storagePath.replace(/^\/+/, '');
            const diskPath = path.resolve(__dirname, safeRel);
            if (!diskPath.startsWith(UPLOADS_ROOT) || !fs.existsSync(diskPath)) {
              throw new Error(`Stored file for ${item.filename} is no longer available on disk.`);
            }
            const buffer = await fs.promises.readFile(diskPath);
            return {
              buffer,
              filename: item.filename,
              mimeType: item.mimeType,
              previewUrl: item.storagePath,
            };
          }

          throw new Error(`Please provide both a Real Reference photo and a Suspicious photo.`);
        };

        const [realSource, suspSource] = await Promise.all([
          resolveImageSource(realUpload, realEvidenceId, 'Real Reference photo'),
          resolveImageSource(suspiciousUpload, suspiciousEvidenceId, 'Suspicious photo'),
        ]);

        const comparisonId = `cmp-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const comparison = await compareRealVsSuspiciousImages({
          realBuffer: realSource.buffer,
          realFilename: realSource.filename,
          realMimeType: realSource.mimeType,
          realPreviewUrl: realSource.previewUrl,
          suspiciousBuffer: suspSource.buffer,
          suspiciousFilename: suspSource.filename,
          suspiciousMimeType: suspSource.mimeType,
          suspiciousPreviewUrl: suspSource.previewUrl,
          elaDir: ELA_DIR,
          comparisonId,
          notes: notes || undefined,
        });

        void logUserActivity({
          userId: dbUser.id,
          actionType: 'image_comparison_completed',
          description: `Compared "${realSource.filename}" (Real) vs. "${suspSource.filename}" (Suspicious) — Verdict: ${comparison.verdict}.`,
        });

        res.json({ comparison });
      } catch (error: any) {
        console.error('Error in /api/images/compare:', error);
        res.status(400).json({ error: error?.message || 'Failed to compare images.' });
      }
    }
  );

  // Create & run full multimodal investigation
  app.post(
    '/api/investigations/analyze',
    requireAuth,
    (req: AuthRequest, res, next) => {
      upload.array('files', 12)(req, res, (err: any) => {
        if (err) {
          return res.status(400).json({ error: err.message || 'Invalid file upload.' });
        }
        next();
      });
    },
    async (req: AuthRequest, res) => {
      try {
        const dbUser = req.dbUser!;
        const title = String(req.body?.title || '').trim() || `Investigation ${new Date().toISOString().slice(0, 10)}`;
        const description = String(req.body?.description || '').trim();
        const pastedText = String(req.body?.pastedText || '').trim();
        const pastedTextTitle = String(req.body?.pastedTextTitle || '').trim() || 'accompanying-statement.txt';

        let clientMetadataList: Array<{
          filename?: string;
          durationSec?: number;
          width?: number;
          height?: number;
          keyframes?: VideoKeyframeInput[];
          acousticFeatures?: AudioAcousticFeatures | null;
        }> = [];

        if (req.body?.clientMetadata) {
          try {
            const parsed = JSON.parse(String(req.body.clientMetadata));
            if (Array.isArray(parsed)) clientMetadataList = parsed;
          } catch {
            // ignore malformed clientMetadata
          }
        }

        const uploadedFiles = (req.files as Express.Multer.File[]) ?? [];
        if (uploadedFiles.length === 0 && !pastedText) {
          return res.status(400).json({
            error: 'Upload at least one image, video, audio, or text evidence file (or supply text/caption evidence).',
          });
        }

        // Create initial investigation shell
        const investigation = await createInvestigationRecord({
          userId: dbUser.id,
          title,
          description,
          overallAssessment: 'Inconclusive',
          overallConfidence: 0,
          summary: 'Analysis in progress...',
          limitations: 'Pending completion of modality analyzers.',
          recommendations: [],
        });

        // Record created ID so failures update the record rather than leaving it stuck
        res.locals.createdInvestigationId = investigation.id;

        void logUserActivity({
          userId: dbUser.id,
          investigationId: investigation.id,
          actionType: 'investigation_created',
          description: `Opened investigation ${investigation.caseCode}: "${title}" with ${uploadedFiles.length + (pastedText ? 1 : 0)} evidence item(s).`,
        });

        const storedEvidenceInputs: Array<{
          id: number;
          modality: EvidenceModality;
          filename: string;
          classification: any;
          confidence: number;
          technicalSummary: string;
          extractedText?: string | null;
          metadataJson: Record<string, unknown>;
        }> = [];

        // Process uploaded files (and optional pasted text) concurrently while preserving deterministic order
        const filePromises = uploadedFiles.map(async (file, idx) => {
          const ext = path.extname(file.originalname).toLowerCase();
          const modality = ALLOWED_EXTENSIONS[ext];
          const sha256Hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
          const safeFilename = `${sha256Hash.slice(0, 16)}-${crypto.randomUUID().slice(0, 8)}${ext}`;
          const diskPath = path.join(EVIDENCE_DIR, safeFilename);
          await fs.promises.writeFile(diskPath, file.buffer);
          const storagePath = `/uploads/evidence/${safeFilename}`;

          const clientMeta =
            clientMetadataList.find((m) => m.filename === file.originalname) ??
            clientMetadataList[idx] ??
            {};

          if (modality === 'image') {
            const imgRes = await analyzeImageEvidence({
              buffer: file.buffer,
              filename: file.originalname,
              mimeType: file.mimetype,
              sha256Hash,
              elaDir: ELA_DIR,
              caseDescription: description,
            });
            return insertEvidenceItemWithFindings({
              investigationId: investigation.id,
              modality: 'image',
              filename: file.originalname,
              mimeType: file.mimetype,
              fileSize: file.size,
              sha256Hash,
              storagePath,
              elaPath: imgRes.elaUrl,
              metadataJson: imgRes.metadata,
              extractedText: null,
              classification: imgRes.classification,
              confidence: imgRes.confidence,
              technicalSummary: imgRes.technicalSummary,
              findings: imgRes.findings,
            });
          }
          if (modality === 'video') {
            const vidRes = await analyzeVideoEvidence({
              buffer: file.buffer,
              filename: file.originalname,
              mimeType: file.mimetype,
              durationSec: clientMeta.durationSec,
              width: clientMeta.width,
              height: clientMeta.height,
              keyframes: clientMeta.keyframes,
              caseDescription: description,
            });
            return insertEvidenceItemWithFindings({
              investigationId: investigation.id,
              modality: 'video',
              filename: file.originalname,
              mimeType: file.mimetype,
              fileSize: file.size,
              sha256Hash,
              storagePath,
              elaPath: null,
              metadataJson: vidRes.metadata,
              extractedText: null,
              classification: vidRes.classification,
              confidence: vidRes.confidence,
              technicalSummary: vidRes.technicalSummary,
              findings: vidRes.findings,
            });
          }
          if (modality === 'audio') {
            const audRes = await analyzeAudioEvidence({
              buffer: file.buffer,
              filename: file.originalname,
              mimeType: file.mimetype,
              acousticFeatures: clientMeta.acousticFeatures,
              caseDescription: description,
            });
            return insertEvidenceItemWithFindings({
              investigationId: investigation.id,
              modality: 'audio',
              filename: file.originalname,
              mimeType: file.mimetype,
              fileSize: file.size,
              sha256Hash,
              storagePath,
              elaPath: null,
              metadataJson: audRes.metadata,
              extractedText: audRes.transcript || null,
              classification: audRes.classification,
              confidence: audRes.confidence,
              technicalSummary: audRes.technicalSummary,
              findings: audRes.findings,
            });
          }
          const txtRes = await analyzeTextEvidence({
            buffer: file.buffer,
            filename: file.originalname,
            mimeType: file.mimetype,
            caseDescription: description,
          });
          return insertEvidenceItemWithFindings({
            investigationId: investigation.id,
            modality: 'text',
            filename: file.originalname,
            mimeType: file.mimetype,
            fileSize: file.size,
            sha256Hash,
            storagePath,
            elaPath: null,
            metadataJson: txtRes.metadata,
            extractedText: txtRes.extractedText,
            classification: txtRes.classification,
            confidence: txtRes.confidence,
            technicalSummary: txtRes.technicalSummary,
            findings: txtRes.findings,
          });
        });

        const pastedTextPromise = pastedText
          ? (async () => {
              const textBuffer = Buffer.from(pastedText, 'utf8');
              const sha256Hash = crypto.createHash('sha256').update(textBuffer).digest('hex');
              const safeFilename = `${sha256Hash.slice(0, 16)}-${crypto.randomUUID().slice(0, 8)}.txt`;
              await fs.promises.writeFile(path.join(EVIDENCE_DIR, safeFilename), textBuffer);
              const txtRes = await analyzeTextEvidence({
                buffer: textBuffer,
                filename: pastedTextTitle,
                mimeType: 'text/plain',
                caseDescription: description,
              });
              return insertEvidenceItemWithFindings({
                investigationId: investigation.id,
                modality: 'text',
                filename: pastedTextTitle,
                mimeType: 'text/plain',
                fileSize: textBuffer.length,
                sha256Hash,
                storagePath: `/uploads/evidence/${safeFilename}`,
                elaPath: null,
                metadataJson: { ...txtRes.metadata, source: 'direct_text_input' },
                extractedText: txtRes.extractedText,
                classification: txtRes.classification,
                confidence: txtRes.confidence,
                technicalSummary: txtRes.technicalSummary,
                findings: txtRes.findings,
              });
            })()
          : null;

        const [fileResults, pastedResult] = await Promise.all([
          Promise.all(filePromises),
          pastedTextPromise,
        ]);

        storedEvidenceInputs.push(...fileResults);
        if (pastedResult) {
          storedEvidenceInputs.push(pastedResult);
        }

        // Run Cross-Modal Correlation across all processed evidence items
        const synthesis = await correlateInvestigationEvidence({
          title,
          description,
          items: storedEvidenceInputs,
        });

        await replaceCrossModalCorrelations(investigation.id, synthesis.correlations);
        await updateInvestigationSynthesis(investigation.id, {
          overallAssessment: synthesis.overallAssessment,
          overallConfidence: synthesis.overallConfidence,
          summary: synthesis.summary,
          limitations: synthesis.limitations,
          recommendations: synthesis.recommendations,
        });

        void logUserActivity({
          userId: dbUser.id,
          investigationId: investigation.id,
          actionType: 'analysis_completed',
          description: `Completed forensic pipeline for ${investigation.caseCode} — Assessment: ${synthesis.overallAssessment}.`,
        });

        const fullInvestigation = await getInvestigationDetail(dbUser.id, investigation.id);
        res.status(201).json({ investigation: fullInvestigation });
      } catch (error: any) {
        console.error('Error in /api/investigations/analyze:', error);
        const failedId = res.locals.createdInvestigationId as number | undefined;
        if (failedId) {
          await updateInvestigationSynthesis(failedId, {
            overallAssessment: 'Analysis Unavailable',
            overallConfidence: 0,
            summary: `Analysis stopped before completion: ${error?.message || 'Unexpected server error.'}`,
            limitations: 'Check could not complete; retry with the original file.',
            recommendations: ['Re-upload the file or retry the check.'],
          }).catch(() => {});
        }
        res.status(500).json({ error: error.message || 'Forensic analysis pipeline failed.' });
      }
    }
  );

  // Ensure API errors always return JSON rather than HTML or dropped sockets
  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled /api route error:', err);
    if (!res.headersSent) {
      res.status(err?.status || 500).json({ error: err?.message || 'Unexpected API error.' });
    }
  });

  // Vite middleware in dev / static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`TruthLens Forensics server listening on http://0.0.0.0:${PORT}`);
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 290_000;
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in TruthLens server:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in TruthLens server:', err);
});

startServer().catch((err) => {
  console.error('Failed to start TruthLens server:', err);
  process.exit(1);
});
