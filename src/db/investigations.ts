import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, isDatabaseConfigured } from './index.ts';
import { getMemoryDb } from './memoryStore.ts';
import {
  activityLogs,
  crossModalCorrelations,
  evidenceItems,
  forensicFindings,
  investigations,
  EvidenceModality,
  ForensicClassification,
  FindingRegion,
} from './schema.ts';

export interface CreateInvestigationInput {
  userId: number;
  title: string;
  description: string;
  overallAssessment: ForensicClassification;
  overallConfidence: number;
  summary: string;
  limitations: string;
  recommendations: string[];
}

export async function generateCaseCode(): Promise<string> {
  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  const year = new Date().getFullYear();
  return `TL-${year}-${randomDigits}`;
}

export async function createInvestigationRecord(input: CreateInvestigationInput) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    const now = new Date();
    const created = {
      id: mem.nextInvestigationId++,
      caseCode: await generateCaseCode(),
      userId: input.userId,
      title: input.title,
      description: input.description,
      overallAssessment: input.overallAssessment,
      overallConfidence: input.overallConfidence,
      summary: input.summary,
      limitations: input.limitations,
      recommendations: input.recommendations,
      createdAt: now,
      updatedAt: now,
    };
    mem.investigations.push(created);
    return created;
  }

  try {
    const caseCode = await generateCaseCode();
    const [created] = await db
      .insert(investigations)
      .values({
        caseCode,
        userId: input.userId,
        title: input.title,
        description: input.description,
        overallAssessment: input.overallAssessment,
        overallConfidence: input.overallConfidence,
        summary: input.summary,
        limitations: input.limitations,
        recommendations: input.recommendations,
      })
      .returning();
    return created;
  } catch (error) {
    console.error('Database error in createInvestigationRecord:', error);
    throw new Error('Failed to create investigation record.', { cause: error });
  }
}

export async function updateInvestigationSynthesis(
  investigationId: number,
  updates: {
    overallAssessment: ForensicClassification;
    overallConfidence: number;
    summary: string;
    limitations: string;
    recommendations: string[];
  }
) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    const inv = mem.investigations.find((i) => i.id === investigationId);
    if (!inv) return undefined;
    Object.assign(inv, updates, { updatedAt: new Date() });
    return inv;
  }

  try {
    const [updated] = await db
      .update(investigations)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(investigations.id, investigationId))
      .returning();
    return updated;
  } catch (error) {
    console.error('Database error in updateInvestigationSynthesis:', error);
    throw new Error('Failed to update investigation synthesis.', { cause: error });
  }
}

export async function insertEvidenceItemWithFindings(params: {
  investigationId: number;
  modality: EvidenceModality;
  filename: string;
  mimeType: string;
  fileSize: number;
  sha256Hash: string;
  storagePath: string;
  elaPath: string | null;
  metadataJson: Record<string, unknown>;
  extractedText: string | null;
  classification: ForensicClassification;
  confidence: number;
  technicalSummary: string;
  findings: Array<{
    whatDetected: string;
    whereDetected: string;
    whyFlagged: string;
    analysisMethod: string;
    confidence: number;
    limitations: string;
    classification: ForensicClassification;
    regionJson: FindingRegion | null;
  }>;
}) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    const now = new Date();
    const item = {
      id: mem.nextEvidenceId++,
      investigationId: params.investigationId,
      modality: params.modality,
      filename: params.filename,
      mimeType: params.mimeType,
      fileSize: params.fileSize,
      sha256Hash: params.sha256Hash,
      storagePath: params.storagePath,
      elaPath: params.elaPath,
      metadataJson: params.metadataJson,
      extractedText: params.extractedText,
      classification: params.classification,
      confidence: params.confidence,
      technicalSummary: params.technicalSummary,
      createdAt: now,
    };
    mem.evidenceItems.push(item);

    for (const f of params.findings) {
      mem.forensicFindings.push({
        id: mem.nextFindingId++,
        evidenceItemId: item.id,
        whatDetected: f.whatDetected,
        whereDetected: f.whereDetected,
        whyFlagged: f.whyFlagged,
        analysisMethod: f.analysisMethod,
        confidence: f.confidence,
        limitations: f.limitations,
        classification: f.classification,
        regionJson: f.regionJson,
        createdAt: now,
      });
    }

    return item;
  }

  try {
    const [item] = await db
      .insert(evidenceItems)
      .values({
        investigationId: params.investigationId,
        modality: params.modality,
        filename: params.filename,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        sha256Hash: params.sha256Hash,
        storagePath: params.storagePath,
        elaPath: params.elaPath,
        metadataJson: params.metadataJson,
        extractedText: params.extractedText,
        classification: params.classification,
        confidence: params.confidence,
        technicalSummary: params.technicalSummary,
      })
      .returning();

    if (params.findings.length > 0) {
      await db.insert(forensicFindings).values(
        params.findings.map((f) => ({
          evidenceItemId: item.id,
          whatDetected: f.whatDetected,
          whereDetected: f.whereDetected,
          whyFlagged: f.whyFlagged,
          analysisMethod: f.analysisMethod,
          confidence: f.confidence,
          limitations: f.limitations,
          classification: f.classification,
          regionJson: f.regionJson,
        }))
      );
    }

    return item;
  } catch (error) {
    console.error('Database error in insertEvidenceItemWithFindings:', error);
    throw new Error('Failed to store evidence item.', { cause: error });
  }
}

