import { GameState, PlayMode, Team, TeamMember, TeamPlayStyle, TemplateConfig, Player } from '../types';

export const DEFAULT_PLAY_MODE: PlayMode = 'INDIVIDUALS';
export const DEFAULT_TEAM_PLAY_STYLE: TeamPlayStyle = 'TEAM_PLAYS_AS_ONE';

const toSafeMember = (member: TeamMember, index: number): TeamMember => {
  const safeName = String(member?.name || '').trim();
  return {
    id: member?.id || `member-${index}`,
    name: safeName || `MEMBER ${index + 1}`,
    score: Number(member?.score || 0),
    orderIndex: Number.isFinite(Number(member?.orderIndex)) ? Number(member.orderIndex) : index,
  };
};

const normalizeTeam = (team: Team, index: number): Team => {
  const members = Array.isArray(team?.members)
    ? team.members.map((member, memberIndex) => toSafeMember(member, memberIndex))
    : [];

  const safeName = String(team?.name || '').trim();
  const nextTeam: Team = {
    id: team?.id || `team-${index}`,
    name: safeName || `TEAM ${index + 1}`,
    members,
    score: Number(team?.score || 0),
    activeMemberId: team?.activeMemberId,
  };

  if (members.length > 0 && !members.some((member) => member.id === nextTeam.activeMemberId)) {
    nextTeam.activeMemberId = members[0].id;
  }

  return nextTeam;
};

export const normalizeTemplateConfigForTeams = (config: TemplateConfig): TemplateConfig => {
  const playMode = config?.playMode || DEFAULT_PLAY_MODE;
  const teamPlayStyle = config?.teamPlayStyle || DEFAULT_TEAM_PLAY_STYLE;
  const teams = Array.isArray(config?.teams) ? config.teams.map(normalizeTeam) : [];

  return {
    ...config,
    playMode,
    teamPlayStyle,
    teams,
  };
};

export const getTeamsValidationError = (
  playMode: PlayMode,
  teamPlayStyle: TeamPlayStyle,
  teams: Team[]
): string | null => {
  if (playMode !== 'TEAMS') return null;
  if (!Array.isArray(teams) || teams.length === 0) return 'Add at least one team.';

  for (const team of teams) {
    if (!String(team?.name || '').trim()) return 'Every team must have a name.';
    if (!Array.isArray(team?.members) || team.members.length === 0) {
      return `Team ${team?.name || 'Unnamed'} must have at least one member.`;
    }
    for (const member of team.members) {
      if (!String(member?.name || '').trim()) {
        return `All members in ${team?.name || 'team'} need names.`;
      }
    }
  }

  if (teamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS') {
    if (teams.length < 2) return 'Turn mode requires at least two teams.';
    const expectedCount = teams[0].members.length;
    if (teams.some((team) => team.members.length !== expectedCount)) {
      return 'In Team Members Take Turns mode, every team must have the same number of players.';
    }
  }

  return null;
};

type TeamTurnParticipant = {
  teamId: string;
  memberId: string;
};

const getMembersInTurnOrder = (team: Team): TeamMember[] => {
  return [...(team.members || [])].sort((a, b) => {
    const aIndex = Number.isFinite(Number(a.orderIndex)) ? Number(a.orderIndex) : 0;
    const bIndex = Number.isFinite(Number(b.orderIndex)) ? Number(b.orderIndex) : 0;
    return aIndex - bIndex;
  });
};

export const buildTeamMemberTurnSequence = (teams: Team[]): TeamTurnParticipant[] => {
  if (!Array.isArray(teams) || teams.length === 0) return [];

  const orderedTeams = teams.map((team) => ({ team, members: getMembersInTurnOrder(team) }));
  const maxMemberCount = Math.max(...orderedTeams.map((entry) => entry.members.length));
  const sequence: TeamTurnParticipant[] = [];

  for (let memberIndex = 0; memberIndex < maxMemberCount; memberIndex += 1) {
    orderedTeams.forEach(({ team, members }) => {
      const member = members[memberIndex];
      if (!member?.id) return;
      sequence.push({ teamId: team.id, memberId: member.id });
    });
  }

  return sequence;
};

