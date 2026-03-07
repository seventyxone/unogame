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

                if (room.pendingChallenge && room.pendingChallenge.victimId === player.userId) {
                    const canStack = player.hand.some(c => (c.value === 'Draw4' || (c.value === 'Draw2' && room.rules?.allowDraw2OnDraw4)));

                    if (canStack && room.rules?.drawWar) {
                        console.log(`[BOT] ${player.name} accepts challenge phase to prepare for stacking.`);
                        room.botIsThinking = false;
                        actionService.handleAcceptChallenge(roomId, player.userId);
                    } else {
                        // 80% chance to accept, 20% to challenge
                        if (Math.random() < 0.2) {
                            console.log(`[BOT] ${player.name} challenges the Draw4.`);
                            room.botIsThinking = false;
                            actionService.handleChallengeDraw4(roomId, player.userId);
                        } else {
                            console.log(`[BOT] ${player.name} accepts the Draw4 penalty.`);
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
                            if (card.value === 'Draw4' && (top.value === 'Draw4' || room.rules?.allowDraw4OnDraw2)) {
                                valid = true;
                                score = 100;
                            } else if (card.value === 'Draw2' && (top.value === 'Draw2' || room.rules?.allowDraw2OnDraw4)) {
                                valid = true;
                                score = 90;
                            }
                        }
                    } else {
                        if (card.color === top.color || card.value === top.value) {
                            valid = true;
                            score = 50;
                            if (card.value === 'Skip' || card.value === 'Reverse' || card.value === 'Draw2') score += 10;
                        } else if (card.color === 'wild') {
                            valid = true;
                            score = 20;
                            if (card.value === 'Draw4') score += 5;
                        }
                    }

                    if (valid && score > bestScore) {
                        bestScore = score;
                        const seq = [card];
                        if (room.rules?.multiPlay) {
                            player.hand.forEach(c => {
                                if (c.id !== card.id && c.value === card.value) seq.push(c);
                            });
                        }
                        bestSeq = seq;
                    }
                });

                if (bestSeq.length > 0) {
                    let selectedColor = undefined;
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
                    actionService.performPlaySequence(roomId, bestSeq.map(s => s.id), selectedColor, player.userId);
                } else {
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
