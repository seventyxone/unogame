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
    room.lastWinnerName = winner.name;

    // Clear any existing continuation timer
    if (room.roundContinuationTimer) {
        clearTimeout(room.roundContinuationTimer);
        room.roundContinuationTimer = null;
    }

    if (room.rules.gameMode === 'tournament') {
        const loser = room.players.find(p => !p.isSpectator && !room.finishedPlayers.includes(p.userId));
        if (loser) {
            loser.isSpectator = true;
            room.lastEliminated = loser.name;
        }

        const activeHumans = room.players.filter(p => !p.isBot && !p.isSpectator).length;
        const totalActive = room.players.filter(p => !p.isSpectator).length;

        room.status = 'round_end';
        if (activeHumans === 0 || totalActive <= 1) {
            room.status = 'finished';
            const realWinner = totalActive === 1 ? room.players.find(p => !p.isSpectator).name : 'AI Dominance';
            io.to(roomId).emit('game_over', { winner: realWinner, mode: 'tournament', loser: loser ? loser.name : 'Unknown', room });
        } else {
            io.to(roomId).emit('game_update', room);
            // Automatic progression after 10s
            room.roundContinuationTimer = setTimeout(() => {
                handlePlayerReady(roomId, room.hostUserId, true);
            }, 10000);
        }
    } else if (room.rules.gameMode === 'points') {
        room.scores = room.scores || {};
        room.scores[winner.userId] = (room.scores[winner.userId] || 0) + 1;

        const targetWins = room.rules.maxRounds || 3;
        const reachedTarget = Object.values(room.scores).some(s => s >= targetWins);

        if (reachedTarget) {
            room.status = 'finished';
            io.to(roomId).emit('game_over', { winner: winner.name, scores: room.scores, mode: 'points', room });
        } else {
            room.status = 'round_end';
            io.to(roomId).emit('game_update', room);
            // Automatic progression after 10s
            room.roundContinuationTimer = setTimeout(() => {
                handlePlayerReady(roomId, room.hostUserId, true);
            }, 10000);
        }
    } else {
        room.status = 'finished';
        io.to(roomId).emit('game_over', { winner: winner.name, room });
    }

    room.readyPlayers = {};
};

const handlePlayerReady = (roomId, userId, isAuto = false) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room || (room.status !== 'round_end' && room.status !== 'finished')) return;

    room.readyPlayers = room.readyPlayers || {};
    room.readyPlayers[userId] = true;

    const hostId = room.hostUserId;
    const humanPlayers = room.players.filter(p => !p.isBot && !p.isSpectator);
    const readyCount = humanPlayers.filter(p => room.readyPlayers[p.userId]).length;

    // Clear timer if manually bypassed or auto-triggered
    if (room.roundContinuationTimer) {
        clearTimeout(room.roundContinuationTimer);
        room.roundContinuationTimer = null;
    }

    if (isAuto || (room.readyPlayers[hostId] && readyCount >= Math.ceil(humanPlayers.length / 2))) {
        if (room.status === 'round_end') {
            room.currentRound++;
            room.readyPlayers = {};
            startGameInternal(roomId);
        } else {
            // Reset to lobby
            room.status = 'lobby';
            room.currentRound = 1;
            room.readyPlayers = {};
            room.winners = [];
            room.finishedPlayers = [];
            room.lastAction = null;
            room.players.forEach(p => { p.hand = []; p.isSpectator = false; });
            io.to(roomId).emit('room_update', room);
        }
    } else {
        io.to(roomId).emit('game_update', room);
    }
};

const startGameInternal = (roomId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    const playingCount = room.players.filter(p => !p.isSpectator).length;
    if (playingCount < 2) return;
    room.status = 'playing';
    room.botIsThinking = false;
    room.deck = createDeck(room.rules);
    room.discardPile = [];
    room.direction = room.rules?.startDirection ?? 1;

    const rule = room.rules?.firstTurnRule || 'host';
    let startIndex = 0;

    if (rule === 'random') {
        startIndex = Math.floor(Math.random() * room.players.length);
    } else if (rule === 'winner' && room.currentRound > 1 && room.lastWinnerId) {
        const winIdx = room.players.findIndex(p => p.userId === room.lastWinnerId);
        startIndex = winIdx !== -1 ? winIdx : 0;
    } else {
        const hostIdx = room.players.findIndex(p => p.userId === room.hostUserId);
        startIndex = hostIdx !== -1 ? hostIdx : 0;
    }

    let safety = 0;
    while (room.players[startIndex].isSpectator && safety < room.players.length) {
        startIndex = (startIndex + 1) % room.players.length;
        safety++;
    }
    room.currentPlayerIndex = startIndex;
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

    const firstCard = room.deck.shift();
    if (!firstCard) {
        room.status = 'lobby';
        io.to(roomId).emit('error', 'Deck exhausted during setup.');
        return;
    }

    room.discardPile = [firstCard];
    let safetyCounter = 0;
    while (room.discardPile[0] &&
        (room.discardPile[0].color === 'wild' || room.discardPile[0].value === 'Draw4') &&
        safetyCounter < room.deck.length + 10 &&
        room.deck.length > 0) {
        room.deck.push(room.discardPile.shift());
        room.discardPile = [room.deck.shift()];
        safetyCounter++;
    }

    io.to(roomId).emit('game_start', room);
    getBotService().checkBotTurn(roomId);
};

module.exports = {
    nextPlayerIndex,
    handleWin,
    handlePlayerReady,
    startGameInternal
};
