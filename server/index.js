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

const rooms = new Map();

function createDeck(rules) {
  const { deckConfig } = rules || {};
  const colors = ['red', 'blue', 'green', 'yellow'];
  const deck = [];

  const defaults = {
    '0': 1, '1': 2, '2': 2, '3': 2, '4': 2, '5': 2, '6': 2, '7': 2, '8': 2, '9': 2,
    'Skip': 2, 'Reverse': 2, 'Draw2': 2, 'Wild': 4, 'Draw4': 4
  };
  const counts = { ...defaults, ...deckConfig };

  for (const color of colors) {
    for (let i = 0; i <= 9; i++) {
      const c = counts[i.toString()];
      for (let j = 0; j < c; j++) {
        deck.push({ color, value: i.toString(), id: Math.random().toString(36).substr(2, 9) });
      }
    }
    ['Skip', 'Reverse', 'Draw2'].forEach(action => {
      const c = counts[action];
      for (let j = 0; j < c; j++) {
        deck.push({ color, value: action, id: Math.random().toString(36).substr(2, 9) });
      }
    });
  }

  for (let i = 0; i < counts['Wild']; i++) {
    deck.push({ color: 'wild', value: 'Wild', id: Math.random().toString(36).substr(2, 9) });
  }
  for (let i = 0; i < counts['Draw4']; i++) {
    deck.push({ color: 'wild', value: 'Draw4', id: Math.random().toString(36).substr(2, 9) });
  }

  return deck.sort(() => Math.random() - 0.5);
}

const performPlaySequence = (roomId, cardIds, newColor, playerId) => {
  const room = rooms.get(roomId);
  if (!room) return;

  const player = room.players[room.currentPlayerIndex];
  if (player.userId !== playerId) return;

  if (cardIds.length > 1 && !room.rules?.multiPlay) return;

  const cards = [];
  for (const id of cardIds) {
    const c = player.hand.find(card => card.id === id);
    if (!c) return;
    cards.push(c);
  }

  const topCard = room.discardPile[room.discardPile.length - 1];
  const isStacking = room.pendingDrawCount > 0;
  let canPlayFirst = false;

  if (isStacking) {
    if (room.rules?.drawWar) {
      if (cards[0].value === 'Draw2' || cards[0].value === 'Draw4') {
        if (cards[0].value === 'Draw2') {
          if (topCard.value === 'Draw2' || (topCard.value === 'Draw4' && room.rules?.allowDraw2OnDraw4)) canPlayFirst = true;
        } else if (cards[0].value === 'Draw4') {
          if (topCard.value === 'Draw4' || (topCard.value === 'Draw2' && room.rules?.allowDraw4OnDraw2)) canPlayFirst = true;
        }
      }
    } else {
      canPlayFirst = cards[0].color === 'wild' || cards[0].color === topCard.color || cards[0].value === topCard.value;
    }
  } else {
    canPlayFirst = cards[0].color === 'wild' || cards[0].color === topCard.color || cards[0].value === topCard.value || (topCard.originalColor && cards[0].color === topCard.color);
  }

  if (!canPlayFirst) return;

  if (cards.length > 1) {
    for (let i = 1; i < cards.length; i++) {
      if (cards[i].value !== cards[0].value) return;
    }
  }

  room.lastAction = {
    type: 'play',
    userId: player.userId,
    userName: player.name,
    sequence: cards.map(c => ({ ...c }))
  };

  let totalDraw = 0, revCount = 0, skipCount = 0;
  cards.forEach((card, index) => {
    const idx = player.hand.findIndex(c => c.id === card.id);
    player.hand.splice(idx, 1);
    if (card.color === 'wild') {
      card.originalColor = 'wild';
      card.color = (index === cards.length - 1) ? newColor : 'red';
    }
    room.discardPile.push(card);
    if (card.value === 'Draw2') totalDraw += 2;
    if (card.value === 'Draw4') totalDraw += 4;
    if (card.value === 'Reverse') revCount++;
    if (card.value === 'Skip') skipCount++;
  });

  room.pendingDrawCount += totalDraw;
  let extraTurn = room.rules?.specialReverse && revCount >= 2;

  if (revCount % 2 !== 0) {
    if (room.players.length === 2) skipCount++;
    else room.direction *= -1;
  }

  if (!extraTurn) {
    room.currentPlayerIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
    for (let i = 0; i < skipCount; i++) {
      room.currentPlayerIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
    }

    if (room.pendingDrawCount > 0) {
      const nextP = room.players[room.currentPlayerIndex];
      const hasResponse = room.rules?.drawWar && nextP.hand.some(c => {
        if (c.value === 'Draw2' && (room.discardPile[room.discardPile.length - 1].value === 'Draw2' || room.rules?.allowDraw2OnDraw4)) return true;
        if (c.value === 'Draw4' && (room.discardPile[room.discardPile.length - 1].value === 'Draw4' || room.rules?.allowDraw4OnDraw2)) return true;
        return false;
      });

      if (!hasResponse) {
        const drawn = room.deck.splice(0, room.pendingDrawCount);
        nextP.hand.push(...drawn);
        room.lastAction = {
          ...room.lastAction,
          warResult: {
            userId: nextP.userId,
            userName: nextP.name,
            count: room.pendingDrawCount
          }
        };
        room.pendingDrawCount = 0;
        room.currentPlayerIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
      }
    }
  }

  if (player.hand.length === 0) {
    handleWin(roomId, player);
  } else {
    io.to(roomId).emit('game_update', room);
    checkBotTurn(roomId);
  }
};

