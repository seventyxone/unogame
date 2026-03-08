import React, { useState, useEffect } from 'react';
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

    const isCrowded = animatedHand.length > 5;

    return (
        <div className={`opponent-hand fanned ${active ? 'active' : ''} ${isCrowded ? 'crowded' : ''}`}>
            {animatedHand.map((card: any, idx: number) => {
                // Fan calculations
                const total = animatedHand.length;
                const mid = (total - 1) / 2;

                // Tighter fan as hand grows to prevent extreme horizontal stretching
                const fanAngle = Math.max(12, 35 - (total * 1.8));
                const rotation = (idx - mid) * (fanAngle / Math.max(total, 4));

                // Spacing offset
                const yOffset = Math.abs(idx - mid) * 1.2;

                return (
                    <motion.div
                        key={card.id}
                        layoutId={`card-${card.id}`}
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
    onPlaySequence: (cardIds: string[], newColor?: string, isUno?: boolean, targetUserId?: string) => void;
    onDrawCard: () => void;
    onPassTurn: () => void;
    onAcceptChallenge?: () => void;
    onChallengeDraw4?: () => void;
    onDeclareUno?: () => void;
    onCallNoUno?: () => void;
    onPlayerReady?: () => void;
}

const Game: React.FC<Props> = ({
    gameState,
    myId,
    onPlaySequence,
    onDrawCard,
    onPassTurn,
    onAcceptChallenge,
    onChallengeDraw4,
    onDeclareUno,
    onCallNoUno,
    onPlayerReady
}) => {

    const me = gameState.players.find((p: any) => p.userId === myId);
    const others = gameState.players.filter((p: any) => p.userId !== myId);
    const [viewportWidth, setViewportWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
    const [viewportHeight, setViewportHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 800);

    useEffect(() => {
        const handleResize = () => {
            setViewportWidth(window.innerWidth);
            setViewportHeight(window.innerHeight);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

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
    const [showYourTurn, setShowYourTurn] = useState<boolean>(false);
    const [autoUnoActive, setAutoUnoActive] = useState<boolean>(false);
    const [showTargetPicker, setShowTargetPicker] = useState<boolean>(false);
    const [targetSelection, setTargetSelection] = useState<any[]>([]); // Store cards being played while picker is up
    const [pendingColor, setPendingColor] = useState<string | undefined>(undefined);
    const scrollRef = React.useRef<HTMLDivElement>(null);

    // Reset Auto-UNO at end of turn
    useEffect(() => {
        if (!isMyTurn) setAutoUnoActive(false);
    }, [isMyTurn]);

    const [roundCountdown, setRoundCountdown] = useState<number | null>(null);

    useEffect(() => {
        if (gameState.status === 'round_end') {
            setRoundCountdown(10);
            const timer = setInterval(() => {
                setRoundCountdown(prev => (prev !== null && prev > 0) ? prev - 1 : 0);
            }, 1000);
            return () => clearInterval(timer);
        } else {
            setRoundCountdown(null);
        }
    }, [gameState.status, gameState.currentRound]);

    // "Your Turn" notification flash
    useEffect(() => {
        if (!isMyTurn) {
            setShowYourTurn(false);
            return;
        }
        const interval = setInterval(() => {
            setShowYourTurn(prev => !prev);
        }, 2000);
        return () => clearInterval(interval);
    }, [isMyTurn]);

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


    const hasUnoToSay = gameState.rules?.requireUnoDeclaration && me?.hand?.length === 1 && !me?.saidUno;
    const canCallNoUno = gameState.rules?.allowCallNoUno && others.some((p: any) => p.hand.length === 1 && !p.saidUno);

    // Auto-minimize hand logic & Auto UNO trigger
    useEffect(() => {
        if (hasUnoToSay || canCallNoUno) {
            // If Auto UNO is active, just shout it immediately
            if (autoUnoActive && hasUnoToSay) {
                onDeclareUno?.();
                // We don't return here so the hand doesn't stay forced visible unnecessarily long,
                // but we let it fall through in case canCallNoUno is true
            }

            if (!autoUnoActive || canCallNoUno) {
                // Force show if there's an active UNO situation to address manually
                setIsHandMinimized(false);
                return;
            }
        }

        if (isMyTurn) {
            setIsHandMinimized(false);
        } else {
            if (autoHidePreference) {
                setIsHandMinimized(true);
            }
        }
    }, [isMyTurn, autoHidePreference, hasUnoToSay, canCallNoUno, autoUnoActive, onDeclareUno]);

    const handleToggleHand = () => {
        const nextState = !isHandMinimized;
        setIsHandMinimized(nextState);
        // If the user manually shows the hand (nextState = false), disable auto-hiding globally for this session
        // If the user manually hides the hand (nextState = true), enable auto-hiding logic
        setAutoHidePreference(nextState);
        localStorage.setItem('uno_autohide_hand', nextState.toString());
    };

    const isCardPlayableNormally = (card: any) => {
        if (card.color === 'wild') return true;
        if (card.color === topCard.color) return true;
        if (card.value === topCard.value) return true;
        // Stacking logic for variations
        if (card.value.includes('Skip') && topCard.value.includes('Skip')) return true;
        if (card.value.includes('Reverse') && topCard.value.includes('Reverse')) return true;
        if (card.value.includes('Hit') && topCard.value.includes('Hit') &&
            ((card.value.includes('2') && topCard.value.includes('2')) ||
                (card.value.includes('4') && topCard.value.includes('4')))) return true;
        return false;
    };

    const isCardPlayableInWar = (card: any) => {
        const isTwo = card.value.includes('Draw2') || card.value.includes('Hit2') || card.value.includes('TargetDraw2');
        const isFour = card.value.includes('Draw4') || card.value.includes('Hit4') || card.value.includes('TargetDraw4');
        const topIsFour = topCard.value.includes('4');

        if (isTwo && (!topIsFour || gameState.rules?.allowDraw2OnDraw4)) {
            if (topIsFour && gameState.rules?.draw2OnDraw4ColorMatch) {
                return card.color === topCard.color || card.color === 'wild';
            }
            return true;
        }
        if (isFour && (topIsFour || gameState.rules?.allowDraw4OnDraw2)) return true;
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
        const projectedHandSize = me.hand.length - selection.length;
        const isUno = !!(autoUnoActive && projectedHandSize === 1);

        if (lastCard.color === 'wild') {
            setShowColorPicker(true);
        } else if (lastCard.value.includes('Target')) {
            setTargetSelection(selection);
            setShowTargetPicker(true);
            setSelection([]);
        } else {
            onPlaySequence(selection.map(s => s.id), undefined, isUno);
            setSelection([]);
        }
    };

    const selectColor = (color: string) => {
        const lastCard = selection[selection.length - 1];
        const projectedHandSize = me.hand.length - selection.length;
        const isUno = !!(autoUnoActive && projectedHandSize === 1);

        if (lastCard.value.includes('Target')) {
            setPendingColor(color);
            setTargetSelection(selection);
            setShowTargetPicker(true);
            setSelection([]);
            setShowColorPicker(false);
        } else {
            // Clear UI state immediately before network wait
            setSelection([]);
            setShowColorPicker(false);
            onPlaySequence(selection.map(s => s.id), color, isUno);
        }
    };

    const selectTarget = (targetUserId: string) => {
        const projectedHandSize = me.hand.length - targetSelection.length;
        const isUno = !!(autoUnoActive && projectedHandSize === 1);

        onPlaySequence(targetSelection.map(s => s.id), pendingColor, isUno, targetUserId);

        // Reset states
        setSelection([]);
        setTargetSelection([]);
        setPendingColor(undefined);
        setShowTargetPicker(false);
    };

    const cancelColorSelection = () => {
        setShowColorPicker(false);
    };

    const handleAutoSort = () => {
        const colorOrder: Record<string, number> = { red: 0, blue: 1, green: 2, yellow: 3, wild: 4 };
        const sorted = [...animatedHand].sort((a: any, b: any) => {
            if (a.value !== b.value) return a.value.localeCompare(b.value);
            return (colorOrder[a.color] ?? 5) - (colorOrder[b.color] ?? 5);
        });
        setAnimatedHand(sorted);
    };

    const isPortrait = viewportHeight > viewportWidth;
    const isDesktop = !isPortrait && viewportWidth > 1024; // Separate logic for desktop
    const aspectRatio = viewportWidth / Math.max(viewportHeight, 1);
    const radiusFactor = isHandMinimized ? 0.85 : 1.0;

    const arenaConfig = {
        isPortrait,
        aspectRatio,
        radiusFactor,
        orbitCenterY: isPortrait ? 40 : (isDesktop ? 34 : 62), // Moved UP on desktop (34), kept low on mobile landscape (62)
        rX: isPortrait ? 31 : Math.min(50, 26 + (aspectRatio * 6)), // Shaved portrait width
        rY: isPortrait ? 30 : 35,
        boardCenterY: isPortrait ? (68 + (50 / viewportHeight) * 100) : (isDesktop ? (45 + (50 / viewportHeight) * 100) : (54 + (50 / viewportHeight) * 100)),
        boardSafetyW: 14,
        boardSafetyH: 12,
        pushFactor: 1.4
    };

    // Calculate circular positions for opponents with perspective scaling
    const getSeatPosition = (index: number, total: number, isActive: boolean = false) => {
        // 1. DYNAMIC SCALE ENGINE (Continuous Power Law)
        // Stricter decay: total=1 => 2.2x, total=7 => 1.1x, total=10 => 0.9x
        const baseScaleFactor = 0.8 + (1.4 / Math.pow(Math.max(1, total), 0.7));
        const crowdingScale = total > 4 ? Math.max(0.45, 1 - (total - 4) * 0.08) : 1;

        // 2. DYNAMIC ARC SPREAD (Linear Growth with Cap)
        // Narrower arc for high player count to keep them away from side edges
        const maxSpread = isPortrait ? 210 : 250;
        const arcSpread = total === 1 ? 0 : Math.min(maxSpread, 70 + (total * 20));

        // 3. ANGLE CALCULATIONS (Polar distribution)
        const centerAngle = 270;
        const startAngle = ((centerAngle - arcSpread / 2) * Math.PI) / 180;
        const endAngle = ((centerAngle + arcSpread / 2) * Math.PI) / 180;
        const step = total > 1 ? (endAngle - startAngle) / (total - 1) : 0;
        const angle = total === 1 ? (Math.PI * 1.5) : startAngle + (step * index);

        // 4. COORDINATE & BOUNDARY MATHEMATICS
        let rY = arenaConfig.rY * radiusFactor;
        let rX = arenaConfig.rX * radiusFactor;

        const sinA = Math.sin(angle);
        const cosA = Math.cos(angle);

        // --- CONSTRAINT SOLVER ---
        // A. Viewport Edge Collision Detection
        if (sinA < 0) {
            const maxRYTop = (arenaConfig.orbitCenterY - 6) / Math.abs(sinA); // 6% top margin
            rY = Math.min(rY, maxRYTop);
        }
        const maxRXSide = (50 - 5) / Math.abs(cosA || 1); // 5% side margin
        rX = Math.min(rX, maxRXSide);

        // B. Board Overlap Prevention (Iterative Repulsion)
        let seatX = 50 + rX * cosA;
        let seatY = arenaConfig.orbitCenterY + rY * sinA;

        const distX = Math.abs(seatX - 50);
        const distY = Math.abs(seatY - arenaConfig.boardCenterY);

        if (distX < arenaConfig.boardSafetyW && distY < arenaConfig.boardSafetyH) {
            // Push it further out to clear the board center
            rY *= arenaConfig.pushFactor;
            rX *= arenaConfig.pushFactor;

            // Re-apply Screen constraints after push
            if (sinA < 0) rY = Math.min(rY, (arenaConfig.orbitCenterY - 4) / Math.abs(sinA));
            rX = Math.min(rX, (50 - 4) / Math.abs(cosA || 1));
        }

        // 5. DEPTH & RENDERING DATA (Z-Buffer management)
        const depthFactor = (sinA + 1) / 2; // 0 = Distant (Top), 1 = Foreground (Bottom)
        const cardScale = (0.5 + (depthFactor * 0.6)) * baseScaleFactor * crowdingScale;
        const labelScale = (0.8 + (depthFactor * 0.2)) * baseScaleFactor;

        // Map zIndex to clear the board (z-index 50) correctly
        const zIndex = 10 + Math.floor(depthFactor * 100);

        return {
            left: `${50 + rX * cosA}%`,
            top: `${arenaConfig.orbitCenterY + rY * sinA}%`,
            cardScale: cardScale * (isActive ? 1.15 : 1.0),
            labelScale: labelScale * (isActive ? 1.1 : 1.0),
            zIndex
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


    return (

        <div className="game-screen" >
            {/* History Toggle Button */}
            < button className="history-toggle-btn" onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? '✕' : '📋'}
            </button >



            {/* Spectator Global Badge */}
            <AnimatePresence>
                {
                    me.isSpectator && (
                        <motion.div
                            className="spectator-indicator"
                            initial={{ y: -50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                        >
                            SPECTATOR MODE
                        </motion.div>
                    )
                }
            </AnimatePresence >

            <div className="arena-background">
            </div>

            <LayoutGroup>
                {/* Integrated Command Center - Docked bottom (Order matters for CSS ~ sibling selector) */}
                <div className={`hand-command-center ${isMyTurn ? 'my-turn-glow' : ''} ${isHandMinimized ? 'minimized' : ''}`}>
                    {/* Centered Selection Zone (Internal to Command Center for better mobile/desktop alignment) */}
                    <AnimatePresence>
                        {selection.length > 0 && !showColorPicker && (
                            <motion.div
                                className="selection-zone floating"
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: 20, opacity: 0 }}
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

                    <div className="my-hand-container">
                        <div className="hand-controls compact">
                            <div className="control-group-left">
                                <button className="arena-control-btn" onClick={handleToggleHand} disabled={isMyTurn}>
                                    {isHandMinimized ? '👁️ SHOW' : '🙈 HIDE'}
                                </button>
                                <button className="arena-control-btn" onClick={handleAutoSort}>⚡ SORT</button>
                                <button
                                    className={`arena-control-btn ${autoUnoActive ? 'active' : ''}`}
                                    onClick={() => setAutoUnoActive(!autoUnoActive)}
                                    title="Auto-declare UNO! when playing your second-to-last card."
                                >
                                    {autoUnoActive ? '🟢 AUTO UNO' : '⚪ AUTO UNO'}
                                </button>
                                {isMyTurn && gameState.drewThisTurn && selection.length === 0 && (
                                    <button className="arena-control-btn danger-btn" onClick={onPassTurn}>🚀 PASS</button>
                                )}
                                {hasUnoToSay && (
                                    <button className="arena-control-btn pulse-btn" onClick={onDeclareUno}>📣 UNO!</button>
                                )}
                                {canCallNoUno && (
                                    <button className="arena-control-btn danger-btn" onClick={onCallNoUno}>🚫 NO UNO!</button>
                                )}
                            </div>
                            <span className={`player-name-label ${showYourTurn ? 'your-turn-active pulse' : ''}`}>
                                {showYourTurn ? 'YOUR TURN!' : me?.name}
                                {gameState.rules?.gameMode === 'points' && gameState.scores && (
                                    <span className={`score-badge mini ${gameState.scores[me?.userId] >= (gameState.rules.maxRounds || 3) - 1 ? 'near-win' : ''}`}>
                                        {gameState.scores[me?.userId] || 0}/{gameState.rules.maxRounds || 3}
                                    </span>
                                )}
                            </span>
                        </div>
                        <div className="my-hand-wrapper">
                            <div className="my-hand">
                                <Reorder.Group
                                    axis="x"
                                    values={animatedHand}
                                    onReorder={setAnimatedHand}
                                    className="reorder-hand"
                                >


                                    <AnimatePresence>
                                        {animatedHand.map((card: any, idx: number) => {
                                            const isSelected = selection.find(s => s.id === card.id);
                                            const canBeAdded = selection.length === 0
                                                ? (gameState.pendingDrawCount > 0 ? isCardPlayableInWar(card) : isCardPlayableNormally(card))
                                                : (card.value === selection[0].value);

                                            // Refined Panoramic Fan & Dynamic Spreading Logic
                                            const total = animatedHand.length;
                                            const mid = (total - 1) / 2;

                                            // Responsive Card Width for fanning math
                                            const isMobileLandscape = viewportHeight < 600 && viewportWidth > viewportHeight;
                                            const getBaseCardWidth = () => {
                                                if (isMobileLandscape) return 60; // Landscape mobile
                                                if (viewportWidth <= 480) return 75; // Portrait mobile
                                                if (viewportWidth <= 768) return 85; // Tablet
                                                return 110; // Desktop
                                            };
                                            const cardWidth = getBaseCardWidth();

                                            const targetSpan = Math.min(viewportWidth * 0.92, 1400);

                                            const calcSpacing = total <= 1 ? 0 : (targetSpan - cardWidth) / (total - 1);
                                            // Dynamic margin - spread out MORE in landscape as we have width to spare
                                            const dynamicMargin = total <= 1 ? 0 : (calcSpacing - cardWidth) / 2;

                                            // Clamp for stability: landscape needs even less aggressive negative margins
                                            const minMargin = isMobileLandscape ? -20 : (viewportWidth < 600 ? -40 : -55);
                                            const finalMargin = Math.max(minMargin, Math.min(25, dynamicMargin));

                                            // Ultra-Compact Arc for Mobile/Landscape
                                            const arcPower = isMobileLandscape ? 25 : (viewportWidth < 600 ? 40 : 45);
                                            const rotation = (idx - mid) * (arcPower / Math.max(total, 4));
                                            const yOffset = Math.abs(idx - mid) * (isMobileLandscape ? 4 : (viewportWidth < 600 ? 8 : 10));




                                            return (
                                                <Reorder.Item
                                                    value={card}
                                                    key={card.id}
                                                    className="player-card-wrapper drag-item"
                                                    style={{
                                                        zIndex: isSelected ? 100 : idx,
                                                        marginLeft: finalMargin,
                                                        marginRight: finalMargin
                                                    }}

                                                    onClick={() => handleCardClick(card)}
                                                    whileDrag={{ scale: 1.15, zIndex: 100, y: -20, rotate: 0 }}
                                                    initial={{ opacity: 0, y: 100, scale: 0.8 }}
                                                    animate={{
                                                        opacity: 1,
                                                        y: isSelected ? -30 : yOffset,
                                                        rotate: isSelected ? 0 : rotation,
                                                        scale: isSelected ? 1.05 : 1
                                                    }}
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
                        </div>

                    </div>
                </div>

                <div className="table-arena">
                    <div className="circular-orbit">
                        {/* Orbit and safety zones hidden for production */}
                        {others.map((player: any, index: number) => {
                            const isFinished = gameState.finishedPlayers?.includes(player.userId);
                            const isActive = gameState.players[gameState.currentPlayerIndex].userId === player.userId;
                            const pos = getSeatPosition(index, others.length, isActive);

                            return (
                                <div
                                    key={player.userId}
                                    className={`table-seat ${isActive ? 'active' : ''}`}
                                    style={{
                                        left: pos.left,
                                        top: pos.top,
                                        transform: `translate(-50%, -50%)`, // Centering
                                        zIndex: pos.zIndex
                                    }}
                                >
                                    <div className="billboard">
                                        <div className="scaling-carrier" style={{ transform: `scale(${pos.cardScale})`, transformOrigin: 'bottom center' }}>
                                            {!isFinished && <MiniHand hand={player.hand} active={isActive} />}
                                        </div>
                                        <div className="opponent-tag isometric" style={{ transform: `scale(${pos.labelScale})` }}>
                                            <div className="tag-inner">{player.name}</div>
                                            {gameState.rules?.gameMode === 'points' && gameState.scores && (
                                                <div className={`score-badge animate-in ${gameState.scores[player.userId] >= (gameState.rules.maxRounds || 3) - 1 ? 'near-win' : ''}`}>
                                                    {gameState.scores[player.userId] || 0}
                                                </div>
                                            )}
                                        </div>
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
                                        {/* Dynamic 3D stack based on deck length. Max 15 layers for performance/visuals */}
                                        {[...Array(Math.min(15, Math.ceil((gameState.deck?.length || 0) / 4)))].map((_, i) => (
                                            <div
                                                key={i}
                                                className="deck-card-layer"
                                                style={{
                                                    transform: `translateZ(${i * 3}px) translateY(-${i}px)`,
                                                    boxShadow: `0 ${i}px ${i * 2}px rgba(0,0,0,0.4)`
                                                }}
                                            >
                                                {i === Math.min(15, Math.ceil((gameState.deck?.length || 0) / 4)) - 1 && (
                                                    <div className="deck-card back"></div>
                                                )}
                                            </div>
                                        ))}
                                        {/* Subtle label for deck count */}
                                        <div className="deck-count-indicator">{gameState.deck?.length || 0}</div>
                                    </div>
                                </div>

                                <div className="discard-pile-cluster" onClick={() => setShowHistory(!showHistory)}>
                                    <AnimatePresence mode="popLayout">
                                        {gameState.discardPile.slice(-8).map((card: any, idx: number) => {
                                            const scatter = getOffsetById(card.id);
                                            return (
                                                <motion.div
                                                    key={`${card.id}-${idx}`}
                                                    className="discarded-card-physical"
                                                    initial={{ scale: 0.5, opacity: 0, rotate: 90, z: 100 }}
                                                    animate={{
                                                        scale: 1,
                                                        opacity: 1,
                                                        rotate: getRotationById(card.id) * 1.5,
                                                        x: scatter.x * 0.8,
                                                        y: scatter.y * 0.8,
                                                        z: idx * 2,
                                                        transition: { type: "spring", stiffness: 200, damping: 20 }
                                                    }}
                                                    exit={{ opacity: 0, scale: 0.8 }}
                                                >
                                                    <UnoCard card={card} />
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>

                                    {gameState.pendingDrawCount > 0 && (
                                        <div className="draw-warning pulse">DRAW WAR: +{gameState.pendingDrawCount}</div>
                                    )}
                                </div>
                            </div>
                            <div className="arena-indicators central">
                                <div className="direction-indicator-embedded">
                                    {gameState.direction === 1 ? '↻ CLOCKWISE' : '↺ ANTI-CLOCKWISE'}
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
                                                        {action.sequence.map((c: any, i: number) => {
                                                            const val = c.value;
                                                            const label = (/[a-zA-Z]/.test(val) && val.includes('4')) ? '+4' :
                                                                (/[a-zA-Z]/.test(val) && val.includes('2')) ? '+2' :
                                                                    val.includes('Skip') ? '🚫' :
                                                                        val.includes('Reverse') ? '⇄' :
                                                                            val.includes('DiscardAll') ? '🗑️' :
                                                                                val;
                                                            return <div key={i} className={`mini-card ${c.color}`}>{label}</div>;
                                                        })}
                                                        {action.purged && action.purged.length > 0 && (
                                                            <>
                                                                <span className="purged-label">PURGED:</span>
                                                                {action.purged.map((c: any, i: number) => {
                                                                    const val = c.value;
                                                                    const label = (/[a-zA-Z]/.test(val) && val.includes('4')) ? '+4' :
                                                                        (/[a-zA-Z]/.test(val) && val.includes('2')) ? '+2' :
                                                                            val.includes('Skip') ? '🚫' :
                                                                                val.includes('Reverse') ? '⇄' :
                                                                                    val.includes('DiscardAll') ? '🗑️' :
                                                                                        val;
                                                                    return <div key={`p-${i}`} className={`mini-card ${c.color} ghost`}>{label}</div>;
                                                                })}
                                                            </>
                                                        )}
                                                    </div>
                                                    {action.details && (
                                                        <div className="action-metadata">
                                                            {action.details.revCount > 0 && <span>REVERSED</span>}
                                                            {action.details.skipCount > 0 && <span>SKIPPED</span>}
                                                            {action.details.isStackingAction && <span>STACKED!</span>}
                                                            {action.details.hitCount > 0 && !action.details.isStackingAction && <span>HIT ALL!</span>}
                                                        </div>
                                                    )}
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
                {/* Selection zone moved into hand-command-center for better centering */}
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
                            <button className="neo-button secondary cancel-picker-btn" onClick={cancelColorSelection}>CANCEL</button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Target Picker Modal */}
            <AnimatePresence>
                {showTargetPicker && (
                    <motion.div
                        className="modal-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="color-picker glass target-picker"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                        >
                            <h3>SELECT TARGET</h3>
                            <div className="target-options">
                                {gameState.players
                                    .filter((p: any) => p.userId !== myId && !p.isSpectator)
                                    .map((p: any) => (
                                        <button
                                            key={p.userId}
                                            className="neo-button target-player-btn"
                                            onClick={() => selectTarget(p.userId)}
                                        >
                                            <span className="player-name-text">{p.name}</span>
                                            <span className="card-count-tag">{p.hand.length} cards</span>
                                        </button>
                                    ))}
                            </div>
                            <button className="neo-button secondary cancel-picker-btn" onClick={() => { setShowTargetPicker(false); setSelection([]); }}>CANCEL</button>
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
                {(gameState.status === 'round_end' || gameState.status === 'finished') && (
                    <motion.div
                        className="modal-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <motion.div
                            className="summary-modal glass transparent-modal"
                            initial={{ y: 50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                        >
                            <h2 className="glitch-text-sm">{gameState.status === 'finished' ? 'CHAMPION DECLARED' : 'ROUND COMPLETE'}</h2>
                            <div className="winner-announcement">
                                <div className="winner-label">WINNER</div>
                                <div className="winner-name-highlight">{gameState.lastWinnerName || 'Someone'}</div>
                            </div>

                            <div className="summary-content">
                                {roundCountdown !== null && (
                                    <div className="auto-timer">
                                        Next round in <span className="timer-val">{roundCountdown}s</span>
                                    </div>
                                )}
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
                                <div className="readiness-section">
                                    <button
                                        className={`neo-button continue-btn ${gameState.readyPlayers?.[myId] ? 'ready' : ''}`}
                                        onClick={onPlayerReady}
                                    >
                                        {gameState.readyPlayers?.[myId] ? 'WAITING...' : 'CONTINUE'}
                                    </button>
                                    <div className="ready-dots">
                                        {gameState.players.filter((p: any) => !p.isBot).map((p: any) => (
                                            <div
                                                key={p.userId}
                                                className={`ready-dot ${gameState.readyPlayers?.[p.userId] ? 'active' : ''}`}
                                                title={`${p.name} is ${gameState.readyPlayers?.[p.userId] ? 'ready' : 'not ready'}`}
                                            />
                                        ))}
                                    </div>
                                    <small className="hint">Host + Majority vote to continue</small>
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
                                    <button className="neo-button confirm-play" onClick={onPlayerReady}>
                                        {gameState.readyPlayers?.[myId] ? 'WAITING FOR OTHERS...' : 'RETURN TO LOBBY // READY'}
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

        </div >
    );
};

export default Game;
