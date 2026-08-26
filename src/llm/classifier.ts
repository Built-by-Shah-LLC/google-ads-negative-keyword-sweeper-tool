import type { ClassificationCandidate, RuleSet, ValidatedBatch } from "../types.js";

export interface ClassificationContext {
  account: {
    customerId: string;
    descriptiveName: string;
    timeZone: string;
  };
  date: string;
  rules: RuleSet;
  searchTerms: ClassificationCandidate[];
}

export interface ClassificationResult {
  validated: ValidatedBatch;
  request: Record<string, unknown>;
  response: unknown;
}

export interface KeywordClassifier {
  readonly provider: string;
  readonly model: string;
  classify(context: ClassificationContext): Promise<ClassificationResult>;
}
