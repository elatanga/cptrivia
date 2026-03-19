import { Category, Player, Question } from '../types';

export interface CelebrationWinner {
  id: string;
  name: string;
  score: number;
}

export interface EndGameCelebrationResult {
  mode: 'single-player' | 'winner' | 'tie' | 'no-players';
  title: string;
  subtitle: string;
  scoreLabel: string;
  winners: CelebrationWinner[];
  topScore: number;
  playerCount: number;
}

const isResolvedQuestion = (question: Question) => question.isAnswered || !!question.isVoided;

const toSafeDisplayName = (name: string | undefined, fallbackIndex: number) => {
  const trimmed = (name || '').trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : `PLAYER ${fallbackIndex + 1}`;
};

export const isTriviaBoardComplete = (categories: Category[]): boolean => {
  if (!categories.length) return false;

  const allQuestions = categories.flatMap((category) => category.questions || []);
  if (!allQuestions.length) return false;

  return allQuestions.every(isResolvedQuestion);
};

export const deriveEndGameCelebrationResult = (players: Player[]): EndGameCelebrationResult => {
  const safePlayers = (players || []).map((player, index) => ({
    id: player.id || `fallback-${index}`,
    name: toSafeDisplayName(player.name, index),
    score: Number.isFinite(player.score) ? player.score : 0,
  }));

  if (!safePlayers.length) {
    return {
      mode: 'no-players',
      title: 'GAME COMPLETE',
      subtitle: 'Final board resolved',
      scoreLabel: 'Final Score',
      winners: [],
      topScore: 0,
      playerCount: 0,
    };
  }

  const topScore = Math.max(...safePlayers.map((player) => player.score));
  const winners = safePlayers
    .filter((player) => player.score === topScore)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (safePlayers.length === 1) {
    return {
      mode: 'single-player',
      title: 'CONGRATULATIONS',
      subtitle: 'Game Complete',
      scoreLabel: 'Final Score',
      winners,
      topScore,
      playerCount: safePlayers.length,
    };
  }

  if (winners.length > 1) {
    return {
      mode: 'tie',
      title: 'CO-WINNERS',
      subtitle: 'Game Complete',
      scoreLabel: 'Shared Score',
      winners,
      topScore,
      playerCount: safePlayers.length,
    };
  }

  return {
    mode: 'winner',
    title: 'WINNER',
    subtitle: 'Game Complete',
    scoreLabel: 'Score',
    winners,
    topScore,
    playerCount: safePlayers.length,
  };
};

