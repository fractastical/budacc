import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Play, Pause, Clock, Plus, Minus, History, Check, X, LogIn, User, LogOut } from 'lucide-react';
import { supabase } from './supabase';

type MeditationSession = {
  id: string;
  duration_minutes: number;
  distractions: number;
  completed_at: string;
  user_id: string;
  user_email?: string;
};

type GlobalStats = {
  totalMinutes: number;
  totalSessions: number;
  averageLength: number;
};

function App() {
  const [duration, setDuration] = useState(20);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [distractions, setDistractions] = useState(0);
  const [sessions, setSessions] = useState<MeditationSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showDistractionInput, setShowDistractionInput] = useState(false);
  const [email, setEmail] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [globalStats, setGlobalStats] = useState<GlobalStats>({
    totalMinutes: 0,
    totalSessions: 0,
    averageLength: 0
  });
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const actualDurationRef = useRef<number>(duration);
  const audioBuffersRef = useRef<{
    start?: AudioBuffer;
    interval?: AudioBuffer;
    end?: AudioBuffer;
  }>({});

  useEffect(() => {
    // Check if user is already logged in
    const user = supabase.auth.getUser();
    user.then(({ data }) => {
      if (data.user) {
        setIsLoggedIn(true);
        setEmail(data.user.email?.split('@')[0] || '');
        fetchSessions();
      }
    });

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setIsLoggedIn(true);
        setEmail(session.user.email?.split('@')[0] || '');
        fetchSessions();
      } else {
        setIsLoggedIn(false);
        setSessions([]);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Fetch global statistics
  useEffect(() => {
    const fetchGlobalStats = async () => {
      const { data, error } = await supabase
        .from('meditation_sessions')
        .select('duration_minutes');

      if (!error && data) {
        const total = data.reduce((acc, session) => acc + session.duration_minutes, 0);
        const validSessions = data.filter(session => session.duration_minutes >= 5);
        const average = validSessions.length > 0
          ? validSessions.reduce((acc, session) => acc + session.duration_minutes, 0) / validSessions.length
          : 0;

        setGlobalStats({
          totalMinutes: total,
          totalSessions: data.length,
          averageLength: Math.round(average)
        });
      }
    };

    // Initial fetch
    fetchGlobalStats();

    // Set up real-time subscription for updates
    const channel = supabase
      .channel('meditation_sessions_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'meditation_sessions'
        },
        () => {
          // Refetch stats when any changes occur
          fetchGlobalStats();
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  // Load audio files when component mounts
  useEffect(() => {
    const loadAudio = async () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;

      try {
        // Try to load WAV files first, fall back to MP3
        const loadBuffer = async (name: string) => {
          try {
            const response = await fetch(`/sounds/${name}.wav`);
            if (!response.ok) {
              const mp3Response = await fetch(`/sounds/${name}.mp3`);
              if (!mp3Response.ok) {
                throw new Error('No audio file found');
              }
              const arrayBuffer = await mp3Response.arrayBuffer();
              return await ctx.decodeAudioData(arrayBuffer);
            }
            const arrayBuffer = await response.arrayBuffer();
            return await ctx.decodeAudioData(arrayBuffer);
          } catch (error) {
            console.warn(`Could not load ${name} sound, falling back to generated tone`);
            return null;
          }
        };

        audioBuffersRef.current = {
          start: await loadBuffer('start'),
          interval: await loadBuffer('interval'),
          end: await loadBuffer('end')
        };
      } catch (error) {
        console.error('Error loading audio files:', error);
      }
    };

    loadAudio();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({
      email: `${email.toLowerCase()}@meditation.app`,
      password: 'meditation123', // Using a fixed password for simplicity
    });

    if (error) {
      // If login fails, try to sign up
      const { error: signUpError } = await supabase.auth.signUp({
        email: `${email.toLowerCase()}@meditation.app`,
        password: 'meditation123',
        options: {
          data: {
            name: email
          }
        }
      });

      if (signUpError) {
        alert('Error logging in. Please try again.');
        return;
      }
    }
  };

  const handleLogout = async () => {
    if (isPlaying) {
      if (!confirm('A meditation session is in progress. Are you sure you want to log out?')) {
        return;
      }
      stopTimer();
    }
    await supabase.auth.signOut();
    setEmail('');
    setIsLoggedIn(false);
    setSessions([]);
  };

  const fetchSessions = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    const { data, error } = await supabase
      .from('meditation_sessions')
      .select('*')
      .order('completed_at', { ascending: false });

    if (!error && data) {
      const sessionsWithEmail = data.map(session => ({
        ...session,
        user_email: user.user?.email
      }));
      setSessions(sessionsWithEmail);
    } else {
      console.error('Error fetching sessions:', error);
    }
  };

  const createBell = useCallback((context: AudioContext) => {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, context.currentTime);
    
    gainNode.gain.setValueAtTime(0, context.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, context.currentTime + 0.1);
    gainNode.gain.linearRampToValueAtTime(0, context.currentTime + 1);
    
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + 1);
  }, []);

  const playSound = useCallback((buffer: AudioBuffer | undefined) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    
    if (buffer) {
      const source = audioContextRef.current.createBufferSource();
      const gainNode = audioContextRef.current.createGain();
      
      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);
      
      gainNode.gain.setValueAtTime(1, audioContextRef.current.currentTime);
      source.start();
    } else {
      // Fall back to the original bell sound if no custom sound is loaded
      createBell(audioContextRef.current);
    }
  }, [createBell]);

  const playBells = useCallback((count: number, type: 'start' | 'interval' | 'end' = 'interval') => {
    const buffer = audioBuffersRef.current[type];
    
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        playSound(buffer);
      }, i * 1500); // 1.5 second delay between bells
    }
  }, [playSound]);

  const startTimer = useCallback(() => {
    if (!isLoggedIn) {
      alert('Please log in first to track your sessions.');
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    setIsPlaying(true);
    setDistractions(0);
    playBells(3, 'start'); // Opening bells with start sound
    
    startTimeRef.current = Date.now();
    actualDurationRef.current = duration;
    
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const remaining = (duration * 60) - elapsed;
      setCurrentTime(remaining);
      
      // Play intermediate bell every 10 minutes
      if (elapsed > 0 && elapsed % 600 === 0 && elapsed < duration * 60) {
        playBells(1, 'interval');
      }
      
      // End timer and play closing bells
      if (elapsed >= duration * 60) {
        stopTimer();
        playBells(3, 'end');
      }
    }, 1000);
  }, [duration, playBells, isLoggedIn]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      // Calculate actual duration in minutes
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      actualDurationRef.current = Math.ceil(elapsed / 60);
    }

    setIsPlaying(false);
    setShowDistractionInput(true);
  }, []);

  const saveSession = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    const { data, error } = await supabase
      .from('meditation_sessions')
      .insert([
        {
          duration_minutes: actualDurationRef.current,
          distractions,
          completed_at: new Date().toISOString(),
          user_id: user.user.id
        },
      ])
      .select()
      .single();

    if (!error && data) {
      const sessionWithEmail = {
        ...data,
        user_email: user.user.email
      };
      setSessions((prev) => [sessionWithEmail, ...prev]);
    } else {
      console.error('Error saving session:', error);
    }

    setShowDistractionInput(false);
    setCurrentTime(duration * 60);
    setDistractions(0);
  };

  const cancelSession = () => {
    setShowDistractionInput(false);
    setCurrentTime(duration * 60);
    setDistractions(0);
  };

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
  };

  // Calculate user statistics
  const userTotalSessions = sessions.length;
  const userTotalMinutes = sessions.reduce((acc, session) => acc + session.duration_minutes, 0);
  const userAverageDistractions = userTotalSessions 
    ? (sessions.reduce((acc, session) => acc + session.distractions, 0) / userTotalSessions).toFixed(1)
    : '0';

  // Initialize countdown time
  useEffect(() => {
    setCurrentTime(duration * 60);
  }, [duration]);

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-indigo-100 to-white flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full">
          <h1 className="text-3xl font-bold text-indigo-900 mb-6 text-center">
            Meditation Timer
          </h1>
          <div className="mb-6 text-center text-gray-600">
            <p className="text-lg font-semibold">Global Meditation Stats</p>
            <p className="text-3xl font-bold text-indigo-900 mt-2">{globalStats.totalMinutes} minutes</p>
            <p className="text-sm mt-1">across {globalStats.totalSessions} sessions</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter your name to continue
              </label>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Your name"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 px-4 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white font-semibold flex items-center justify-center gap-2"
            >
              <LogIn className="w-5 h-5" />
              Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-100 to-white flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-indigo-900">
            Meditation Timer
          </h1>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-600 flex items-center gap-2">
              <User className="w-4 h-4" />
              {email}
            </div>
            <button
              onClick={handleLogout}
              className="text-gray-500 hover:text-gray-700 transition-colors"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mb-6 text-center">
          <p className="text-lg font-semibold text-gray-600">Global Meditation Time</p>
          <p className="text-3xl font-bold text-indigo-900 mt-2">{globalStats.totalMinutes} minutes</p>
          <p className="text-sm text-gray-500 mt-1">across {globalStats.totalSessions} sessions</p>
        </div>
        
        {showDistractionInput ? (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-center text-indigo-900">
              Session Complete
            </h2>
            <div className="text-center text-gray-600">
              <p>Duration: {actualDurationRef.current} minutes</p>
            </div>
            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                Number of Distractions
              </label>
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => setDistractions(prev => Math.max(0, prev - 1))}
                  className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600"
                >
                  <Minus className="w-5 h-5" />
                </button>
                <span className="text-2xl font-bold text-indigo-900 w-12 text-center">
                  {distractions}
                </span>
                <button
                  onClick={() => setDistractions(prev => prev + 1)}
                  className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={cancelSession}
                className="flex-1 py-3 px-4 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold flex items-center justify-center gap-2"
              >
                <X className="w-5 h-5" /> Cancel
              </button>
              <button
                onClick={saveSession}
                className="flex-1 py-3 px-4 rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold flex items-center justify-center gap-2"
              >
                <Check className="w-5 h-5" /> Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Duration (minutes)
              </label>
              <input
                type="range"
                min="5"
                max="180"
                value={duration}
                onChange={(e) => {
                  setDuration(Number(e.target.value));
                  setCurrentTime(Number(e.target.value) * 60);
                }}
                disabled={isPlaying}
                className="w-full h-2 bg-indigo-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
              />
              <div className="text-center mt-2 text-lg font-semibold text-indigo-900">
                {duration} minutes
              </div>
            </div>

            <div className="text-center mb-8">
              <div className="text-4xl font-mono font-bold text-indigo-900">
                {formatTime(currentTime)}
              </div>
              <div className="text-sm text-gray-500 mt-2">
                {isPlaying ? 'Time remaining' : 'Ready to begin'}
              </div>
            </div>

            <button
              onClick={isPlaying ? stopTimer : startTimer}
              className={`w-full py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-white font-semibold transition-colors ${
                isPlaying
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-indigo-500 hover:bg-indigo-600'
              }`}
            >
              {isPlaying ? (
                <>
                  <Pause className="w-5 h-5" /> Stop
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" /> Start
                </>
              )}
            </button>

            <div className="mt-6 text-sm text-gray-500 text-center">
              3 bells will sound at the start and end.
              <br />
              1 bell every 10 minutes during the session.
            </div>

            <div className="mt-8 border-t pt-6">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-900">{userTotalSessions}</div>
                  <div className="text-xs text-gray-500">Sessions</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-900">{userTotalMinutes}</div>
                  <div className="text-xs text-gray-500">Minutes</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-900">{userAverageDistractions}</div>
                  <div className="text-xs text-gray-500">Avg. Distractions</div>
                </div>
              </div>

              <button
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center justify-center gap-2 text-indigo-600 hover:text-indigo-700"
              >
                <History className="w-4 h-4" />
                {showHistory ? 'Hide History' : 'Show History'}
              </button>

              {showHistory && sessions.length > 0 && (
                <div className="mt-4 space-y-3">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="bg-gray-50 p-3 rounded-lg text-sm"
                    >
                      <div className="flex justify-between text-gray-600">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4" />
                          <span>{session.user_email?.split('@')[0]}</span>
                        </div>
                        <span>{formatDate(session.completed_at)}</span>
                      </div>
                      <div className="text-gray-500 mt-1">
                        {session.duration_minutes} minutes, {session.distractions} distractions
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;