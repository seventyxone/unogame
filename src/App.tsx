import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import Lobby from './components/Lobby';
import Game from './components/Game';
import './App.css';

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const socket = io(SOCKET_URL);

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

    socket.on('game_over', ({ winner }) => {
      alert(`Game Over! Winner: ${winner}`);
      setGameState(null);
      setJoined(false);
    });

    return () => {
      socket.off('room_update');
      socket.off('game_start');
      socket.off('game_update');
      socket.off('game_over');
    };
  }, []);

  const joinRoom = (id: string, name: string) => {
    setRoomId(id);
    socket.emit('join_room', { roomId: id, playerName: name, userId });
    setJoined(true);
  };

  const startGame = () => {
    socket.emit('start_game', { roomId, userId });
  };

  const playSequence = (cardIds: string[], newColor?: string) => {
    console.log(`[App] Emitting play_sequence: Room=${roomId}, Cards=${JSON.stringify(cardIds)}`);
    socket.emit('play_sequence', { roomId, cardIds, newColor, userId });
  };

  const updateRules = (rules: any) => {
    socket.emit('update_rules', { roomId, rules, userId });
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
                  <label className="rule-item">
                    <span>Game Mode</span>
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
                    <label className="rule-item">
                      <span>Max Rounds</span>
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
                  <label className="rule-item">
                    <span>AI Opponents (1-7)</span>
                    <input
                      type="number"
                      min="1"
                      max="7"
                      disabled={gameState.hostUserId !== userId}
                      value={gameState.players.filter((p: any) => p.isBot).length}
                      onChange={(e) => socket.emit('set_bot_count', { roomId, count: parseInt(e.target.value), userId })}
                    />
                  </label>
                  <label className="rule-item">
                    <span>Starting Hand Size</span>
                    <input
                      type="number"
                      min="1"
                      max="25"
                      disabled={gameState.hostUserId !== userId}
                      value={gameState.rules?.startingHandSize || 7}
                      onChange={(e) => updateRules({ startingHandSize: parseInt(e.target.value) })}
                    />
                  </label>
                  <label className="rule-item">
                    <span>Draw War</span>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.drawWar ?? true}
                      onChange={(e) => updateRules({ drawWar: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item">
                    <span>Multi-Play</span>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.multiPlay ?? true}
                      onChange={(e) => updateRules({ multiPlay: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item" style={{ opacity: gameState.rules?.drawWar ? 1 : 0.5 }}>
                    <span>Draw 4 on Draw 2</span>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId || !gameState.rules?.drawWar}
                      checked={gameState.rules?.allowDraw4OnDraw2 ?? true}
                      onChange={(e) => updateRules({ allowDraw4OnDraw2: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item" style={{ opacity: gameState.rules?.drawWar ? 1 : 0.5 }}>
                    <span>Draw 2 on Draw 4</span>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId || !gameState.rules?.drawWar}
                      checked={gameState.rules?.allowDraw2OnDraw4 ?? true}
                      onChange={(e) => updateRules({ allowDraw2OnDraw4: e.target.checked })}
                    />
                  </label>
                  <label className="rule-item">
                    <span>Special Reverse</span>
                    <input
                      type="checkbox"
                      disabled={gameState.hostUserId !== userId}
                      checked={gameState.rules?.specialReverse ?? true}
                      onChange={(e) => updateRules({ specialReverse: e.target.checked })}
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
      ) : gameState?.status === 'playing' ? (
        <Game
          gameState={gameState}
          myId={userId}
          onPlaySequence={playSequence}
          onDrawCard={drawCard}
        />
      ) : (
        <div className="loading">Connecting to the Matrix...</div>
      )}
    </div>
  );
};

export default App;
