export type ForensicClassification =
  | 'Suspicious'
  | 'No Significant Indicators Detected'
  | 'Inconclusive'
  | 'Analysis Unavailable';

export type EvidenceModality = 'image' | 'video' | 'audio' | 'text';

export interface FindingRegion {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  startSec?: number;
  endSec?: number;
  frameIndex?: number;
  excerpt?: string;
}

export interface UserProfile {
  id: number;
  uid: string;
  email: string;
  displayName: string | null;
  photoUrl: string | null;
  defaultConfidenceThreshold: number;
  includeLimitationsInExports: boolean;
  analystOrganization: string;
  createdAt: string;
}

export interface ForensicFinding {
  id: number;
  evidenceItemId: number;
  whatDetected: string;
  whereDetected: string;
  whyFlagged: string;
  analysisMethod: string;
  confidence: number;
  limitations: string;
  classification: ForensicClassification;
  regionJson: FindingRegion | null;
  createdAt: string;
}

export interface EvidenceItem {
  id: number;
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
  createdAt: string;
  findings?: ForensicFinding[];
}

export interface CrossModalCorrelation {
  id: number;
  investigationId: number;
  pairType: string;
  title: string;
  sourceEvidenceIds: number[];
  findingSummary: string;
  consistencyStatus: ForensicClassification;
  confidence: number;
  limitations: string;
  createdAt: string;
}

export interface InvestigationSummary {
  id: number;
  caseCode: string;
  userId: number;
  title: string;
  description: string;
  overallAssessment: ForensicClassification;
  overallConfidence: number;
  summary: string;
  limitations: string;
  recommendations: string[];
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
  modalities: EvidenceModality[];
}

export interface InvestigationDetail extends Omit<InvestigationSummary, 'evidenceCount' | 'modalities'> {
  evidenceItems: Array<EvidenceItem & { findings: ForensicFinding[] }>;
  correlations: CrossModalCorrelation[];
}

export interface ActivityLog {
  id: number;
  userId: number;
  investigationId: number | null;
  actionType: string;
  description: string;
  createdAt: string;
}

export interface DashboardData {
  stats: {
    totalFiles: number;
    suspiciousFiles: number;
    verifiedLowRiskFiles: number;
    totalInvestigations: number;
    modalityCounts: Record<EvidenceModality, number>;
    classificationCounts: Record<ForensicClassification, number>;
  };
  investigations: InvestigationSummary[];
  recentActivity: ActivityLog[];
  evidenceItems: EvidenceItem[];
}

export type WorkspaceTab =
  | 'dashboard'
  | 'new-investigation'
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'cross-modal'
  | 'history'
  | 'reports'
  | 'settings';