export async function replaceCrossModalCorrelations(
  investigationId: number,
  correlations: Array<{
    pairType: string;
    title: string;
    sourceEvidenceIds: number[];
    findingSummary: string;
    consistencyStatus: ForensicClassification;
    confidence: number;
    limitations: string;
  }>
) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    mem.crossModalCorrelations = mem.crossModalCorrelations.filter(
      (c) => c.investigationId !== investigationId
    );
    const now = new Date();
    const inserted = correlations.map((c) => ({
      id: mem.nextCorrelationId++,
      investigationId,
      pairType: c.pairType,
      title: c.title,
      sourceEvidenceIds: c.sourceEvidenceIds,
      findingSummary: c.findingSummary,
      consistencyStatus: c.consistencyStatus,
      confidence: c.confidence,
      limitations: c.limitations,
      createdAt: now,
    }));
    mem.crossModalCorrelations.push(...inserted);
    return inserted;
  }

  try {
    await db
      .delete(crossModalCorrelations)
      .where(eq(crossModalCorrelations.investigationId, investigationId));

    if (correlations.length === 0) return [];

    return await db
      .insert(crossModalCorrelations)
      .values(
        correlations.map((c) => ({
          investigationId,
          pairType: c.pairType,
          title: c.title,
          sourceEvidenceIds: c.sourceEvidenceIds,
          findingSummary: c.findingSummary,
          consistencyStatus: c.consistencyStatus,
          confidence: c.confidence,
          limitations: c.limitations,
        }))
      )
      .returning();
  } catch (error) {
    console.error('Database error in replaceCrossModalCorrelations:', error);
    throw new Error('Failed to store cross-modal correlations.', { cause: error });
  }
}

export async function logUserActivity(params: {
  userId: number;
  investigationId?: number | null;
  actionType: string;
  description: string;
}) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    mem.activityLogs.push({
      id: mem.nextActivityId++,
      userId: params.userId,
      investigationId: params.investigationId ?? null,
      actionType: params.actionType,
      description: params.description,
      createdAt: new Date(),
    });
    return;
  }

  try {
    await db.insert(activityLogs).values({
      userId: params.userId,
      investigationId: params.investigationId ?? null,
      actionType: params.actionType,
      description: params.description,
    });
  } catch (error) {
    console.error('Database error in logUserActivity:', error);
  }
}

