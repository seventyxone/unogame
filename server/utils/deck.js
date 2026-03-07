function createDeck(rules) {
    const { deckConfig } = rules || {};
    const colors = ['red', 'blue', 'green', 'yellow'];
    const deck = [];

    const defaults = {
        '0': 1, '1': 2, '2': 2, '3': 2, '4': 2, '5': 2, '6': 2, '7': 2, '8': 2, '9': 2,
        'Skip': 2, 'Reverse': 2, 'Draw2': 2, 'Wild': 4, 'Draw4': 4
    };
    const counts = { ...defaults, ...deckConfig };

    for (const color of colors) {
        for (let i = 0; i <= 9; i++) {
            const c = counts[i.toString()];
            for (let j = 0; j < c; j++) {
                deck.push({ color, value: i.toString(), id: Math.random().toString(36).substr(2, 9) });
            }
        }
        ['Skip', 'Reverse', 'Draw2'].forEach(action => {
            const c = counts[action];
            for (let j = 0; j < c; j++) {
                deck.push({ color, value: action, id: Math.random().toString(36).substr(2, 9) });
            }
        });
    }

    for (let i = 0; i < counts['Wild']; i++) {
        deck.push({ color: 'wild', value: 'Wild', id: Math.random().toString(36).substr(2, 9) });
    }
    for (let i = 0; i < counts['Draw4']; i++) {
        deck.push({ color: 'wild', value: 'Draw4', id: Math.random().toString(36).substr(2, 9) });
    }

    // Fisher-Yates Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

module.exports = { createDeck };
