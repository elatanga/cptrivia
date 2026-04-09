import { Category, Player, PlayMode, Question, Team } from '../types';

export interface CelebrationWinner {
  id: string;
  name: string;
  score: number;
}

export interface CelebrationStats {
  questionsAnswered: number;
  stealsMade: number;
  bonusMovesGot: number;
  lostOrVoided: number;
}

export interface CelebrationPlacement {
  id: string;
  name: string;
  score: number;
  rank: number;
  stats: CelebrationStats;
}

export interface TeamMemberCelebrationPlacement {
  id: string;
  name: string;
  score: number;
  stats: CelebrationStats;
}

export interface TeamCelebrationPlacement {
  id: string;
  name: string;
  score: number;
  rank: number;
  stats: CelebrationStats;
  members: TeamMemberCelebrationPlacement[];
}

export interface EndGameCelebrationResult {
  mode: 'single-player' | 'winner' | 'tie' | 'no-players';
  title: string;
  subtitle: string;
  scoreLabel: string;
  winners: CelebrationWinner[];
  topScore: number;
  playerCount: number;
  placements: CelebrationPlacement[];
  teamPlacements: TeamCelebrationPlacement[];
  singlePlayerOutcome?: 'victory' | 'loss';
  singlePlayerCorrectAnswers?: number;
}

export interface EndGameCelebrationOptions {
  playMode?: PlayMode;
  teams?: Team[];
  singlePlayerQuickMode?: boolean;
}

const isResolvedQuestion = (question: Question) => question.isAnswered || !!question.isVoided;

const toSafeDisplayName = (name: string | undefined, fallbackIndex: number) => {
  const trimmed = (name || '').trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : `PLAYER ${fallbackIndex + 1}`;
};

const toSafeStatNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const toStats = (source: {
  questionsAnswered?: number;
  stealsCount?: number;
  specialMovesUsedCount?: number;
  lostOrVoidedCount?: number;
}): CelebrationStats => ({
  questionsAnswered: toSafeStatNumber(source.questionsAnswered),
  stealsMade: toSafeStatNumber(source.stealsCount),
  bonusMovesGot: toSafeStatNumber(source.specialMovesUsedCount),
  lostOrVoided: toSafeStatNumber(source.lostOrVoidedCount),
});

const rankByScore = <T extends { score: number }>(items: T[]) => {
  let previousScore: number | null = null;
  let previousRank = 0;
  return items.map((item, index) => {
    if (previousScore !== item.score) {
      previousRank = index + 1;
      previousScore = item.score;
    }
    return previousRank;
  });
};

export const isTriviaBoardComplete = (categories: Category[]): boolean => {
  if (!categories.length) return false;

  const allQuestions = categories.flatMap((category) => category.questions || []);
  if (!allQuestions.length) return false;

  return allQuestions.every(isResolvedQuestion);
};

export const deriveEndGameCelebrationResult = (
  players: Player[],
  options: EndGameCelebrationOptions = {}
): EndGameCelebrationResult => {
  const safePlayers = (players || []).map((player, index) => ({
    id: player.id || `fallback-${index}`,
    name: toSafeDisplayName(player.name, index),
    score: Number.isFinite(player.score) ? player.score : 0,
    stats: toStats(player),
  }));

  const sortedPlayers = [...safePlayers].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });
  const playerRanks = rankByScore(sortedPlayers);
  const placements: CelebrationPlacement[] = sortedPlayers.slice(0, 3).map((player, index) => ({
    id: player.id,
    name: player.name,
    score: player.score,
    rank: playerRanks[index],
    stats: player.stats,
  }));

  const teamPlacements: TeamCelebrationPlacement[] = options.playMode === 'TEAMS'
    ? [...(options.teams || [])]
        .map((team, teamIndex) => {
          const safeTeamName = toSafeDisplayName(team.name, teamIndex).replace(/^PLAYER/, 'TEAM');
          const safeMembers = (team.members || []).map((member, memberIndex) => ({
            id: member.id || `${team.id || `team-${teamIndex}`}-member-${memberIndex}`,
            name: toSafeDisplayName(member.name, memberIndex),
            score: toSafeStatNumber(member.score),
            stats: toStats(member),
          }));
          const fallbackTeamStats = safePlayers.find((player) => player.id === team.id)?.stats
            || { questionsAnswered: 0, stealsMade: 0, bonusMovesGot: 0, lostOrVoided: 0 };
          const aggregatedMemberStats = safeMembers.reduce(
            (acc, member) => ({
              questionsAnswered: acc.questionsAnswered + member.stats.questionsAnswered,
              stealsMade: acc.stealsMade + member.stats.stealsMade,
              bonusMovesGot: acc.bonusMovesGot + member.stats.bonusMovesGot,
              lostOrVoided: acc.lostOrVoided + member.stats.lostOrVoided,
            }),
            { questionsAnswered: 0, stealsMade: 0, bonusMovesGot: 0, lostOrVoided: 0 } as CelebrationStats
          );
          const hasMemberStats = aggregatedMemberStats.questionsAnswered > 0
            || aggregatedMemberStats.stealsMade > 0
            || aggregatedMemberStats.bonusMovesGot > 0
            || aggregatedMemberStats.lostOrVoided > 0;
          return {
            id: team.id || `team-${teamIndex}`,
            name: safeTeamName,
            score: toSafeStatNumber(team.score),
            stats: hasMemberStats ? aggregatedMemberStats : fallbackTeamStats,
            members: safeMembers,
          };
        })
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.name.localeCompare(b.name);
        })
        .map((team, index, allTeams) => {
          const ranks = rankByScore(allTeams);
          return {
            ...team,
            rank: ranks[index],
          };
        })
    : [];

  if (!safePlayers.length) {
    return {
      mode: 'no-players',
      title: 'GAME COMPLETE',
      subtitle: 'Final board resolved',
      scoreLabel: 'Final Score',
      winners: [],
      topScore: 0,
      playerCount: 0,
      placements,
      teamPlacements,
    };
  }

  const topScore = Math.max(...safePlayers.map((player) => player.score));
  const winners = safePlayers
    .filter((player) => player.score === topScore)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (safePlayers.length === 1) {
    const single = safePlayers[0];
    const singlePlayerCorrectAnswers = Math.max(0, single.stats.questionsAnswered - single.stats.lostOrVoided);
    const singlePlayerOutcome = options.singlePlayerQuickMode
      ? (singlePlayerCorrectAnswers >= 8 ? 'victory' : 'loss')
      : 'victory';
    return {
      mode: 'single-player',
      title: options.singlePlayerQuickMode
        ? (singlePlayerOutcome === 'victory' ? 'VICTORY' : 'FAILED CHALLENGE')
        : 'CONGRATULATIONS',
      subtitle: options.singlePlayerQuickMode
        ? `Quick Mode • ${singlePlayerCorrectAnswers}/10 Correct`
        : 'Game Complete',
      scoreLabel: 'Final Score',
      winners,
      topScore,
      playerCount: safePlayers.length,
      placements,
      teamPlacements,
      singlePlayerOutcome,
      singlePlayerCorrectAnswers,
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
      placements,
      teamPlacements,
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
    placements,
    teamPlacements,
  };
};

