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
  Mars,
  Lock,
  Unlock,
  Settings,
  LogOut,
  Clock,
  ShieldCheck,
  Calendar
} from 'lucide-react';
import { Student } from './types';
import {
  getInitialStudents,
  selectMatchup,
  calculateElo,
  playArcadeVoteSound,
  getAvatarUrl,
  INITIAL_MEN,
  INITIAL_WOMEN
} from './utils';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  deleteDoc,
  getDoc
} from 'firebase/firestore';
import {
  db,
  auth,
  handleFirestoreError,
  OperationType,
  formatSpTimestamp,
  getStudentDocumentId
} from './firebase';
import {
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  User,
  onAuthStateChanged
} from 'firebase/auth';

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

  // Admin & Authentication Status
  const [user, setUser] = useState<User | null>(null);
  const [isUserAdmin, setIsUserAdmin] = useState<boolean>(false);
  const [checkingAdmin, setCheckingAdmin] = useState<boolean>(true);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState<boolean>(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);
  const [registering, setRegistering] = useState<boolean>(false);
  
  // Countdown Config & Time Tracking
  const [countdownConfig, setCountdownConfig] = useState<{ isActive: boolean; targetDate: string } | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    total: number;
  }>({ days: 0, hours: 0, minutes: 0, seconds: 0, total: 100000 });

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
        
        // Ensure ALL initial students from code are present in Firestore.
        // This is robust: preserved any existing ELO/votos, and adds missing students dynamically.
        const existingIds = new Set(combined.map((s) => s.id));
        const missingWomen = INITIAL_WOMEN.filter((name) => !existingIds.has(getStudentDocumentId(name)));
        const missingMen = INITIAL_MEN.filter((name) => !existingIds.has(getStudentDocumentId(name)));

        if (missingWomen.length > 0 || missingMen.length > 0) {
          console.log(`Auto-seeding missing students. Women: ${missingWomen.length}, Men: ${missingMen.length}`);
          try {
            await Promise.all([
              ...missingWomen.map(async (name) => {
                const docId = getStudentDocumentId(name);
                const docRef = doc(db, 'CTA7.Estudiantes', 'generos', 'mujeres', docId);
                await setDoc(docRef, {
                  nombre: name,
                  elo: 1200,
                  perfilPhotoUrl: getAvatarUrl(name, 'women'),
                  votos_ganados: 0,
                  votos_perdidos: 0,
                  genre: 'women',
                  actualizadoEn: formatSpTimestamp(new Date())
                });
              }),
              ...missingMen.map(async (name) => {
                const docId = getStudentDocumentId(name);
                const docRef = doc(db, 'CTA7.Estudiantes', 'generos', 'hombres', docId);
                await setDoc(docRef, {
                  nombre: name,
                  elo: 1200,
                  perfilPhotoUrl: getAvatarUrl(name, 'men'),
                  votos_ganados: 0,
                  votos_perdidos: 0,
                  genre: 'men',
                  actualizadoEn: formatSpTimestamp(new Date())
                });
              })
            ]);
            // The snapshot listener will fire again with the complete data set.
          } catch (err) {
            console.error("Error auto-seeding missing default students:", err);
            if (isMounted.current) {
              setStudents(combined);
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

  // --- PERSISTENCE & INIT: AUTHENTICATION, ADMIN & COUNTDOWN SYNC ---
  useEffect(() => {
    // Escuchar cambios de autenticación con Firebase Auth
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setCheckingAdmin(true);
        // Suscripción en tiempo real para verificar el estado de administrador en subcolección de CTA7.Estudiantes
        const adminDocRef = doc(db, 'CTA7.Estudiantes', 'configuracion', 'user-admin', currentUser.uid);
        const unsubscribeAdmin = onSnapshot(adminDocRef, (snap) => {
          setIsUserAdmin(snap.exists());
          setCheckingAdmin(false);
        }, (err) => {
          console.error("Error al suscribirse al estado de admin:", err);
          setIsUserAdmin(false);
          setCheckingAdmin(false);
        });
        return () => {
          unsubscribeAdmin();
        };
      } else {
        setIsUserAdmin(false);
        setCheckingAdmin(false);
      }
    });

    // Suscripción en tiempo real para configuraciones globales en Firestore (subcolección de CTA7.Estudiantes)
    const countdownDocRef = doc(db, 'CTA7.Estudiantes', 'configuracion', 'config', 'countdown');
    const unsubscribeCountdown = onSnapshot(countdownDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setCountdownConfig({
          isActive: data.isActive ?? false,
          targetDate: data.targetDate ?? '',
        });
      } else {
        setCountdownConfig({
          isActive: false,
          targetDate: '',
        });
      }
    }, (error) => {
      console.error("Error al obtener la configuración del temporizador:", error);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeCountdown();
    };
  }, []);

  // Ticker de cuenta regresiva
  useEffect(() => {
    if (!countdownConfig || !countdownConfig.isActive || !countdownConfig.targetDate) {
      setTimeRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0, total: 100000 });
      return;
    }

    const updateTimer = () => {
      const targetTime = new Date(countdownConfig.targetDate).getTime();
      const currentTime = new Date().getTime();
      const difference = targetTime - currentTime;

      if (difference <= 0) {
        setTimeRemaining({ days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 });
      } else {
        setTimeRemaining({
          days: Math.floor(difference / (1000 * 60 * 60 * 24)),
          hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((difference / 1000 / 60) % 60),
          seconds: Math.floor((difference / 1000) % 60),
          total: difference,
        });
      }
    };

    updateTimer();
    const ticker = setInterval(updateTimer, 1000);

    return () => clearInterval(ticker);
  }, [countdownConfig]);

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

    // Guardar restricciones si el contador de cuenta atrás está activo y finalizó
    if (countdownConfig?.isActive && timeRemaining.total <= 0) {
      return;
    }

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

      // Guardar restricciones si el contador de cuenta atrás está activo y finalizó
      if (countdownConfig?.isActive && timeRemaining.total <= 0) {
        return;
      }

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
  }, [currentMatchup, isMuted, students, totalVotes, activeTab, lastMatchupIds, playedMatchups, countdownConfig, timeRemaining.total]);

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
  const completionPercent = totalPossibleMatchups > 0 
    ? Math.min(100, Math.round((playedInThisCategory / totalPossibleMatchups) * 100)) 
    : 0;

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
            onClick={() => {
              setAdminError(null);
              setAdminSuccess(null);
              setIsAdminModalOpen(true);
            }}
            title={isUserAdmin ? "Panel de Admin Activo" : "Acceso de Administrador"}
            className={`w-10 h-10 rounded-full border ${
              isUserAdmin 
                ? 'border-[#ff007a] bg-[#ff007a]/15 text-[#ff007a] shadow-[0_0_15px_rgba(255,0,122,0.4)]' 
                : 'border-white/10 text-white/60 hover:text-white hover:bg-white/5'
            } flex items-center justify-center transition-all cursor-pointer`}
          >
            {isUserAdmin ? <ShieldCheck className="w-4.5 h-4.5" /> : <Lock className="w-4 h-4" />}
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
            
            {/* Dedicated futuristic voting progress bar component */}
            <div className="w-full max-w-md bg-white/5 border border-white/10 p-4 rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md">
              <div className="flex justify-between items-center text-[10px] font-mono mb-2 text-white/60 tracking-wider uppercase">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#ff007a] animate-pulse" />
                  Progreso de Votos
                </span>
                <span className="font-bold text-white font-mono">
                  {playedInThisCategory} / {totalPossibleMatchups} ({completionPercent}%)
                </span>
              </div>
              <div className="h-2.5 w-full bg-black/40 border border-white/5 rounded-full overflow-hidden relative p-[1px] shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]">
                {/* The glowing progress line */}
                <div 
                  className="h-full rounded-full bg-gradient-to-r from-[#ff007a] to-[#bc13fe] transition-all duration-500 ease-out shadow-[0_0_12px_rgba(255,0,122,0.6)]"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
              <div className="flex justify-between items-center mt-2 text-[9px] font-mono text-white/40 uppercase tracking-wider">
                <span>Total Versus: {totalPossibleMatchups}</span>
                {remainingMatchups > 0 ? (
                  <span>Por Votar: <span className="text-emerald-400 font-bold font-sans">{remainingMatchups}</span></span>
                ) : (
                  <span className="text-yellow-400 font-bold animate-pulse flex items-center gap-1">
                    🎉 ¡Categoría Completa!
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-row gap-2.5 sm:gap-6 items-stretch relative min-h-[280px] xs:min-h-[320px] sm:min-h-[380px]">
            {/* Immersive Beautiful VS Crest centered - only shown when there's an active matchup and voting is not ended */}
            {!(countdownConfig?.isActive && timeRemaining.total <= 0) && currentMatchup && currentMatchup.length === 2 && (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">
                <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-[#050505] border-2 border-[#ff007a] flex items-center justify-center shadow-[0_0_25px_rgba(255,0,122,0.65)]">
                  <span className="text-xs sm:text-lg font-black italic text-white tracking-widest">VS</span>
                </div>
              </div>
            )}

            <AnimatePresence mode="wait">
              {countdownConfig?.isActive && timeRemaining.total <= 0 ? (
                <motion.div
                  key="voting-ended"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex-1 flex flex-col items-center justify-center bg-[#0c0c0e]/90 border border-[#ff007a]/30 rounded-[20px] sm:rounded-[32px] p-6 sm:p-12 text-center shadow-[0_0_50px_rgba(255,0,122,0.15)] relative overflow-hidden backdrop-blur-md"
                >
                  <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-[#ff007a] via-[#bc13fe] to-[#ff007a]" />
                  <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-red-500/10 border-2 border-red-500/50 flex items-center justify-center text-red-500 mb-4 animate-bounce shadow-[0_0_30px_rgba(239,68,68,0.3)]">
                    <Lock className="w-6 h-6 sm:w-8 sm:h-8" />
                  </div>
                  <h3 className="text-xl sm:text-3xl font-black italic uppercase tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-[#ff007a] to-white">
                    Votación Finalizada
                  </h3>
                  <p className="text-xs sm:text-sm font-semibold text-white/60 max-w-sm mt-3 leading-relaxed">
                    La cuenta regresiva configurada por el administrador de MashMatch ha concluido. Nuevos votos de ELO están cerrados.
                  </p>
                  <div className="mt-6 px-4 py-2 bg-white/5 border border-white/10 rounded-xl">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-white/40 block">Fecha Límite Alcanzada</span>
                    <span className="text-xs font-mono font-bold text-red-400 mt-1 block">
                      {countdownConfig.targetDate ? new Date(countdownConfig.targetDate).toLocaleString('es-PE', { timeZone: 'America/Lima' }) : 'Sábado (Media Noche)'} (Perú)
                    </span>
                  </div>
                </motion.div>
              ) : currentMatchup && currentMatchup.length === 2 ? (
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

      {/* --- REAL-TIME COUNTDOWN FOOTER BAR --- */}
      <AnimatePresence>
        {countdownConfig?.isActive && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="w-full bg-[#08080a] border-t border-[#ff007a]/30 py-3 px-4 sm:px-10 sticky bottom-0 z-30 flex flex-col md:flex-row items-center justify-between gap-3 shadow-[0_-10px_30px_rgba(255,0,122,0.1)] backdrop-blur-md"
          >
            {/* Ambient neon pulse indicator */}
            <div className="absolute top-0 left-0 h-0.5 bg-gradient-to-r from-transparent via-[#ff007a] to-transparent w-full animate-pulse" />

            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${timeRemaining.total <= 0 ? 'bg-red-500/10 text-red-500' : 'bg-[#ff007a]/10 text-[#ff007a]'} shrink-0`}>
                <Clock className="w-5 h-5 animate-spin" style={{ animationDuration: timeRemaining.total <= 0 ? '0s' : '10s' }} />
              </div>
              <div className="text-center md:text-left">
                <span className="text-[10px] sm:text-xs font-bold text-white uppercase tracking-widest flex items-center gap-1.5 justify-center md:justify-start">
                  Cuenta Regresiva de Votación
                  <span className={`h-2 w-2 rounded-full ${timeRemaining.total <= 0 ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
                </span>

              </div>
            </div>

            {/* SEGMENTED GLOWING CLOCK */}
            <div className="flex items-center gap-2 font-mono">
              {timeRemaining.total <= 0 ? (
                <div className="px-5 py-1.5 rounded-xl bg-red-950/20 border border-red-900/50 text-red-500 text-xs sm:text-sm font-extrabold uppercase tracking-widest animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.2)]">
                  🚫 Tiempo Agotado - Votación Cerrada
                </div>
              ) : (
                <>
                  <div className="flex flex-col items-center">
                    <div className="bg-black/80 border border-white/5 shadow-inner px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-sm sm:text-lg font-black text-white min-w-[40px] text-center tracking-tight">
                      {String(timeRemaining.days).padStart(2, '0')}
                    </div>
                    <span className="text-[8px] text-white/30 tracking-widest mt-1 uppercase">Días</span>
                  </div>
                  <span className="text-white/40 font-black mb-4">:</span>
                  <div className="flex flex-col items-center">
                    <div className="bg-black/80 border border-white/5 shadow-inner px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-sm sm:text-lg font-black text-[#ff007a] min-w-[40px] text-center tracking-tight shadow-[inset_0_0_8px_rgba(255,0,122,0.1)]">
                      {String(timeRemaining.hours).padStart(2, '0')}
                    </div>
                    <span className="text-[8px] text-[#ff007a]/50 tracking-widest mt-1 uppercase">Horas</span>
                  </div>
                  <span className="text-white/40 font-black mb-4">:</span>
                  <div className="flex flex-col items-center">
                    <div className="bg-black/80 border border-white/5 shadow-inner px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-sm sm:text-lg font-black text-[#bc13fe] min-w-[40px] text-center tracking-tight shadow-[inset_0_0_8px_rgba(188,19,254,0.1)]">
                      {String(timeRemaining.minutes).padStart(2, '0')}
                    </div>
                    <span className="text-[8px] text-[#bc13fe]/50 tracking-widest mt-1 uppercase">Minutos</span>
                  </div>
                  <span className="text-white/40 font-black mb-4">:</span>
                  <div className="flex flex-col items-center">
                    <div className="bg-[#ff007a]/10 border border-[#ff007a]/30 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-sm sm:text-lg font-black text-rose-400 min-w-[40px] text-center tracking-tight shadow-[0_0_10px_rgba(255,0,122,0.2)]">
                      {String(timeRemaining.seconds).padStart(2, '0')}
                    </div>
                    <span className="text-[8px] text-rose-400/60 tracking-widest mt-1 uppercase">Segundos</span>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>





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

      {/* --- ADMIN DASHBOARD MODAL DIALOG --- */}
      <AnimatePresence>
        {isAdminModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdminModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-[#0c0c0e] border border-white/10 rounded-[32px] p-6 sm:p-8 w-full max-w-lg shadow-2xl relative z-10 overflow-hidden text-white font-sans"
            >
              {/* Top rainbow glow line */}
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-[#ff007a] via-[#bc13fe] to-[#ff007a]" />

              <div className="flex items-center justify-between pb-4 border-b border-white/5">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-[#ff007a]" />
                  <h3 className="text-sm sm:text-md font-display font-black uppercase tracking-wider text-white">
                    Panel de Administración
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAdminModalOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* BODY VIEWS CHANGER */}
              <div className="mt-6">
                {!user ? (
                  /* STEP 1: SOLICITAR INGRESO / INICIAR SESIÓN */
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/15 flex items-center justify-center text-[#ff007a] mb-4 shadow-[0_0_15px_rgba(255,0,122,0.15)]">
                      <Lock className="w-6 h-6" />
                    </div>
                    <h4 className="text-md font-bold text-white uppercase tracking-wider font-display">Ingreso Protegido</h4>
                    <p className="text-xs text-white/50 max-w-sm mt-2 leading-relaxed">
                      Por favor, inicia sesión con Google para verificar tus permisos de administración, configurar la cuenta regresiva o reiniciar el listado.
                    </p>

                    <button
                      type="button"
                      onClick={async () => {
                        setAdminError(null);
                        try {
                          const provider = new GoogleAuthProvider();
                          await signInWithPopup(auth, provider);
                        } catch (err) {
                          console.error("Login Error:", err);
                          setAdminError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                      className="mt-6 flex items-center justify-center gap-3 w-full py-3 px-5 bg-white text-black hover:bg-white/90 rounded-2xl text-xs font-black uppercase tracking-widest cursor-pointer transition-all shadow-lg text-center"
                    >
                      {/* SVG Google Icon */}
                      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                      <span>Entrar / Registrar con Google</span>
                    </button>
                  </div>
                ) : checkingAdmin ? (
                  /* LOADING PRIVILEGES STATE */
                  <div className="flex flex-col items-center justify-center py-10">
                    <div className="w-8 h-8 rounded-full border-t-2 border-r-2 border-[#ff007a] animate-spin mb-4" />
                    <p className="text-xs font-mono text-white/50 uppercase tracking-widest">Verificando permisos admin en la base de datos...</p>
                  </div>
                ) : !isUserAdmin ? (
                  /* STEP 2: USUARIO CONECTADO PERO NO ES ADMIN (REGISTRARLO) */
                  <div className="flex flex-col items-center justify-center py-4 text-center">
                    <div className="w-12 h-12 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center text-yellow-500 mb-4 animate-pulse">
                      <Lock className="w-5 h-5" />
                    </div>
                    <h4 className="text-sm font-bold text-white uppercase tracking-wider font-display">Solicitud de Privilegios</h4>
                    <p className="text-[11px] text-yellow-400/85 max-w-xs bg-yellow-950/25 border border-yellow-800/45 rounded-xl p-3 mt-4 leading-normal">
                      ⚠️ Registra ahora mismo este usuario en Firestore para activarte como administrador y controlar el temporizador de cuenta atrás.
                    </p>

                    <button
                      type="button"
                      disabled={registering}
                      onClick={async () => {
                        setRegistering(true);
                        setAdminError(null);
                        try {
                          await setDoc(doc(db, 'CTA7.Estudiantes', 'configuracion', 'user-admin', user.uid), {
                            email: user.email || 'desconocido',
                            displayName: user.displayName || user.email?.split('@')[0] || 'Administrador',
                            registeredAt: formatSpTimestamp(new Date())
                          });
                          setAdminSuccess("¡Te has registrado como administrador con éxito!");
                        } catch (err) {
                          console.error("Registration Error:", err);
                          setAdminError(err instanceof Error ? `Error al registrar: ${err.message}` : "Error desconocido al registrar.");
                        } finally {
                          setRegistering(false);
                        }
                      }}
                      className="mt-6 flex items-center justify-center gap-2 w-full py-3 px-5 bg-gradient-to-r from-[#ff007a] to-[#bc13fe] hover:brightness-110 text-white rounded-2xl text-xs font-bold uppercase tracking-widest cursor-pointer disabled:opacity-50"
                    >
                      {registering ? 'Registrando...' : 'Registrarme como Administrador'}
                    </button>

                    <button
                      type="button"
                      onClick={() => signOut(auth)}
                      className="mt-3 text-[10px] font-bold uppercase tracking-wider text-white/30 hover:text-white transition"
                    >
                      Volver / Cerrar Sesión
                    </button>
                  </div>
                ) : (
                  /* STEP 3: ADMINISTRADOR AUTORIZADO - MOSTRAR FORMULARIO DE COUNTDOWN Y ACCIONES */
                  <div className="flex flex-col gap-6 text-left">
                    {/* Header welcome banner */}
                    <div className="flex items-center justify-between pb-4 border-b border-white/5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-[#ff007a] to-[#bc13fe] p-0.5 shrink-0">
                          <div className="w-full h-full rounded-full bg-black flex items-center justify-center">
                            <span className="text-[10px] font-bold">👑</span>
                          </div>
                        </div>
                        <div className="text-left">
                          <span className="text-[11px] font-bold text-white block leading-none">{user.displayName || 'Admin'}</span>
                          <span className="text-[9px] font-mono text-white/40 block mt-1">{user.email}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => signOut(auth)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition text-[10px] font-bold uppercase tracking-widest cursor-pointer text-white/60 hover:text-white"
                      >
                        <LogOut className="w-3.5 h-3.5" /> Salir
                      </button>
                    </div>

                    {/* SECCIÓN 1: CONFIGURAR CUENTA ATRÁS */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4.5 h-4.5 text-[#ff007a]" />
                          <h4 className="text-xs font-bold uppercase tracking-widest text-[#ff007a]">Control de Cuenta Atrás</h4>
                        </div>
                        {/* SWITCH LIVE ACTIVE / INACTIVE */}
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={countdownConfig?.isActive ?? false}
                            onChange={async (e) => {
                              const activeVal = e.target.checked;
                              setAdminError(null);
                              setAdminSuccess(null);
                              try {
                                const targetDateVal = countdownConfig?.targetDate || new Date(Date.now() + 24*3600*1000).toISOString();
                                await setDoc(doc(db, 'CTA7.Estudiantes', 'configuracion', 'config', 'countdown'), {
                                  isActive: activeVal,
                                  targetDate: targetDateVal,
                                  updatedBy: user.uid
                                }, { merge: true });
                                setAdminSuccess(activeVal ? "Cuenta atrás ACTIVADA." : "Cuenta atrás DESACTIVADA.");
                              } catch (err) {
                                console.error("Update Countdown Error:", err);
                                setAdminError(err instanceof Error ? `Error al activar: ${err.message}` : "No se pudo actualizar el estado de cuenta atrás.");
                              }
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-[#ff007a] peer-checked:to-[#bc13fe]"></div>
                        </label>
                      </div>

                      {/* DATE TIME SELECTOR */}
                      <div className="flex flex-col gap-2 mt-2 select-none">
                        <label className="block text-[10px] font-semibold text-white/40 uppercase tracking-widest font-mono">
                          Fecha y Hora Límite (Zona Perú UTC-5)
                        </label>
                        
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="datetime-local"
                            value={countdownConfig?.targetDate ? countdownConfig.targetDate.slice(0, 16) : ''}
                            onChange={async (e) => {
                              const datetimeVal = e.target.value;
                              if (!datetimeVal) return;
                              setAdminError(null);
                              setAdminSuccess(null);
                              try {
                                // Convert input local format YYYY-MM-DDTHH:mm to YYYY-MM-DDTHH:mm:00-05:00
                                const formattedStr = `${datetimeVal}:00-05:00`;
                                await setDoc(doc(db, 'CTA7.Estudiantes', 'configuracion', 'config', 'countdown'), {
                                  targetDate: formattedStr,
                                  updatedBy: user.uid
                                }, { merge: true });
                                setAdminSuccess("Hora de finalización actualizada.");
                              } catch (err) {
                                console.error("Date Input Error:", err);
                                setAdminError(err instanceof Error ? `Error al guardar: ${err.message}` : "Error al guardar la hora del temporizador.");
                              }
                            }}
                            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white opacity-90 outline-none focus:border-[#ff007a] flex-1 font-mono"
                          />

                          <button
                            type="button"
                            onClick={async () => {
                              setAdminError(null);
                              setAdminSuccess(null);
                              try {
                                // Calcular próximo sábado a medianoche en Perú
                                const now = new Date();
                                const sabado = new Date();
                                const currentDay = sabado.getDay();
                                let daysOffset = (6 - currentDay + 7) % 7;
                                if (daysOffset === 0) {
                                  // si ya es sábado, calcular el siguiente
                                  daysOffset = 7;
                                }
                                sabado.setDate(sabado.getDate() + daysOffset);
                                sabado.setHours(0, 0, 0, 0);

                                const year = sabado.getFullYear();
                                const month = String(sabado.getMonth() + 1).padStart(2, '0');
                                const dateNum = String(sabado.getDate()).padStart(2, '0');
                                const correctVal = `${year}-${month}-${dateNum}T00:00:00-05:00`;

                                await setDoc(doc(db, 'CTA7.Estudiantes', 'configuracion', 'config', 'countdown'), {
                                  targetDate: correctVal,
                                  updatedBy: user.uid
                                }, { merge: true });
                                setAdminSuccess("Preestablecido para el Sábado a Medianoche (Perú).");
                              } catch (err) {
                                console.error("Shortcut date error:", err);
                                setAdminError(err instanceof Error ? `Error al preestablecer: ${err.message}` : "Error al preestablecer la fecha.");
                              }
                            }}
                            className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 text-[10px] font-bold uppercase tracking-wider text-white transition-all cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <Calendar className="w-3.5 h-3.5 text-[#ff007a]" /> Sábado 12am PE
                          </button>
                        </div>
                        
                        <p className="text-[9px] font-mono text-white/30 leading-snug mt-1">
                          💡 El temporizador detendrá las votaciones automáticamente para todos los visitantes del sitio apenas este cronómetro llegue a cero.
                        </p>
                      </div>
                    </div>

                    {/* SECCIÓN 2: RESTABLECER BASE DE DATOS */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 sm:p-5 flex flex-col gap-3">
                      <div className="flex items-center gap-2 text-red-500">
                        <RotateCcw className="w-4 h-4" />
                        <h4 className="text-xs font-bold uppercase tracking-widest">Restauración de Emergencia</h4>
                      </div>
                      <p className="text-[10px] text-white/40 leading-normal">
                        Esta acción borrará todos los registros actuales de ELO/votos en la nube e inicializará el listado predeterminado de estudiantes.
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          setIsAdminModalOpen(false);
                          await handleResetData();
                        }}
                        className="w-full py-2.5 px-4 bg-red-950/20 border border-red-900/40 text-red-400 hover:bg-red-900 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer text-center"
                      >
                        Reiniciar ELO y Votos de Estudiantes
                      </button>
                    </div>
                  </div>
                )}

                {/* NOTIFICATIONS AND FEEDBACKS */}
                {adminError && (
                  <div className="mt-4 text-red-400 text-xs font-mono bg-red-950/20 border border-red-900/40 p-3 rounded-xl animate-shake">
                    ⚠️ {adminError}
                  </div>
                )}
                {adminSuccess && (
                  <div className="mt-4 text-emerald-400 text-xs font-mono bg-emerald-950/20 border border-emerald-900/40 p-3 rounded-xl animate-fade-in">
                    ✅ {adminSuccess}
                  </div>
                )}

                <div className="flex justify-end mt-6 border-t border-white/5 pt-5">
                  <button
                    type="button"
                    onClick={() => setIsAdminModalOpen(false)}
                    className="px-5 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl text-white text-xs uppercase font-bold tracking-wider cursor-pointer transition"
                  >
                    Cerrar Panel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
