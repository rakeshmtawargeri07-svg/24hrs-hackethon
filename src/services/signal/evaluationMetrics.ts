// Honest Classification Evaluation Metrics Utility for Labeled Benchmark Datasets
// Used only when real labeled predictions are supplied (never fabricated).

export interface EvaluationMetricsReport {
  sampleCount: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  rocAuc: number | null;
  confusionMatrix: {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
  };
  falsePositiveRate: number;
  falseNegativeRate: number;
}

export function computeClassificationMetrics(
  yTrue: Array<0 | 1>,
  yPred: Array<0 | 1>,
  yScores?: number[]
): EvaluationMetricsReport {
  const n = Math.min(yTrue.length, yPred.length);
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (let i = 0; i < n; i++) {
    if (yTrue[i] === 1 && yPred[i] === 1) tp++;
    else if (yTrue[i] === 0 && yPred[i] === 1) fp++;
    else if (yTrue[i] === 0 && yPred[i] === 0) tn++;
    else if (yTrue[i] === 1 && yPred[i] === 0) fn++;
  }

  const accuracy = n > 0 ? (tp + tn) / n : 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const falsePositiveRate = fp + tn > 0 ? fp / (fp + tn) : 0;
  const falseNegativeRate = fn + tp > 0 ? fn / (fn + tp) : 0;

  let rocAuc: number | null = null;
  if (yScores && yScores.length === n && tp + fn > 0 && tn + fp > 0) {
    const pairs = yScores.map((s, idx) => ({ score: s, label: yTrue[idx] }));
    pairs.sort((a, b) => b.score - a.score);
    const totalPos = tp + fn;
    const totalNeg = tn + fp;
    let curTp = 0;
    let curFp = 0;
    let prevTpr = 0;
    let prevFpr = 0;
    let area = 0;

    for (const p of pairs) {
      if (p.label === 1) curTp++;
      else curFp++;
      const tpr = curTp / totalPos;
      const fpr = curFp / totalNeg;
      area += ((fpr - prevFpr) * (tpr + prevTpr)) / 2;
      prevTpr = tpr;
      prevFpr = fpr;
    }
    rocAuc = Number(area.toFixed(4));
  }

  return {
    sampleCount: n,
    accuracy: Number(accuracy.toFixed(4)),
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1Score: Number(f1Score.toFixed(4)),
    rocAuc,
    confusionMatrix: { tp, fp, tn, fn },
    falsePositiveRate: Number(falsePositiveRate.toFixed(4)),
    falseNegativeRate: Number(falseNegativeRate.toFixed(4)),
  };
}
