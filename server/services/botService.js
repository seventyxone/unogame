const { rooms, getIo } = require('../state');

// Lazy loading to avoid circular dependency with playerActionService
const getPlayerActionService = () => require('./playerActionService');
const { nextPlayerIndex } = require('../utils/gameCore');

const checkBotTurn = (roomId) => {
    const room = rooms.get(roomId);
    const io = getIo();
    if (!room || room.status !== 'playing' || room.botIsThinking) return;

    const curr = room.players[room.currentPlayerIndex];
    if (curr && curr.isBot) {
        room.botIsThinking = true;

        // Determine delay based on state
        const isChallenge = room.pendingChallenge && room.pendingChallenge.victimId === curr.userId;
        const delay = isChallenge ? 2500 : 3000; // Increased from 1.5s/1.2s to 2.5s/3.0s

        setTimeout(() => {
            try {
                if (room.status !== 'playing') {
                    room.botIsThinking = false;
                    return;
                }

                // RE-FETCH CURRENT PLAYER (it might have changed during timeout)
                const player = room.players[room.currentPlayerIndex];
                if (!player || !player.isBot) {
                    room.botIsThinking = false;
                    return;
                }

                const actionService = getPlayerActionService();

                // Competitive Logic: Bots check if anyone forgot to say UNO
                if (room.rules?.allowCallNoUno) {
                    const forgetful = room.players.find(p => p.userId !== player.userId && !p.isSpectator && p.hand.length === 1 && !p.saidUno);
                    if (forgetful && Math.random() < 0.7) {
                        console.log(`[BOT] ${player.name} calling out ${forgetful.name} for missing UNO!`);
                        actionService.handleCallNoUno(roomId, player.userId);
                        // Delay the actual turn slightly after calling out for realism
                        setTimeout(() => checkBotTurn(roomId), 1500);
                        room.botIsThinking = false;
                        return;
                    }
                }

                if (room.pendingChallenge && room.pendingChallenge.victimId === player.userId) {
                    const top = room.discardPile[room.discardPile.length - 1];
                    const canStack = player.hand.some(c => {
                        const isTwo = c.value.includes('Draw2') || c.value.includes('Hit2') || c.value.includes('TargetDraw2');
                        const isFour = c.value.includes('Draw4') || c.value.includes('Hit4') || c.value.includes('TargetDraw4');
                        const topIsFour = top.value.includes('4');
                        if (isFour && (topIsFour || room.rules?.allowDraw4OnDraw2)) return true;
                        if (isTwo && (!topIsFour || room.rules?.allowDraw2OnDraw4)) {
                            if (topIsFour && room.rules?.draw2OnDraw4ColorMatch) {
                                return c.color === top.color || c.color === 'wild';
                            }
                            return true;
                        }
                        return false;
                    });

                    if (canStack && room.rules?.drawWar) {
                        console.log(`[BOT] ${player.name} accepts challenge phase to prepare for stacking.`);
                        room.botIsThinking = false;
                        actionService.handleAcceptChallenge(roomId, player.userId);
                    } else {
                        // 80% chance to accept, 20% to challenge
                        if (Math.random() < 0.2) {
                            console.log(`[BOT] ${player.name} challenges the action.`);
                            room.botIsThinking = false;
                            actionService.handleChallengeDraw4(roomId, player.userId);
                        } else {
                            console.log(`[BOT] ${player.name} accepts the penalty.`);
                            room.botIsThinking = false;
                            actionService.handleAcceptChallenge(roomId, player.userId);
                        }
                    }
                    return;
                }

                const top = room.discardPile[room.discardPile.length - 1];
                const stacking = room.pendingDrawCount > 0;

                // Priority Scoring: Stacking > Matching Normal > Matches Wild
                let bestSeq = [];
                let bestScore = -1;

                player.hand.forEach(card => {
                    let valid = false;
                    let score = 0;
                    if (stacking) {
                        if (room.rules?.drawWar) {
                            const isTwo = card.value.includes('Draw2') || card.value.includes('Hit2') || card.value.includes('TargetDraw2');
                            const isFour = card.value.includes('Draw4') || card.value.includes('Hit4') || card.value.includes('TargetDraw4');
                            const topIsFour = top.value.includes('4');

                            if (isFour && (topIsFour || room.rules?.allowDraw4OnDraw2)) {
                                valid = true;
                                score = 100;
                            } else if (isTwo && (!topIsFour || room.rules?.allowDraw2OnDraw4)) {
                                // Important: Check color match rule for bots too
                                if (topIsFour && room.rules?.draw2OnDraw4ColorMatch) {
                                    // if top is wild, its color is dynamic.
                                    if (card.color === top.color || card.color === 'wild') {
                                        valid = true;
                                        score = 90;
                                    }
                                } else {
                                    valid = true;
                                    score = 90;
                                }
                            }
                        }
                    } else {
                        let matchesNormal = card.color === top.color || card.value === top.value;
                        if (!matchesNormal) {
                            if (card.value.includes('Skip') && top.value.includes('Skip')) matchesNormal = true;
                            if (card.value.includes('Reverse') && top.value.includes('Reverse')) matchesNormal = true;
                            if (card.value.includes('Hit') && top.value.includes('Hit') &&
                                ((card.value.includes('2') && top.value.includes('2')) ||
                                    (card.value.includes('4') && top.value.includes('4')))) matchesNormal = true;
                        }

                        if (matchesNormal) {
                            valid = true;
                            score = 50;
                            if (card.value.includes('Skip') || card.value.includes('Reverse') || card.value.includes('Draw2') ||
                                card.value.includes('Hit') || card.value.includes('TargetDraw') || card.value.includes('Draw4')) score += 10;
                            if (card.value.includes('DiscardAll')) {
                                const matchedCount = player.hand.filter(c => c.color === card.color).length;
                                score += matchedCount * 15;
                            }
                        } else if (card.color === 'wild') {
                            valid = true;
                            score = 25;
                            if (card.value.includes('4')) score += 5;
                            if (card.value.includes('DiscardAll')) score += 40; // Wild discard is very strong
                        }
                    }

                    if (valid && score > bestScore) {
                        bestScore = score;
                        const seq = [card];
                        if (room.rules?.multiPlay) {
                            const v1 = card.value;
                            player.hand.forEach(c => {
                                if (c.id !== card.id) {
                                    const vi = c.value;
                                    const valuesMatch = v1 === vi ||
                                        (v1.includes('Skip') && vi.includes('Skip')) ||
                                        (v1.includes('Reverse') && vi.includes('Reverse')) ||
                                        (v1.includes('Hit') && vi.includes('Hit') &&
                                            ((v1.includes('2') && vi.includes('2')) ||
                                                (v1.includes('4') && vi.includes('4'))));
                                    if (valuesMatch) seq.push(c);
                                }
                            });
                        }
                        bestSeq = seq;
                    }
                });

                if (bestSeq.length > 0) {
                    let selectedColor = undefined;
                    let targetUserId = undefined;

                    if (bestSeq[0].value.includes('Target')) {
                        const others = room.players.filter(p => !p.isSpectator && p.userId !== player.userId);
                        if (others.length > 0) {
                            targetUserId = others[Math.floor(Math.random() * others.length)].userId;
                            console.log(`[BOT] ${player.name} targeting ${targetUserId}.`);
                        }
                    }

                    if (bestSeq[0].color === 'wild') {
                        // Pick color most present in hand
                        const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
                        player.hand.forEach(c => { if (c.color !== 'wild') counts[c.color]++; });
                        const max = Math.max(...Object.values(counts));
                        selectedColor = max > 0
                            ? Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b)
                            : 'red';
                        console.log(`[BOT] ${player.name} playing ${bestSeq[0].value}, chose color: ${selectedColor}`);
                    }
                    room.botIsThinking = false; // RELEASE LOCK EARLY
                    actionService.performPlaySequence(roomId, bestSeq.map(s => s.id), selectedColor, player.userId, undefined, false, targetUserId);
                } else {
                    if (room.pendingDrawCount > 0) {
                        console.log(`[BOT] ${player.name} forced to draw stack of ${room.pendingDrawCount}.`);
                        room.botIsThinking = false;
                        actionService.performDrawCard(roomId, player.userId);
                        return;
                    }
                    if (room.drewThisTurn && !room.rules?.drawUntilPlayable) {
                        console.log(`[BOT] ${player.name} passes turn.`);
                        room.drewThisTurn = false;
                        room.botIsThinking = false; // RELEASE LOCK EARLY
                        room.currentPlayerIndex = nextPlayerIndex(room);
                        io.to(roomId).emit('game_update', room);
                        checkBotTurn(roomId);
                    } else {
                        console.log(`[BOT] ${player.name} drawing card.`);
                        room.botIsThinking = false; // RELEASE LOCK EARLY
                        actionService.performDrawCard(roomId, player.userId);
                    }
                }
            } catch (err) {
                console.error(`[BOT ERROR] Fatal error in ${roomId} taking turn. Forcing pass to avoid deadlock:`, err);
                room.botIsThinking = false;
                room.currentPlayerIndex = nextPlayerIndex(room);
                io.to(roomId).emit('game_update', room);
                setTimeout(() => checkBotTurn(roomId), 1000);
            }
        }, delay);
    }
};

module.exports = {
    checkBotTurn
};
