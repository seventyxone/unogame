const { rooms, getIo } = require('../state');
const { nextPlayerIndex, handleWin } = require('../utils/gameCore');
// Lazy load botService
const getBotService = () => require('./botService');

const performPlaySequence = (roomId, cardIds, newColor, playerId, socketId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room) return;

    const player = room.players[room.currentPlayerIndex];
    if (player.userId !== playerId) {
        // Silent reject — user clicked during opponent's turn, not a real error
        return;
    }

    if (cardIds.length > 1 && !room.rules?.multiPlay) {
        if (socketId) io.to(socketId).emit('error', 'Multi-play is currently disabled in rules.');
        if (!socketId) {
            console.log(`[BOT ERROR] Bot tried multi-play when disabled. Forcing pass.`);
            room.currentPlayerIndex = nextPlayerIndex(room);
            io.to(roomId).emit('game_update', room);
            getBotService().checkBotTurn(roomId);
        }
        return;
    }

    const cards = [];
    for (const id of cardIds) {
        const c = player.hand.find(card => card.id === id);
        if (!c) {
            if (socketId) io.to(socketId).emit('error', 'Card missing from hand.');
            if (!socketId) {
                console.log(`[BOT ERROR] Bot tried playing missing card. Forcing pass.`);
                room.currentPlayerIndex = nextPlayerIndex(room);
                io.to(roomId).emit('game_update', room);
                getBotService().checkBotTurn(roomId);
            }
            return;
        }
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

    if (!canPlayFirst) {
        if (socketId) io.to(socketId).emit('error', 'Card does not match the discard pile!');
        if (!socketId) {
            console.log(`[BOT ERROR] Bot tried illegal move. Forcing pass.`);
            room.currentPlayerIndex = nextPlayerIndex(room);
            io.to(roomId).emit('game_update', room);
            getBotService().checkBotTurn(roomId);
        }
        return;
    }

    if (cards.length > 1) {
        for (let i = 1; i < cards.length; i++) {
            if (cards[i].value !== cards[0].value) {
                if (socketId) io.to(socketId).emit('error', 'Multi-played cards must be the same value!');
                if (!socketId) {
                    console.log(`[BOT ERROR] Bot tried illegal multi move. Forcing pass.`);
                    room.currentPlayerIndex = nextPlayerIndex(room);
                    io.to(roomId).emit('game_update', room);
                    getBotService().checkBotTurn(roomId);
                }
                return;
            }
        }
    }

    let totalDraw = 0, revCount = 0, skipCount = 0;
    cards.forEach((card, index) => {
        const idx = player.hand.findIndex(c => c.id === card.id);
        player.hand.splice(idx, 1);
        if (card.color === 'wild') {
            card.originalColor = 'wild';
            card.color = newColor || 'red'; // Set all wild tiles in this sequence to chosen color
        }
        room.discardPile.push(card);
        if (card.value === 'Draw2') totalDraw += 2;
        if (card.value === 'Draw4') totalDraw += 4;
        if (card.value === 'Reverse') revCount++;
        if (card.value === 'Skip') skipCount++;
    });

    const action = {
        type: 'play',
        userId: player.userId,
        userName: player.name,
        sequence: cards.map(c => ({ ...c })) // Now has updated colors
    };

    room.playHistory = room.playHistory || [];
    room.playHistory.push(action);
    const historyLimit = Math.max(room.players.length, 10);
    if (room.playHistory.length > historyLimit) {
        room.playHistory.shift();
    }
    room.lastAction = action;

    room.pendingDrawCount += totalDraw;
    let extraTurn = room.rules?.specialReverse && revCount >= 2;

    if (revCount % 2 !== 0) {
        if (room.players.length === 2) skipCount++;
        else room.direction *= -1;
    }

    if (!extraTurn) {
        room.drewThisTurn = false; // Reset draw flag on play

        // CAPTURE PREVIOUS COLOR BEFORE TURN ADVANCE (for Draw4 challenge)
        const prevTop = room.discardPile[room.discardPile.length - cards.length - 1];
        const targetChallengeColor = prevTop ? (prevTop.color || prevTop.originalColor) : null;
        const playedDraw4 = cards.some(c => c.value === 'Draw4');

        room.currentPlayerIndex = nextPlayerIndex(room);
        for (let i = 0; i < skipCount; i++) {
            room.currentPlayerIndex = nextPlayerIndex(room);
        }

        if (room.pendingDrawCount > 0) {
            const nextP = room.players[room.currentPlayerIndex];

            // OFFICIAL CHALLENGE RULE: Only applies to Wild Draw 4
            if (room.rules?.challengeRule && playedDraw4 && room.pendingDrawCount === 4) {
                room.pendingChallenge = {
                    victimId: nextP.userId,
                    attackerId: player.userId,
                    attackerName: player.name,
                    targetColor: targetChallengeColor,
                    roomId: roomId
                };
                io.to(roomId).emit('game_update', room);
                if (nextP.isBot) {
                    getBotService().checkBotTurn(roomId);
                }
                return; // STOP HERE - Wait for victim to accept or challenge
            }

            const hasResponse = room.rules?.drawWar && nextP.hand.some(c => {
                if (c.value === 'Draw2' && (room.discardPile[room.discardPile.length - 1].value === 'Draw2' || room.rules?.allowDraw2OnDraw4)) return true;
                if (c.value === 'Draw4' && (room.discardPile[room.discardPile.length - 1].value === 'Draw4' || room.rules?.allowDraw4OnDraw2)) return true;
                return false;
            });

            if (!hasResponse) {
                const drawn = room.deck.splice(0, room.pendingDrawCount);
                const targetPlayer = room.players[room.currentPlayerIndex];
                targetPlayer.hand.push(...drawn);

                // Log the forced draw in play history
                const drawAction = {
                    type: 'draw',
                    userId: targetPlayer.userId,
                    userName: targetPlayer.name,
                    count: room.pendingDrawCount
                };
                room.playHistory = room.playHistory || [];
                room.playHistory.push(drawAction);
                const historyLimit = Math.max(room.players.length, 10);
                if (room.playHistory.length > historyLimit) room.playHistory.shift();

                room.lastAction = {
                    ...room.lastAction,
                    warResult: {
                        userId: targetPlayer.userId,
                        userName: targetPlayer.name,
                        count: room.pendingDrawCount
                    }
                };
                room.pendingDrawCount = 0;

                // Custom Rule: Play After Multiple Draw
                const topCard = room.discardPile[room.discardPile.length - 1];
                const hasPlayable = drawn.some(c =>
                    c.color === 'wild' || c.color === topCard.color || c.value === topCard.value || (topCard.originalColor && c.color === topCard.color)
                );

                if (room.rules?.playAfterPenalty && hasPlayable && !targetPlayer.isBot) {
                    room.drewThisTurn = true; // Let player choose to play or pass
                } else {
                    room.drewThisTurn = false;
                    room.currentPlayerIndex = nextPlayerIndex(room);
                }

                if (targetPlayer.isBot) {
                    // Bot already drew, above logic handled turn advancement
                    getBotService().checkBotTurn(roomId);
                }
            }
        }
    }

    if (player.hand.length === 0) {
        if (room.rules.gameMode === 'tournament') {
            room.finishedPlayers = room.finishedPlayers || [];
            if (!room.finishedPlayers.includes(player.userId)) {
                room.finishedPlayers.push(player.userId);
            }

            const activeCount = room.players.filter(p => !room.finishedPlayers.includes(p.userId)).length;
            if (activeCount === 1) {
                handleWin(roomId, player); // Ends round
            } else {
                io.to(roomId).emit('game_update', room);
                getBotService().checkBotTurn(roomId);
            }
        } else {
            handleWin(roomId, player);
        }
    } else {
        io.to(roomId).emit('game_update', room);
        getBotService().checkBotTurn(roomId);
    }
};

