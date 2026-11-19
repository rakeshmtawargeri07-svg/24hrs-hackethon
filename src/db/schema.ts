import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

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

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  photoUrl: text('photo_url'),
  defaultConfidenceThreshold: integer('default_confidence_threshold').notNull().default(65),
  includeLimitationsInExports: boolean('include_limitations_in_exports').notNull().default(true),
  analystOrganization: text('analyst_organization').notNull().default('Independent Forensic Unit'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const investigations = pgTable('investigations', {
  id: serial('id').primaryKey(),
  caseCode: text('case_code').notNull().unique(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  overallAssessment: text('overall_assessment').$type<ForensicClassification>().notNull(),
  overallConfidence: integer('overall_confidence').notNull().default(0),
  summary: text('summary').notNull(),
  limitations: text('limitations').notNull(),
  recommendations: jsonb('recommendations').$type<string[]>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const evidenceItems = pgTable('evidence_items', {
  id: serial('id').primaryKey(),
  investigationId: integer('investigation_id')
    .references(() => investigations.id, { onDelete: 'cascade' })
    .notNull(),
  modality: text('modality').$type<EvidenceModality>().notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  sha256Hash: text('sha256_hash').notNull(),
  storagePath: text('storage_path').notNull(),
  elaPath: text('ela_path'),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull(),
  extractedText: text('extracted_text'),
  classification: text('classification').$type<ForensicClassification>().notNull(),
  confidence: integer('confidence').notNull().default(0),
  technicalSummary: text('technical_summary').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const forensicFindings = pgTable('forensic_findings', {
  id: serial('id').primaryKey(),
  evidenceItemId: integer('evidence_item_id')
    .references(() => evidenceItems.id, { onDelete: 'cascade' })
    .notNull(),
  whatDetected: text('what_detected').notNull(),
  whereDetected: text('where_detected').notNull(),
  whyFlagged: text('why_flagged').notNull(),
  analysisMethod: text('analysis_method').notNull(),
  confidence: integer('confidence').notNull().default(0),
  limitations: text('limitations').notNull(),
  classification: text('classification').$type<ForensicClassification>().notNull(),
  regionJson: jsonb('region_json').$type<FindingRegion | null>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const crossModalCorrelations = pgTable('cross_modal_correlations', {
  id: serial('id').primaryKey(),
  investigationId: integer('investigation_id')
    .references(() => investigations.id, { onDelete: 'cascade' })
    .notNull(),
  pairType: text('pair_type').notNull(),
  title: text('title').notNull(),
  sourceEvidenceIds: jsonb('source_evidence_ids').$type<number[]>().notNull(),
  findingSummary: text('finding_summary').notNull(),
  consistencyStatus: text('consistency_status').$type<ForensicClassification>().notNull(),
  confidence: integer('confidence').notNull().default(0),
  limitations: text('limitations').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  investigationId: integer('investigation_id').references(() => investigations.id, {
    onDelete: 'set null',
  }),
  actionType: text('action_type').notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  investigations: many(investigations),
  activityLogs: many(activityLogs),
}));

export const investigationsRelations = relations(investigations, ({ one, many }) => ({
  author: one(users, {
    fields: [investigations.userId],
    references: [users.id],
  }),
  evidenceItems: many(evidenceItems),
  correlations: many(crossModalCorrelations),
}));

export const evidenceItemsRelations = relations(evidenceItems, ({ one, many }) => ({
  investigation: one(investigations, {
    fields: [evidenceItems.investigationId],
    references: [investigations.id],
  }),
  findings: many(forensicFindings),
}));

export const forensicFindingsRelations = relations(forensicFindings, ({ one }) => ({
  evidenceItem: one(evidenceItems, {
    fields: [forensicFindings.evidenceItemId],
    references: [evidenceItems.id],
  }),
}));

export const crossModalCorrelationsRelations = relations(crossModalCorrelations, ({ one }) => ({
  investigation: one(investigations, {
    fields: [crossModalCorrelations.investigationId],
    references: [investigations.id],
  }),
}));
