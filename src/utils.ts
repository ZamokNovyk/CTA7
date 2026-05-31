/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Student } from './types';

// ELO logic
// Base ELO: 1200
// K-Factor: 32
export function calculateElo(
  winnerRating: number,
  loserRating: number,
  kFactor: number = 32
) {
  // Expected probabilities
  const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

  // New ratings
  const newWinnerRating = Math.round(winnerRating + kFactor * (1 - expectedWinner));
  const newLoserRating = Math.round(loserRating + kFactor * (0 - expectedLoser));

  return {
    winnerNew: newWinnerRating,
    loserNew: newLoserRating,
    winnerDelta: newWinnerRating - winnerRating,
    loserDelta: newLoserRating - loserRating,
  };
}

// Default list of students
export const INITIAL_WOMEN: string[] = [
  'Guiannella Bravo Flores',
  'Romi Yomara Campos Morom',
  'Jade Perez Sanchez',
  'Lilia Vanesa Caldas Ortega',
  'Katy Cruz Rojas',
  'Gaby Nancy Haro Correa',
  'Jemima Evelyn Montalvo Matos',
  'Xiomara Ponte Vilca',
  'Medali Rodriguez Espinoza',
  'Rosalinda Diana Viera Tarazona',
];

export const INITIAL_MEN: string[] = [
  'Frankli Caldas Limas',
  'Deyner Franklin Campos Francisco',
  'Emerson Jara Felix',
  'Jhonatan Piero Caldas Ortega',
  'Eduardo Cardenas Chavez',
  'Deivid Jesús Castillo Vega',
  'Enoc Isaias Chavez Yañez',
  'Luis Alberto Crespín Rodriguez',
  'Jose Antonio Dionicio Huayanay',
  'Stick Angel Espinoza Quinteros',
  'Roli Edwar Garay Peña',
  'Michel Gonzales Cachique',
  'Juvenal Gutierrez Tarazona',
  'Luis Yamil Lopez Vega',
  'Robiño Payajo Campos',
  'Maximo Piendo Honorio',
  'Jhonny David Rios Campos',
  'Yerson Wiliam Rodriguez Atero',
  'Minuel Rodriguez Lopez',
  'Rildo Solano Ávila',
];

export function getInitialStudents(): Student[] {
  const list: Student[] = [];
  
  // Seed women
  INITIAL_WOMEN.forEach((name, index) => {
    list.push({
      id: `w-${index}-${Date.now()}-${name.replace(/\s+/g, '-').toLowerCase()}`,
      name,
      genre: 'women',
      elo: 1200,
      matches: 0,
      wins: 0,
      createdAt: Date.now() - index * 1000,
    });
  });

  // Seed men
  INITIAL_MEN.forEach((name, index) => {
    list.push({
      id: `m-${index}-${Date.now()}-${name.replace(/\s+/g, '-').toLowerCase()}`,
      name,
      genre: 'men',
      elo: 1200,
      matches: 0,
      wins: 0,
      createdAt: Date.now() - (index + 50) * 1000,
    });
  });

  return list;
}

// Intelligent Matchmaking Engine
// Tries to select two students from the same category who are somewhat close in ELO or totally random as fallback.
// This prevents matches of 2000 vs 800 ELO and makes the game highly balanced and engaging.
// Now also accepts a set of played matchup keys to prevent repeating matchups.
export function selectMatchup(
  students: Student[],
  genre: 'women' | 'men',
  previousMatchup: [string, string] | null = null,
  playedMatchupKeys: Set<string> = new Set()
): [Student, Student] | null {
  const pool = students.filter((s) => s.genre === genre);
  if (pool.length < 2) return null;

  // Generate all possible non-self pairings
  let pairings: [Student, Student][] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const s1 = pool[i];
      const s2 = pool[j];
      const key = s1.id < s2.id ? `${s1.id}_${s2.id}` : `${s2.id}_${s1.id}`;
      if (!playedMatchupKeys.has(key)) {
        pairings.push([s1, s2]);
      }
    }
  }

  // If we have no unplayed matchups left, clear/ignore the history for this calculation
  if (pairings.length === 0) {
    console.log(`Todos los emparejamientos de ${genre === 'men' ? 'hombres' : 'mujeres'} han sido jugados. Reiniciando pool de emparejamientos...`);
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        pairings.push([pool[i], pool[j]]);
      }
    }
  }

  // If for some reason we still have no pairings, return null
  if (pairings.length === 0) return null;

  // Avoid showing the exact previous matchup again if we have more options
  if (previousMatchup) {
    const nonPrevPairings = pairings.filter(([s1, s2]) => {
      return !previousMatchup.includes(s1.id) && !previousMatchup.includes(s2.id);
    });
    if (nonPrevPairings.length > 0) {
      pairings = nonPrevPairings;
    }
  }

  // Choose matchmaking algorithm: 35% random, 65% ELO proximity for closer matches
  const useProximity = Math.random() < 0.65;
  let selectedPair: [Student, Student];

  if (useProximity && pairings.length > 3) {
    // Sort pairings by absolute ELO difference
    const sortedPairings = [...pairings].sort((a, b) => {
      const diffA = Math.abs(a[0].elo - a[1].elo);
      const diffB = Math.abs(b[0].elo - b[1].elo);
      return diffA - diffB;
    });
    // Pick randomly from the top 5 closest pairings (or range of pairings)
    const range = Math.min(5, sortedPairings.length);
    const index = Math.floor(Math.random() * range);
    selectedPair = sortedPairings[index];
  } else {
    // Pick fully randomly from pairings
    const index = Math.floor(Math.random() * pairings.length);
    selectedPair = pairings[index];
  }

  const [studentA, studentB] = selectedPair;

  // Ensure left and right order has 50/50 chance so the same student doesn't always appear on the left
  return Math.random() < 0.5 ? [studentA, studentB] : [studentB, studentA];
}

// Clean and crisp Web Audio API arcade sound synthesizer
export function playArcadeVoteSound(isMuted: boolean) {
  if (isMuted) return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    
    // Create oscillator & gain nodes
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    // Retro arcade blip sound: double-pitched note
    const now = ctx.currentTime;
    
    // A clean triangle wave gives a lovely 80s console aesthetic
    oscillator.type = 'triangle';
    
    // Play sequence: Note A (300Hz), then quick shift to Note B (600Hz)
    oscillator.frequency.setValueAtTime(440, now); // A4
    oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5 (octave higher)
    
    // Fast envelope release
    gainNode.gain.setValueAtTime(0.15, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    
    oscillator.start(now);
    oscillator.stop(now + 0.25);
  } catch (error) {
    // Graceful fallback if audio context blocked or uninitialized
    console.warn('Web Audio API play error:', error);
  }
}
