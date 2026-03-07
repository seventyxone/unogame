function createDeck(rules) {
    const { deckConfig } = rules || {};
    const colors = ['red', 'blue', 'green', 'yellow'];
    const deck = [];

    const defaults = {
        '0': 1, '1': 2, '2': 2, '3': 2, '4': 2, '5': 2, '6': 2, '7': 2, '8': 2, '9': 2,
        'Skip': 2, 'Reverse': 2, 'Draw2': 2, 'Wild': 4, 'Draw4': 4,
        'DiscardAll': 0, 'ColorHit2': 0, 'ColorHit4': 0, 'ColorDraw4': 0, 'SkipAll': 0, 'TargetDraw2': 0, 'TargetDraw4': 0,
        'WildDiscardAll': 0, 'WildHit2': 0, 'WildHit4': 0, 'WildDraw2': 0, 'WildSkipAll': 0, 'WildTargetDraw2': 0, 'WildTargetDraw4': 0, 'WildSkip': 0, 'WildReverse': 0
    };

    // Normalize config keys to be case-insensitive
    const normConfig = {};
    if (deckConfig) {
        Object.keys(deckConfig).forEach(k => {
            normConfig[k.toLowerCase()] = deckConfig[k];
        });
    }

    const counts = {};
    Object.keys(defaults).forEach(k => {
        const lowerK = k.toLowerCase();
        counts[k] = (normConfig[lowerK] !== undefined) ? normConfig[lowerK] : defaults[k];
    });

    for (const color of colors) {
        // Numbers 0-9
        for (let i = 0; i <= 9; i++) {
            const count = counts[i.toString()] ?? 0;
            for (let j = 0; j < count; j++) {
                deck.push({ color, value: i.toString(), id: Math.random().toString(36).substr(2, 9) });
            }
        }
        // Colored Actions
        ['Skip', 'Reverse', 'Draw2', 'DiscardAll', 'ColorHit2', 'ColorHit4', 'ColorDraw4', 'SkipAll', 'TargetDraw2', 'TargetDraw4'].forEach(action => {
            const count = counts[action] ?? 0;
            for (let j = 0; j < count; j++) {
                deck.push({ color, value: action, id: Math.random().toString(36).substr(2, 9) });
            }
        });
    }

    // Wilds
    const wildTypes = ['Wild', 'Draw4', 'WildDiscardAll', 'WildHit2', 'WildHit4', 'WildDraw2', 'WildSkipAll', 'WildTargetDraw2', 'WildTargetDraw4', 'WildSkip', 'WildReverse'];
    wildTypes.forEach(val => {
        const count = counts[val] ?? 0;
        for (let i = 0; i < count; i++) {
            deck.push({ color: 'wild', value: val, id: Math.random().toString(36).substr(2, 9) });
        }
    });

    if (deck.length === 0) {
        console.warn("[DECK] Empty deck generated! Adding emergency Red 0.");
        deck.push({ color: 'red', value: '0', id: 'emergency' });
    }

    // Fisher-Yates Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

module.exports = { createDeck };
