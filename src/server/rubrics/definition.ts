export type RubricLevel = { id: string; score: string; description: string };
export type RubricCriterion = { id: string; label: string; group?: string; max: string; levels: RubricLevel[] };
export type RubricDefinition = { max: string; criteria: RubricCriterion[] };
export type Rubric = { id: string; revision: number; label: string; definition: RubricDefinition; retired: boolean };

export class RubricError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

function invalid(): never { throw new RubricError(422, 'INVALID_RUBRIC'); }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, limit: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) invalid();
  return value.trim();
}

function entries(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > limit) invalid();
  return value;
}

function identifier(value: unknown, seen: Set<string>) {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(value) || seen.has(value)) invalid();
  seen.add(value);
  return value;
}

export function parseRubric(label: unknown, input: unknown) {
  const body = object(input);
  const criteriaIds = new Set<string>();
  let rubricMax = 0;
  const criteria = entries(body.criteria, 100).map(raw => {
    const criterion = object(raw);
    const levelIds = new Set<string>();
    const scores = new Set<number>();
    const levels = entries(criterion.levels, 50).map(rawLevel => {
      const level = object(rawLevel);
      if (typeof level.score !== 'string' || !/^\d{1,6}(?:[.,]\d{1,2})?$/.test(level.score.trim())) invalid();
      const score = Math.round(Number(level.score.trim().replace(',', '.')) * 100);
      if (scores.has(score)) invalid();
      scores.add(score);
      return {
        id: identifier(level.id, levelIds), score: (score / 100).toFixed(2),
        description: boundedText(level.description, 4000)
      };
    });
    const max = Math.max(...scores);
    if (max === 0) invalid();
    rubricMax += max;
    const group = criterion.group === undefined || criterion.group === '' ? undefined : boundedText(criterion.group, 250);
    return {
      id: identifier(criterion.id, criteriaIds), label: boundedText(criterion.label, 250), ...(group ? { group } : {}),
      max: (max / 100).toFixed(2), levels
    };
  });
  return { label: boundedText(label, 150), definition: { max: (rubricMax / 100).toFixed(2), criteria } };
}
