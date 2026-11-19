import { jsPDF } from 'jspdf';
import { InvestigationDetail } from '../types/forensics';

export function exportForensicPdfReport(
  investigation: InvestigationDetail,
  analystOrg = 'TruthLens',
  includeLimitations = true
) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const maxWidth = pageWidth - margin * 2;
  let y = 52;

  const ensureSpace = (needed = 40) => {
    if (y + needed > pageHeight - 48) {
      doc.addPage();
      y = 52;
    }
  };

  const addSectionHeader = (num: string, title: string) => {
    ensureSpace(46);
    y += 8;
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.6);
    doc.line(margin, y, pageWidth - margin, y);
    y += 16;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(14, 165, 233);
    doc.text(`${num}. ${title.toUpperCase()}`, margin, y);
    y += 16;
  };

  const addParagraph = (text: string, size = 9.5, color: [number, number, number] = [30, 41, 59]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text || 'N/A', maxWidth);
    for (const line of lines) {
      ensureSpace(14);
      doc.text(line, margin, y);
      y += 13;
    }
    y += 4;
  };

  const addKeyValue = (label: string, value: string) => {
    ensureSpace(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(`${label}:`, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(value, maxWidth - 135);
    doc.text(lines, margin + 135, y);
    y += Math.max(14, lines.length * 12 + 2);
  };

  // Header Banner
  doc.setFillColor(11, 17, 32);
  doc.rect(0, 0, pageWidth, 86, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(248, 250, 252);
  doc.text('TRUTHLENS FORENSIC DOSSIER', margin, 36);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Multimodal Digital Forensics Report  |  ${analystOrg}  |  Generated ${new Date().toISOString()}`,
    margin,
    58
  );
  y = 112;

  // 1. Investigation ID
  addSectionHeader('01', 'Investigation Identification');
  addKeyValue('Investigation ID', investigation.caseCode);
  addKeyValue('Case Title', investigation.title);
  addKeyValue('Created Timestamp', new Date(investigation.createdAt).toLocaleString());
  addKeyValue('Case Notes', investigation.description || 'None provided');

  // 2. Uploaded Evidence Details
  addSectionHeader('02', 'Uploaded Evidence & Cryptographic Hashes');
  for (const item of investigation.evidenceItems) {
    ensureSpace(54);
    const detectionLabel =
      typeof item.metadataJson?.detectionLabel === 'string'
        ? item.metadataJson.detectionLabel
        : item.classification;
    const aiProb =
      typeof item.metadataJson?.aiProbability === 'number'
        ? ` | AI Probability: ${item.metadataJson.aiProbability}%`
        : '';
    addKeyValue(
      `[ID #${item.id}] ${item.modality.toUpperCase()}`,
      `${item.filename} (${item.mimeType}, ${(item.fileSize / 1024).toFixed(1)} KB)`
    );
    addKeyValue('SHA-256 Hash', item.sha256Hash);
    addKeyValue('Detection Result', `${detectionLabel} (${item.confidence}% confidence${aiProb})`);
    y += 4;
  }

  // 3. File Metadata
  addSectionHeader('03', 'Extracted File Metadata');
  for (const item of investigation.evidenceItems) {
    const cleanMeta = { ...item.metadataJson };
    delete cleanMeta.keyframes;
    delete cleanMeta.waveformPeaks;
    addParagraph(`• ${item.filename}: ${JSON.stringify(cleanMeta)}`, 8.5, [51, 65, 85]);
  }

  // 4. Analysis Performed
  addSectionHeader('04', 'Analysis Methods Executed');
  const uniqueMethods = Array.from(
    new Set(
      investigation.evidenceItems.flatMap((i) => i.findings.map((f) => f.analysisMethod))
    )
  );
  if (uniqueMethods.length === 0) {
    addParagraph('Standard ingestion metadata verification executed.');
  } else {
    for (const m of uniqueMethods) {
      addParagraph(`• ${m}`);
    }
  }

  // 5. Flagged Evidence & Timestamps
  addSectionHeader('05', 'Flagged Evidence, Spatial Regions & Timestamps');
  const flaggedFindings = investigation.evidenceItems.flatMap((item) =>
    item.findings
      .filter((f) => f.classification === 'Suspicious' || f.classification === 'Inconclusive')
      .map((f) => ({ item, f }))
  );
  if (flaggedFindings.length === 0) {
    addParagraph('No suspicious timestamps, spatial regions, or acoustic segments were flagged.');
  } else {
    for (const { item, f } of flaggedFindings) {
      const regionDesc = f.regionJson
        ? f.regionJson.startSec !== undefined
          ? `Timestamp ${f.regionJson.startSec}s - ${f.regionJson.endSec ?? f.regionJson.startSec}s`
          : f.regionJson.x !== undefined
          ? `Region (${f.regionJson.x?.toFixed(0)}%, ${f.regionJson.y?.toFixed(0)}%, ${f.regionJson.width?.toFixed(0)}%x${f.regionJson.height?.toFixed(0)}%)`
          : f.regionJson.excerpt
          ? `Excerpt: "${f.regionJson.excerpt}"`
          : f.whereDetected
        : f.whereDetected;
      addParagraph(`[${item.filename}] ${f.classification}: ${f.whatDetected} — ${regionDesc}`);
    }
  }

  // 6. Detected Indicators (Explainable Findings)
  addSectionHeader('06', 'Detailed Detected Indicators');
  for (const item of investigation.evidenceItems) {
    addParagraph(`Evidence: ${item.filename} (${item.modality}) — ${item.technicalSummary}`, 9.5, [15, 23, 42]);
    for (const f of item.findings) {
      addParagraph(
        `  - [${f.classification} | ${f.confidence}%] ${f.whatDetected} @ ${f.whereDetected}. Rationale: ${f.whyFlagged} (Method: ${f.analysisMethod})`,
        8.5,
        [51, 65, 85]
      );
    }
  }

  // 7. Cross-Modal Findings
  addSectionHeader('07', 'Cross-Modal Correlation Findings');
  if (investigation.correlations.length === 0) {
    addParagraph('Cross-modal correlation requires two or more complementary evidence items or was unavailable.');
  } else {
    for (const c of investigation.correlations) {
      addParagraph(
        `• ${c.title} [${c.consistencyStatus} | ${c.confidence}%] (Refs: #${c.sourceEvidenceIds.join(', #')}): ${c.findingSummary}`
      );
    }
  }

  // 8. Confidence Scores
  addSectionHeader('08', 'Calibrated Confidence Scores');
  addKeyValue('Overall Confidence', `${investigation.overallConfidence}%`);
  for (const item of investigation.evidenceItems) {
    const detectionLabel =
      typeof item.metadataJson?.detectionLabel === 'string'
        ? item.metadataJson.detectionLabel
        : item.classification;
    const aiProb =
      typeof item.metadataJson?.aiProbability === 'number'
        ? `, AI Prob ${item.metadataJson.aiProbability}%`
        : '';
    addKeyValue(item.filename, `${item.confidence}% (${detectionLabel}${aiProb})`);
  }

  // 9. Model Limitations
  addSectionHeader('09', 'Model Limitations & Uncertainty Statement');
  if (includeLimitations) {
    addParagraph(investigation.limitations);
    addParagraph(
      'Notice: Probabilistic AI and signal forensics detect statistical, structural, or semantic anomalies. They must never be treated as standalone proof of authenticity or intentional fabrication.'
    );
  } else {
    addParagraph('Detailed limitation notes omitted per user export preference. Probabilistic outputs are non-deterministic.');
  }

  // 10. Final Assessment
  addSectionHeader('10', 'Final Forensic Assessment');
  addKeyValue('Assessment Status', investigation.overallAssessment);
  addParagraph(investigation.summary);

  // 11. Human-Review Recommendations
  addSectionHeader('11', 'Human-Review Recommendations');
  for (const rec of investigation.recommendations) {
    addParagraph(`• ${rec}`);
  }

  doc.save(`${investigation.caseCode}-forensic-report.pdf`);
}
