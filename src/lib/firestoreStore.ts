import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  ActivityLog,
  CrossModalCorrelation,
  DashboardData,
  EvidenceItem,
  EvidenceModality,
  ForensicClassification,
  ForensicFinding,
  InvestigationDetail,
  InvestigationSummary,
  UserProfile,
} from '../types/forensics';

const VALID_CLASSIFICATIONS = new Set<ForensicClassification>([
  'Suspicious',
  'No Significant Indicators Detected',
  'Inconclusive',
  'Analysis Unavailable',
]);

const VALID_MODALITIES = new Set<EvidenceModality>(['image', 'video', 'audio', 'text']);

let idCounter = 0;

function nextNumericId(): number {
  idCounter = (idCounter + 1) % 1000;
  return (Date.now() % 10_000_000_000) * 1000 + idCounter;
}

function toClassification(val: unknown): ForensicClassification {
  return typeof val === 'string' && VALID_CLASSIFICATIONS.has(val as ForensicClassification)
    ? (val as ForensicClassification)
    : 'Inconclusive';
}

function toModality(val: unknown): EvidenceModality {
  return typeof val === 'string' && VALID_MODALITIES.has(val as EvidenceModality)
    ? (val as EvidenceModality)
    : 'text';
}

function toInt(val: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const num = typeof val === 'number' && Number.isFinite(val) ? Math.round(val) : min;
  return Math.max(min, Math.min(max, num));
}

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val : val == null ? fallback : String(val);
  return s.slice(0, maxLen);
}

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (val && typeof val === 'object' && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string' && val) {
    return val;
  }
  return new Date().toISOString();
}

function sanitizeNestedValue(value: unknown, depth = 0): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    return value.slice(0, 8000);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (depth >= 6) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeNestedValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      if (count >= 90) break;
      out[k.slice(0, 120)] = sanitizeNestedValue(v, depth + 1);
      count++;
    }
    return out;
  }
  return String(value).slice(0, 1000);
}

function sanitizeMetadataMap(meta: unknown): Record<string, unknown> {
  const sanitized = sanitizeNestedValue(meta, 0);
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return {};
}

export async function getUserProfileFromFirestore(uid: string): Promise<UserProfile | null> {
  const userPath = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      id: 1,
      uid: clampStr(data.uid, 128, uid),
      email: clampStr(data.email, 320),
      displayName: typeof data.displayName === 'string' ? data.displayName : null,
      photoUrl: typeof data.photoUrl === 'string' ? data.photoUrl : null,
      analystOrganization: clampStr(data.analystOrganization, 120, 'Independent Forensic Unit') || 'Independent Forensic Unit',
      defaultConfidenceThreshold: toInt(data.defaultConfidenceThreshold ?? 65, 20, 95),
      includeLimitationsInExports:
        typeof data.includeLimitationsInExports === 'boolean'
          ? data.includeLimitationsInExports
          : true,
      createdAt: toIsoString(data.createdAt),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }
}

