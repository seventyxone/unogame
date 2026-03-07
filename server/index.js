const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const { rooms, setIo } = require('./state');
const { startGameInternal, nextPlayerIndex } = require('./utils/gameCore');
const { performPlaySequence, performDrawCard, handleAcceptChallenge, handleChallengeDraw4 } = require('./services/playerActionService');
const { checkBotTurn } = require('./services/botService');

setIo(io);

io.on('connection', (socket) => {
  console.log('User Connected:', socket.id);

  socket.on('join_room', ({ roomId, playerName, userId }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userId = userId;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        hostUserId: userId,
        players: [],
        deck: [],
        discardPile: [],
        currentPlayerIndex: 0,
        direction: 1,
        status: 'lobby',
        pendingDrawCount: 0,
        currentRound: 1,
        playHistory: [],
        lastAction: null,
        finishedPlayers: [],
        winners: [],
        rules: {
          gameMode: 'standard',
          firstTurnRule: 'host', // host, random, winner
          maxRounds: 3,
          drawWar: true,
          allowDraw4OnDraw2: true,
          allowDraw2OnDraw4: true,
          specialReverse: true,
          multiPlay: true,
          allowPlayAfterDraw: true,
          forcedDrawPass: false,
          playAfterPenalty: true,
          startingHandSize: 7,
          challengeRule: true,
          deckConfig: { '0': 1, '1': 2, '2': 2, '3': 2, '4': 2, '5': 2, '6': 2, '7': 2, '8': 2, '9': 2, 'Skip': 2, 'Reverse': 2, 'Draw2': 2, 'Wild': 4, 'Draw4': 4 }
        }
      });
    }

    const room = rooms.get(roomId);
    let player = room.players.find(p => p.userId === userId);
    if (player) {
      player.id = socket.id;
      player.name = playerName;
    } else {
      if (room.status !== 'lobby') {
        return socket.emit('error', 'Late joining is not allowed. This room is already in a game.');
      }
      player = { id: socket.id, userId, name: playerName, hand: [], isBot: false, isSpectator: false };
      room.players.push(player);
    }
    io.to(roomId).emit('room_update', room);
  });

  socket.on('fix_host', ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.hostUserId = userId;
      io.to(roomId).emit('room_update', room);
    }
  });

  socket.on('set_bot_count', ({ roomId, count, userId }) => {
    const room = rooms.get(roomId);
    if (!room || room.hostUserId !== userId) return;

    const botNames = [
      'Alexander', 'Beatriz', 'Charlie', 'Dimitri', 'Elena', 'Fabian', 'Grace', 'Hiroki', 'Isabella', 'Julian',
      'Katarina', 'Liam', 'Maya', 'Nathan', 'Olivia', 'Pavel', 'Quinn', 'Rafael', 'Sophia', 'Thomas'
    ];
    console.log(`[Server] Setting bot count to ${count} for room ${roomId}`);
    room.players = room.players.filter(p => !p.isBot);
    const shuffledNames = [...botNames].sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      const botId = `bot_${Math.random().toString(36).substr(2, 5)}`;
      const name = shuffledNames[i % shuffledNames.length];
      room.players.push({ id: botId, userId: botId, name, hand: [], isBot: true, isSpectator: false });
    }
    console.log(`[Server] Room ${roomId} now has ${room.players.length} total players.`);
    io.to(roomId).emit('room_update', room);
  });

  socket.on('update_rules', ({ roomId, rules, userId }) => {
    const room = rooms.get(roomId);
    if (room && room.hostUserId === userId) {
      const { deckConfig, ...otherRules } = rules;
      room.rules = { ...room.rules, ...otherRules };
      if (deckConfig) room.rules.deckConfig = { ...room.rules.deckConfig, ...deckConfig };
      io.to(roomId).emit('room_update', room);
    }
  });

  socket.on('start_game', ({ roomId, userId }) => {
    console.log(`[Server] Received start_game for room ${roomId} from user ${userId}`);
    const room = rooms.get(roomId);
    if (room && room.hostUserId === userId) {
      console.log(`[Server] Room found and host verified. Starting game...`);
      room.currentRound = 1;
      room.scores = {};
      room.winners = [];
      startGameInternal(roomId);
    } else {
      console.log(`[Server] Start failed: RoomExists=${!!room}, HostMatch=${room?.hostUserId === userId}`);
    }
  });

  socket.on('play_sequence', ({ roomId, cardIds, newColor, userId }) => {
    performPlaySequence(roomId, cardIds, newColor, userId, socket.id);
  });

  socket.on('draw_card', ({ roomId, userId }) => {
    performDrawCard(roomId, userId);
  });

  socket.on('accept_draw4', ({ roomId, userId }) => {
    handleAcceptChallenge(roomId, userId);
  });

  socket.on('challenge_draw4', ({ roomId, userId }) => {
    handleChallengeDraw4(roomId, userId);
  });

  socket.on('pass_turn', ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.players[room.currentPlayerIndex].userId !== userId) return;

    room.drewThisTurn = false;
    room.currentPlayerIndex = nextPlayerIndex(room);
    io.to(roomId).emit('game_update', room);
    checkBotTurn(roomId);
  });

  socket.on('reset_to_lobby', ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (!room || room.hostUserId !== userId) return;

    room.status = 'lobby';
    room.currentRound = 1;
    room.winners = [];
    room.finishedPlayers = [];
    room.lastAction = null;
    room.players.forEach(p => {
      p.hand = [];
      p.isSpectator = false;
    });

    io.to(roomId).emit('room_update', room);
  });

  socket.on('disconnect', () => {
    rooms.forEach((room, roomId) => {
      const player = room.players.find(p => p.id === socket.id);
      if (player && player.userId !== room.hostUserId && room.status === 'lobby') {
        room.players = room.players.filter(p => p.id !== socket.id);
        io.to(roomId).emit('room_update', room);
      }
      if (room.players.filter(p => !p.isBot).length === 0) rooms.delete(roomId);
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
