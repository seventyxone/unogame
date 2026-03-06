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
}

const UnoCard: React.FC<CardProps> = ({ card, onClick, disabled, isSmall }) => {
    const getColor = (color: string) => {
        switch (color) {
            case 'red': return '#ff3b3b';
            case 'blue': return '#3b82f6';
            case 'green': return '#22c55e';
            case 'yellow': return '#eab308';
            case 'wild': return 'linear-gradient(45deg, #ff3b3b, #3b82f6, #22c55e, #eab308)';
            default: return '#333';
        }
    };

    return (
        <motion.div
            whileHover={!disabled ? { scale: 1.1, y: -20, rotate: 2 } : {}}
            whileTap={!disabled ? { scale: 0.95 } : {}}
            className={`uno-card ${isSmall ? 'small' : ''} ${disabled ? 'disabled' : ''}`}
            style={{
                background: getColor(card.color),
                boxShadow: `0 0 20px ${card.color === 'wild' ? '#a855f7' : getColor(card.color)}44`
            }}
            onClick={!disabled ? onClick : undefined}
        >
            <div className="card-top-left">{card.value}</div>
            <div className="card-center glass">
                {card.value === 'Draw4' ? '+4' :
                    card.value === 'Draw2' ? '+2' :
                        card.value === 'Skip' ? '🚫' :
                            card.value === 'Reverse' ? '⇄' :
                                card.value}
            </div>
            <div className="card-bottom-right">{card.value}</div>

            {/* Gloss overlay */}
            <div className="card-gloss"></div>
        </motion.div>
    );
};

export default UnoCard;
