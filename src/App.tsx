import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import Lobby from './components/Lobby';
import Game from './components/Game';
import './App.css';
import './Challenge.css';

// Allow overriding the server URL via the ?server= URL parameter
const urlParams = new URLSearchParams(window.location.search);
const customServer = urlParams.get('server');
const isGitHubPages = window.location.hostname.includes('github.io');
const defaultServer = isGitHubPages
  ? 'https://your-ngrok-url.ngrok-free.app' // Fallback for GH pages if no parameter is provided
  : `http://${window.location.hostname}:3001`; // Local network

const SOCKET_URL = customServer || import.meta.env.VITE_SERVER_URL || defaultServer;
const socket = io(SOCKET_URL, {
  extraHeaders: {
    "ngrok-skip-browser-warning": "69420"
  }
});

const deckDescriptions: Record<string, string> = {
  'Skip': 'Skips the next player (x4 per color).',
  'Reverse': 'Reverses rotation direction (x4 per color).',
  'Draw2': 'Next player draws 2 (x4 per color).',
  'Wild': 'Changes color to choice (Exact quantity).',
  'Draw4': 'Wild: Color + Draw 4 (Exact quantity).',
  'DiscardAll': 'Purge all of one color (x4 per color).',
  'ColorHit2': 'Everyone else draws 2 (x4 per color).',
  'ColorHit4': 'Everyone else draws 4 (x4 per color).',
  'ColorDraw4': 'Next player draws 4 (x4 per color).',
  'SkipAll': 'Extra turn (x4 per color).',
  'WildDiscardAll': 'Wild: Purge color (Exact quantity).',
  'WildHit2': 'Wild: Everyone draws 2 (Exact quantity).',
  'WildHit4': 'Wild: Everyone draws 4 (Exact quantity).',
  'WildDraw2': 'Wild: Next player draws 2 (Exact quantity).',
  'WildSkipAll': 'Wild: Extra turn (Exact quantity).',
  'WildSkip': 'Wild: Skip next player (Exact quantity).',
  'WildReverse': 'Wild: Reverse direction (Exact quantity).',
  'TargetDraw2': 'Targeted: Pick a player to draw 2 (x4 per color).',
  'TargetDraw4': 'Targeted: Pick a player to draw 4 (x4 per color).',
  'WildTargetDraw2': 'Wild Targeted: Pick a player to draw 2 (Exact quantity).',
  'WildTargetDraw4': 'Wild Targeted: Pick a player to draw 4 (Exact quantity).'
};

const CardPreview: React.FC<{ cardKey: string }> = ({ cardKey }) => {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const [currentColor, setCurrentColor] = useState('red');
  const isWild = cardKey.includes('Wild') || cardKey === 'Draw4' || cardKey.includes('WildDraw2');

  useEffect(() => {
    if (isWild) return;

    let timeoutId: any;
    const tick = () => {
      setCurrentColor(prev => {
        const otherColors = colors.filter(c => c !== prev);
        return otherColors[Math.floor(Math.random() * otherColors.length)];
      });
      timeoutId = setTimeout(tick, Math.random() * 2500 + 1500); // 1.5s - 4s intervals
    };

    timeoutId = setTimeout(tick, Math.random() * 2000);
    return () => clearTimeout(timeoutId);
  }, [isWild]);

  let icon = cardKey;
  if (cardKey.includes('Hit')) {
    icon = '💥' + (cardKey.includes('4') ? '+4' : '+2');
  } else if (cardKey.includes('Draw4')) {
    icon = '+4';
  } else if (cardKey.includes('Draw2')) {
    icon = '+2';
  } else if (cardKey.includes('SkipAll')) {
    icon = '🚫👥';
  } else if (cardKey.includes('Skip')) {
    icon = '🚫';
  } else if (cardKey.includes('Reverse')) {
    icon = '⇄';
  } else if (cardKey.includes('DiscardAll')) {
    icon = '🗑️';
  } else if (cardKey.includes('Target')) {
    icon = '🎯';
  }

  return (
    <div className={`deck-mini-preview ${isWild ? 'wild' : currentColor}`}>
      <span style={{ fontSize: icon.length > 2 ? '0.7rem' : '0.9rem' }}>{icon}</span>
    </div>
  );
};

