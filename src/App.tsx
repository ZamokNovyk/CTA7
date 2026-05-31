/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Heart,
  Volume2,
  VolumeX,
  Plus,
  Crown,
  Sparkles,
  Award,
  Flame,
  Info,
  UserPlus,
  Check,
  X,
  RotateCcw,
  Zap,
  Venus,
  Mars
} from 'lucide-react';
import { Student } from './types';
import {
  getInitialStudents,
  selectMatchup,
  calculateElo,
  playArcadeVoteSound,
  getAvatarUrl
} from './utils';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  deleteDoc
} from 'firebase/firestore';
import {
  db,
  handleFirestoreError,
  OperationType,
  formatSpTimestamp,
  getStudentDocumentId
} from './firebase';

export default function App() {
  // --- STATE ---
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'women' | 'men'>('women');
  const [currentMatchup, setCurrentMatchup] = useState<[Student, Student] | null>(null);
  const [lastMatchupIds, setLastMatchupIds] = useState<[string, string] | null>(null);
  
  // Audio state
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    const saved = localStorage.getItem('mashMatch_muted');
    return saved ? JSON.parse(saved) : false;
  });

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentGenre, setNewStudentGenre] = useState<'women' | 'men'>('women');
  const [addError, setAddError] = useState('');
  
  // Stats
  const [totalVotes, setTotalVotes] = useState<number>(() => {
    const saved = localStorage.getItem('mashMatch_votes_count');
    return saved ? parseInt(saved, 10) : 0;
  });

  // Floating ELO feedback animations
  const [eloFeedback, setEloFeedback] = useState<{
    leftId: string;
    rightId: string;
    leftDelta: number;
    rightDelta: number;
    winnerId: string;
  } | null>(null);

  // Active key press feedback for UI hints
  const [pressedKey, setPressedKey] = useState<'left' | 'right' | null>(null);

  // Played matchups list to prevent repeat matchups in matchmaking
  const [playedMatchups, setPlayedMatchups] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('mashMatch_played_matchups');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Track isMounted to avoid triggering state updates on uninstalled hooks
  const isMounted = useRef(true);

  // --- PERSISTENCE & INIT: FIRESTORE REAL-TIME SYNC ---
  useEffect(() => {
    isMounted.current = true;
    
    const hombresRef = collection(db, 'CTA7.Estudiantes', 'generos', 'hombres');
    const mujeresRef = collection(db, 'CTA7.Estudiantes', 'generos', 'mujeres');
    
    let hombresData: Student[] = [];
    let mujeresData: Student[] = [];
    let hombresLoaded = false;
    let mujeresLoaded = false;

    const checkAndSet = async () => {
      if (!isMounted.current) return;
      if (hombresLoaded && mujeresLoaded) {
        const combined = [...hombresData, ...mujeresData];
        if (combined.length === 0) {
          console.log("No students found in Firestore. Seeding database with defaults...");
          try {
            const initial = getInitialStudents();
            // Seed initial students to their respective subcolección
            await Promise.all(
              initial.map(async (s) => {
                const docId = getStudentDocumentId(s.name);
                const docRef = doc(db, 'CTA7.Estudiantes', 'generos', s.genre === 'men' ? 'hombres' : 'mujeres', docId);
                await setDoc(docRef, {
                  nombre: s.name,
                  elo: s.elo,
                  perfilPhotoUrl: getAvatarUrl(s.name, s.genre),
                  votos_ganados: 0,
                  votos_perdidos: 0,
                  genre: s.genre,
                  actualizadoEn: formatSpTimestamp(new Date())
                });
              })
            );
            const mappedInitial = initial.map((s) => ({
              ...s,
              id: getStudentDocumentId(s.name),
            }));
            if (isMounted.current) {
              setStudents(mappedInitial);
              setLoading(false);
            }
          } catch (err) {
            console.error("Error seeding initial students to Firestore:", err);
            if (isMounted.current) {
              setConnectionError(err instanceof Error ? err.message : String(err));
              setLoading(false);
            }
          }
        } else {
          setStudents(combined);
          setLoading(false);
        }
      }
    };

    const unsubscribeHombres = onSnapshot(hombresRef, (snapshot) => {
      hombresData = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        hombresData.push({
          id: docSnap.id,
          name: data.nombre || docSnap.id,
          genre: 'men',
          elo: typeof data.elo === 'number' ? data.elo : 1200,
          matches: (data.votos_ganados ?? 0) + (data.votos_perdidos ?? 0),
          wins: data.votos_ganados ?? 0,
          createdAt: 0,
          perfilPhotoUrl: getAvatarUrl(data.nombre || docSnap.id, 'men'),
          actualizadoEn: data.actualizadoEn,
        });
      });
      hombresLoaded = true;
      checkAndSet();
    }, (error) => {
      console.error("Firestore onSnapshot Hombres Error:", error);
      if (isMounted.current) {
        setConnectionError(error.message || String(error));
        setLoading(false);
      }
    });

    const unsubscribeMujeres = onSnapshot(mujeresRef, (snapshot) => {
      mujeresData = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        mujeresData.push({
          id: docSnap.id,
          name: data.nombre || docSnap.id,
          genre: 'women',
          elo: typeof data.elo === 'number' ? data.elo : 1200,
          matches: (data.votos_ganados ?? 0) + (data.votos_perdidos ?? 0),
          wins: data.votos_ganados ?? 0,
          createdAt: 0,
          perfilPhotoUrl: getAvatarUrl(data.nombre || docSnap.id, 'women'),
          actualizadoEn: data.actualizadoEn,
        });
      });
      mujeresLoaded = true;
      checkAndSet();
    }, (error) => {
      console.error("Firestore onSnapshot Mujeres Error:", error);
      if (isMounted.current) {
        setConnectionError(error.message || String(error));
        setLoading(false);
      }
    });

    return () => {
      isMounted.current = false;
      unsubscribeHombres();
      unsubscribeMujeres();
    };
  }, []);

  // --- MATCHMAKER TRIGGER ---
  const triggerNewMatchup = useCallback((
    currentStudents: Student[],
    genre: 'women' | 'men',
    prevIds: [string, string] | null,
    playedKeys: string[]
  ) => {
    const nextMatch = selectMatchup(currentStudents, genre, prevIds, new Set(playedKeys));
    setCurrentMatchup(nextMatch);
  }, []);

  // Update matchup when active tab (gender) changes or students are loaded
  useEffect(() => {
    if (students.length > 0) {
      triggerNewMatchup(students, activeTab, lastMatchupIds, playedMatchups);
    }
  }, [activeTab, students.length, triggerNewMatchup]);

  // --- VOTE PROCESSING (ELO ENGINE) ---
  const handleVote = async (winnerId: string, loserId: string) => {
    if (!currentMatchup) return;

    const winner = students.find((s) => s.id === winnerId);
    const loser = students.find((s) => s.id === loserId);

    if (!winner || !loser) return;

    // Calculate ELO update
    const { winnerDelta, loserDelta, winnerNew, loserNew } = calculateElo(
      winner.elo,
      loser.elo,
      32 // K-factor as specified
    );

    // Play arcade audio blip
    playArcadeVoteSound(isMuted);

    // Show temporary floating numbers
    setEloFeedback({
      leftId: currentMatchup[0].id,
      rightId: currentMatchup[1].id,
      leftDelta: currentMatchup[0].id === winnerId ? winnerDelta : loserDelta,
      rightDelta: currentMatchup[1].id === winnerId ? winnerDelta : loserDelta,
      winnerId: winnerId,
    });

    // Clear feedback floating numbers after 850ms
    setTimeout(() => {
      if (isMounted.current) {
        setEloFeedback(null);
      }
    }, 850);

    // Map updated state (optimistic)
    const nextStudentsList = students.map((it) => {
      if (it.id === winnerId) {
        return {
          ...it,
          elo: winnerNew,
          matches: it.matches + 1,
          wins: it.wins + 1,
        };
      }
      if (it.id === loserId) {
        return {
          ...it,
          elo: loserNew,
          matches: it.matches + 1,
        };
      }
      return it;
    });

    // Save optimistically locally
    setStudents(nextStudentsList);
    
    // Write changes to Firestore
    try {
      const winnerRef = doc(db, 'CTA7.Estudiantes', 'generos', winner.genre === 'men' ? 'hombres' : 'mujeres', winnerId);
      const loserRef = doc(db, 'CTA7.Estudiantes', 'generos', loser.genre === 'men' ? 'hombres' : 'mujeres', loserId);

      await Promise.all([
        setDoc(winnerRef, {
          nombre: winner.name,
          elo: winnerNew,
          perfilPhotoUrl: getAvatarUrl(winner.name, winner.genre),
          votos_ganados: winner.wins + 1,
          votos_perdidos: (winner.matches - winner.wins),
          genre: winner.genre,
          actualizadoEn: formatSpTimestamp(new Date())
        }, { merge: true }),

        setDoc(loserRef, {
          nombre: loser.name,
          elo: loserNew,
          perfilPhotoUrl: getAvatarUrl(loser.name, loser.genre),
          votos_ganados: loser.wins,
          votos_perdidos: (loser.matches - loser.wins + 1),
          genre: loser.genre,
          actualizadoEn: formatSpTimestamp(new Date())
        }, { merge: true })
      ]);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `CTA7.Estudiantes/generos/${winner.genre === 'men' ? 'hombres' : 'mujeres'}/${winnerId},${loserId}`);
    }
    
    // Track stats
    const nextVotes = totalVotes + 1;
    setTotalVotes(nextVotes);
    localStorage.setItem('mashMatch_votes_count', String(nextVotes));

    // Save last matchup to prevent quick repetition
    const matchedIds: [string, string] = [winnerId, loserId];
    setLastMatchupIds(matchedIds);

    // Log the played matchup to exclude it in the matchmaking of this category
    const matchupKey = winnerId < loserId ? `${winnerId}_${loserId}` : `${loserId}_${winnerId}`;
    const nextPlayedList = [...playedMatchups, matchupKey];
    setPlayedMatchups(nextPlayedList);
    localStorage.setItem('mashMatch_played_matchups', JSON.stringify(nextPlayedList));

    // Pull next match with updated list of played pairings
    triggerNewMatchup(nextStudentsList, activeTab, matchedIds, nextPlayedList);
  };

  // --- KEYBOARD LISTENERS ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcut if user is inputting text anywhere
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.tagName === 'TEXTAREA')
      ) {
        return;
      }

      if (!currentMatchup) return;

      const [leftStudent, rightStudent] = currentMatchup;

      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setPressedKey('left');
        handleVote(leftStudent.id, rightStudent.id);
        setTimeout(() => setPressedKey(null), 150);
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        e.preventDefault();
        setPressedKey('right');
        handleVote(rightStudent.id, leftStudent.id);
        setTimeout(() => setPressedKey(null), 150);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentMatchup, isMuted, students, totalVotes, activeTab, lastMatchupIds, playedMatchups]);

  // --- AUDIO MUTING ---
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    localStorage.setItem('mashMatch_muted', JSON.stringify(nextMuted));
  };

  // --- RESET ALL DATA (RESTORE DEFAULTS) ---
  const handleResetData = async () => {
    if (window.confirm('¿Estás seguro de que deseas reiniciar todos los puntajes ELO de la base de datos en la nube y restaurar al estado inicial?')) {
      setLoading(true);
      try {
        const hombresSnap = await getDocs(collection(db, 'CTA7.Estudiantes', 'generos', 'hombres'));
        const mujeresSnap = await getDocs(collection(db, 'CTA7.Estudiantes', 'generos', 'mujeres'));
        
        // delete all current docs
        await Promise.all([
          ...hombresSnap.docs.map(docSnap => deleteDoc(doc(db, 'CTA7.Estudiantes', 'generos', 'hombres', docSnap.id))),
          ...mujeresSnap.docs.map(docSnap => deleteDoc(doc(db, 'CTA7.Estudiantes', 'generos', 'mujeres', docSnap.id))),
        ]);

        // immediately seed the database
        const initial = getInitialStudents();
        await Promise.all(
          initial.map(async (s) => {
            const docId = getStudentDocumentId(s.name);
            const docRef = doc(db, 'CTA7.Estudiantes', 'generos', s.genre === 'men' ? 'hombres' : 'mujeres', docId);
            await setDoc(docRef, {
              nombre: s.name,
              elo: s.elo,
              perfilPhotoUrl: getAvatarUrl(s.name, s.genre),
              votos_ganados: 0,
              votos_perdidos: 0,
              genre: s.genre,
              actualizadoEn: formatSpTimestamp(new Date())
            });
          })
        );

        const mappedInitial = initial.map((s) => ({
          ...s,
          id: getStudentDocumentId(s.name),
        }));

        setTotalVotes(0);
        setLastMatchupIds(null);
        setPlayedMatchups([]);
        localStorage.setItem('mashMatch_votes_count', '0');
        localStorage.removeItem('mashMatch_played_matchups');
        
        if (isMounted.current) {
          setStudents(mappedInitial);
          setLoading(false);
        }
        alert('Base de datos y listado de estudiantes restaurado con éxito.');
      } catch (err) {
        if (isMounted.current) {
          setLoading(false);
        }
        handleFirestoreError(err, OperationType.DELETE, 'CTA7.Estudiantes/generos');
      }
    }
  };

  // --- ADD STUDENT HANDLER ---
  const handleAddStudentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAddError('');

    const trimmedName = newStudentName.trim();
    if (!trimmedName) {
      setAddError('Por favor ingresa un nombre válido.');
      return;
    }

    if (trimmedName.length < 3) {
      setAddError('El nombre debe tener al menos 3 caracteres.');
      return;
    }

    // Check for duplicate name inside the same gender to avoid issues
    const isDuplicate = students.some(
      (s) => s.name.toLowerCase() === trimmedName.toLowerCase() && s.genre === newStudentGenre
    );
    if (isDuplicate) {
      setAddError('Este estudiante ya se encuentra registrado en esta categoría.');
      return;
    }

    const docId = getStudentDocumentId(trimmedName);
    
    try {
      const docRef = doc(db, 'CTA7.Estudiantes', 'generos', newStudentGenre === 'men' ? 'hombres' : 'mujeres', docId);
      await setDoc(docRef, {
        nombre: trimmedName,
        elo: 1200,
        perfilPhotoUrl: getAvatarUrl(trimmedName, newStudentGenre),
        votos_ganados: 0,
        votos_perdidos: 0,
        genre: newStudentGenre,
        actualizadoEn: formatSpTimestamp(new Date())
      });

      // Reset fields & close
      setNewStudentName('');
      setIsAddModalOpen(false);
    } catch (err) {
      setAddError('Error al guardar en la base de datos de Firebase: ' + (err instanceof Error ? err.message : String(err)));
      handleFirestoreError(err, OperationType.CREATE, `CTA7.Estudiantes/${docId}`);
    }
  };

  // --- LEADERBOARD LOGIC: STRICT TOP 3 ONLY ---
  const activeTabStudents = students.filter((s) => s.genre === activeTab);
  
  // Sort students strictly by ELO descending, then wins, then created date
  const sortedRanking = [...activeTabStudents].sort((a, b) => {
    if (b.elo !== a.elo) return b.elo - a.elo;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.createdAt - a.createdAt;
  });

  const top3 = sortedRanking.slice(0, 3);
  
  // Split podium arrangement: [2nd, 1st, 3rd] for balanced visual layout
  const podiumStudents: { place: 1 | 2 | 3; student: Student | null }[] = [
    { place: 2, student: top3[1] || null },
    { place: 1, student: top3[0] || null },
    { place: 3, student: top3[2] || null },
  ];

  // Helper check for custom high-end Guiannella highlight
  const isGuiannella = (name: string) => {
    return name.toLowerCase() === 'guiannella bravo flores';
  };

  // Cálculo de cuántos versus únicos se pueden hacer sin repetir parejas
  const totalPossibleMatchups = Math.max(0, (activeTabStudents.length * (activeTabStudents.length - 1)) / 2);
  const playedInThisCategory = playedMatchups.filter(key => {
    const [idA, idB] = key.split('_');
    const studentA = students.find(s => s.id === idA);
    const studentB = students.find(s => s.id === idB);
    return studentA && studentB && studentA.genre === activeTab && studentB.genre === activeTab;
  }).length;
  const remainingMatchups = Math.max(0, totalPossibleMatchups - playedInThisCategory);

  if (connectionError) {
    return (
      <div className="min-h-screen bg-[#050505] text-[#e0e0e0] flex flex-col items-center justify-center font-sans p-6">
        <div className="w-full max-w-md bg-black/60 border border-white/10 rounded-2xl p-6 sm:p-8 backdrop-blur-md shadow-[0_0_50px_rgba(255,0,122,0.15)] flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-center mb-6">
            <X className="w-8 h-8 text-red-500 animate-pulse" />
          </div>
          <h2 className="text-xl font-bold font-sans tracking-tight text-white mb-2 uppercase">Error de Conexión a Firebase</h2>
          <p className="text-xs text-white/60 mb-6 font-mono leading-relaxed bg-white/5 border border-white/5 p-3 rounded-lg w-full text-left overflow-x-auto whitespace-pre-wrap max-h-36">
            {connectionError}
          </p>
          <div className="text-left text-xs space-y-3 text-white/70 w-full mb-6">
            <p className="font-bold text-[#ff007a] uppercase tracking-wider font-mono text-[10px]">¿Cómo solucionar este error?</p>
            <div className="flex gap-2">
              <span className="text-[#bc13fe] font-black">1.</span>
              <p>Verifica que las <strong>Reglas de Seguridad (Security Rules)</strong> de tu nueva base de datos Firestore de Firebase permitan la lectura y escritura pública para la ruta <code>CTA7.Estudiantes</code>.</p>
            </div>
            <pre className="text-[10px] bg-black/80 font-mono p-2.5 rounded-lg border border-white/5 text-[#ff007a] overflow-x-auto select-all">
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /CTA7.Estudiantes/{document=**} {
      allow read, write: if true;
    }
  }
}`}
            </pre>
            <div className="flex gap-2">
              <span className="text-[#bc13fe] font-black">2.</span>
              <p>Asegúrate de que <strong>Cloud Firestore</strong> esté activado en tu pantalla de la consola de Firebase del proyecto ({db.app.options.projectId}).</p>
            </div>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#ff007a] to-[#bc13fe] text-white font-black text-sm tracking-widest hover:scale-[1.02] active:scale-95 transition-all text-center cursor-pointer shadow-[0_4px_20px_rgba(255,0,122,0.3)] mb-4 uppercase"
          >
            Reintentar Conexión
          </button>
          
          <button
            onClick={() => {
              // Permitir usar datos en local si Firebase falla para que la página sea interactiva
              setStudents(getInitialStudents().map(s => ({ ...s, id: getStudentDocumentId(s.name) })));
              setConnectionError(null);
            }}
            className="text-xs text-[#ff007a] hover:text-white transition-colors cursor-pointer font-bold underline uppercase tracking-wider mt-2 border border-[#ff007a]/30 rounded-lg py-2 px-4 bg-[#ff007a]/5"
          >
            Continuar con Datos Locales
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-[#e0e0e0] flex flex-col items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-[#bc13fe] to-[#ff007a] flex items-center justify-center shadow-[0_0_20px_rgba(188,19,254,0.5)] animate-pulse">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <p className="text-xs font-mono tracking-widest text-[#ff007a] uppercase animate-pulse">Conectando a la nube...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] flex flex-col font-sans relative overflow-x-hidden selection:bg-[#ff007a] selection:text-white">
      {/* Immersive background radial glow accents */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[500px] bg-[radial-gradient(circle_at_center,rgba(188,19,254,0.08)_0,transparent_65%)] pointer-events-none" />
      <div className="absolute top-80 -left-48 w-96 h-96 bg-[#ff007a]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-[400px] -right-48 w-96 h-96 bg-[#bc13fe]/5 rounded-full blur-3xl pointer-events-none" />

      {/* --- FLOATING NOTIFIER BANNER FOR SFX --- */}
      <header className="h-20 border-b border-white/10 flex items-center justify-between px-4 sm:px-10 bg-black/40 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-[#bc13fe] to-[#ff007a] rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(188,19,254,0.4)] transition-transform hover:scale-105 duration-200">
            <span className="font-black text-white italic text-lg select-none">M</span>
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tighter uppercase italic leading-none flex items-center gap-1.5 text-white">
              MashMatch 
              <span className="text-[#ff007a] text-[10px] align-top font-bold uppercase tracking-widest bg-[#ff007a]/15 px-1.5 py-0.5 rounded border border-[#ff007a]/20">v4.0</span>
            </h1>
            <p className="text-[9px] font-mono text-white/40 uppercase tracking-widest mt-1 hidden sm:block">
              Aula de Adultos • ELO Matcher
            </p>
          </div>
        </div>

        {/* --- TABS --- */}
        <nav className="flex bg-white/5 rounded-full p-1 border border-white/10">
          <button
            onClick={() => setActiveTab('women')}
            className={`px-4 sm:px-8 py-2 rounded-full font-bold text-xs sm:text-sm transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'women'
                ? 'bg-gradient-to-r from-[#ff007a] to-[#bc13fe] text-white shadow-[0_0_15px_rgba(255,0,122,0.35)] font-black'
                : 'text-white/40 hover:text-white/80'
            }`}
          >
            <Venus className="w-4 h-4 shrink-0" /> <span className="hidden xs:inline">Mujeres</span>
          </button>
          <button
            onClick={() => setActiveTab('men')}
            className={`px-4 sm:px-8 py-2 rounded-full font-bold text-xs sm:text-sm transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'men'
                ? 'bg-gradient-to-r from-[#ff007a] to-[#bc13fe] text-white shadow-[0_0_15px_rgba(255,0,122,0.35)] font-black'
                : 'text-white/40 hover:text-white/80'
            }`}
          >
            <Mars className="w-4 h-4 shrink-0" /> <span className="hidden xs:inline">Hombres</span>
          </button>
        </nav>

        {/* --- UTILITIES AND SWITCHES --- */}
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={toggleMute}
            className="flex items-center gap-2 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all cursor-pointer text-white/60 hover:text-white"
            title={isMuted ? 'Activar sonido arcade' : 'Silenciar sonido arcade'}
          >
            {isMuted ? (
              <>
                <VolumeX className="w-4 h-4 text-red-500" />
                <span className="text-[9px] font-mono tracking-wider uppercase text-red-500 hidden md:inline">SFX MUTED</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 text-[#ff007a]" />
                <span className="text-[9px] font-mono tracking-wider uppercase text-[#ff007a] hidden md:inline">SFX ACTIVE</span>
              </>
            )}
          </button>

          <button
            onClick={handleResetData}
            title="Restaurar base de datos inicial"
            className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/5 hover:text-red-400 transition-all cursor-pointer text-white/60"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* --- MAIN SPLIT PANEL CONTAINER --- */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8 flex flex-col lg:flex-row gap-8 overflow-hidden z-10 relative">
        
        {/* --- LEFT HAND: VOTING ARENA --- */}
        <section className="flex-1 flex flex-col gap-6 lg:max-h-[640px]">
          <div className="flex flex-col items-center justify-center mb-1 gap-2.5">
            <h2 className="text-xs font-mono tracking-widest text-[#ff007a] uppercase italic flex items-center justify-center gap-2 text-center">
              <span className="inline-block w-2 h-2 rounded-full bg-[#ff007a] animate-pulse" />
              {activeTab === 'women' ? '¿Quién es la más linda?' : '¿Quién es el más guapo?'}
            </h2>
            
            {/* Visual indicator of maximum unrepeated matchups / potential loop limits */}
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full text-[10px] font-mono text-white/60 shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
              <div className="flex items-center gap-1">
                <span>Versus Posibles:</span>
                <span className="text-white font-bold">{totalPossibleMatchups}</span>
              </div>
              <span className="text-white/20 hidden xs:inline">•</span>
              <div className="flex items-center gap-1">
                <span>Votados:</span>
                <span className="text-[#ff007a] font-bold">{playedInThisCategory}</span>
              </div>
              <span className="text-white/20 hidden xs:inline">•</span>
              {remainingMatchups > 0 ? (
                <div className="flex items-center gap-1">
                  <span>Por Votar:</span>
                  <span className="text-emerald-400 font-bold">{remainingMatchups}</span>
                </div>
              ) : (
                <span className="text-yellow-400 font-bold animate-pulse">¡Ciclo completado!</span>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-row gap-2.5 sm:gap-6 items-stretch relative min-h-[280px] xs:min-h-[320px] sm:min-h-[380px]">
            {/* Immersive Beautiful VS Crest centered */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
              <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-[#050505] border-2 border-[#ff007a] flex items-center justify-center shadow-[0_0_25px_rgba(255,0,122,0.65)]">
                <span className="text-xs sm:text-lg font-black italic text-white tracking-widest">VS</span>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {currentMatchup && currentMatchup.length === 2 ? (
                <>
                  {/* LEFT STUDENT CORE VOTE BOARD */}
                  <motion.div
                    key={`left-${currentMatchup[0].id}`}
                    initial={{ opacity: 0, scale: 0.95, x: -15 }}
                    animate={{ 
                      opacity: 1, 
                      scale: pressedKey === 'left' ? 0.97 : 1,
                      x: 0,
                    }}
                    exit={{ opacity: 0, scale: 0.95, x: -10 }}
                    transition={{ type: 'spring', stiffness: 220, damping: 20 }}
                    onClick={() => handleVote(currentMatchup[0].id, currentMatchup[1].id)}
                    className={`flex-1 min-w-0 bg-white/[0.03] border ${
                      pressedKey === 'left'
                        ? 'border-[#ff007a]/90 shadow-[0_0_30px_rgba(255,0,122,0.3)] bg-white/[0.06] scale-[0.98]'
                        : 'border-white/10 hover:border-[#ff007a]/60 duration-300'
                    } rounded-[20px] sm:rounded-[32px] overflow-hidden group cursor-pointer transition-all flex flex-col p-3 xs:p-5 sm:p-8 items-center justify-between text-center relative`}
                  >
                    {/* Background glow vignette */}
                    <div className="absolute inset-0 bg-gradient-to-b from-[#ff007a]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                    {/* Top shortcuts layout */}
                    <div className="absolute top-2 left-2 sm:top-4 sm:left-4 flex gap-1">
                      <span className="bg-black/80 border border-white/15 px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg text-[8px] sm:text-[10px] font-mono tracking-widest text-[#ff007a] group-hover:border-[#ff007a] group-hover:text-white transition-all uppercase">
                        VOTAR [A]
                      </span>
                    </div>

                    <div className="absolute top-2 right-2 sm:top-4 sm:right-4 bg-black/80 border border-white/10 px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-[9px] sm:text-xs font-mono text-white/50">
                      🛡️ <span className="hidden xs:inline">ELO </span>{currentMatchup[0].elo}
                    </div>

                    {/* Styled Avatar */}
                    <div className="relative mt-8 xs:mt-12 mb-3 sm:mb-4">
                      {/* Interactive circular backdrops */}
                      <div className="absolute inset-0 bg-gradient-to-b from-[#ff007a]/15 to-[#bc13fe]/15 rounded-full blur-xl sm:blur-2xl group-hover:scale-110 duration-500 transition-transform" />
                      <div className="relative w-16 h-16 xs:w-28 xs:h-28 sm:w-44 sm:h-44 rounded-full border border-white/10 bg-[#121214] overflow-hidden flex items-center justify-center p-1 sm:p-2 group-hover:scale-105 duration-300 transition-transform shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]">
                        <img
                          src={currentMatchup[0].perfilPhotoUrl || getAvatarUrl(currentMatchup[0].name, currentMatchup[0].genre)}
                          alt={currentMatchup[0].name}
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>

                      {/* Delta floating increment/decrement display */}
                      {eloFeedback && eloFeedback.leftId === currentMatchup[0].id && (
                        <motion.div
                          initial={{ opacity: 0, y: 15, scale: 0.8 }}
                          animate={{ opacity: 1, y: -40, scale: 1.25 }}
                          exit={{ opacity: 0 }}
                          className={`absolute left-1/2 -translate-x-1/2 text-xs font-mono font-bold px-3 py-1 rounded-full shadow-lg ${
                            eloFeedback.leftDelta > 0
                              ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                              : 'bg-rose-500 text-white shadow-rose-500/20'
                          }`}
                        >
                          {eloFeedback.leftDelta > 0 ? `+${eloFeedback.leftDelta}` : eloFeedback.leftDelta} ELO
                        </motion.div>
                      )}
                    </div>

                    {/* Name Tag & Stats */}
                    <div className="mb-2 sm:mb-4">
                      <h3 className="text-xs xs:text-base sm:text-2xl font-bold tracking-tight text-white group-hover:text-[#ff007a] transition-all line-clamp-1">
                        {currentMatchup[0].name}
                      </h3>
                      
                      <div className="flex items-center justify-center gap-1 sm:gap-2.5 mt-1 sm:mt-2.5 text-[9px] sm:text-[11px] font-mono text-white/40">
                        <span className="flex items-center gap-0.5 sm:gap-1">
                          <Flame className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 text-[#ff007a]" />
                          <span>{currentMatchup[0].matches} <span className="hidden sm:inline">partidas</span><span className="sm:hidden">P</span></span>
                        </span>
                        <span>•</span>
                        <span>{currentMatchup[0].wins} <span className="hidden sm:inline">victorias</span><span className="sm:hidden">V</span></span>
                      </div>
                    </div>

                    <div className="w-full mt-2">
                      <div className="w-full py-1.5 xs:py-2.5 rounded-full border border-white/10 group-hover:bg-[#ff007a] group-hover:border-[#ff007a] group-hover:text-white transition-all text-white/50 text-[10px] sm:text-xs font-bold tracking-widest uppercase">
                        Votar<span className="hidden xs:inline"> [A]</span>
                      </div>
                    </div>
                  </motion.div>

                  {/* RIGHT STUDENT CORE VOTE BOARD */}
                  <motion.div
                    key={`right-${currentMatchup[1].id}`}
                    initial={{ opacity: 0, scale: 0.95, x: 15 }}
                    animate={{ 
                      opacity: 1, 
                      scale: pressedKey === 'right' ? 0.97 : 1,
                      x: 0,
                    }}
                    exit={{ opacity: 0, scale: 0.95, x: 10 }}
                    transition={{ type: 'spring', stiffness: 220, damping: 20 }}
                    onClick={() => handleVote(currentMatchup[1].id, currentMatchup[0].id)}
                    className={`flex-1 min-w-0 bg-white/[0.03] border ${
                      pressedKey === 'right'
                        ? 'border-[#bc13fe]/90 shadow-[0_0_30px_rgba(188,19,254,0.3)] bg-white/[0.06] scale-[0.98]'
                        : 'border-[#bc13fe]/30 hover:border-[#bc13fe] shadow-[0_0_30px_rgba(188,19,254,0.06)]'
                    } rounded-[20px] sm:rounded-[32px] overflow-hidden group cursor-pointer transition-all flex flex-col p-3 xs:p-5 sm:p-8 items-center justify-between text-center relative`}
                  >
                    {/* Specialty indicator if right student is highest rated or favored */}
                    {currentMatchup[1].elo > currentMatchup[0].elo && (
                      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-10 animate-pulse">
                        <div className="bg-[#bc13fe] text-[8px] sm:text-[9px] px-1.5 py-0.5 sm:px-2 sm:py-0.5 rounded-full font-black text-white italic tracking-wider shadow-[0_0_10px_rgba(188,19,254,0.7)] uppercase">
                          ⭐<span className="hidden sm:inline"> Favorito</span>
                        </div>
                      </div>
                    )}

                    {/* Background glow vignette */}
                    <div className="absolute inset-0 bg-gradient-to-b from-[#bc13fe]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                    {/* Top shortcuts layout */}
                    <div className="absolute top-2 left-2 sm:top-4 sm:left-4 flex gap-1">
                      <span className="bg-black/80 border border-white/15 px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg text-[8px] sm:text-[10px] font-mono tracking-widest text-[#bc13fe] group-hover:border-[#bc13fe] group-hover:text-white transition-all uppercase">
                        VOTAR [D]
                      </span>
                    </div>

                    {/* Standard ELO info if not favorited */}
                    {currentMatchup[1].elo <= currentMatchup[0].elo && (
                      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 bg-black/80 border border-white/10 px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-[9px] sm:text-xs font-mono text-white/50">
                        🛡️ <span className="hidden xs:inline">ELO </span>{currentMatchup[1].elo}
                      </div>
                    )}

                    {/* Styled Avatar */}
                    <div className="relative mt-8 xs:mt-12 mb-3 sm:mb-4">
                      {/* Interactive circular backdrops */}
                      <div className="absolute inset-0 bg-gradient-to-b from-[#bc13fe]/15 to-[#ff007a]/15 rounded-full blur-xl sm:blur-2xl group-hover:scale-110 duration-500 transition-transform" />
                      <div className="relative w-16 h-16 xs:w-28 xs:h-28 sm:w-44 sm:h-44 rounded-full border border-[#bc13fe]/30 bg-[#121214] overflow-hidden flex items-center justify-center p-1 sm:p-2 group-hover:scale-105 duration-300 transition-transform shadow-[inset_0_0_25px_rgba(188,19,254,0.15)]">
                        <img
                          src={currentMatchup[1].perfilPhotoUrl || getAvatarUrl(currentMatchup[1].name, currentMatchup[1].genre)}
                          alt={currentMatchup[1].name}
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>

                      {/* Delta floating increment/decrement display */}
                      {eloFeedback && eloFeedback.rightId === currentMatchup[1].id && (
                        <motion.div
                          initial={{ opacity: 0, y: 15, scale: 0.8 }}
                          animate={{ opacity: 1, y: -40, scale: 1.25 }}
                          exit={{ opacity: 0 }}
                          className={`absolute left-1/2 -translate-x-1/2 text-xs font-mono font-bold px-3 py-1 rounded-full shadow-lg ${
                            eloFeedback.rightDelta > 0
                              ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                              : 'bg-rose-500 text-white shadow-rose-500/20'
                          }`}
                        >
                          {eloFeedback.rightDelta > 0 ? `+${eloFeedback.rightDelta}` : eloFeedback.rightDelta} ELO
                        </motion.div>
                      )}
                    </div>

                    {/* Name Tag & Stats */}
                    <div className="mb-2 sm:mb-4">
                      <h3 className="text-xs xs:text-base sm:text-2xl font-bold tracking-tight text-white group-hover:text-[#bc13fe] transition-all line-clamp-1">
                        {currentMatchup[1].name}
                      </h3>
                      
                      <div className="flex items-center justify-center gap-1 sm:gap-2.5 mt-1 sm:mt-2.5 text-[9px] sm:text-[11px] font-mono text-white/40">
                        <span className="flex items-center gap-0.5 sm:gap-1">
                          <Flame className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 text-[#bc13fe]" />
                          <span>{currentMatchup[1].matches} <span className="hidden sm:inline">partidas</span><span className="sm:hidden">P</span></span>
                        </span>
                        <span>•</span>
                        <span>{currentMatchup[1].wins} <span className="hidden sm:inline">victorias</span><span className="sm:hidden">V</span></span>
                      </div>
                    </div>

                    <div className="w-full mt-2">
                       <div className="w-full py-1.5 xs:py-2.5 rounded-full bg-[#bc13fe] text-white transition-all text-[10px] sm:text-xs font-bold tracking-widest uppercase shadow-[0_0_20px_rgba(188,19,254,0.3)]">
                        Votar<span className="hidden xs:inline"> [D]</span>
                      </div>
                    </div>
                  </motion.div>
                </>
              ) : (
                <div className="flex-1 w-full flex flex-col items-center justify-center bg-white/[0.02] border border-dashed border-white/10 rounded-[32px] p-12 text-center min-h-[300px]">
                  <p className="text-white/60 font-display text-lg">No hay suficientes estudiantes en esta categoría</p>
                  <p className="text-xs text-white/30 mt-2">Usa el botón para registrar al menos 2 personas y empezar.</p>
                  <button 
                    onClick={() => setIsAddModalOpen(true)}
                    className="mt-6 px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold tracking-widest uppercase rounded-full transition-all"
                  >
                    + Registrar Estudiante
                  </button>
                </div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* --- RIGHT HAND: LEADERBOARD SIDEBAR --- */}
        <aside className="w-full lg:w-[320px] flex flex-col gap-6 shrink-0 justify-between">
          <div>
            <h2 className="text-xs font-mono tracking-widest text-white/30 uppercase italic mb-4">
              Podio de Honor
            </h2>

            {/* Immersive Sidebar container strictly showcasing Top 3 only for privacy */}
            <div className="bg-white/[0.02] border border-white/10 rounded-[32px] p-6 flex flex-col gap-4 relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-[#bc13fe]/10 rounded-full blur-3xl pointer-events-none" />

              {sortedRanking.length === 0 ? (
                <div className="text-center py-12 text-xs font-mono text-white/30 italic">
                  Registros nulos todavía
                </div>
              ) : (
                <>
                  {/* Rank 1 Student Block */}
                  {top3[0] ? (
                    <div className={`border rounded-2xl p-4 relative overflow-hidden group transition-all duration-300 ${
                      isGuiannella(top3[0].name)
                        ? 'border-violet-500/80 bg-violet-950/25 shadow-[0_0_20px_rgba(188,19,254,0.3)]'
                        : 'bg-white/5 border-[#bc13fe]/30'
                    }`}>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-4xl opacity-15 font-black italic select-none">01</div>
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-full border-2 bg-black flex items-center justify-center text-xl shrink-0 ${
                          isGuiannella(top3[0].name) 
                            ? 'border-violet-400 shadow-[0_0_12px_rgba(188,19,254,0.6)]' 
                            : 'border-[#bc13fe] shadow-[0_0_10px_rgba(188,19,254,0.4)]'
                        }`}>
                          🥇
                        </div>
                        <div className="overflow-hidden">
                          <div className={`text-sm font-bold truncate leading-snug ${
                            isGuiannella(top3[0].name) ? 'text-violet-300' : 'text-white'
                          }`}>
                            {top3[0].name}
                          </div>
                          <div className="text-[10px] font-mono text-[#bc13fe] tracking-tighter uppercase font-semibold">
                            🏆 {top3[0].elo} Points • {top3[0].wins}V
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Rank 2 Student Block */}
                  {top3[1] ? (
                    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 relative overflow-hidden">
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-4xl opacity-10 font-black italic select-none">02</div>
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full border border-white/20 bg-white/5 flex items-center justify-center text-xl shrink-0">
                          🥈
                        </div>
                        <div className="overflow-hidden">
                          <div className="text-sm font-bold text-white/80 truncate leading-snug">{top3[1].name}</div>
                          <div className="text-[10px] font-mono text-white/40 tracking-tighter uppercase mt-0.5">
                            {top3[1].elo} Points • {top3[1].wins}V
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-white/5 border-dashed rounded-2xl p-4 text-center text-[10px] text-white/20 font-mono">
                      Segundo puesto vacante
                    </div>
                  )}

                  {/* Rank 3 Student Block */}
                  {top3[2] ? (
                    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 relative overflow-hidden">
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-4xl opacity-10 font-black italic select-none">03</div>
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full border border-white/20 bg-white/5 flex items-center justify-center text-xl shrink-0">
                          🥉
                        </div>
                        <div className="overflow-hidden">
                          <div className="text-sm font-bold text-white/80 truncate leading-snug">{top3[2].name}</div>
                          <div className="text-[10px] font-mono text-white/40 tracking-tighter uppercase mt-0.5">
                            {top3[2].elo} Points • {top3[2].wins}V
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-white/5 border-dashed rounded-2xl p-4 text-center text-[10px] text-white/20 font-mono">
                      Tercer puesto vacante
                    </div>
                  )}
                </>
              )}

            </div>
          </div>
        </aside>

      </main>





      {/* --- ADD NEW STUDENT MODAL DIALOG --- */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-[#0c0c0e] border border-white/10 rounded-[32px] p-6 sm:p-8 w-full max-w-md shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#ff007a] to-[#bc13fe]" />

              <div className="flex items-center justify-between pb-4 border-b border-white/5">
                <div className="flex items-center gap-2.5">
                  <UserPlus className="w-5 h-5 text-[#ff007a]" />
                  <h3 className="text-md font-display font-bold uppercase tracking-wider text-white">
                    Registrar Estudiante
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddStudentSubmit} className="mt-6 flex flex-col gap-4">
                <div>
                  <label htmlFor="student-name" className="block text-[10px] font-semibold text-white/40 uppercase tracking-widest mb-2 font-mono">
                    Nombre Completo
                  </label>
                  <input
                    id="student-name"
                    type="text"
                    required
                    maxLength={32}
                    placeholder="Ej. Juan de Dios Castillo"
                    value={newStudentName}
                    onChange={(e) => {
                      setNewStudentName(e.target.value);
                      if (addError) setAddError('');
                    }}
                    className="w-full bg-white/5 border border-white/10 focus:border-[#ff007a] focus:ring-1 focus:ring-[#ff007a] outline-none rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 transition-all font-sans"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-widest mb-2 font-mono">
                    Categoría / Género
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setNewStudentGenre('women')}
                      className={`py-2 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                        newStudentGenre === 'women'
                          ? 'bg-[#ff007a]/15 border-[#ff007a] text-white'
                          : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'
                      }`}
                    >
                      <Venus className="w-4 h-4 shrink-0" />
                      <span>Mujeres</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewStudentGenre('men')}
                      className={`py-2 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                        newStudentGenre === 'men'
                          ? 'bg-[#bc13fe]/15 border-[#bc13fe] text-white'
                          : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'
                      }`}
                    >
                      <Mars className="w-4 h-4 shrink-0" />
                      <span>Hombres</span>
                    </button>
                  </div>
                </div>

                {addError && (
                  <div className="text-red-400 text-xs font-mono bg-red-950/20 border border-red-900/40 p-3 rounded-lg animate-shake">
                    ⚠️ {addError}
                  </div>
                )}

                <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 mt-2">
                  <p className="text-[10px] text-white/30 leading-relaxed font-mono">
                    💡 El estudiante registrado comenzará automáticamente con un ELO base de <strong className="text-[#ff007a]">1200 puntos</strong> y un avatar exclusivo de DiceBear según género.
                  </p>
                </div>

                <div className="flex gap-2 justify-end mt-4 border-t border-white/5 pt-5">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 hover:bg-white/5 rounded-xl text-white/30 hover:text-white transition cursor-pointer text-xs uppercase font-bold tracking-wider"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-gradient-to-r from-[#ff007a] to-[#bc13fe] hover:brightness-110 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition cursor-pointer shadow-[0_0_15px_rgba(255,0,122,0.3)]"
                  >
                    Registrar Estudiante
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
