const { rooms, getIo } = require('../state');
const { nextPlayerIndex, handleWin } = require('../utils/gameCore');

const refillDeckIfNeeded = (room) => {
    if (room.deck.length > 5) return; // Pad to prevent excessive shuffling
    if (room.discardPile.length <= 1) return; // Cannot refill if nothing to shuffle

    const top = room.discardPile.pop();
    const deck = [...room.discardPile];

    // Fisher-Yates Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    room.deck = deck.map(c => {
        if (c.originalColor === 'wild') {
            return { ...c, color: 'wild', originalColor: undefined };
        }
        return c;
    });
    room.discardPile = [top];
    console.log(`[DECK] Reshuffled ${room.deck.length} cards into the deck.`);
};
// Lazy load botService
const getBotService = () => require('./botService');

const performPlaySequence = (roomId, cardIds, newColor, playerId, socketId, isUno, targetUserId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room) return;

    const player = room.players[room.currentPlayerIndex];
    if (player.userId !== playerId) {
        return;
    }

    if (isUno) {
        player.saidUno = true;
        console.log(`[UNO] ${player.name} declared UNO! during play sequence.`);
    }

    // AUTO-PENALTY CHECK: If anyone (NOT the current player who is about to play) 
    // has 1 card and hasn't said UNO, they are caught now as the window closes.
    if (room.rules?.requireUnoDeclaration) {
        const missedUnos = room.players.filter(p => !p.isSpectator && p.userId !== player.userId && p.hand.length === 1 && !p.saidUno);
        if (missedUnos.length > 0) {
            missedUnos.forEach(target => {
                refillDeckIfNeeded(room);
                const penalty = room.deck.splice(0, 2);
                target.hand.push(...penalty);
                target.saidUno = false;
                console.log(`[UNO] AUTO-PENALTY: ${target.name} caught by turn skip. +2 Cards.`);
            });
            // We don't stop the play, but we do update the room state and maybe notify?
            // Usually, room.lastAction will be overwritten by the play action below, 
            // so we might want to log a mini-event or just let it slide since it's "auto".
        }
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
            if (cards[0].value.includes('Draw2') || cards[0].value.includes('Hit2') || cards[0].value.includes('TargetDraw2') || cards[0].value.includes('Draw4') || cards[0].value.includes('Hit4') || cards[0].value.includes('TargetDraw4')) {
                const isTwo = cards[0].value.includes('Draw2') || cards[0].value.includes('Hit2') || cards[0].value.includes('TargetDraw2');
                const isFour = cards[0].value.includes('Draw4') || cards[0].value.includes('Hit4') || cards[0].value.includes('TargetDraw4');
                const stackValue = topCard.value.includes('4') ? 4 : 2;

                if (isTwo && (stackValue === 2 || (stackValue === 4 && room.rules?.allowDraw2OnDraw4))) {
                    if (stackValue === 4 && room.rules?.draw2OnDraw4ColorMatch) {
                        if (cards[0].color === topCard.color || cards[0].color === 'wild') canPlayFirst = true;
                    } else {
                        canPlayFirst = true;
                    }
                } else if (isFour && (stackValue === 4 || (stackValue === 2 && room.rules?.allowDraw4OnDraw2))) {
                    canPlayFirst = true;
                }
            }
        } else {
            canPlayFirst = cards[0].color === 'wild' || cards[0].color === topCard.color || cards[0].value === topCard.value;
        }
    } else {
        const isDiscardAllMatch = (cards[0].value.includes('DiscardAll') && topCard.value.includes('DiscardAll'));
        canPlayFirst = cards[0].color === 'wild' ||
            cards[0].color === topCard.color ||
            cards[0].value === topCard.value ||
            (topCard.originalColor && cards[0].color === topCard.color) ||
            isDiscardAllMatch;
        // Custom stacking check for variations
        if (!canPlayFirst) {
            if (cards[0].value.includes('Skip') && topCard.value.includes('Skip')) canPlayFirst = true;
            if (cards[0].value.includes('Reverse') && topCard.value.includes('Reverse')) canPlayFirst = true;
            if (cards[0].value.includes('Hit') && topCard.value.includes('Hit') &&
                ((cards[0].value.includes('2') && topCard.value.includes('2')) ||
                    (cards[0].value.includes('4') && topCard.value.includes('4')))) canPlayFirst = true;
        }
    }

    if (!canPlayFirst) {
        if (socketId) io.to(socketId).emit('error', 'Card does not match the discard pile!');
        if (!socketId) {
            console.log(`[BOT ERROR] Bot tried illegal move. Forcing pass or draw.`);
            if (isStacking) {
                performDrawCard(roomId, player.userId);
            } else {
                room.currentPlayerIndex = nextPlayerIndex(room);
                io.to(roomId).emit('game_update', room);
                getBotService().checkBotTurn(roomId);
            }
        }
        return;
    }

    if (cards.length > 1) {
        for (let i = 1; i < cards.length; i++) {
            const v1 = cards[0].value;
            const vi = cards[i].value;
            const valuesMatch = v1 === vi ||
                (v1.includes('Skip') && vi.includes('Skip')) ||
                (v1.includes('Reverse') && vi.includes('Reverse')) ||
                (v1.includes('Hit') && vi.includes('Hit') &&
                    ((v1.includes('2') && vi.includes('2')) ||
                        (v1.includes('4') && vi.includes('4'))));

            if (!valuesMatch) {
                if (socketId) io.to(socketId).emit('error', 'Multi-played cards must be a compatible value!');
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

    let totalDraw = 0, revCount = 0, skipCount = 0, hitAllValue = 0, targetDrawValue = 0;
    const discardAllBatch = [];

    cards.forEach((card, index) => {
        const idx = player.hand.findIndex(c => c.id === card.id);
        player.hand.splice(idx, 1);

        if (card.color === 'wild') {
            card.originalColor = 'wild';
            card.color = newColor || 'red';
        }

        // Action Logic
        if (card.value === 'Reverse' || card.value === 'WildReverse') revCount++;
        if (card.value === 'Skip' || card.value === 'WildSkip') skipCount++;

        if (card.value.includes('TargetDraw')) {
            const amount = card.value.includes('4') ? 4 : 2;
            targetDrawValue += amount;
        } else if (card.value.includes('Hit2')) {
            hitAllValue += 2;
        } else if (card.value.includes('Hit4')) {
            hitAllValue += 4;
        } else if (card.value.includes('Draw2')) {
            totalDraw += 2;
        } else if (card.value.includes('Draw4')) {
            totalDraw += 4;
        }

        if (card.value.includes('DiscardAll')) {
            const targetColor = card.color;
            // IMPORTANT: Only discard cards of the EXACT match color, 
            // and NEVER include other Wild cards in the generic purge.
            const toDiscard = player.hand.filter(c => c.color === targetColor && c.color !== 'wild');
            toDiscard.forEach(c => {
                const cIdx = player.hand.findIndex(h => h.id === c.id);
                player.hand.splice(cIdx, 1);
                discardAllBatch.push(c);
            });
        }

        if (card.value.includes('SkipAll')) {
            skipCount = room.players.length - 1;
        }

        // Rule: A player can NEVER skip themselves. 
        // We cap the skipCount so that the cycle doesn't land back on the perpetrator 
        // unless they intended to (e.g. Skip All).
        // Since the turn moves to next player FIRST, skipCount=N-1 means "Return to me".
        // skipCount=N would mean "Skip me and go to player 2".
        if (skipCount >= room.players.length) {
            skipCount = room.players.length - 1;
        }

        // Push main card last for DiscardAll batches to ensure it's on top
        if (card.value.includes('DiscardAll')) {
            discardAllBatch.forEach(c => room.discardPile.push(c));
        }

        room.discardPile.push(card);
    });

    // Apply Effects: Draw War (Stacking/Contribute) vs Target/Global Hit
    if (room.rules?.drawWar && isStacking) {
        // High Intensity Stack: Convert Hit-All and TargetDraw into Stack Growth
        if (hitAllValue > 0) {
            totalDraw += hitAllValue;
            hitAllValue = 0; // Negated global effect for local war escalation
        }
        if (targetDrawValue > 0) {
            totalDraw += targetDrawValue;
            targetDrawValue = 0; // Negated targeting effect for local war escalation
        }
    } else {
        if (hitAllValue > 0) {
            // Standard Ping: Everyone else draws immediately
            room.players.forEach(p => {
                if (p.userId !== player.userId && !p.isSpectator) {
                    while (room.deck.length < hitAllValue && room.discardPile.length > 1) {
                        refillDeckIfNeeded(room);
                    }
                    const drawn = room.deck.splice(0, hitAllValue);
                    p.hand.push(...drawn);
                    p.saidUno = false;
                }
            });
            // hitAllValue is NOT added to pendingDrawCount here, so no war is started
        }

        if (targetDrawValue > 0 && targetUserId) {
            const target = room.players.find(p => p.userId === targetUserId);
            if (target) {
                while (room.deck.length < targetDrawValue && room.discardPile.length > 1) {
                    refillDeckIfNeeded(room);
                }
                const drawn = room.deck.splice(0, targetDrawValue);
                target.hand.push(...drawn);
                target.saidUno = false;
            }
        }
    }

    room.skippedPlayers = []; // RESET for every play
    let isSpecialReverse = room.rules?.specialReverse && (revCount >= 2 || (room.players.length === 2 && revCount > 0));

    // Handle 1v1 Reverse as a Skip
    if (room.players.length === 2 && revCount % 2 !== 0 && room.rules?.specialReverse) {
        skipCount++;
    }

    const action = {
        id: Date.now(), // UNIQUE ID
        type: 'play',
        userId: player.userId,
        userName: player.name,
        sequence: cards.map(c => ({ ...c })),
        purged: discardAllBatch.map(c => ({ ...c })),
        specialReverse: isSpecialReverse,
        isAutoUno: isUno,
        skippedPlayers: [],
        details: {
            revCount,
            skipCount,
            hitCount: hitAllValue,
            totalDrawAmount: totalDraw,
            isStackingAction: isStacking && (totalDraw > 0 || hitAllValue > 0 || targetDrawValue > 0),
            targetName: (targetDrawValue > 0 && targetUserId) ? room.players.find(p => p.userId === targetUserId)?.name : undefined,
            targetAmount: targetDrawValue > 0 ? targetDrawValue : undefined
        }
    };

    room.playHistory = room.playHistory || [];
    room.playHistory.push(action);
    const historyLimit = Math.max(room.players.length, 10);
    if (room.playHistory.length > historyLimit) {
        room.playHistory.shift();
    }
    room.lastAction = action;

    room.pendingDrawCount += totalDraw;
    let extraTurn = room.rules?.specialReverse && revCount >= 2 && player.hand.length > 0;

    if (revCount % 2 !== 0) {
        if (room.players.length === 2) {
            if (room.rules?.specialReverse) {
                // In 2-player, reverse acts as skip if specialReverse is on
                // This skip is already handled by the `room.skippedPlayers` logic above if it was a single reverse
                // If it's a double reverse, it's an extra turn, so no skip.
                if (revCount === 1) { /* skip already handled */ }
            } else {
                room.direction *= -1;
            }
        } else {
            room.direction *= -1;
        }
    }

    if (!extraTurn) {
        room.drewThisTurn = false;

        // Advance to NEXT player (the person who would normally be next)
        room.currentPlayerIndex = nextPlayerIndex(room);

        // If skipCount > 0, we skip THAT player and potentially more
        while (skipCount > 0) {
            const skippedPlayer = room.players[room.currentPlayerIndex];
            room.skippedPlayers.push({ name: skippedPlayer.name, userId: skippedPlayer.userId });

            // Advance past the skipped player
            room.currentPlayerIndex = nextPlayerIndex(room);
            skipCount--;
        }
    }

    action.skippedPlayers = room.skippedPlayers;
    room.lastAction = action;

    if (room.pendingDrawCount > 0) {
        const nextP = room.players[room.currentPlayerIndex];

        // Compute these for challenge logic (fixes ReferenceError)
        const playedDraw4 = action.sequence.some(c => c.value === 'Draw4');
        const prevTop = room.discardPile[room.discardPile.length - action.sequence.length - 1];
        const targetChallengeColor = prevTop ? (prevTop.color || prevTop.originalColor) : null;

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

        const currentTop = room.discardPile[room.discardPile.length - 1];
        const hasResponse = room.rules?.drawWar && nextP.hand.some(c => {
            const isTwo = c.value.includes('Draw2') || c.value.includes('Hit2') || c.value.includes('TargetDraw2');
            const isFour = c.value.includes('Draw4') || c.value.includes('Hit4') || c.value.includes('TargetDraw4');
            const topIsFour = currentTop.value.includes('4');

            if (isTwo && (!topIsFour || room.rules?.allowDraw2OnDraw4)) {
                if (topIsFour && room.rules?.draw2OnDraw4ColorMatch) {
                    return c.color === currentTop.color || c.color === 'wild';
                }
                return true;
            }
            if (isFour && (topIsFour || room.rules?.allowDraw4OnDraw2)) return true;
            return false;
        });

        if (!hasResponse) {
            console.log(`[WAR] ${nextP.name} has no response to stack of ${room.pendingDrawCount}. Drawing.`);
            while (room.deck.length < room.pendingDrawCount && room.discardPile.length > 1) {
                refillDeckIfNeeded(room);
            }
            const drawn = room.deck.splice(0, room.pendingDrawCount);
            const targetPlayer = room.players[room.currentPlayerIndex];
            targetPlayer.hand.push(...drawn);
            if (targetPlayer.hand.length > 1) targetPlayer.saidUno = false;

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
                id: Date.now(), // Refresh ID for draw side-effect
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

            if (room.rules?.playAfterPenalty && hasPlayable && !targetPlayer.isBot && targetPlayer.hand.length > 0) {
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

    // Only reset saidUno if they have MORE than 1 card.
    // If they have exactly 1, we keep the flag if they just said it.
    if (player.hand.length > 1) {
        player.saidUno = false;
    }

    if (player.hand.length === 0) {
        if (room.rules.gameMode === 'tournament') {
            room.finishedPlayers = room.finishedPlayers || [];
            if (!room.finishedPlayers.includes(player.userId)) {
                room.finishedPlayers.push(player.userId);
            }

            const activeCount = room.players.filter(p => !p.isSpectator && !room.finishedPlayers.includes(p.userId)).length;
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

    // Bot UNO logic: 95% chance to say it after a 1.5s delay
    if (room.rules?.requireUnoDeclaration && player.isBot && player.hand.length === 1) {
        setTimeout(() => {
            if (player.hand.length === 1 && !player.saidUno && Math.random() < 0.95) {
                console.log(`[BOT] ${player.name} declaring UNO automatically.`);
                handleDeclareUno(roomId, player.userId);
            }
        }, 1500);
    }
};

const performDrawCard = (roomId, playerId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room) return;
    const player = room.players[room.currentPlayerIndex];
    if (player.userId !== playerId) {
        return;
    }

    // AUTO-PENALTY CHECK
    if (room.rules?.requireUnoDeclaration) {
        const missedUnos = room.players.filter(p => !p.isSpectator && p.userId !== player.userId && p.hand.length === 1 && !p.saidUno);
        missedUnos.forEach(target => {
            refillDeckIfNeeded(room);
            const penalty = room.deck.splice(0, 2);
            target.hand.push(...penalty);
            target.saidUno = false;
        });
    }

    // Guard against multiple draws in one turn
    if (room.drewThisTurn && !room.rules?.drawUntilPlayable) {
        return;
    }

    // Reset drew flag
    room.drewThisTurn = true;

    if (room.pendingDrawCount > 0) {
        // Ensure deck has enough cards for the penalty
        while (room.deck.length < room.pendingDrawCount && room.discardPile.length > 1) {
            refillDeckIfNeeded(room);
        }
        const drawn = room.deck.splice(0, room.pendingDrawCount);
        player.hand.push(...drawn);
        if (player.hand.length > 1) player.saidUno = false;
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
        refillDeckIfNeeded(room);
        const drawnCard = room.deck.shift();
        if (!drawnCard) {
            console.error("[SERVER ERROR] Deck empty after refill attempt.");
            room.currentPlayerIndex = nextPlayerIndex(room);
            io.to(roomId).emit('game_update', room);
            getBotService().checkBotTurn(roomId); // FIX: Ensure next player (if bot) is triggered
            return;
        }
        player.hand.push(drawnCard);
        if (player.hand.length > 1) player.saidUno = false;
        const action = {
            id: Date.now(),
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
            room.drewThisTurn = true; // FIX: Ensure this is set so AI knows it already drew!
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
    const challenge = room.pendingChallenge;
    room.pendingChallenge = null;
    const targetPlayer = room.players[room.currentPlayerIndex];

    // If Draw War is active and player can stack, skip the automatic drawing
    const canStack = room.rules?.drawWar && targetPlayer.hand.some(c => {
        const top = room.discardPile[room.discardPile.length - 1];
        const isTwo = c.value.includes('Draw2') || c.value.includes('Hit2') || c.value.includes('TargetDraw2');
        const isFour = c.value.includes('Draw4') || c.value.includes('Hit4') || c.value.includes('TargetDraw4');

        if (isFour && (top.value.includes('4') || room.rules?.allowDraw4OnDraw2)) return true;
        if (isTwo && (top.value.includes('2') || room.rules?.allowDraw2OnDraw4)) {
            if (top.value.includes('4') && room.rules?.draw2OnDraw4ColorMatch) {
                return c.color === top.color || c.color === 'wild';
            }
            return true;
        }
        return false;
    });

    if (canStack) {
        console.log(`[Server] ${targetPlayer.name} accepted phase but has stack options. Staying in turn.`);
        room.botIsThinking = false; // Clear guard so they can think for their turn
        io.to(roomId).emit('game_update', room);
        getBotService().checkBotTurn(roomId);
        return;
    }

    while (room.deck.length < 4 && room.discardPile.length > 1) {
        refillDeckIfNeeded(room);
    }
    const drawn = room.deck.splice(0, 4);
    targetPlayer.hand.push(...drawn);
    if (targetPlayer.hand.length > 1) targetPlayer.saidUno = false;

    room.lastAction = {
        id: Date.now(),
        type: 'draw',
        userId: targetPlayer.userId,
        userName: targetPlayer.name,
        count: 4
    };
    room.playHistory.push(room.lastAction);
    room.pendingDrawCount = 0;
    const attacker = room.players.find(p => p.userId === challenge.attackerId);
    room.currentPlayerIndex = nextPlayerIndex(room);

    io.to(roomId).emit('game_update', room);

    // Final win check if the attacker finished on this Wild Draw 4
    if (attacker && attacker.hand.length === 0) {
        if (room.rules.gameMode === 'tournament') {
            room.finishedPlayers = room.finishedPlayers || [];
            if (!room.finishedPlayers.includes(attacker.userId)) {
                room.finishedPlayers.push(attacker.userId);
            }
            const activeCount = room.players.filter(p => !p.isSpectator && !room.finishedPlayers.includes(p.userId)).length;
            if (activeCount === 1) {
                handleWin(roomId, attacker);
            } else {
                getBotService().checkBotTurn(roomId);
            }
        } else {
            handleWin(roomId, attacker);
        }
    } else {
        getBotService().checkBotTurn(roomId);
    }
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

    const penaltyUser = hasMatch ? attacker : victim;
    const cardCount = hasMatch ? 4 : 6;
    while (room.deck.length < cardCount && room.discardPile.length > 1) {
        refillDeckIfNeeded(room);
    }
    const drawn = room.deck.splice(0, cardCount);
    penaltyUser.hand.push(...drawn);
    if (penaltyUser.hand.length > 1) penaltyUser.saidUno = false;

    room.lastAction = {
        id: Date.now(),
        type: 'challenge_result',
        result: hasMatch ? 'success' : 'failure',
        attackerId: challenge.attackerId,
        victimId: challenge.victimId,
        penaltyCount: cardCount
    };
    room.playHistory.push(room.lastAction);
    room.pendingDrawCount = 0;

    if (!hasMatch) {
        room.currentPlayerIndex = nextPlayerIndex(room);
    }

    io.to(roomId).emit('game_update', room);

    // Final win check for the attacker (they might have zero cards if the challenge failed/succeeded)
    if (attacker.hand.length === 0) {
        if (room.rules.gameMode === 'tournament') {
            room.finishedPlayers = room.finishedPlayers || [];
            if (!room.finishedPlayers.includes(attacker.userId)) {
                room.finishedPlayers.push(attacker.userId);
            }
            const activeCount = room.players.filter(p => !p.isSpectator && !room.finishedPlayers.includes(p.userId)).length;
            if (activeCount === 1) {
                handleWin(roomId, attacker);
            } else {
                getBotService().checkBotTurn(roomId);
            }
        } else {
            handleWin(roomId, attacker);
        }
    } else {
        getBotService().checkBotTurn(roomId);
    }
};

const handleDeclareUno = (roomId, userId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room || !room.rules?.requireUnoDeclaration) return;
    const player = room.players.find(p => p.userId === userId);
    if (!player || player.hand.length !== 1 || player.isSpectator || room.finishedPlayers?.includes(userId)) return;

    player.saidUno = true;
    room.lastAction = {
        id: Date.now(),
        type: 'uno_announcement',
        userId: player.userId,
        userName: player.name,
        text: 'declared UNO!'
    };
    io.to(roomId).emit('game_update', room);
};

const handleCallNoUno = (roomId, callingUserId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room || room.status !== 'playing') return;
    if (!room.rules?.allowCallNoUno) return;

    const caller = room.players.find(p => p.userId === callingUserId);
    if (!caller || caller.isSpectator || room.finishedPlayers?.includes(callingUserId)) return;

    // Find players who have 1 card and haven't said UNO
    const targets = room.players.filter(p => !p.isSpectator && p.hand.length === 1 && !p.saidUno);

    if (targets.length > 0) {
        targets.forEach(target => {
            const drawn = room.deck.splice(0, 2);
            target.hand.push(...drawn);
            target.saidUno = false; // Just in case
            console.log(`[UNO] ${target.name} penalized for failing to say UNO. Caught by ${caller?.name}`);
        });

        room.lastAction = {
            id: Date.now(),
            type: 'uno_penalty',
            userId: callingUserId,
            userName: caller?.name || 'Someone',
            text: `exposed ${targets.length === 1 ? targets[0].name : 'players'}! +2 Cards penalty.`
        };
        io.to(roomId).emit('game_update', room);
    }
};

module.exports = {
    performPlaySequence,
    performDrawCard,
    handleAcceptChallenge,
    handleChallengeDraw4,
    handleDeclareUno,
    handleCallNoUno
};