export async function getUserDashboardData(userId: number) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    const userInvestigations = mem.investigations
      .filter((i) => i.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const invIds = new Set(userInvestigations.map((i) => i.id));
    const items = mem.evidenceItems
      .filter((item) => invIds.has(item.investigationId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const logs = mem.activityLogs
      .filter((l) => l.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 12);

    const totalFiles = items.length;
    const suspiciousFiles = items.filter((i) => i.classification === 'Suspicious').length;
    const verifiedLowRiskFiles = items.filter(
      (i) => i.classification === 'No Significant Indicators Detected'
    ).length;

    const modalityCounts = {
      image: items.filter((i) => i.modality === 'image').length,
      video: items.filter((i) => i.modality === 'video').length,
      audio: items.filter((i) => i.modality === 'audio').length,
      text: items.filter((i) => i.modality === 'text').length,
    };

    const classificationCounts = {
      Suspicious: suspiciousFiles,
      'No Significant Indicators Detected': verifiedLowRiskFiles,
      Inconclusive: items.filter((i) => i.classification === 'Inconclusive').length,
      'Analysis Unavailable': items.filter((i) => i.classification === 'Analysis Unavailable').length,
    };

    const evidenceByInv = new Map<number, typeof items>();
    for (const item of items) {
      const arr = evidenceByInv.get(item.investigationId) ?? [];
      arr.push(item);
      evidenceByInv.set(item.investigationId, arr);
    }

    const enrichedInvestigations = userInvestigations.map((inv) => ({
      ...inv,
      evidenceCount: (evidenceByInv.get(inv.id) ?? []).length,
      modalities: Array.from(new Set((evidenceByInv.get(inv.id) ?? []).map((e) => e.modality))),
    }));

    return {
      stats: {
        totalFiles,
        suspiciousFiles,
        verifiedLowRiskFiles,
        totalInvestigations: userInvestigations.length,
        modalityCounts,
        classificationCounts,
      },
      investigations: enrichedInvestigations,
      recentActivity: logs,
      evidenceItems: items,
    };
  }

  try {
    const userInvestigations = await db
      .select()
      .from(investigations)
      .where(eq(investigations.userId, userId))
      .orderBy(desc(investigations.createdAt));

    const investigationIds = userInvestigations.map((i) => i.id);
    const items =
      investigationIds.length > 0
        ? await db
            .select()
            .from(evidenceItems)
            .where(inArray(evidenceItems.investigationId, investigationIds))
            .orderBy(desc(evidenceItems.createdAt))
        : [];

    const logs = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(12);

    const totalFiles = items.length;
    const suspiciousFiles = items.filter((i) => i.classification === 'Suspicious').length;
    const verifiedLowRiskFiles = items.filter(
      (i) => i.classification === 'No Significant Indicators Detected'
    ).length;

    const modalityCounts = {
      image: items.filter((i) => i.modality === 'image').length,
      video: items.filter((i) => i.modality === 'video').length,
      audio: items.filter((i) => i.modality === 'audio').length,
      text: items.filter((i) => i.modality === 'text').length,
    };

    const classificationCounts = {
      Suspicious: suspiciousFiles,
      'No Significant Indicators Detected': verifiedLowRiskFiles,
      Inconclusive: items.filter((i) => i.classification === 'Inconclusive').length,
      'Analysis Unavailable': items.filter((i) => i.classification === 'Analysis Unavailable').length,
    };

    const evidenceByInv = new Map<number, typeof items>();
    for (const item of items) {
      const arr = evidenceByInv.get(item.investigationId) ?? [];
      arr.push(item);
      evidenceByInv.set(item.investigationId, arr);
    }

    const enrichedInvestigations = userInvestigations.map((inv) => ({
      ...inv,
      evidenceCount: (evidenceByInv.get(inv.id) ?? []).length,
      modalities: Array.from(new Set((evidenceByInv.get(inv.id) ?? []).map((e) => e.modality))),
    }));

    return {
      stats: {
        totalFiles,
        suspiciousFiles,
        verifiedLowRiskFiles,
        totalInvestigations: userInvestigations.length,
        modalityCounts,
        classificationCounts,
      },
      investigations: enrichedInvestigations,
      recentActivity: logs,
      evidenceItems: items,
    };
  } catch (error) {
    console.error('Database error in getUserDashboardData:', error);
    throw new Error('Failed to load forensic dashboard data.', { cause: error });
  }
}

export async function getInvestigationDetail(userId: number, investigationId: number) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    const inv = mem.investigations.find(
      (i) => i.id === investigationId && i.userId === userId
    );
    if (!inv) return null;

    const items = mem.evidenceItems
      .filter((e) => e.investigationId === inv.id)
      .sort((a, b) => a.id - b.id);

    const itemIdSet = new Set(items.map((i) => i.id));
    const findings = mem.forensicFindings
      .filter((f) => itemIdSet.has(f.evidenceItemId))
      .sort((a, b) => a.id - b.id);

    const correlations = mem.crossModalCorrelations
      .filter((c) => c.investigationId === inv.id)
      .sort((a, b) => a.id - b.id);

    const findingsByItem = new Map<number, typeof findings>();
    for (const f of findings) {
      const arr = findingsByItem.get(f.evidenceItemId) ?? [];
      arr.push(f);
      findingsByItem.set(f.evidenceItemId, arr);
    }

    return {
      ...inv,
      evidenceItems: items.map((item) => ({
        ...item,
        findings: findingsByItem.get(item.id) ?? [],
      })),
      correlations,
    };
  }

  try {
    const [inv] = await db
      .select()
      .from(investigations)
      .where(and(eq(investigations.id, investigationId), eq(investigations.userId, userId)))
      .limit(1);

    if (!inv) return null;

    const items = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.investigationId, inv.id))
      .orderBy(evidenceItems.id);

    const itemIds = items.map((i) => i.id);
    const findings =
      itemIds.length > 0
        ? await db
            .select()
            .from(forensicFindings)
            .where(inArray(forensicFindings.evidenceItemId, itemIds))
            .orderBy(forensicFindings.id)
        : [];

    const correlations = await db
      .select()
      .from(crossModalCorrelations)
      .where(eq(crossModalCorrelations.investigationId, inv.id))
      .orderBy(crossModalCorrelations.id);

    const findingsByItem = new Map<number, typeof findings>();
    for (const f of findings) {
      const arr = findingsByItem.get(f.evidenceItemId) ?? [];
      arr.push(f);
      findingsByItem.set(f.evidenceItemId, arr);
    }

    return {
      ...inv,
      evidenceItems: items.map((item) => ({
        ...item,
        findings: findingsByItem.get(item.id) ?? [],
      })),
      correlations,
    };
  } catch (error) {
    console.error('Database error in getInvestigationDetail:', error);
    throw new Error('Failed to load investigation details.', { cause: error });
  }
}

