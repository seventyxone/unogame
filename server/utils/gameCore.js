const { rooms, getIo } = require('../state');
const { createDeck } = require('./deck');

// Lazy load to avoid circular dependencies
const getBotService = () => require('../services/botService');

const nextPlayerIndex = (room) => {
    let nextIdx = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
    let count = 0;
    while ((room.players[nextIdx].hand.length === 0 || (room.rules?.gameMode === 'tournament' && room.finishedPlayers?.includes(room.players[nextIdx].userId))) && count < room.players.length) {
        nextIdx = (nextIdx + room.direction + room.players.length) % room.players.length;
        count++;
    }
    return nextIdx;
};

const handleWin = (roomId, winner) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room) return;

    if (room.rules.gameMode === 'tournament') {
        // The player who is NOT in room.finishedPlayers is the one left with cards
        const loser = room.players.find(p => !room.finishedPlayers.includes(p.userId));
        if (loser) {
            const loserIdx = room.players.findIndex(p => p.userId === loser.userId);
            room.players.splice(loserIdx, 1); // Eliminate the last one left!
        }

        const humanCount = room.players.filter(p => !p.isBot).length;
        const totalRemaining = room.players.length;

        if (humanCount === 0 || totalRemaining <= 1) {
            room.status = 'finished';
            const realWinner = totalRemaining === 1 ? room.players[0].name : 'AI Dominance';
            io.to(roomId).emit('game_over', { winner: realWinner, mode: 'tournament', loser: loser ? loser.name : 'Unknown' });
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

const startGameInternal = (roomId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room || room.players.length < 2) return;
    room.status = 'playing';
    room.botIsThinking = false; // Reset lock to prevent deadlock bleeding across rounds
    room.deck = createDeck(room.rules);
    room.discardPile = [];
    room.currentPlayerIndex = 0;
    room.direction = 1;
    room.pendingDrawCount = 0;
    room.lastAction = null;
    room.playHistory = [];
    room.finishedPlayers = [];
    const size = room.rules?.startingHandSize || 7;
    room.players.forEach(p => p.hand = room.deck.splice(0, size));

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