const performDrawCard = (roomId, playerId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room) return;
    const player = room.players[room.currentPlayerIndex];
    if (player.userId !== playerId) {
        return; // Guard against acting out of turn (fixes bot deadlock sync issue)
    }

    // Guard against multiple draws in one turn
    if (room.drewThisTurn && !room.rules?.drawUntilPlayable) {
        return;
    }

    // Reset drew flag
    room.drewThisTurn = true;

    if (room.pendingDrawCount > 0) {
        const drawn = room.deck.splice(0, room.pendingDrawCount);
        player.hand.push(...drawn);
        const action = {
            type: 'draw',
            userId: player.userId,
            userName: player.name,
            count: room.pendingDrawCount
        };
        room.playHistory = room.playHistory || [];
        room.playHistory.push(action);
        const historyLimit = Math.max(room.players.length, 10);
        if (room.playHistory.length > historyLimit) room.playHistory.shift();
        room.lastAction = action;
        room.pendingDrawCount = 0;

        // In many rules, penalty draw ends turn immediately
        room.drewThisTurn = false;
        room.currentPlayerIndex = nextPlayerIndex(room);
    } else {
        if (room.deck.length === 0) {
            const top = room.discardPile.pop();
            // Reset wild cards back to their original color before reshuffling
            room.deck = room.discardPile.map(c => {
                if (c.originalColor === 'wild') {
                    return { ...c, color: 'wild', originalColor: undefined };
                }
                return c;
            }).sort(() => Math.random() - 0.5);
            room.discardPile = [top];
        }
        const drawnCard = room.deck.shift();
        player.hand.push(drawnCard);
        const action = {
            type: 'draw',
            userId: player.userId,
            userName: player.name,
            count: 1
        };
        room.playHistory = room.playHistory || [];
        room.playHistory.push(action);
        const historyLimit = Math.max(room.players.length, 10);
        if (room.playHistory.length > historyLimit) room.playHistory.shift();
        room.lastAction = action;

        // Custom Rule: Strategic Decision Point
        const topCard = room.discardPile[room.discardPile.length - 1];
        const isPlayable = drawnCard.color === 'wild' || drawnCard.color === topCard.color || drawnCard.value === topCard.value || (topCard.originalColor && drawnCard.color === topCard.color);

        // If either Play After Draw is on (and playable) OR Forced Draw/Pass is on, don't advance
        if ((room.rules?.allowPlayAfterDraw && isPlayable) || room.rules?.forcedDrawPass) {
            io.to(roomId).emit('game_update', room);
            if (player.isBot) {
                setTimeout(() => getBotService().checkBotTurn(roomId), 1000);
            }
            return;
        } else {
            // In Standard/Safe rules, turn advances if drawn card isn't playable
            room.drewThisTurn = false;
            room.currentPlayerIndex = nextPlayerIndex(room);
        }
    }
    io.to(roomId).emit('game_update', room);
    getBotService().checkBotTurn(roomId);
};

