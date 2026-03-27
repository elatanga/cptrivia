
import { SpecialMoveType } from '../../types';

export type SMSType = SpecialMoveType;

export interface SMSArmedMove {
  type: SMSType;
  armedAt: string;
  armedBy: string;
}

export interface SMSState {
  deployments: Record<string, SMSArmedMove>; // Key: tileId
  isLive: boolean;
  lastUpdate: number;
}

export interface SMSResolution {
  points: number;
  label: string;
  isBlocked?: boolean;
}
