import { Category, Question } from '../types';

export type CategoryRegenerationMode = 'active_only' | 'inactive_only' | 'reset_all_active';

export interface CategoryRegenerationResult {
  categories: Category[];
  targetedTiles: number;
  updatedTiles: number;
}

const tileContentKeys = ['text', 'answer', 'options', 'explanation', 'difficulty', 'metadata'] as const;

const hasOwn = (obj: unknown, key: string) => Object.prototype.hasOwnProperty.call(obj as object, key);

const cloneQuestionWithContent = (base: Question, generated: Question): Question => {
  const next: Record<string, unknown> = { ...base };
  tileContentKeys.forEach((key) => {
    if (hasOwn(generated, key)) {
      next[key] = (generated as Record<string, unknown>)[key];
    }
  });
  return next as Question;
};

export const isTileActive = (question: Question): boolean => {
  const q = question as Question & {
    isDisabled?: boolean;
    isPlayable?: boolean;
    isActive?: boolean;
  };

  if (typeof q.isPlayable === 'boolean') return q.isPlayable;
  if (typeof q.isActive === 'boolean') return q.isActive;
  return !q.isAnswered && !q.isVoided && !q.isDisabled;
};

export const preserveTileStateOnRegenerate = (existing: Question, generated: Question): Question => {
  return cloneQuestionWithContent(existing, generated);
};

export const resetTileToActive = (existing: Question, generated: Question): Question => {
  const next = cloneQuestionWithContent(existing, generated) as Question & {
    isDisabled?: boolean;
    isPlayable?: boolean;
    isActive?: boolean;
  };

  next.isAnswered = false;
  next.isVoided = false;
  next.isRevealed = false;
  if (hasOwn(existing, 'isDisabled')) next.isDisabled = false;
  if (hasOwn(existing, 'isPlayable')) next.isPlayable = true;
  if (hasOwn(existing, 'isActive')) next.isActive = true;

  return next as Question;
};

const validateCategoryShape = (existing: Category, generatedQuestions: Question[]) => {
  if (!Array.isArray(generatedQuestions) || generatedQuestions.length < existing.questions.length) {
    throw new Error(`AI payload did not return enough questions for category ${existing.id}.`);
  }
};

export const regenerateCategoryWithMode = (
  category: Category,
  generatedQuestions: Question[],
  mode: CategoryRegenerationMode
): { category: Category; targetedTiles: number; updatedTiles: number } => {
  validateCategoryShape(category, generatedQuestions);

  let targetedTiles = 0;
  let updatedTiles = 0;

  const nextQuestions = category.questions.map((existingQuestion, index) => {
    const generatedQuestion = generatedQuestions[index];
    const active = isTileActive(existingQuestion);

    const shouldUpdate =
      mode === 'reset_all_active' ||
      (mode === 'active_only' && active) ||
      (mode === 'inactive_only' && !active);

    if (!shouldUpdate) return existingQuestion;

    targetedTiles += 1;
    updatedTiles += 1;

    if (mode === 'reset_all_active') {
      return resetTileToActive(existingQuestion, generatedQuestion);
    }

    return preserveTileStateOnRegenerate(existingQuestion, generatedQuestion);
  });

  return {
    category: {
      ...category,
      questions: nextQuestions,
    },
    targetedTiles,
    updatedTiles,
  };
};

export const applyBoardMasterRegeneration = (existingCategories: Category[], generatedCategories: Category[]): Category[] => {
  if (!Array.isArray(generatedCategories) || generatedCategories.length < existingCategories.length) {
    throw new Error('AI payload did not return enough categories for full board regeneration.');
  }

  return existingCategories.map((existingCategory, categoryIndex) => {
    const generatedCategory = generatedCategories[categoryIndex];
    if (!generatedCategory) {
      throw new Error(`Missing regenerated category at index ${categoryIndex}.`);
    }

    if (!Array.isArray(generatedCategory.questions) || generatedCategory.questions.length < existingCategory.questions.length) {
      throw new Error(`AI payload category ${existingCategory.id} has insufficient question count.`);
    }

    return {
      ...existingCategory,
      title: generatedCategory.title,
      questions: existingCategory.questions.map((existingQuestion, questionIndex) =>
        resetTileToActive(existingQuestion, generatedCategory.questions[questionIndex])
      ),
    };
  });
};


