import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
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
      setGameState((prev: any) => ({ ...prev, status: 'finished', results: data }));
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

  // Removed aggressive auto-save useEffect to prevent overwriting custom rules on refresh.
  useEffect(() => {
    // If we're the host and in a lobby, push our preferred rules if they differ
    if (gameState?.status === 'lobby' && gameState.hostUserId === userId) {
      const saved = localStorage.getItem('uno_custom_rules');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const currentRules = gameState.rules || {};

          // Check for meaningful differences including deckConfig
          const hasDiff = JSON.stringify(parsed) !== JSON.stringify(currentRules);

          if (hasDiff) {
            updateRules(parsed);
          }
        } catch (e) {
          console.error("Failed to parse saved rules", e);
        }
      }

      const savedAi = localStorage.getItem('uno_ai_count');
      if (savedAi) {
        const count = parseInt(savedAi, 10);
        const currentAi = gameState.players.filter((p: any) => p.isBot).length;
        if (count >= 1 && count <= 7 && count !== currentAi) {
          socket.emit('set_bot_count', { roomId, count, userId });
        }
      }
    }
  }, [gameState?.status, gameState?.hostUserId, userId]);
  const joinRoom = (id: string, name: string) => {
    setRoomId(id);
    socket.emit('join_room', { roomId: id, playerName: name, userId });
    setJoined(true);
  };

  const startGame = () => {
    console.log(`[App] Emitting start_game for Room=${roomId}, User=${userId}`);
    socket.emit('start_game', { roomId, userId });
  };

  const playSequence = (cardIds: string[], newColor?: string) => {
    console.log(`[App] Emitting play_sequence: Room=${roomId}, Cards=${JSON.stringify(cardIds)}`);
    socket.emit('play_sequence', { roomId, cardIds, newColor, userId });
  };

  const updateRules = (rules: any) => {
    // Deep merge new rules into existing state
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
              <span>Total: {gameState.players.length}/8</span>
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
                <h3 className="section-title">GAME ARCHITECTURE</h3>
                <div className="settings-grid">
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
                    <label className="rule-item" title="Total rounds to play before declaring a point-based winner (1-10).">
                      <div className="rule-label-group">
                        <span>Max Rounds</span>
                        <small>Session Duration</small>
                      </div>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        disabled={gameState.hostUserId !== userId}
                        value={gameState.rules?.maxRounds || 3}
                        onChange={(e) => updateRules({ maxRounds: parseInt(e.target.value) })}
                      />
                    </label>
                  )}
                  <label className="rule-item" title="Add elite AI agents to the table (max 8 players total).">
                    <div className="rule-label-group">
                      <span>AI Opponents</span>
                      <small>Add synthetic players</small>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="7"
                      disabled={gameState.hostUserId !== userId}
                      value={gameState.players.filter((p: any) => p.isBot).length}
                      onChange={(e) => {
                        const count = parseInt(e.target.value);
                        localStorage.setItem('uno_ai_count', count.toString());
                        socket.emit('set_bot_count', { roomId, count, userId });
                      }}
                    />
                  </label>
                  <label className="rule-item" title="Initial cards dealt to each player at the start of the round (1-25).">
                    <div className="rule-label-group">
                      <span>Starting Hand Size</span>
                      <small>Initial tactical loadout</small>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="25"
                      disabled={gameState.hostUserId !== userId}
                      value={gameState.rules?.startingHandSize || 7}
                      onChange={(e) => updateRules({ startingHandSize: parseInt(e.target.value) })}
                    />
                  </label>
                  <label className="rule-item" title="Force draw wars where +2 and +4 can be stacked to punish the next player.">
                    <div className="rule-label-group">
                      <span>Draw War</span>
                      <small>Stack +2/+4 to increase penalty</small>
                    </div>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.drawWar ?? true}
                      onChange={(e) => updateRules({ drawWar: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item" title="Allow playing multiple cards of the same number/value in one turn.">
                    <div className="rule-label-group">
                      <span>Multi-Play</span>
                      <small>Play same-value cards together</small>
                    </div>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.multiPlay ?? true}
                      onChange={(e) => updateRules({ multiPlay: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item" title="If you draw a card because you had no move, play it immediately if it's legal.">
                    <div className="rule-label-group">
                      <span>Play After Draw</span>
                      <small>Play drawn card if it matches</small>
                    </div>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.allowPlayAfterDraw ?? true}
                      onChange={(e) => updateRules({ allowPlayAfterDraw: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item" title="Always allowed to draw, but can only pass turn after drawing one.">
                    <div className="rule-label-group">
                      <span>Forced Draw/Pass</span>
                      <small>Must draw to pass if no move</small>
                    </div>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.forcedDrawPass ?? false}
                      onChange={(e) => updateRules({ forcedDrawPass: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item" title="If you draw multiple cards from a +2 or +4, you can still play a legal card immediately.">
                    <div className="rule-label-group">
                      <span>Play After Penalty</span>
                      <small>Play even after draw-wars</small>
                    </div>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.playAfterPenalty ?? false}
                      onChange={(e) => updateRules({ playAfterPenalty: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item" title="Allows stacking +4 on top of a +2 penalty." style={{ opacity: gameState.rules?.drawWar ? 1 : 0.5 }}>
                    <div className="rule-label-group">
                      <span>Draw 4 on Draw 2</span>
                      <small>Aggressive stacking</small>
                    </div>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId || !gameState.rules?.drawWar}
                      checked={gameState.rules?.allowDraw4OnDraw2 ?? true}
                      onChange={(e) => updateRules({ allowDraw4OnDraw2: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item" title="Allows stacking +2 on top of a +4 penalty." style={{ opacity: gameState.rules?.drawWar ? 1 : 0.5 }}>
                    <div className="rule-label-group">
                      <span>Draw 2 on Draw 4</span>
                      <small>Recursive penalty logic</small>
                    </div>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId || !gameState.rules?.drawWar}
                      checked={gameState.rules?.allowDraw2OnDraw4 ?? true}
                      onChange={(e) => updateRules({ allowDraw2OnDraw4: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item" title="Consecutive Reverse plays grant the player an extra turn.">
                    <div className="rule-label-group">
                      <span>Special Reverse</span>
                      <small>Tactical momentum</small>
                    </div>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.specialReverse ?? true}
                      onChange={(e) => updateRules({ specialReverse: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item" title="If enabled, players can challenge a Wild Draw 4. If the attacker had a legal colored card, they draw 4 instead. If not, the victim draws 6.">
                    <div className="rule-label-group">
                      <span>Challenge Rule</span>
                      <small>Official Uno mechanic</small>
                    </div>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.challengeRule ?? true}
                      onChange={(e) => updateRules({ challengeRule: e.target.checked })}
                    />
                  </label>
                </div>

                <h3 className="section-title">DECK COMPOSITION</h3>
                <div className="deck-grid">
                  {Object.entries(gameState.rules?.deckConfig || {}).map(([key, val]: [string, any]) => (
                    <label key={key} className="deck-item">
                      <span>{key}</span>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        disabled={gameState.hostUserId !== userId}
                        value={val}
                        onChange={(e) => updateRules({ deckConfig: { [key]: parseInt(e.target.value) } })}
                      />
                    </label>
                  ))}
                </div>
                {gameState.hostUserId === userId && (
                  <button
                    className="neo-button secondary"
                    style={{ marginTop: '1rem' }}
                    onClick={() => updateRules({
                      deckConfig: {
                        '0': 1, '1': 2, '2': 2, '3': 2, '4': 2, '5': 2, '6': 2, '7': 2, '8': 2, '9': 2,
                        'Skip': 2, 'Reverse': 2, 'Draw2': 2, 'Wild': 4, 'Draw4': 4
                      }
                    })}
                  >
                    Restore Factory Defaults
                  </button>
                )}
              </div>
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
      ) : (gameState?.status === 'playing' || gameState?.status === 'finished') ? (
        <Game
          gameState={gameState}
          myId={userId}
          onPlaySequence={playSequence}
          onDrawCard={drawCard}
          onPassTurn={() => socket.emit('pass_turn', { roomId, userId })}
          onAcceptChallenge={() => socket.emit('accept_draw4', { roomId, userId })}
          onChallengeDraw4={() => socket.emit('challenge_draw4', { roomId, userId })}
        />
      ) : (
        <div className="loading">Connecting to the Matrix...</div>
      )}
    </div>
  );
};

export default App;