const App: React.FC = () => {
  const [roomId, setRoomId] = useState<string>('');
  const [joined, setJoined] = useState(false);
  const [gameState, setGameState] = useState<any>(null);
  const [userId] = useState(() => {
    const saved = localStorage.getItem('uno_user_id');
    if (saved) return saved;
    const fresh = 'u_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('uno_user_id', fresh);
    return fresh;
  });

  const [activeEvent, setActiveEvent] = useState<{ id: number, type: string, count?: number } | null>(null);
  const hasAttemptedRestore = useRef<string | null>(null);

  // Game Event Listener for Global Announcements
  useEffect(() => {
    if (!gameState?.lastAction || !gameState.lastAction.id) return;
    const action = gameState.lastAction;

    let eventType = '';
    let eventCount = 0;

    if (action.type === 'play') {
      const values = action.sequence.map((c: any) => c.value);
      const skips = action.skippedPlayers || [];

      if (skips.length > 0) {
        if (action.specialReverse) {
          eventType = 'EXTRA TURN!';
        } else {
          const names = skips.map((s: any) => s.name.split(' ')[0]);
          eventType = names.join(' & ') + ' SKIPPED';
        }
      } else if (values.includes('Reverse')) {
        eventType = 'REVERSE';
      } else if (action.details?.hitCount > 0 && !action.details?.isStackingAction) {
        eventType = 'HIT ALL';
        eventCount = action.details.hitCount;
      } else if (action.details?.targetAmount > 0 && !action.details?.isStackingAction) {
        eventType = '🎯 ' + (action.details.targetName?.split(' ')[0] || 'SOMEONE').toUpperCase();
        eventCount = action.details.targetAmount;
      } else if (action.details?.isStackingAction) {
        eventType = 'STACKED!';
        eventCount = (action.details.hitCount || 0) + (action.details.totalDrawAmount || 0);
      } else if (values.some((v: string) => v.includes('DiscardAll'))) {
        eventType = 'DISCARD ALL';
        eventCount = action.sequence.length + (action.purged?.length || 0);
      } else if (values.some((v: string) => /[a-zA-Z]/.test(v) && v.includes('4'))) {
        eventType = 'DRAW 4';
        eventCount = 4;
      } else if (values.some((v: string) => /[a-zA-Z]/.test(v) && v.includes('2'))) {
        eventType = 'DRAW 2';
        eventCount = 2;
      }

      if (action.isAutoUno) {
        eventType = 'UNO!';
      }

      const warResult = action.warResult;
      if (warResult) {
        eventType = 'DRAW';
        eventCount = warResult.count;
      }
    } else if (action.type === 'draw') {
      eventType = 'DRAW';
      eventCount = action.count;
    } else if (action.type === 'challenge_result') {
      eventType = action.result === 'success' ? 'EXPOSED!' : 'INNOCENT!';
      if (action.penaltyCount) eventCount = action.penaltyCount;
    } else if (action.type === 'uno_announcement') {
      eventType = 'UNO!';
    } else if (action.type === 'uno_penalty') {
      eventType = 'EXPOSED!';
    }

    if (eventType) {
      setActiveEvent({ id: action.id, type: eventType, count: eventCount });
      const timer = setTimeout(() => setActiveEvent(null), 850);
      return () => clearTimeout(timer);
    }
  }, [gameState?.lastAction?.id]);

  useEffect(() => {
    // Cleanup any existing listeners first to prevent duplicates
    socket.off('room_update');
    socket.off('game_start');
    socket.off('game_update');
    socket.off('game_over');

    socket.on('room_update', (room) => {
      setGameState(room);
    });

    socket.on('game_start', (room) => {
      setGameState(room);
    });

    socket.on('game_update', (room) => {
      setGameState(room);
    });

    socket.on('game_over', (data: any) => {
      setGameState((prev: any) => {
        const base = data.room || prev || {};
        return { ...base, status: 'finished', results: data };
      });
    });

    socket.on('error', (msg: string) => {
      alert(`Move Rejected: ${msg}`);
    });

    return () => {
      socket.off('room_update');
      socket.off('game_start');
      socket.off('game_update');
      socket.off('game_over');
      socket.off('error');
    };
  }, []);

  useEffect(() => {
    // If we're the host and in a lobby, push our preferred rules if they differ
    if (gameState?.status === 'lobby' && gameState.hostUserId === userId && roomId) {
      if (hasAttemptedRestore.current === roomId) return;

      const saved = localStorage.getItem('uno_custom_rules');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const currentRules = gameState.rules || {};

          // Ensure new card keys exist in the parsed rules from storage
          const defaultDeckKeys = {
            'DiscardAll': 0, 'ColorHit2': 0, 'ColorHit4': 0, 'ColorDraw4': 0, 'SkipAll': 0, 'TargetDraw2': 0, 'TargetDraw4': 0,
            'WildDiscardAll': 0, 'WildHit2': 0, 'WildHit4': 0, 'WildDraw2': 0, 'WildSkipAll': 0, 'WildTargetDraw2': 0, 'WildTargetDraw4': 0, 'WildSkip': 0, 'WildReverse': 0
          };
          if (parsed.deckConfig) {
            parsed.deckConfig = { ...defaultDeckKeys, ...parsed.deckConfig };
          }

          const hasDiff = JSON.stringify(parsed) !== JSON.stringify(currentRules);

          if (hasDiff) {
            console.log("[App] Restoring saved rules from localStorage...");
            socket.emit('update_rules', { roomId, rules: parsed, userId });
          }
          hasAttemptedRestore.current = roomId;
        } catch (e) {
          console.error(e);
          hasAttemptedRestore.current = roomId;
        }
      } else {
        hasAttemptedRestore.current = roomId;
      }

      const savedAi = localStorage.getItem('uno_ai_count');
      if (savedAi) {
        const count = parseInt(savedAi, 10);
        const currentAi = gameState.players.filter((p: any) => p.isBot).length;
        if (count >= 1 && count !== currentAi) {
          socket.emit('set_bot_count', { roomId, count, userId });
        }
      }
    }
  }, [gameState?.status, gameState?.hostUserId, userId, roomId]);

  const joinRoom = (id: string, name: string) => {
    setRoomId(id);
    socket.emit('join_room', { roomId: id, playerName: name, userId });
    setJoined(true);
  };

  const startGame = () => {
    socket.emit('start_game', { roomId, userId });
  };

  const playSequence = (cardIds: string[], newColor?: string, isUno?: boolean, targetUserId?: string) => {
    socket.emit('play_sequence', { roomId, cardIds, newColor, userId, isUno, targetUserId });
  };

  const updateRules = (rules: any) => {
    const newRules = { ...gameState?.rules, ...rules };
    if (rules.deckConfig) {
      newRules.deckConfig = { ...gameState?.rules?.deckConfig, ...rules.deckConfig };
    }
    if (gameState?.hostUserId === userId) {
      localStorage.setItem('uno_custom_rules', JSON.stringify(newRules));
    }
    socket.emit('update_rules', { roomId, rules: newRules, userId });
  };

  const drawCard = () => {
    socket.emit('draw_card', { roomId, userId });
  };

  return (
    <div className="app-container">
      {!joined ? (
        <Lobby onJoin={joinRoom} />
      ) : gameState?.status === 'lobby' ? (
        <div className="waiting-room">
          <div className="lobby-header">
            <h2 className="glitch-text">ROOM: {roomId}</h2>
            <div className="lobby-summary glass">
              <span>Humans: {gameState.players.filter((p: any) => !p.isBot).length}</span>
              <span className="accent">AI Bots: {gameState.players.filter((p: any) => p.isBot).length}</span>
              <span>Total: {gameState.players.length} Players</span>
            </div>
            <div className="debug-id-bar">
              Your Session: <span className="id-val">{userId.slice(0, 8)}...</span> |
              Host: <span className="id-val">{gameState.hostUserId?.slice(0, 8)}...</span>
            </div>
          </div>

          <div className="lobby-content">
            <div className="lobby-left">
              <h3 className="section-title">PLAYERS</h3>
              <div className="player-list glass">
                {gameState.players.map((p: any) => (
                  <div key={p.id} className="player-item">
                    <div className="player-name">
                      {p.name} {p.userId === userId && <span className="you-tag">(You)</span>}
                      {p.userId === gameState.hostUserId && <span className="host-tag">HOST</span>}
                    </div>
                    {p.isBot && <span className="bot-status-tag">ACTIVE AI</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="lobby-right">
              <div className="rule-settings glass">
                <div className="rules-section-header">GAMEPLAY MODES</div>
                <label className="rule-item" title="Standard: First to win ends game. Tournament (LMS): Eliminated players watch until one champion remains. Points: Lowest total hand count wins.">
                  <div className="rule-label-group">
                    <span>Game Mode</span>
                    <small>Championship Formats</small>
                  </div>
                  <select
                    disabled={gameState.hostUserId !== userId}
                    value={gameState.rules?.gameMode || 'standard'}
                    onChange={(e) => updateRules({ gameMode: e.target.value })}
                  >
                    <option value="standard">Standard</option>
                    <option value="tournament">Tournament (LMS)</option>
                    <option value="points">Points Mode</option>
                  </select>
                </label>
                {gameState.rules?.gameMode === 'points' && (
                  <label className="rule-item" title="Score or rounds required to end the session.">
                    <div className="rule-label-group">
                      <span>Target Wins</span>
                      <small>Score to reach</small>
                    </div>
                    <input
                      type="number"
                      min="1"
                      disabled={gameState.hostUserId !== userId}
                      value={gameState.rules?.maxRounds || 3}
                      onChange={(e) => updateRules({ maxRounds: parseInt(e.target.value) })}
                    />
                  </label>
                )}
                <label className="rule-item" title="Add elite AI agents to the table.">
                  <div className="rule-label-group">
                    <span>AI Opponents</span>
                    <small>Add synthetic players</small>
                  </div>
                  <input
                    type="number"
                    min="1"
                    disabled={gameState.hostUserId !== userId}
                    value={gameState.players.filter((p: any) => p.isBot).length}
                    onChange={(e) => {
                      const count = parseInt(e.target.value);
                      localStorage.setItem('uno_ai_count', count.toString());
                      socket.emit('set_bot_count', { roomId, count, userId });
                    }}
                  />
                </label>

                <div className="rules-section-header">TURN & ROUND LOGIC</div>
                <label className="rule-item" title="Choose who starts each round.">
                  <div className="rule-label-group">
                    <span>First Turn</span>
                    <small>Round Ignition Phase</small>
                  </div>
                  <select
                    disabled={gameState.hostUserId !== userId}
                    value={gameState.rules?.firstTurnRule || 'host'}
                    onChange={(e) => updateRules({ firstTurnRule: e.target.value })}
                  >
                    <option value="host">Room Host</option>
                    <option value="random">Shuffled Random</option>
                    <option value="winner">Previous Winner</option>
                  </select>
                </label>
                <label className="rule-item" title="Initial flight direction.">
                  <div className="rule-label-group">
                    <span>Starting Rotation</span>
                    <small>Initial orbit path</small>
                  </div>
                  <select
                    disabled={gameState.hostUserId !== userId}
                    value={gameState.rules?.startDirection ?? 1}
                    onChange={(e) => updateRules({ startDirection: parseInt(e.target.value) })}
                  >
                    <option value={1}>Clockwise (Standard)</option>
                    <option value={-1}>Anti-Clockwise (Orbit Swap)</option>
                  </select>
                </label>
                <label className="rule-item" title="Initial cards dealt to each player (1-25).">
                  <div className="rule-label-group">
                    <span>Starting Hand Size</span>
                    <small>Initial tactical loadout</small>
                  </div>
                  <input
                    type="number"
                    min="1"
                    disabled={gameState.hostUserId !== userId}
                    value={gameState.rules?.startingHandSize || 7}
                    onChange={(e) => updateRules({ startingHandSize: parseInt(e.target.value) })}
                  />
                </label>
                <label className="rule-item" title="Play drawn card immediately if it matches.">
                  <div className="rule-label-group">
                    <span>Throwouts (After Draw)</span>
                    <small>Quick play</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId}
                    checked={gameState.rules?.allowPlayAfterDraw ?? true}
                    onChange={(e) => updateRules({ allowPlayAfterDraw: e.target.checked })}
                  />
                </label>
                <label className="rule-item" title="Draw cards until you get a playable one.">
                  <div className="rule-label-group">
                    <span>Forced Draw</span>
                    <small>Draw until playable</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId}
                    checked={gameState.rules?.forcedDrawPass ?? false}
                    onChange={(e) => updateRules({ forcedDrawPass: e.target.checked })}
                  />
                </label>

                <div className="rules-section-header">DECLARATION RULES</div>
                <label className="rule-item" title="Mandatory shout with 1 card.">
                  <div className="rule-label-group">
                    <span>Require UNO! Declaration</span>
                    <small>Mandatory shout</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId}
                    checked={gameState.rules?.requireUnoDeclaration ?? true}
                    onChange={(e) => updateRules({ requireUnoDeclaration: e.target.checked })}
                  />
                </label>
                <label className="rule-item" title="Opponents can click 'NO UNO!' to penalize you.">
                  <div className="rule-label-group">
                    <span>Allow 'NO UNO!' Callouts</span>
                    <small>Opponents can catch you</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId}
                    checked={gameState.rules?.allowCallNoUno ?? true}
                    onChange={(e) => updateRules({ allowCallNoUno: e.target.checked })}
                  />
                </label>

                <div className="rules-section-header">THE WAR (STAKING)</div>
                <label className="rule-item" title="Stack +2 or +4 to pass the penalty.">
                  <div className="rule-label-group">
                    <span>Draw War (Stacking)</span>
                    <small>Redirect penalties</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId}
                    checked={gameState.rules?.drawWar ?? true}
                    onChange={(e) => updateRules({ drawWar: e.target.checked })}
                  />
                </label>
                <label className="rule-item" title="Stack a Wild Draw 4 on top of a +2 penalty.">
                  <div className="rule-label-group">
                    <span>Draw 4 on Draw 2</span>
                    <small>Up-scaling the war</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId || !gameState.rules?.drawWar}
                    checked={gameState.rules?.allowDraw4OnDraw2 ?? true}
                    onChange={(e) => updateRules({ allowDraw4OnDraw2: e.target.checked })}
                  />
                </label>
                <label className="rule-item" title="Stack a regular +2 on top of a Wild Draw 4 penalty.">
                  <div className="rule-label-group">
                    <span>Draw 2 on Draw 4</span>
                    <small>Down-scaling the war</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId || !gameState.rules?.drawWar}
                    checked={gameState.rules?.allowDraw2OnDraw4 ?? true}
                    onChange={(e) => updateRules({ allowDraw2OnDraw4: e.target.checked })}
                  />
                </label>
                {gameState.rules?.allowDraw2OnDraw4 && (
                  <label className="rule-item" title="The +2 defense must match the color chosen by the +4 player.">
                    <div className="rule-label-group">
                      <span className="accent-sub">Color Precision Rule</span>
                      <small>Strict stacking match</small>
                    </div>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.draw2OnDraw4ColorMatch ?? false}
                      onChange={(e) => updateRules({ draw2OnDraw4ColorMatch: e.target.checked })}
                    />
                  </label>
                )}
                <label className="rule-item" title="Challenge the Attackers integrity on a Wild Draw 4.">
                  <div className="rule-label-group">
                    <span>Challenge Rule</span>
                    <small>Integrity Check</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId}
                    checked={gameState.rules?.challengeRule ?? true}
                    onChange={(e) => updateRules({ challengeRule: e.target.checked })}
                  />
                </label>
                <label className="rule-item" title="Play a legal card after receiving a draw penalty.">
                  <div className="rule-label-group">
                    <span>Defensive Throwout</span>
                    <small>Recover after penalty</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId}
                    checked={gameState.rules?.playAfterPenalty ?? false}
                    onChange={(e) => updateRules({ playAfterPenalty: e.target.checked })}
                  />
                </label>

                <div className="rules-section-header">SLANG moves (house rules)</div>
                <label className="rule-item" title="Play multiple cards of the same number/value at once.">
                  <div className="rule-label-group">
                    <span>Number Stacks</span>
                    <small>Multi-play same values</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId}
                    checked={gameState.rules?.multiPlay ?? true}
                    onChange={(e) => updateRules({ multiPlay: e.target.checked })}
                  />
                </label>
                <label className="rule-item" title="Extra turn for Double Reverses or 1v1 Reverses.">
                  <div className="rule-label-group">
                    <span>Special Reverse</span>
                    <small>Momentum rules</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={gameState.hostUserId !== userId}
                    checked={gameState.rules?.specialReverse ?? true}
                    onChange={(e) => updateRules({ specialReverse: e.target.checked })}
                  />
                </label>
              </div>

              {(() => {
                const deck = Object.entries(gameState.rules?.deckConfig || {});
                const groups = [
                  { title: "CORE ZERO", items: deck.filter(([k]) => k === '0') },
                  { title: "NUMERIC SUITS", items: deck.filter(([k]) => !isNaN(parseInt(k)) && k !== '0').sort((a, b) => parseInt(a[0]) - parseInt(b[0])) },
                  { title: "CLASSIC ACTION CARDS (COLORED)", items: deck.filter(([k]) => ['Skip', 'Reverse', 'Draw2'].includes(k)) },
                  { title: "ELITE ACTION CARDS (COLORED)", items: deck.filter(([k]) => ['DiscardAll', 'ColorHit2', 'ColorHit4', 'ColorDraw4', 'SkipAll', 'TargetDraw2', 'TargetDraw4'].includes(k)) },
                  { title: "STANDARD WILDS", items: deck.filter(([k]) => ['Wild', 'Draw4'].includes(k)) },
                  { title: "SPECIALIST WILDS", items: deck.filter(([k]) => k.startsWith('Wild') && !['Wild', 'Draw4'].includes(k)) }
                ];

                return groups.map(group => group.items.length > 0 && (
                  <div key={group.title} className="deck-group-container">
                    <div className="rules-section-header">{group.title}</div>
                    <div className="deck-grid-premium">
                      {group.items.map(([key, val]: [string, any]) => (
                        <div key={key} className="deck-item-premium">
                          <div className="deck-item-left">
                            <CardPreview cardKey={key} />
                            <div className="deck-item-info">
                              <span className="card-name">{key}</span>
                              <small className="card-desc">
                                {deckDescriptions[key] || 'Classic card.'}
                              </small>
                            </div>
                          </div>
                          <div className="deck-item-controls">
                            <button
                              className="count-btn"
                              disabled={gameState.hostUserId !== userId || (val || 0) <= 0}
                              onClick={() => updateRules({ deckConfig: { [key]: Math.max(0, (val || 0) - 1) } })}
                            >
                              -
                            </button>
                            <span className="count-val">{val || 0}</span>
                            <button
                              className="count-btn"
                              disabled={gameState.hostUserId !== userId}
                              onClick={() => updateRules({ deckConfig: { [key]: (val || 0) + 1 } })}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}

              {gameState.hostUserId === userId && (
                <button
                  className="neo-button secondary"
                  style={{ marginTop: '1rem' }}
                  onClick={() => updateRules({
                    deckConfig: {
                      '0': 1, '1': 2, '2': 2, '3': 2, '4': 2, '5': 2, '6': 2, '7': 2, '8': 2, '9': 2,
                      'Skip': 2, 'Reverse': 2, 'Draw2': 2, 'Wild': 4, 'Draw4': 4,
                      'DiscardAll': 0, 'ColorHit2': 0, 'ColorHit4': 0, 'ColorDraw4': 0, 'SkipAll': 0, 'TargetDraw2': 0, 'TargetDraw4': 0,
                      'WildDiscardAll': 0, 'WildHit2': 0, 'WildHit4': 0, 'WildDraw2': 0, 'WildSkipAll': 0, 'WildTargetDraw2': 0, 'WildTargetDraw4': 0, 'WildSkip': 0, 'WildReverse': 0
                    }
                  })}
                >
                  Restore Factory Defaults
                </button>
              )}
            </div>
          </div>

          <div className="lobby-controls glass">
            {gameState.hostUserId === userId ? (
              <>
                <div className="controls-hint">Host must confirm setup to begin</div>
                <div className="button-group">
                  <button className="neo-button" onClick={startGame} disabled={gameState.players.length < 2}>
                    CONFIRM SETUP // START
                  </button>
                </div>
              </>
            ) : (
              <div className="guest-view">
                <div className="waiting-status">Waiting for host to start game...</div>
                <button
                  className="neo-button secondary small"
                  style={{ marginTop: '1rem' }}
                  onClick={() => socket.emit('fix_host', { roomId, userId })}
                >
                  Take Over Room Host (Force)
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (gameState?.status === 'playing' || gameState?.status === 'round_end' || gameState?.status === 'finished') ? (
        <Game
          gameState={gameState}
          myId={userId}
          onPlaySequence={playSequence}
          onDrawCard={drawCard}
          onPassTurn={() => socket.emit('pass_turn', { roomId, userId })}
          onAcceptChallenge={() => socket.emit('accept_draw4', { roomId, userId })}
          onChallengeDraw4={() => socket.emit('challenge_draw4', { roomId, userId })}
          onDeclareUno={() => socket.emit('declare_uno', { roomId, userId })}
          onCallNoUno={() => socket.emit('call_no_uno', { roomId, userId })}
          onPlayerReady={() => socket.emit('player_ready_continue', { roomId, userId })}
        />
      ) : (
        <div className="loading">Connecting to the Matrix...</div>
      )}

      {/* Global Announcements */}
      <AnimatePresence mode="wait">
        {activeEvent && (
          <motion.div
            key={activeEvent.id}
            className="event-zoom-container"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1.1, opacity: 1 }}
            exit={{ scale: 1.5, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
          >
            <div className="event-zoom-text">{activeEvent.type}</div>
            {activeEvent.count !== undefined && (activeEvent.type === 'DRAW' || activeEvent.count > 0) && (
              <div className="event-zoom-sub">+{activeEvent.count} CARDS</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
