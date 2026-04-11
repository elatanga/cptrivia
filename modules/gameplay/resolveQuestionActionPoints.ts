import { SpecialMoveType } from '../../types';

export type QuestionResolutionAction = 'return' | 'void' | 'award' | 'steal';

type DecoratorOutcome = 'AWARD' | 'STEAL' | 'FAIL';

export type ResolveQuestionActionPointsParams = {
  action: QuestionResolutionAction;
  resolvesAsFail: boolean;
  basePoints: number;
  tileId: string;
  moveType?: SpecialMoveType;
  applyDecorator: (
    points: number,
    context: { tileId: string; moveType?: SpecialMoveType; outcome: DecoratorOutcome }
  ) => number;
};

const isScoringAction = (action: QuestionResolutionAction, resolvesAsFail: boolean) => {
  return action === 'award' || action === 'steal' || resolvesAsFail;
};

export const resolveQuestionActionPoints = ({
  action,
  resolvesAsFail,
  basePoints,
  tileId,
  moveType,
  applyDecorator,
}: ResolveQuestionActionPointsParams): number => {
  if (!isScoringAction(action, resolvesAsFail)) {
    return 0;
  }

  const outcome: DecoratorOutcome = action === 'award' ? 'AWARD' : action === 'steal' ? 'STEAL' : 'FAIL';

  return applyDecorator(basePoints, {
    tileId,
    moveType,
    outcome,
  });
};

