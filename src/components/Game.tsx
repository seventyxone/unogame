import React, { useState, useEffect, useRef } from 'react';
import UnoCard from './UnoCard';
import { motion, AnimatePresence, LayoutGroup, Reorder } from 'framer-motion';

const MiniHand: React.FC<{ hand: any[], active?: boolean }> = ({ hand, active }) => {
    const [animatedHand, setAnimatedHand] = React.useState<any[]>([]);

    React.useEffect(() => {
        if (!hand) return;
        if (hand.length > animatedHand.length) {
            const timer = setTimeout(() => {
                setAnimatedHand(hand.slice(0, animatedHand.length + 1));
            }, 60);
            return () => clearTimeout(timer);
        } else if (hand.length < animatedHand.length) {
            setAnimatedHand(hand);
        }
    }, [hand.length, animatedHand.length]);

    return (
        <div className={`opponent-hand fanned ${active ? 'active' : ''}`}>
            {animatedHand.map((card: any, idx: number) => {
                // Fan calculations
                const total = animatedHand.length;
                const mid = (total - 1) / 2;
                const rotation = (idx - mid) * (40 / Math.max(total, 5));
                const yOffset = Math.abs(idx - mid) * 2;

                return (
                    <motion.div
                        key={card.id}
                        layoutId={card.id}
                        className="mini-card-wrapper"
                        initial={{ scale: 0, opacity: 0, y: 50 }}
                        animate={{
                            scale: 1,
                            opacity: 1,
                            y: yOffset,
                            rotate: rotation,
                            zIndex: idx
                        }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    >
                        <UnoCard card={card} isSmall hidden />
                    </motion.div>
                );
            })}
        </div>
    );
};

interface Props {
    gameState: any;
    myId: string;
    onPlaySequence: (cardIds: string[], newColor?: string) => void;
    onDrawCard: () => void;
    onPassTurn: () => void;
    onAcceptChallenge?: () => void;
    onChallengeDraw4?: () => void;
    onResetToLobby?: () => void;
}

const Game: React.FC<Props> = ({
    gameState,
    myId,
    onPlaySequence,
    onDrawCard,
    onPassTurn,
    onAcceptChallenge,
    onChallengeDraw4,
    onResetToLobby
}) => {

    const me = gameState.players.find((p: any) => p.userId === myId);
    const others = gameState.players.filter((p: any) => p.userId !== myId);
    const isMyTurn = gameState.players[gameState.currentPlayerIndex].userId === myId;
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];

    const [selection, setSelection] = useState<any[]>([]);
    const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
    const [showHistory, setShowHistory] = useState<boolean>(false);
    const [animatedHand, setAnimatedHand] = useState<any[]>([]);
    const [isHandMinimized, setIsHandMinimized] = useState<boolean>(false);
    const [autoHidePreference, setAutoHidePreference] = useState<boolean>(() => {
        const saved = localStorage.getItem('uno_autohide_hand');
        return saved === 'true'; // Default to false if not present ('true' !== undefined)
    });
    const scrollRef = React.useRef<HTMLDivElement>(null);

    // Sequential Hand Loading Engine — preserves user drag order
    React.useEffect(() => {
        if (!me?.hand) return;

        const serverIds = new Set(me.hand.map((h: any) => h.id));
        const localIds = new Set(animatedHand.map((c: any) => c.id));

        // Find cards that exist on server but not locally (newly drawn)
        const newCards = me.hand.filter((h: any) => !localIds.has(h.id));
        // Keep only cards still on server (removes played cards), preserving local order
        const kept = animatedHand.filter((c: any) => serverIds.has(c.id));

        if (newCards.length > 0 || kept.length !== animatedHand.length) {
            // Append new cards at the end of existing order
            setAnimatedHand([...kept, ...newCards]);
        }
    }, [me?.hand]);


    // Auto-minimize hand logic
    useEffect(() => {
        if (isMyTurn) {
            // My turn starts: always show
            setIsHandMinimized(false);
        } else {
            // Someone else's turn: auto-hide ONLY if the user hasn't explicitly clicked "SHOW" (global preference)
            if (autoHidePreference) {
                setIsHandMinimized(true);
            }
        }
    }, [isMyTurn, autoHidePreference]);

    const handleToggleHand = () => {
        const nextState = !isHandMinimized;
        setIsHandMinimized(nextState);
        // If the user manually shows the hand (nextState = false), disable auto-hiding globally for this session
        // If the user manually hides the hand (nextState = true), enable auto-hiding logic
        setAutoHidePreference(nextState);
        localStorage.setItem('uno_autohide_hand', nextState.toString());
    };

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
        if (selection.length === 0) {
            const canStart = gameState.pendingDrawCount > 0 ? isCardPlayableInWar(card) : isCardPlayableNormally(card);
            if (canStart) {
                setSelection([card]);
            }
        } else {
            if (card.value === selection[0].value && !selection.find(s => s.id === card.id)) {
                setSelection([...selection, card]);
            }
        }
    };

    const removeFromSelection = (id: string) => {
        setSelection(selection.filter(s => s.id !== id));
    };

    const handleConfirm = () => {
        const lastCard = selection[selection.length - 1];
        if (lastCard.color === 'wild') {
            setShowColorPicker(true);
        } else {
            onPlaySequence(selection.map(s => s.id));
            setSelection([]);
        }
    };

    const selectColor = (color: string) => {
        // Clear UI state immediately before network wait
        setSelection([]);
        setShowColorPicker(false);
        onPlaySequence(selection.map(s => s.id), color);
    };

    const handleAutoSort = () => {
        const colorOrder: Record<string, number> = { red: 0, blue: 1, green: 2, yellow: 3, wild: 4 };
        const sorted = [...animatedHand].sort((a: any, b: any) => {
            if (a.value !== b.value) return a.value.localeCompare(b.value);
            return (colorOrder[a.color] ?? 5) - (colorOrder[b.color] ?? 5);
        });
        setAnimatedHand(sorted);
    };

    // Calculate circular positions for opponents
    const getSeatPosition = (index: number, total: number) => {
        const isMobile = window.innerWidth <= 480;
        // In portrait mode, push the player orbit higher and narrower to clear the action zone
        const isPortrait = window.innerHeight > window.innerWidth;
        const radiusFactor = isHandMinimized ? 0.75 : 1.0;

        // Narrower arc for portrait to keep players in a tighter "crown"
        const portraitStartAngle = (170 * Math.PI) / 180;
        const portraitEndAngle = (370 * Math.PI) / 180;

        const startAngle = isPortrait ? portraitStartAngle : (140 * Math.PI) / 180;
        const endAngle = isPortrait ? portraitEndAngle : (400 * Math.PI) / 180;

        const portraitScaleX = 1.0;
        const portraitScaleY = isPortrait ? 1.1 : 1.0;

        const radiusX = (isMobile ? (total > 5 ? 36 : 40) : 42) * radiusFactor * portraitScaleX;
        const radiusY = (isMobile ? (total > 5 ? 22 : 30) : 34) * radiusFactor * portraitScaleY;
        const centerY = (isMobile && isPortrait) ? (isHandMinimized ? 35 : 40) : (isMobile ? (isHandMinimized ? 42 : 48) : 52);

        const step = total > 1 ? (endAngle - startAngle) / (total - 1) : 0;
        const angle = total === 1 ? (startAngle + endAngle) / 2 : startAngle + (step * index);

        return {
            left: `${50 + radiusX * Math.cos(angle)}%`,
            top: `${centerY + radiusY * Math.sin(angle)}%`
        };
    };

    const getRotationById = (id: string) => {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        return (hash % 20); // -10 to 10
    };

    const getOffsetById = (id: string) => {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        return {
            x: (hash % 10) - 5,
            y: ((hash >> 4) % 10) - 5
        };
    };

    const handScrollRef = useRef<HTMLUListElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const checkScroll = () => {
        if (handScrollRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = handScrollRef.current;
            setCanScrollLeft(scrollLeft > 5);
            setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 5);
        }
    };

    useEffect(() => {
        checkScroll();
        window.addEventListener('resize', checkScroll);
        return () => window.removeEventListener('resize', checkScroll);
    }, [animatedHand]);

    const scrollHand = (direction: 'left' | 'right') => {
        if (handScrollRef.current) {
            const isMobile = window.innerWidth <= 768;
            const amount = direction === 'left' ? (isMobile ? -80 : -120) : (isMobile ? 80 : 120);
            handScrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
            setTimeout(checkScroll, 400); // Check after smooth scroll finishes
        }
    };

    return (
        <div className="game-screen">
            {/* History Toggle Button */}
            <button className="history-toggle-btn" onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? '✕' : '📋'}
            </button>

            {/* Spectator Global Badge */}
            <AnimatePresence>
                {me.isSpectator && (
                    <motion.div
                        className="spectator-indicator"
                        initial={{ y: -50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                    >
                        SPECTATOR MODE
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="arena-background">
            </div>

            <LayoutGroup>
                {/* Integrated Command Center - Docked bottom (Order matters for CSS ~ sibling selector) */}
                <div className={`hand-command-center ${isMyTurn ? 'my-turn-glow' : ''} ${isHandMinimized ? 'minimized' : ''}`}>
                    <button key="toggle-tab" className="neo-button toggle-btn-inline" onClick={handleToggleHand} disabled={isMyTurn}>
                        {isHandMinimized ? '👁️ SHOW' : '🙈 HIDE'}
                    </button>
                    <div className="my-hand-container">
                        <div className="hand-controls">
                            <span className="direction-indicator">{gameState.direction === 1 ? '↻ CLOCKWISE' : '↺ ANTI-CLOCKWISE'}</span>
                            <span className="player-name-label">PLAYER {me?.name}</span>
                            <button className="neo-button sort-btn" onClick={handleAutoSort}>⚡ SORT</button>

                            {isMyTurn && gameState.drewThisTurn && selection.length === 0 && (
                                <button className="neo-button pass-btn-inline" onClick={onPassTurn}>🚀 PASS</button>
                            )}
                        </div>
                        <div className="my-hand-wrapper">
                            <button
                                className={`hand-scroll-btn scroll-left-btn ${!canScrollLeft ? 'disabled' : ''}`}
                                onClick={() => canScrollLeft && scrollHand('left')}
                            >
                                <span className="arrow">←</span>
                            </button>
                            <div className="my-hand">
                                <Reorder.Group
                                    axis="x"
                                    values={animatedHand}
                                    onReorder={setAnimatedHand}
                                    className="reorder-hand"
                                    ref={handScrollRef}
                                    onScroll={checkScroll}
                                >
                                    <AnimatePresence>
                                        {animatedHand.map((card: any, idx: number) => {
                                            const isSelected = selection.find(s => s.id === card.id);
                                            const canBeAdded = selection.length === 0
                                                ? (gameState.pendingDrawCount > 0 ? isCardPlayableInWar(card) : isCardPlayableNormally(card))
                                                : (card.value === selection[0].value);

                                            return (
                                                <Reorder.Item
                                                    value={card}
                                                    key={card.id}
                                                    className="player-card-wrapper drag-item"
                                                    style={{ zIndex: isSelected ? 100 : idx }}
                                                    onClick={() => handleCardClick(card)}
                                                    whileDrag={{ scale: 1.15, zIndex: 100, y: -20 }}
                                                    initial={{ opacity: 0, y: 50, scale: 0.8 }}
                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                    exit={{ opacity: 0, y: -50, scale: 0 }}
                                                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                                                >
                                                    <UnoCard
                                                        card={card}
                                                        disabled={!isMyTurn || (selection.length > 0 && !isSelected && !canBeAdded)}
                                                        highlight={isSelected}
                                                    />
                                                </Reorder.Item>
                                            );
                                        })}
                                    </AnimatePresence>
                                </Reorder.Group>
                            </div>
                            <button
                                className={`hand-scroll-btn scroll-right-btn ${!canScrollRight ? 'disabled' : ''}`}
                                onClick={() => canScrollRight && scrollHand('right')}
                            >
                                <span className="arrow">→</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="table-arena">
                    <div className="circular-orbit">
                        {others.map((player: any, index: number) => {
                            const isFinished = gameState.finishedPlayers?.includes(player.userId);
                            const pos = getSeatPosition(index, others.length);
                            const isActive = gameState.players[gameState.currentPlayerIndex].userId === player.userId;

                            return (
                                <div
                                    key={player.userId}
                                    className={`table-seat ${isActive ? 'active' : ''}`}
                                    style={{ ...pos, transform: 'translate(-50%, -50%)' }}
                                >
                                    {!isFinished && <MiniHand hand={player.hand} active={isActive} />}
                                    <div className="opponent-tag isometric">
                                        <div className="tag-inner">{player.name}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>



                    <div className="main-battle-area">
                        <div className="board-center">

                            <div className="piles-row">
                                <div className={`deck-pile ${me.isSpectator ? 'disabled' : ''}`} onClick={isMyTurn && !me.isSpectator && selection.length === 0 ? onDrawCard : undefined}>
                                    <div className="deck-3d-stack">
                                        <div className="deck-shadow-layer"></div>
                                        {[...Array(5)].map((_, i) => (
                                            <div key={i} className="deck-card-layer" style={{ transform: `translateZ(${i * 2}px) translateY(-${i}px)` }}>
                                                {i === 4 && <div className="deck-card back"></div>}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="discard-pile-cluster" onClick={() => setShowHistory(!showHistory)}>
                                    <AnimatePresence>
                                        {gameState.discardPile.slice(-5).map((card: any, idx: number) => (
                                            <motion.div
                                                key={card.id}
                                                className="discarded-card-physical"
                                                initial={{ scale: 0, opacity: 0, rotate: 180 }}
                                                animate={{
                                                    scale: 1,
                                                    opacity: 1,
                                                    rotate: getRotationById(card.id),
                                                    x: getOffsetById(card.id).x,
                                                    y: getOffsetById(card.id).y,
                                                    zIndex: idx
                                                }}
                                                transition={{ type: "spring", stiffness: 200, damping: 20 }}
                                            >
                                                <UnoCard card={card} />
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                    {gameState.pendingDrawCount > 0 && (
                                        <div className="draw-warning pulse">DRAW WAR: +{gameState.pendingDrawCount}</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* History sidebar — toggleable */}
                    {showHistory && (
                        <div className="history-sidebar">
                            <div className="stream-header" onClick={() => setShowHistory(false)}>
                                <span>📋 HISTORY</span>
                                <button className="close-log">✕</button>
                            </div>
                            <div className="stream-content" ref={scrollRef}>
                                {gameState.playHistory && gameState.playHistory.length > 0 ? (
                                    gameState.playHistory.slice().reverse().map((action: any, idx: number) => (
                                        <div key={idx} className="action-entry">
                                            <div className="action-user">{action.userName}</div>
                                            {action.type === 'play' ? (
                                                <div className="action-cards">
                                                    <div className="mini-card-row">
                                                        {action.sequence.map((c: any, i: number) => (
                                                            <div key={i} className={`mini-card ${c.color}`}>{c.value}</div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="action-draw text-accent">drew {action.count} card{action.count > 1 ? 's' : ''}</span>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <div className="empty-history">No moves yet...</div>
                                )}
                            </div>
                        </div>
                    )}

                </div>{/* END table-arena */}

            </LayoutGroup>

            {/* OVERLAY SECTION - Outside LayoutGroup for stability */}
            <AnimatePresence>
                {selection.length > 0 && (
                    <motion.div
                        className="selection-zone floating"
                        initial={{ y: 50, opacity: 0, x: '-50%' }}
                        animate={{ y: 0, opacity: 1, x: '-50%' }}
                        exit={{ y: 50, opacity: 0, x: '-50%' }}
                    >
                        <div className="selection-header">
                            <div className="selection-info">
                                <h3>SELECTED ({selection.length})</h3>
                                <div className="button-group">
                                    <button className="neo-button confirm-btn" disabled={me.isSpectator} onClick={handleConfirm}>CONFIRM PLAY</button>
                                    <button className="neo-button secondary small" onClick={() => setSelection([])}>X</button>
                                </div>
                            </div>
                            <div className="selection-list">
                                <AnimatePresence>
                                    {selection.map(card => (
                                        <div key={card.id} className="selected-card-wrapper" onClick={() => removeFromSelection(card.id)}>
                                            <UnoCard card={card} isSmall disabled noLayout />
                                        </div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Color Picker Modal */}
            <AnimatePresence>
                {showColorPicker && (
                    <motion.div
                        className="modal-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="color-picker glass"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                        >
                            <h3>CHOOSE COLOR</h3>
                            <div className="color-options">
                                <div className="color-btn red" onClick={() => selectColor('red')}></div>
                                <div className="color-btn blue" onClick={() => selectColor('blue')}></div>
                                <div className="color-btn green" onClick={() => selectColor('green')}></div>
                                <div className="color-btn yellow" onClick={() => selectColor('yellow')}></div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Challenge Draw 4 Modal */}
            <AnimatePresence>
                {gameState.pendingChallenge && gameState.pendingChallenge.victimId === myId && (
                    <motion.div
                        className="challenge-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="challenge-modal glass-heavy floating"
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                        >
                            <h2 className="glitch-text-sm">CHALLENGE DRAW 4?</h2>
                            <p>{gameState.pendingChallenge.attackerName} played a Wild Draw 4.</p>
                            <div className="challenge-hint">
                                If they had a matching color, THEY draw 4.<br />
                                If they are innocent, YOU draw 6!
                            </div>
                            <div className="button-group-vertical">
                                <button className="neo-button" onClick={onAcceptChallenge}>ACCEPT DRAW 4</button>
                                <button className="neo-button secondary" onClick={onChallengeDraw4}>CHALLENGE!</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Round Summary Modal (Tournament) */}
            <AnimatePresence>
                {gameState.status === 'round_end' && (
                    <motion.div
                        className="modal-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="summary-modal glass"
                            initial={{ y: 50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                        >
                            <h2 className="glitch-text-sm">ROUND OVER</h2>
                            <div className="summary-content">
                                {gameState.lastEliminated && (
                                    <div className="elimination-alert">
                                        <span className="name">{gameState.lastEliminated}</span> ELIMINATED
                                    </div>
                                )}
                                {gameState.rules?.gameMode === 'points' && gameState.scores && (
                                    <div className="standings-summary">
                                        <h3>STANDINGS</h3>
                                        <div className="standings-list">
                                            {gameState.players.map((p: any) => (
                                                <div key={p.userId} className="standing-entry">
                                                    <span className="name">{p.name}</span>
                                                    <span className="score">{gameState.scores[p.userId] || 0} WINS</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="loading-bar-container">
                                    <small>Preparing next round...</small>
                                    <motion.div
                                        className="loading-bar"
                                        initial={{ width: 0 }}
                                        animate={{ width: "100%" }}
                                        transition={{ duration: 3 }}
                                    />
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Game Over Modal */}
            <AnimatePresence>
                {gameState.status === 'finished' && (
                    <motion.div
                        className="game-over-overlay glass-heavy"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        <motion.div
                            className="game-over-modal floating"
                            initial={{ scale: 0.8, y: 50, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                        >
                            <h1 className="glitch-text">CHAMPION</h1>
                            <div className="winner-name">{gameState.results?.winner}</div>

                            {gameState.results?.mode === 'points' && gameState.results?.scores && (
                                <div className="final-scoreboard standings-summary">
                                    <h3>FINAL SCOREBOARD</h3>
                                    <div className="standings-list">
                                        {Object.entries(gameState.results.scores)
                                            .sort(([, a]: any, [, b]: any) => b - a)
                                            .map(([uid, score]: any) => {
                                                const p = gameState.players.find((pl: any) => pl.userId === uid);
                                                return (
                                                    <div key={uid} className="standing-entry">
                                                        <span className="name">{p?.name || 'Player'}</span>
                                                        <span className="score">{score} WINS</span>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>
                            )}

                            <div className="game-over-controls">
                                {gameState.hostUserId === myId ? (
                                    <button className="neo-button confirm-play" onClick={onResetToLobby}>
                                        RETURN TO LOBBY // REPLAY
                                    </button>
                                ) : (
                                    <p className="waiting-hint">Waiting for host to reset room...</p>
                                )}
                                <button className="neo-button secondary" onClick={() => window.location.reload()}>
                                    EXIT TO MAIN MENU
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

        </div>
    );
};

export default Game;