export async function deleteUserInvestigation(userId: number, investigationId: number) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    const idx = mem.investigations.findIndex(
      (i) => i.id === investigationId && i.userId === userId
    );
    if (idx === -1) return null;
    const [deleted] = mem.investigations.splice(idx, 1);
    const removedEvidenceIds = new Set(
      mem.evidenceItems
        .filter((e) => e.investigationId === deleted.id)
        .map((e) => e.id)
    );
    mem.evidenceItems = mem.evidenceItems.filter((e) => e.investigationId !== deleted.id);
    mem.forensicFindings = mem.forensicFindings.filter(
      (f) => !removedEvidenceIds.has(f.evidenceItemId)
    );
    mem.crossModalCorrelations = mem.crossModalCorrelations.filter(
      (c) => c.investigationId !== deleted.id
    );
    return deleted;
  }

  try {
    const [deleted] = await db
      .delete(investigations)
      .where(and(eq(investigations.id, investigationId), eq(investigations.userId, userId)))
      .returning();
    return deleted ?? null;
  } catch (error) {
    console.error('Database error in deleteUserInvestigation:', error);
    throw new Error('Failed to delete investigation.', { cause: error });
  }
}

export async function getUserEvidenceItemById(userId: number, evidenceId: number) {
  if (!isDatabaseConfigured) {
    const mem = getMemoryDb();
    const item = mem.evidenceItems.find((e) => e.id === evidenceId);
    if (!item) return null;
    const owner = mem.investigations.find(
      (i) => i.id === item.investigationId && i.userId === userId
    );
    return owner ? item : null;
  }

  try {
    const rows = await db
      .select({
        item: evidenceItems,
        ownerId: investigations.userId,
      })
      .from(evidenceItems)
      .innerJoin(investigations, eq(evidenceItems.investigationId, investigations.id))
      .where(and(eq(evidenceItems.id, evidenceId), eq(investigations.userId, userId)))
      .limit(1);
    return rows[0]?.item ?? null;
  } catch (error) {
    console.error('Database error in getUserEvidenceItemById:', error);
    return null;
  }
}
