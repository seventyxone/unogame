import React, { useState } from 'react';
import UnoCard from './UnoCard';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
    gameState: any;
    myId: string;
    onPlaySequence: (cardIds: string[], newColor?: string) => void;
    onDrawCard: () => void;
}

const Game: React.FC<Props> = ({ gameState, myId, onPlaySequence, onDrawCard }) => {
    const me = gameState.players.find((p: any) => p.userId === myId);
    const others = gameState.players.filter((p: any) => p.userId !== myId);
    const isMyTurn = gameState.players[gameState.currentPlayerIndex].userId === myId;
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];

    const [selection, setSelection] = useState<any[]>([]);
    const [showColorPicker, setShowColorPicker] = useState<boolean>(false);

    const isCardPlayableNormally = (card: any) => {
        return card.color === 'wild' || card.color === topCard.color || card.value === topCard.value;
    };

    const isCardPlayableInWar = (card: any) => {
        if (card.value === 'Draw2') {
            return topCard.value === 'Draw2' || (topCard.value === 'Draw4' && gameState.rules?.allowDraw2OnDraw4);
        }
        if (card.value === 'Draw4') {
            return topCard.value === 'Draw4' || (topCard.value === 'Draw2' && gameState.rules?.allowDraw4OnDraw2);
        }
        return false;
    };

    const handleCardClick = (card: any) => {
        if (!isMyTurn) return;
        console.log(`[Game] Clicked card: ${card.value} (${card.color})`);

        if (selection.length === 0) {
            const canStart = gameState.pendingDrawCount > 0 ? isCardPlayableInWar(card) : isCardPlayableNormally(card);
            if (canStart) {
                setSelection([card]);
                console.log(`[Game] Started selection with ${card.id}`);
            }
        } else {
            // Must match the value of the first selected card
            if (card.value === selection[0].value && !selection.find(s => s.id === card.id)) {
                setSelection([...selection, card]);
                console.log(`[Game] Added to sequence: ${card.id}`);
            }
        }
    };

    const removeFromSelection = (id: string) => {
        setSelection(selection.filter(s => s.id !== id));
    };

    const handleConfirm = () => {
        console.log(`[Game] Confirming sequence:`, selection.map(s => s.id));
        const lastCard = selection[selection.length - 1];
        if (lastCard.color === 'wild') {
            setShowColorPicker(true);
        } else {
            onPlaySequence(selection.map(s => s.id));
            setSelection([]);
        }
    };

    const selectColor = (color: string) => {
        onPlaySequence(selection.map(s => s.id), color);
        setSelection([]);
        setShowColorPicker(false);
    };

    return (
        <div className="game-screen">
            {/* Opponents Area */}
            <div className="opponents">
                {others.map((player: any) => (
                    <div key={player.userId} className={`opponent glass ${gameState.players[gameState.currentPlayerIndex].userId === player.userId ? 'active' : ''}`}>
                        <div className="opponent-info">
                            <div className="opponent-name">{player.name} {player.isBot && <span className="bot-tag">AI</span>}</div>
                            <div className="card-count">{player.hand?.length || 0} Cards</div>
                        </div>
                        <div className="opponent-hand-graphic">
                            {Array.from({ length: Math.min(player.hand?.length || 0, 10) }).map((_, i) => (
                                <div key={i} className="card-back-mini" style={{ transform: `translateX(${i * 5}px) rotate(${i * 2}deg)` }}>UNO</div>
                            ))}
                            {(player.hand?.length || 0) > 10 && <span className="more-cards">+{player.hand.length - 10}</span>}
                        </div>
                    </div>
                ))}
            </div>

            {/* Board Center */}
            <div className="board-center">
                <div className="deck-pile glass" onClick={isMyTurn && selection.length === 0 ? onDrawCard : undefined}>
                    <div className="deck-card back">UNO</div>
                    <div className="deck-count">{gameState.deck.length}</div>
                </div>

                <div className="discard-pile-container">
                    {gameState.pendingDrawCount > 0 && (
                        <div className="draw-warning pulse">DRAW WAR: +{gameState.pendingDrawCount}</div>
                    )}
                    <div className="discard-pile">
                        <AnimatePresence mode="popLayout">
                            <motion.div
                                key={topCard?.id}
                                initial={{ scale: 0.5, opacity: 0, rotate: -45 }}
                                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                            >
                                {topCard && <UnoCard card={topCard} disabled />}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                    {gameState.lastAction && (
                        <div className="last-action-overlay glass">
                            <div className="action-header">{gameState.lastAction.userName} {gameState.lastAction.type === 'play' ? 'played:' : 'drew cards'}</div>
                            {gameState.lastAction.sequence && (
                                <div className="action-sequence">
                                    {gameState.lastAction.sequence.map((c: any) => (
                                        <UnoCard key={c.id} card={c} isSmall disabled />
                                    ))}
                                </div>
                            )}
                            {gameState.lastAction.warResult && (
                                <div className="war-result">
                                    {gameState.lastAction.warResult.userName || 'They'} drew <span className="accent">+{gameState.lastAction.warResult.count}</span> cards!
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Selection Area */}
            <div className={`selection-area glass ${selection.length > 0 ? 'visible' : ''}`}>
                <div className="selection-label">Playing Sequence:</div>
                <div className="selection-list">
                    {selection.map(card => (
                        <div key={card.id} className="selected-card-wrapper" onClick={() => removeFromSelection(card.id)}>
                            <UnoCard card={card} isSmall disabled />
                        </div>
                    ))}
                </div>
                {selection.length > 0 && (
                    <div className="button-group">
                        <button className="neo-button confirm-btn" onClick={handleConfirm}>Confirm Play</button>
                        <button className="neo-button secondary small" onClick={() => setSelection([])}>Cancel</button>
                    </div>
                )}
            </div>

            {/* Turn Indicator */}
            <div className={`turn-indicator ${isMyTurn ? 'my-turn' : ''}`}>
                <div className="turn-text">
                    {isMyTurn ? "YOUR TURN" : `${gameState.players[gameState.currentPlayerIndex].name}'s Turn`}
                </div>
                {gameState.rules?.gameMode !== 'standard' && (
                    <div className="round-info">ROUND {gameState.currentRound} {gameState.rules?.maxRounds ? `/ ${gameState.rules.maxRounds}` : ''}</div>
                )}
            </div>

            {/* My Hand */}
            <div className="my-hand-container glass">
                <div className="my-hand">
                    {me?.hand?.map((card: any, index: number) => {
                        const isSelected = selection.find(s => s.id === card.id);
                        const canBeAdded = selection.length === 0
                            ? (gameState.pendingDrawCount > 0 ? isCardPlayableInWar(card) : isCardPlayableNormally(card))
                            : (card.value === selection[0].value);

                        return (
                            <motion.div
                                key={card.id}
                                layout
                                initial={{ x: 300, opacity: 0 }}
                                animate={{ x: 0, opacity: 1 }}
                                transition={{ delay: index * 0.05 }}
                            >
                                <UnoCard
                                    card={card}
                                    onClick={() => handleCardClick(card)}
                                    disabled={!isMyTurn || isSelected || !canBeAdded}
                                />
                            </motion.div>
                        );
                    })}
                </div>
            </div>

            {/* Color Picker Modal */}
            {showColorPicker && (
                <div className="modal-overlay">
                    <div className="color-picker glass">
                        <h3>Choose a Color</h3>
                        <div className="color-options">
                            <div className="color-btn red" onClick={() => selectColor('red')}></div>
                            <div className="color-btn blue" onClick={() => selectColor('blue')}></div>
                            <div className="color-btn green" onClick={() => selectColor('green')}></div>
                            <div className="color-btn yellow" onClick={() => selectColor('yellow')}></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Game;