export const getNextTeamTurnSelection = (
  teams: Team[],
  currentSelectedTeamId: string | null
): string | null => {
  const sequence = buildTeamMemberTurnSequence(teams);
  if (sequence.length === 0) return null;

  if (!currentSelectedTeamId) {
    return sequence[0].teamId;
  }

  const currentTeam = teams.find((team) => team.id === currentSelectedTeamId);
  const currentActiveMemberId = currentTeam?.activeMemberId;
  const exactIndex = sequence.findIndex(
    (entry) => entry.teamId === currentSelectedTeamId && entry.memberId === currentActiveMemberId
  );
  const fallbackIndex = sequence.findIndex((entry) => entry.teamId === currentSelectedTeamId);
  const currentIndex = exactIndex !== -1 ? exactIndex : fallbackIndex;

  if (currentIndex === -1) {
    return sequence[0].teamId;
  }

  return sequence[(currentIndex + 1) % sequence.length].teamId;
};

export const normalizeGameStateForTeams = (state: GameState): GameState => {
  const playMode = state?.playMode || DEFAULT_PLAY_MODE;
  const teamPlayStyle = state?.teamPlayStyle || DEFAULT_TEAM_PLAY_STYLE;
  const teams = Array.isArray(state?.teams) ? state.teams.map(normalizeTeam) : [];

  return {
    ...state,
    playMode,
    teamPlayStyle,
    teams,
  };
};

export const buildContestantsFromTeams = (teams: Team[]): Player[] => {
  return (teams || []).map((team) => ({
    id: team.id,
    name: team.name,
    score: Number(team.score || 0),
    color: '#ffffff',
    wildcardsUsed: 0,
    wildcardActive: false,
    stealsCount: 0,
    questionsAnswered: 0,
    lostOrVoidedCount: 0,
    specialMovesUsedCount: 0,
    specialMovesUsedNames: [],
  }));
};

export const rotateTeamActiveMember = (team: Team): Team => {
  if (!team.members || team.members.length === 0) return team;

  const currentIdx = team.members.findIndex((member) => member.id === team.activeMemberId);
  const safeIdx = currentIdx === -1 ? 0 : currentIdx;
  const nextIdx = (safeIdx + 1) % team.members.length;

  return {
    ...team,
    activeMemberId: team.members[nextIdx].id,
  };
};

export const applyScoreDeltaByMode = (
  teams: Team[],
  selectedContestantId: string | null,
  delta: number,
  teamPlayStyle: TeamPlayStyle
): Team[] => {
  if (!selectedContestantId || !Array.isArray(teams) || teams.length === 0) {
    return teams;
  }

  return teams.map((team) => {
    if (team.id !== selectedContestantId) return team;

    const nextTeam = { ...team, score: Number(team.score || 0) + delta };

    if (teamPlayStyle !== 'TEAM_MEMBERS_TAKE_TURNS' || !Array.isArray(team.members) || team.members.length === 0) {
      return nextTeam;
    }

    const memberIdx = team.members.findIndex((member) => member.id === team.activeMemberId);
    const safeMemberIdx = memberIdx === -1 ? 0 : memberIdx;

    const updatedMembers = team.members.map((member, index) => {
      if (index !== safeMemberIdx) return member;
      return { ...member, score: Number(member.score || 0) + delta };
    });

    return {
      ...nextTeam,
      members: updatedMembers,
      activeMemberId: updatedMembers[safeMemberIdx]?.id,
    };
  });
};

export const rotateActiveMemberForTeamById = (teams: Team[], teamId: string | null): Team[] => {
  if (!teamId || !Array.isArray(teams) || teams.length === 0) {
    return teams;
  }

  return teams.map((team) => (team.id === teamId ? rotateTeamActiveMember(team) : team));
};

export const resetLiveScoresByMode = (
  players: Player[],
  teams: Team[],
  playMode: PlayMode
): { players: Player[]; teams: Team[] } => {
  const nextPlayers = (players || []).map((player) => ({
    ...player,
    score: 0,
  }));

  if (playMode !== 'TEAMS') {
    return {
      players: nextPlayers,
      teams: teams || [],
    };
  }

  const nextTeams = (teams || []).map((team) => ({
    ...team,
    score: 0,
    members: (team.members || []).map((member) => ({
      ...member,
      score: 0,
    })),
  }));

  return {
    players: nextPlayers,
    teams: nextTeams,
  };
};

