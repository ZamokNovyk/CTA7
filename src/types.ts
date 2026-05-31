/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Student {
  id: string;
  name: string;
  genre: 'women' | 'men';
  elo: number;
  matches: number;
  wins: number;
  createdAt: number;
  perfilPhotoUrl?: string;
  actualizadoEn?: string;
}

export interface MatchHistory {
  id: string;
  timestamp: number;
  winnerId: string;
  loserId: string;
  winnerPrevElo: number;
  winnerNewElo: number;
  loserPrevElo: number;
  loserNewElo: number;
  genre: 'women' | 'men';
}