export async function updateUserSettingsInFirestore(
  uid: string,
  updates: {
    displayName?: string;
    analystOrganization?: string;
    defaultConfidenceThreshold?: number;
    includeLimitationsInExports?: boolean;
  }
): Promise<UserProfile> {
  const userPath = `users/${uid}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (typeof updates.displayName === 'string') {
    payload.displayName = updates.displayName.trim().slice(0, 120);
  }
  if (typeof updates.analystOrganization === 'string') {
    payload.analystOrganization =
      (updates.analystOrganization.trim() || 'Independent Forensic Unit').slice(0, 120);
  }
  if (typeof updates.defaultConfidenceThreshold === 'number') {
    payload.defaultConfidenceThreshold = toInt(updates.defaultConfidenceThreshold, 20, 95);
  }
  if (typeof updates.includeLimitationsInExports === 'boolean') {
    payload.includeLimitationsInExports = updates.includeLimitationsInExports;
  }

  try {
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }

  await logActivityInFirestore(uid, {
    actionType: 'settings_updated',
    description: 'Updated forensic workspace preferences and reporting thresholds.',
  });

  const updated = await getUserProfileFromFirestore(uid);
  if (!updated) {
    throw new Error('User profile not found after settings update.');
  }
  return updated;
}

export async function logActivityInFirestore(
  uid: string,
  params: {
    investigationId?: number | null;
    actionType: string;
    description: string;
  }
): Promise<void> {
  const numericId = nextNumericId();
  const docId = `log-${numericId}`;
  const path = `users/${uid}/activityLogs/${docId}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid, 'activityLogs', docId), {
      ownerUid: uid,
      numericId,
      investigationId:
        typeof params.investigationId === 'number' && params.investigationId > 0
          ? toInt(params.investigationId, 1)
          : null,
      actionType: clampStr(params.actionType, 80, 'activity') || 'activity',
      description: clampStr(params.description, 1000, 'Workspace activity recorded.') || 'Workspace activity recorded.',
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveInvestigationToFirestore(
  uid: string,
  inv: InvestigationDetail
): Promise<void> {
  const invNumericId = toInt(inv.id, 1);
  const invDocId = `inv-${invNumericId}`;
  const invPath = `users/${uid}/investigations/${invDocId}`;

  const modalities = Array.from(
    new Set(inv.evidenceItems.map((e) => toModality(e.modality)))
  ).slice(0, 4);

  const recommendations = (Array.isArray(inv.recommendations) ? inv.recommendations : [])
    .slice(0, 12)
    .map((r) => clampStr(r, 500))
    .filter(Boolean);

  try {
    const batch = writeBatch(db);

    batch.set(doc(db, 'users', uid, 'investigations', invDocId), {
      ownerUid: uid,
      numericId: invNumericId,
      caseCode: clampStr(inv.caseCode, 40, `TL-${new Date().getFullYear()}-0000`),
      title: clampStr(inv.title, 200, 'Untitled Investigation') || 'Untitled Investigation',
      description: clampStr(inv.description, 4000, ''),
      overallAssessment: toClassification(inv.overallAssessment),
      overallConfidence: toInt(inv.overallConfidence, 0, 100),
      summary: clampStr(inv.summary, 4000, ''),
      limitations: clampStr(inv.limitations, 2000, ''),
      recommendations,
      evidenceCount: toInt(inv.evidenceItems.length, 0, 24),
      modalities,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const item of inv.evidenceItems.slice(0, 24)) {
      const evNumericId = toInt(item.id, 1);
      const evDocId = `ev-${evNumericId}`;
      const findings = (Array.isArray(item.findings) ? item.findings : [])
        .slice(0, 25)
        .map((f) => sanitizeNestedValue(f, 0) as ForensicFinding);

      batch.set(doc(db, 'users', uid, 'evidenceItems', evDocId), {
        ownerUid: uid,
        numericId: evNumericId,
        investigationId: invNumericId,
        investigationDocId: invDocId,
        modality: toModality(item.modality),
        filename: clampStr(item.filename, 260, 'evidence-file') || 'evidence-file',
        mimeType: clampStr(item.mimeType, 120, 'application/octet-stream') || 'application/octet-stream',
        fileSize: toInt(item.fileSize, 0),
        sha256Hash: clampStr(item.sha256Hash, 128, 'unavailable') || 'unavailable',
        storagePath: clampStr(item.storagePath, 512, '/uploads') || '/uploads',
        elaPath: item.elaPath ? clampStr(item.elaPath, 512) : null,
        metadataJson: sanitizeMetadataMap(item.metadataJson),
        extractedText:
          typeof item.extractedText === 'string' && item.extractedText.length > 0
            ? clampStr(item.extractedText, 20000)
            : null,
        classification: toClassification(item.classification),
        confidence: toInt(item.confidence, 0, 100),
        technicalSummary: clampStr(item.technicalSummary, 2000, ''),
        findings,
        createdAt: serverTimestamp(),
      });
    }

    for (const corr of inv.correlations.slice(0, 20)) {
      const corrNumericId = toInt(corr.id, 1);
      const corrDocId = `corr-${corrNumericId}`;
      const sourceIds = (Array.isArray(corr.sourceEvidenceIds) ? corr.sourceEvidenceIds : [])
        .slice(0, 20)
        .map((sid) => toInt(sid, 1));

      batch.set(doc(db, 'users', uid, 'correlations', corrDocId), {
        ownerUid: uid,
        numericId: corrNumericId,
        investigationId: invNumericId,
        investigationDocId: invDocId,
        pairType: clampStr(corr.pairType, 80, 'cross_source_contradiction') || 'cross_source_contradiction',
        title: clampStr(corr.title, 240, 'Cross-Modal Comparison') || 'Cross-Modal Comparison',
        sourceEvidenceIds: sourceIds,
        findingSummary: clampStr(corr.findingSummary, 2500, ''),
        consistencyStatus: toClassification(corr.consistencyStatus),
        confidence: toInt(corr.confidence, 0, 100),
        limitations: clampStr(corr.limitations, 1000, ''),
        createdAt: serverTimestamp(),
      });
    }

    const logNumericId = nextNumericId();
    batch.set(doc(db, 'users', uid, 'activityLogs', `log-${logNumericId}`), {
      ownerUid: uid,
      numericId: logNumericId,
      investigationId: invNumericId,
      actionType: 'analysis_completed',
      description: clampStr(
        `Saved ${inv.caseCode} ("${inv.title}") with ${inv.evidenceItems.length} evidence item(s) — ${inv.overallAssessment}.`,
        1000
      ),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, invPath);
  }
}

export async function updateInvestigationCorrelationsInFirestore(
  uid: string,
  inv: InvestigationDetail
): Promise<void> {
  const invNumericId = toInt(inv.id, 1);
  const invDocId = `inv-${invNumericId}`;
  const invPath = `users/${uid}/investigations/${invDocId}`;

  const recommendations = (Array.isArray(inv.recommendations) ? inv.recommendations : [])
    .slice(0, 12)
    .map((r) => clampStr(r, 500))
    .filter(Boolean);

  let existingCorrSnap;
  try {
    existingCorrSnap = await getDocs(
      query(
        collection(db, 'users', uid, 'correlations'),
        where('ownerUid', '==', uid),
        where('investigationId', '==', invNumericId)
      )
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `users/${uid}/correlations`);
  }

  try {
    const batch = writeBatch(db);

    for (const oldDoc of existingCorrSnap.docs) {
      batch.delete(oldDoc.ref);
    }

    batch.update(doc(db, 'users', uid, 'investigations', invDocId), {
      overallAssessment: toClassification(inv.overallAssessment),
      overallConfidence: toInt(inv.overallConfidence, 0, 100),
      summary: clampStr(inv.summary, 4000, ''),
      limitations: clampStr(inv.limitations, 2000, ''),
      recommendations,
      updatedAt: serverTimestamp(),
    });

    for (const corr of inv.correlations.slice(0, 20)) {
      const corrNumericId = toInt(corr.id, 1);
      const corrDocId = `corr-${corrNumericId}`;
      const sourceIds = (Array.isArray(corr.sourceEvidenceIds) ? corr.sourceEvidenceIds : [])
        .slice(0, 20)
        .map((sid) => toInt(sid, 1));

      batch.set(doc(db, 'users', uid, 'correlations', corrDocId), {
        ownerUid: uid,
        numericId: corrNumericId,
        investigationId: invNumericId,
        investigationDocId: invDocId,
        pairType: clampStr(corr.pairType, 80, 'cross_source_contradiction') || 'cross_source_contradiction',
        title: clampStr(corr.title, 240, 'Cross-Modal Comparison') || 'Cross-Modal Comparison',
        sourceEvidenceIds: sourceIds,
        findingSummary: clampStr(corr.findingSummary, 2500, ''),
        consistencyStatus: toClassification(corr.consistencyStatus),
        confidence: toInt(corr.confidence, 0, 100),
        limitations: clampStr(corr.limitations, 1000, ''),
        createdAt: serverTimestamp(),
      });
    }

    const logNumericId = nextNumericId();
    batch.set(doc(db, 'users', uid, 'activityLogs', `log-${logNumericId}`), {
      ownerUid: uid,
      numericId: logNumericId,
      investigationId: invNumericId,
      actionType: 'analysis_completed',
      description: clampStr(`Re-ran cross-modal correlation on ${inv.caseCode}.`, 1000),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, invPath);
  }
}

export async function getDashboardDataFromFirestore(uid: string): Promise<DashboardData> {
  const invPath = `users/${uid}/investigations`;
  const evPath = `users/${uid}/evidenceItems`;
  const logPath = `users/${uid}/activityLogs`;

  let invSnap;
  let evSnap;
  let logSnap;

  try {
    [invSnap, evSnap, logSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', uid, 'investigations'), where('ownerUid', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'evidenceItems'), where('ownerUid', '==', uid))),
      getDocs(query(collection(db, 'users', uid, 'activityLogs'), where('ownerUid', '==', uid))),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, invPath);
  }

  const investigations: InvestigationSummary[] = invSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: toInt(data.numericId, 1),
        caseCode: clampStr(data.caseCode, 40),
        userId: 1,
        title: clampStr(data.title, 200),
        description: clampStr(data.description, 4000),
        overallAssessment: toClassification(data.overallAssessment),
        overallConfidence: toInt(data.overallConfidence, 0, 100),
        summary: clampStr(data.summary, 4000),
        limitations: clampStr(data.limitations, 2000),
        recommendations: Array.isArray(data.recommendations)
          ? data.recommendations.map((r: unknown) => String(r))
          : [],
        createdAt: toIsoString(data.createdAt),
        updatedAt: toIsoString(data.updatedAt),
        evidenceCount: toInt(data.evidenceCount, 0),
        modalities: Array.isArray(data.modalities)
          ? data.modalities.map((m: unknown) => toModality(m))
          : [],
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const evidenceItems: EvidenceItem[] = evSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: toInt(data.numericId, 1),
        investigationId: toInt(data.investigationId, 1),
        modality: toModality(data.modality),
        filename: clampStr(data.filename, 260),
        mimeType: clampStr(data.mimeType, 120),
        fileSize: toInt(data.fileSize, 0),
        sha256Hash: clampStr(data.sha256Hash, 128),
        storagePath: clampStr(data.storagePath, 512),
        elaPath: typeof data.elaPath === 'string' ? data.elaPath : null,
        metadataJson:
          data.metadataJson && typeof data.metadataJson === 'object'
            ? (data.metadataJson as Record<string, unknown>)
            : {},
        extractedText: typeof data.extractedText === 'string' ? data.extractedText : null,
        classification: toClassification(data.classification),
        confidence: toInt(data.confidence, 0, 100),
        technicalSummary: clampStr(data.technicalSummary, 2000),
        createdAt: toIsoString(data.createdAt),
        findings: Array.isArray(data.findings) ? (data.findings as ForensicFinding[]) : [],
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const recentActivity: ActivityLog[] = logSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: toInt(data.numericId, 1),
        userId: 1,
        investigationId:
          typeof data.investigationId === 'number' ? toInt(data.investigationId, 1) : null,
        actionType: clampStr(data.actionType, 80),
        description: clampStr(data.description, 1000),
        createdAt: toIsoString(data.createdAt),
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 12);

  // Void unused path strings lint check
  void evPath;
  void logPath;

  const totalFiles = evidenceItems.length;
  const suspiciousFiles = evidenceItems.filter((i) => i.classification === 'Suspicious').length;
  const verifiedLowRiskFiles = evidenceItems.filter(
    (i) => i.classification === 'No Significant Indicators Detected'
  ).length;

  return {
    stats: {
      totalFiles,
      suspiciousFiles,
      verifiedLowRiskFiles,
      totalInvestigations: investigations.length,
      modalityCounts: {
        image: evidenceItems.filter((i) => i.modality === 'image').length,
        video: evidenceItems.filter((i) => i.modality === 'video').length,
        audio: evidenceItems.filter((i) => i.modality === 'audio').length,
        text: evidenceItems.filter((i) => i.modality === 'text').length,
      },
      classificationCounts: {
        Suspicious: suspiciousFiles,
        'No Significant Indicators Detected': verifiedLowRiskFiles,
        Inconclusive: evidenceItems.filter((i) => i.classification === 'Inconclusive').length,
        'Analysis Unavailable': evidenceItems.filter(
          (i) => i.classification === 'Analysis Unavailable'
        ).length,
      },
    },
    investigations,
    recentActivity,
    evidenceItems,
  };
}

export async function getInvestigationDetailFromFirestore(
  uid: string,
  investigationId: number
): Promise<InvestigationDetail | null> {
  const invNumericId = toInt(investigationId, 1);
  const invDocId = `inv-${invNumericId}`;
  const invPath = `users/${uid}/investigations/${invDocId}`;

  let invSnap;
  try {
    invSnap = await getDoc(doc(db, 'users', uid, 'investigations', invDocId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, invPath);
  }

  if (!invSnap.exists()) return null;

  let evSnap;
  let corrSnap;
  try {
    [evSnap, corrSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'users', uid, 'evidenceItems'),
          where('ownerUid', '==', uid),
          where('investigationId', '==', invNumericId)
        )
      ),
      getDocs(
        query(
          collection(db, 'users', uid, 'correlations'),
          where('ownerUid', '==', uid),
          where('investigationId', '==', invNumericId)
        )
      ),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `users/${uid}/evidenceItems`);
  }

  const data = invSnap.data();

  const evidenceItems = evSnap.docs
    .map((d) => {
      const item = d.data();
      return {
        id: toInt(item.numericId, 1),
        investigationId: toInt(item.investigationId, 1),
        modality: toModality(item.modality),
        filename: clampStr(item.filename, 260),
        mimeType: clampStr(item.mimeType, 120),
        fileSize: toInt(item.fileSize, 0),
        sha256Hash: clampStr(item.sha256Hash, 128),
        storagePath: clampStr(item.storagePath, 512),
        elaPath: typeof item.elaPath === 'string' ? item.elaPath : null,
        metadataJson:
          item.metadataJson && typeof item.metadataJson === 'object'
            ? (item.metadataJson as Record<string, unknown>)
            : {},
        extractedText: typeof item.extractedText === 'string' ? item.extractedText : null,
        classification: toClassification(item.classification),
        confidence: toInt(item.confidence, 0, 100),
        technicalSummary: clampStr(item.technicalSummary, 2000),
        createdAt: toIsoString(item.createdAt),
        findings: Array.isArray(item.findings) ? (item.findings as ForensicFinding[]) : [],
      };
    })
    .sort((a, b) => a.id - b.id);

  const correlations: CrossModalCorrelation[] = corrSnap.docs
    .map((d) => {
      const c = d.data();
      return {
        id: toInt(c.numericId, 1),
        investigationId: toInt(c.investigationId, 1),
        pairType: clampStr(c.pairType, 80),
        title: clampStr(c.title, 240),
        sourceEvidenceIds: Array.isArray(c.sourceEvidenceIds)
          ? c.sourceEvidenceIds.map((sid: unknown) => toInt(sid, 1))
          : [],
        findingSummary: clampStr(c.findingSummary, 2500),
        consistencyStatus: toClassification(c.consistencyStatus),
        confidence: toInt(c.confidence, 0, 100),
        limitations: clampStr(c.limitations, 1000),
        createdAt: toIsoString(c.createdAt),
      };
    })
    .sort((a, b) => a.id - b.id);

  return {
    id: invNumericId,
    caseCode: clampStr(data.caseCode, 40),
    userId: 1,
    title: clampStr(data.title, 200),
    description: clampStr(data.description, 4000),
    overallAssessment: toClassification(data.overallAssessment),
    overallConfidence: toInt(data.overallConfidence, 0, 100),
    summary: clampStr(data.summary, 4000),
    limitations: clampStr(data.limitations, 2000),
    recommendations: Array.isArray(data.recommendations)
      ? data.recommendations.map((r: unknown) => String(r))
      : [],
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
    evidenceItems,
    correlations,
  };
}

export async function deleteInvestigationFromFirestore(
  uid: string,
  investigationId: number
): Promise<void> {
  const invNumericId = toInt(investigationId, 1);
  const invDocId = `inv-${invNumericId}`;
  const invPath = `users/${uid}/investigations/${invDocId}`;

  let evSnap;
  let corrSnap;
  try {
    [evSnap, corrSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'users', uid, 'evidenceItems'),
          where('ownerUid', '==', uid),
          where('investigationId', '==', invNumericId)
        )
      ),
      getDocs(
        query(
          collection(db, 'users', uid, 'correlations'),
          where('ownerUid', '==', uid),
          where('investigationId', '==', invNumericId)
        )
      ),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `users/${uid}/evidenceItems`);
  }

  try {
    const batch = writeBatch(db);
    for (const d of evSnap.docs) {
      batch.delete(d.ref);
    }
    for (const d of corrSnap.docs) {
      batch.delete(d.ref);
    }
    batch.delete(doc(db, 'users', uid, 'investigations', invDocId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, invPath);
  }
}
