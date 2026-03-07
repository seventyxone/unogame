const { rooms, getIo } = require('../state');
const { createDeck } = require('./deck');

// Lazy load to avoid circular dependencies
const getBotService = () => require('../services/botService');

const nextPlayerIndex = (room) => {
    let nextIdx = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
    let count = 0;
    while ((room.players[nextIdx].hand.length === 0 || room.players[nextIdx].isSpectator || (room.rules?.gameMode === 'tournament' && room.finishedPlayers?.includes(room.players[nextIdx].userId))) && count < room.players.length) {
        nextIdx = (nextIdx + room.direction + room.players.length) % room.players.length;
        count++;
    }
    return nextIdx;
};

const handleWin = (roomId, winner) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room) return;

    room.lastWinnerId = winner.userId;

    if (room.rules.gameMode === 'tournament') {
        // The one player NOT in room.finishedPlayers is the one left with cards
        const loser = room.players.find(p => !p.isSpectator && !room.finishedPlayers.includes(p.userId));

        if (loser) {
            loser.isSpectator = true;
            room.lastEliminated = loser.name;
        }

        const activeHumans = room.players.filter(p => !p.isBot && !p.isSpectator).length;
        const totalActive = room.players.filter(p => !p.isSpectator).length;

        room.status = 'round_end';
        io.to(roomId).emit('game_update', room);

        if (activeHumans === 0 || totalActive <= 1) {
            setTimeout(() => {
                room.status = 'finished';
                const realWinner = totalActive === 1 ? room.players.find(p => !p.isSpectator).name : 'AI Dominance';
                io.to(roomId).emit('game_over', { winner: realWinner, mode: 'tournament', loser: loser ? loser.name : 'Unknown' });
            }, 3000);
        } else {
            setTimeout(() => {
                room.currentRound++;
                startGameInternal(roomId);
            }, 3000);
        }
    } else if (room.rules.gameMode === 'points') {
        room.scores = room.scores || {};
        room.scores[winner.userId] = (room.scores[winner.userId] || 0) + 1;

        const targetWins = room.rules.maxRounds || 3;
        const reachedTarget = Object.values(room.scores).some(s => s >= targetWins);

        room.status = 'round_end';
        io.to(roomId).emit('game_update', room);

        if (reachedTarget) {
            setTimeout(() => {
                room.status = 'finished';
                io.to(roomId).emit('game_over', { winner: winner.name, scores: room.scores, mode: 'points' });
            }, 3000);
        } else {
            setTimeout(() => {
                room.currentRound++;
                startGameInternal(roomId);
            }, 3000);
        }
    } else {
        room.status = 'finished';
        io.to(roomId).emit('game_over', { winner: winner.name });
    }
};

const startGameInternal = (roomId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    const playingCount = room.players.filter(p => !p.isSpectator).length;
    if (playingCount < 2) return;
    room.status = 'playing';
    room.botIsThinking = false; // Reset lock to prevent deadlock bleeding across rounds
    room.deck = createDeck(room.rules);
    room.discardPile = [];

    // Determine First Player
    const rule = room.rules?.firstTurnRule || 'host';
    let startIndex = 0;

    if (rule === 'random') {
        startIndex = Math.floor(Math.random() * room.players.length);
        console.log(`[GAME] Start Rule: RANDOM. Chose index ${startIndex} (${room.players[startIndex]?.name})`);
    } else if (rule === 'winner' && room.currentRound > 1 && room.lastWinnerId) {
        const winIdx = room.players.findIndex(p => p.userId === room.lastWinnerId);
        startIndex = winIdx !== -1 ? winIdx : 0;
        console.log(`[GAME] Start Rule: WINNER. Chose winner index ${startIndex} (${room.players[startIndex]?.name})`);
    } else {
        const hostIdx = room.players.findIndex(p => p.userId === room.hostUserId);
        startIndex = hostIdx !== -1 ? hostIdx : 0;
        console.log(`[GAME] Start Rule: HOST. Chose host index ${startIndex} (${room.players[startIndex]?.name})`);
    }

    // Crucial: Ensure the chosen starting player is actually playing (not eliminated/spectator)
    let safety = 0;
    const initialStart = startIndex;
    while (room.players[startIndex].isSpectator && safety < room.players.length) {
        startIndex = (startIndex + 1) % room.players.length;
        safety++;
    }
    if (initialStart !== startIndex) {
        console.log(`[GAME] Adjusted starting player from ${initialStart} to ${startIndex} because of spectator status.`);
    }
    room.currentPlayerIndex = startIndex;

    room.direction = room.rules?.startDirection ?? 1;
    room.pendingDrawCount = 0;
    room.lastAction = null;
    room.playHistory = [];
    room.finishedPlayers = [];
    room.lastEliminated = null;
    const size = room.rules?.startingHandSize || 7;
    room.players.forEach(p => {
        if (!p.isSpectator) p.hand = room.deck.splice(0, size);
        else p.hand = [];
    });

    // Initialize discard pile safely
    const firstCard = room.deck.shift();
    if (!firstCard) {
        room.status = 'lobby';
        io.to(roomId).emit('error', 'Deck exhausted during setup. Please check lobby settings.');
        return;
    }

    room.discardPile = [firstCard];

    // Official Uno Rules: Current top card cannot be Wild or Draw4 at start
    let safetyCounter = 0;
    while (room.discardPile[0] && room.discardPile[0].color === 'wild' && safetyCounter < 50) {
        room.deck.push(room.discardPile.shift());
        const nextCard = room.deck.shift();
        if (nextCard) {
            room.discardPile = [nextCard];
        }
        safetyCounter++;
    }
    io.to(roomId).emit('game_start', room);
    getBotService().checkBotTurn(roomId);
};

module.exports = {
    nextPlayerIndex,
    handleWin,
    startGameInternal
};