const handleWin = (roomId, winner) => {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.rules.gameMode === 'tournament') {
    // Find who has the most cards to eliminate them
    let maxCards = -1;
    let loserIdx = -1;
    room.players.forEach((p, i) => {
      if (p.hand.length > maxCards) {
        maxCards = p.hand.length;
        loserIdx = i;
      }
    });

    const loser = room.players[loserIdx];
    room.players.splice(loserIdx, 1); // Eliminate!

    const activeHumans = room.players.filter(p => !p.isBot);
    if (activeHumans.length <= 1) {
      room.status = 'finished';
      io.to(roomId).emit('game_over', { winner: winner.name, mode: 'tournament', loser: loser.name });
    } else {
      room.currentRound++;
      startGameInternal(roomId);
    }
  } else if (room.rules.gameMode === 'points') {
    room.scores = room.scores || {};
    room.players.forEach(p => {
      room.scores[p.userId] = (room.scores[p.userId] || 0) + p.hand.length;
    });
    if (room.currentRound >= (room.rules.maxRounds || 3)) {
      room.status = 'finished';
      io.to(roomId).emit('game_over', { winner: winner.name, scores: room.scores });
    } else {
      room.currentRound++;
      startGameInternal(roomId);
    }
  } else {
    room.status = 'finished';
    io.to(roomId).emit('game_over', { winner: winner.name });
  }
};

const performDrawCard = (roomId, playerId) => {
  const room = rooms.get(roomId);
  if (!room) return;
  const player = room.players[room.currentPlayerIndex];
  if (player.userId !== playerId) return;

  if (room.pendingDrawCount > 0) {
    const drawn = room.deck.splice(0, room.pendingDrawCount);
    player.hand.push(...drawn);
    room.lastAction = {
      type: 'draw',
      userId: player.userId,
      userName: player.name,
      warResult: { count: room.pendingDrawCount }
    };
    room.pendingDrawCount = 0;
  } else {
    if (room.deck.length === 0) {
      const top = room.discardPile.pop();
      room.deck = room.discardPile.sort(() => Math.random() - 0.5);
      room.discardPile = [top];
    }
    const drawnCard = room.deck.shift();
    player.hand.push(drawnCard);
    room.lastAction = {
      type: 'draw',
      userId: player.userId,
      userName: player.name,
      count: 1
    };
  }
  room.currentPlayerIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
  io.to(roomId).emit('game_update', room);
  checkBotTurn(roomId);
};

const checkBotTurn = (roomId) => {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') return;
  const curr = room.players[room.currentPlayerIndex];
  if (curr && curr.isBot) {
    setTimeout(() => {
      const top = room.discardPile[room.discardPile.length - 1];
      const stacking = room.pendingDrawCount > 0;
      let seq = [];
      curr.hand.forEach(c => {
        if (seq.length === 0) {
          let valid = false;
          if (stacking) {
            if (room.rules?.drawWar) {
              if (c.value === 'Draw2' && (top.value === 'Draw2' || room.rules?.allowDraw2OnDraw4)) valid = true;
              if (c.value === 'Draw4' && (top.value === 'Draw4' || room.rules?.allowDraw4OnDraw2)) valid = true;
            }
          } else {
            valid = c.color === 'wild' || c.color === top.color || c.value === top.value;
          }
          if (valid) seq.push(c);
        } else if (room.rules?.multiPlay && c.value === seq[0].value) {
          seq.push(c);
        }
      });
      if (seq.length > 0) {
        const colors = ['red', 'blue', 'green', 'yellow'];
        performPlaySequence(roomId, seq.map(s => s.id), colors[Math.floor(Math.random() * 4)], curr.userId);
      } else performDrawCard(roomId, curr.userId);
    }, 1000);
  }
};

const startGameInternal = (roomId) => {
  const room = rooms.get(roomId);
  if (!room || room.players.length < 2) return;
  room.status = 'playing';
  room.deck = createDeck(room.rules);
  room.discardPile = [];
  room.currentPlayerIndex = 0;
  room.direction = 1;
  room.pendingDrawCount = 0;
  room.lastAction = null;
  const size = room.rules?.startingHandSize || 7;
  room.players.forEach(p => p.hand = room.deck.splice(0, size));
  room.discardPile = [room.deck.shift()];
  while (room.discardPile[0].color === 'wild') {
    room.deck.push(room.discardPile.shift());
    room.discardPile = [room.deck.shift()];
  }
  io.to(roomId).emit('game_start', room);
  checkBotTurn(roomId);
};

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
        rules: {
          gameMode: 'standard',
          maxRounds: 3,
          drawWar: true,
          allowDraw4OnDraw2: true,
          allowDraw2OnDraw4: true,
          specialReverse: true,
          multiPlay: true,
          startingHandSize: 7,
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
      if (room.status !== 'lobby') return socket.emit('error', 'Game already in progress');
      player = { id: socket.id, userId, name: playerName, hand: [], isBot: false };
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
    room.players = room.players.filter(p => !p.isBot);
    for (let i = 0; i < count && room.players.length < 8; i++) {
      const botId = `bot_${Math.random().toString(36).substr(2, 5)}`;
      room.players.push({ id: botId, userId: botId, name: `Agent ${room.players.length}`, hand: [], isBot: true });
    }
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
    const room = rooms.get(roomId);
    if (room && room.hostUserId === userId) {
      room.currentRound = 1;
      room.scores = {};
      room.winners = [];
      startGameInternal(roomId);
    }
  });

  socket.on('play_sequence', ({ roomId, cardIds, newColor, userId }) => {
    performPlaySequence(roomId, cardIds, newColor, userId);
  });

  socket.on('draw_card', ({ roomId, userId }) => {
    performDrawCard(roomId, userId);
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
