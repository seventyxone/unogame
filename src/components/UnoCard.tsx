import React from 'react';
import { motion } from 'framer-motion';

interface CardProps {
    card: {
        color: string;
        value: string;
        id: string;
    };
    onClick?: () => void;
    disabled?: boolean;
    isSmall?: boolean;
    hidden?: boolean;
    noLayout?: boolean;
    highlight?: boolean;
}
const UnoCard: React.FC<CardProps> = ({ card, onClick, disabled, isSmall, hidden, highlight }) => {
    const getColor = (color: string) => {
        if (hidden) return 'linear-gradient(135deg, #1e293b, #0f172a)';
        switch (color) {
            case 'red': return 'var(--uno-red, #ff3b3b)';
            case 'blue': return 'var(--uno-blue, #3b82f6)';
            case 'green': return 'var(--uno-green, #22c55e)';
            case 'yellow': return 'var(--uno-yellow, #eab308)';
            case 'wild': return 'linear-gradient(45deg, #ff3b3b, #3b82f6, #22c55e, #eab308)';
            default: return '#333';
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: isSmall ? 0.7 : 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 220, damping: 28 }}
            whileHover={!disabled && !hidden ? { scale: 1.15, zIndex: 100 } : {}}
            className={`uno-card ${isSmall ? 'small' : ''} ${disabled ? 'disabled' : ''} ${hidden ? 'hidden-card' : ''} ${highlight ? 'highlight-glow' : ''}`}
            style={{
                background: getColor(card.color),
                boxShadow: hidden ? 'none' : `0 4px 12px rgba(0,0,0,0.4)`,
                border: hidden ? '1px solid rgba(255,255,255,0.2)' : '4px solid #fff',
            }}
            onClick={!disabled ? onClick : undefined}
        >
            <div className="card-inner-border"></div>
            {hidden ? (
                <div className="card-center hidden-logo"></div>
            ) : (
                <>
                    <div className="card-corner top-left">
                        {(card.value.match(/[a-z]/i) && card.value.includes('4')) ? '+4' :
                            (card.value.match(/[a-z]/i) && card.value.includes('2')) ? '+2' :
                                card.value.includes('SkipAll') ? '🚫👥' :
                                    card.value.includes('Skip') ? '🚫' :
                                        card.value.includes('Reverse') ? '⇄' :
                                            card.value.includes('DiscardAll') ? '🗑️' :
                                                card.value}
                    </div>
                    <div className="card-center-ellipse">
                        <div className="center-value" style={{ color: card.color === 'wild' ? '#a855f7' : getColor(card.color) }}>
                            {card.value.includes('Target') ? '🎯' :
                                card.value.includes('Hit') ? '💥' + (card.value.includes('4') ? '+4' : '+2') :
                                    (card.value.includes('Draw4') || (card.value.match(/[a-z]/i) && card.value.includes('4'))) ? '+4' :
                                        (card.value.includes('Draw2') || (card.value.match(/[a-z]/i) && card.value.includes('2'))) ? '+2' :
                                            card.value.includes('SkipAll') ? '🚫👥' :
                                                card.value.includes('Skip') ? '🚫' :
                                                    card.value.includes('Reverse') ? '⇄' :
                                                        card.value.includes('DiscardAll') ? '🗑️' :
                                                            card.value}
                        </div>
                    </div>
                    <div className="card-corner bottom-right">
                        {(card.value.match(/[a-z]/i) && card.value.includes('4')) ? '+4' :
                            (card.value.match(/[a-z]/i) && card.value.includes('2')) ? '+2' :
                                card.value.includes('SkipAll') ? '🚫👥' :
                                    card.value.includes('Skip') ? '🚫' :
                                        card.value.includes('Reverse') ? '⇄' :
                                            card.value.includes('DiscardAll') ? '🗑️' :
                                                card.value}
                    </div>
                </>
            )}
            <div className="card-gloss"></div>
        </motion.div>
    );
};

export default UnoCard;