const handleAcceptChallenge = (roomId, userId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room || !room.pendingChallenge || room.pendingChallenge.victimId !== userId) return;

    room.pendingChallenge = null;
    const targetPlayer = room.players[room.currentPlayerIndex];

    // If Draw War is active and player can stack, skip the automatic drawing
    const canStack = room.rules?.drawWar && targetPlayer.hand.some(c => {
        const top = room.discardPile[room.discardPile.length - 1];
        if (c.value === 'Draw4' && (top.value === 'Draw4' || room.rules?.allowDraw4OnDraw2)) return true;
        if (c.value === 'Draw2' && (top.value === 'Draw2' || room.rules?.allowDraw2OnDraw4)) return true;
        return false;
    });

    if (canStack) {
        console.log(`[Server] ${targetPlayer.name} accepted phase but has stack options. Staying in turn.`);
        room.botIsThinking = false; // Clear guard so they can think for their turn
        io.to(roomId).emit('game_update', room);
        getBotService().checkBotTurn(roomId);
        return;
    }

    const drawn = room.deck.splice(0, 4);
    targetPlayer.hand.push(...drawn);

    room.playHistory.push({ type: 'draw', userId: targetPlayer.userId, userName: targetPlayer.name, count: 4 });
    room.pendingDrawCount = 0;
    room.currentPlayerIndex = nextPlayerIndex(room);

    io.to(roomId).emit('game_update', room);
    getBotService().checkBotTurn(roomId);
};

const handleChallengeDraw4 = (roomId, userId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room || !room.pendingChallenge || room.pendingChallenge.victimId !== userId) return;

    const challenge = room.pendingChallenge;
    room.pendingChallenge = null;

    const attacker = room.players.find(p => p.userId === challenge.attackerId);
    const victim = room.players.find(p => p.userId === challenge.victimId);
    const hasMatch = attacker.hand.some(c => c.color === challenge.targetColor && c.color !== 'wild');

    let penaltyUser, cardCount;
    if (hasMatch) {
        penaltyUser = attacker;
        cardCount = 4;
        room.playHistory.push({ type: 'challenge_result', result: 'success', attacker: attacker.name, victim: victim.name });
    } else {
        penaltyUser = victim;
        cardCount = 6;
        room.playHistory.push({ type: 'challenge_result', result: 'failed', attacker: attacker.name, victim: victim.name });
    }

    const drawn = room.deck.splice(0, cardCount);
    penaltyUser.hand.push(...drawn);
    room.playHistory.push({ type: 'draw', userId: penaltyUser.userId, userName: penaltyUser.name, count: cardCount });
    room.pendingDrawCount = 0;

    if (!hasMatch) {
        room.currentPlayerIndex = nextPlayerIndex(room);
    }

    io.to(roomId).emit('game_update', room);
    getBotService().checkBotTurn(roomId);
};

module.exports = {
    performPlaySequence,
    performDrawCard,
    handleAcceptChallenge,
    handleChallengeDraw4
};
