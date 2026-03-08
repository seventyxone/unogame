# UNO Game: Comprehensive User & Developer Guide

Welcome to the ultimate dual-purpose manual for the UNO Game! This document serves as both a **Complete User Manual** for players setting up lobbies and playing matches, as well as an **Expert Developer Guide** documenting the system architecture, mathematical matrix, and backend AI engines.

---

# PART 1: USER MANUAL (HOW TO PLAY & CONFIGURE)

## 1. The Game Lobby & Configuration
When you first launch the game or create a room, you enter the Lobby. The host has absolute power to configure the match using a highly granular rule engine.

### Game Modes
*   **Standard Mode**: Classic Uno. The first person to empty their hand immediately wins the game.
*   **LMS (Last Man Standing)**: Battle-Royale mode. When you empty your hand, you win and become a spectator. The remaining players keep fighting until only one "Loser" is left holding cards.
*   **Points Mode**: Competitive tournament mode. Play continues in rounds. When a player clears their hand, they earn 1 point. The game automatically resets rounds until a player reaches the configured "Target Score" (e.g., First to 3 Wins).

### Custom Rule Toggles
*   **Stacking (Draw Wars)**: When someone plays a `+2` or `+4`, the next player can play another `+2` or `+4` on top of it to pass the penalty along. The penalty accumulates (e.g., 2 + 2 + 4 = Draw 8) until someone is forced to draw the massive pile.
*   **Multi-Play**: Allows players to discard multiple identical cards at once (e.g., playing three Red 7s in the same turn). They must all be exactly the same color and value.
*   **Draw Until Playable**: If you have no valid cards, you don't just draw one card—you keep drawing indefinitely until you pull a card that can be played.
*   **Allow Play After Draw**: If you draw a card (due to not having a move), you can immediately play it if it's valid, rather than your turn instantly ending.
*   **Required UNO! Call**: When you reach 1 card, you must click the "UNO!" button. If you forget, other players can click "NO UNO!" to hit you with a 2-card penalty.
*   **Special Reverse (1v1)**: In a 2-player game, playing a Reverse card acts as a Skip, giving you another turn.

## 2. Advanced Custom Deck Configuration
The host can build custom decks by modifying the quantity of *every single card type*. 
*   **Numbers (0-9)**: Adjust how many of each number appear per color.
*   **Standard Actions**: Skips, Reverses, and +2s.
*   **Action Hit 2 / Hit 4**: When played, *every other player* at the table instantly draws 2 or 4 cards.
*   **Target Draw 2 / Target Draw 4**: Opens a crosshair menu allowing you to select a specific opponent to hit with a penalty.
*   **Discard All**: A tactical nuke. Playing a "Red Discard All" instantly throws every Red card in your hand into the discard pile.
*   **Skip All**: Skips the turn of *every* other player, making it your turn again instantly.

You can also add **Wild versions** of all the above cards (e.g., Wild Target Draw 4, Wild Discard All), which allow you to change the active color while unleashing the effect.

## 3. The 3D Game Arena Interface
*   **The Command Center**: Bottom of the screen. Hover over your hand to fan it out. 
    *   Click multiple matching cards to select them (if Multi-Play is on).
    *   Click **Confirm Play** to lock them in.
*   **Sort / Hide**: Use the UI buttons to magically sort your cards by color/number, or "Hide" them to view the entire arena.
*   **Auto-UNO**: Toggle this on strictly *before* you play your second-to-last card, and the system will automatically scream "UNO!" for you, keeping you safe from penalties.

---

# PART 2: DEVELOPER & ARCHITECTURE GUIDE

The application follows a **Real-time Stateful Client-Server** architecture powered by `Node.js`, `Express`, `Socket.IO`, `React 19`, and `Framer Motion`.

## 1. Server Architecture & State (`/server`)

The server is the absolute source of truth. The clients are "dumb terminals" that render the current state and broadcast their intents.

### A. Core State Management (`state.js` & `gameCore.js`)
*   **`rooms` Map**: Centralized volatile storage. Holds the full object for every active session: players, hands, deck, discard pile, current round, scores, and active `room.rules` configuration.
*   **`createDeck(rules)`**: Dynamically parses the host's `deckConfig` numbers, generates the raw cards arrays using nested loops for colors, assigns unique IDs, and performs a Fisher-Yates array shuffle.
*   **`advanceTurn(room, skipCount)`**: Vector-based turn resolution. Uses `(currentIndex + direction + players.length) % players.length` modulo mathematics. Skips over eliminated (LMS mode) or spectating players.

### B. The Rules Engine (`playerActionService.js`)
The backbone of the application. Processes the `play_sequence` event.
*   **`isPlayValid(...)`**: Extensive boolean matrix. Verifies color matches, value matches, and Wild validity. Heavily interlocks with `pendingDrawCount` to ensure players cannot dodge an active Draw War with a standard card.
*   **`processPlaySequence(...)` / `applyCardEffects(...)`**: 
    *   Validates Multi-Play value matching (e.g., throwing a server error if a user tries to multi-play a 7 and an 8).
    *   Accumulates `totalDraw`, `hitAllValue`, and `targetDrawValue`.
    *   If `room.rules.drawWar` is on, Target/Hit cards *convert* their global attack values into the local Draw War stack, allowing massive counter-attacks.
*   **Penalty Dispatchers**: Handlers for `handleCallNoUno` cycle through opponents looking for `saidUno === false` combined with `hand.length === 1` and force a slice/push array manipulation from the deck.

### C. Artificial Intelligence Sandbox (`botService.js`)
Bots operate via a multi-tiered recursive scoring matrix to act indistinguishably from humans.
*   **Simulated Latency**: Uses `setTimeout` logic so bots don't react in 0 milliseconds.
*   **Heuristic Scoring Engine (`evaluateHand`)**:
    *   *Score 100*: Defensively stacking a + card during a Draw War.
    *   *Score 50+*: Matching normal cards. Prioritizes dumping action cards (Skips/Reverses) before number cards.
    *   *Score 25*: Holds Wild cards hostage as last-resort lifelines.
    *   *Score +40 (Synergy)*: Identifies `DiscardAll` cards and scans its own hand to calculate multi-card combos.
*   **Dynamic Intelligence**: Bots are aware of other players forgetting to say UNO and have a 70% chance to maliciously hit them with a penalty. When playing a Wild card, bots execute `determineOptimalColor` by iterating over their own arrays to declare the color they possess the most of.

---

## 2. Client Architecture & 3D Math (`/src`)

### A. Networking & Synchronization (`App.tsx`)
*   Maintains the singleton `socket.io-client` connection.
*   Acts as the central router between `<Lobby />` and `<Game />`. Replaces the entire local React state payload whenever `game_update` fires from the Node server.

### B. Trigonometric 3D Arena Layout (`Game.tsx`)
*   **The Math Model**: Players are not put in standard HTML grids. The `getSeatPosition` matrix uses Polar Coordinates (`Math.sin` and `Math.cos`) to bind opponents dynamically to a circular track.
*   **`arenaConfig` Engine**:
    *   Detects `viewportHeight`, `viewportWidth`, Portrait/Landscape mode, and Desktop breakpoints.
    *   Alters `rX` (width) and `rY` (height / perspective tilt) dynamically. Portrait mode dramatically squashes `rX` to keep the circle tight to the phone layout.
*   **Occlusion Constraint Solver**: Before placing an opponent, the code mathematically simulates a collision box with the center `boardCenterY`. If mathematical overlap threatens the center, it uses an iterative `pushFactor` (1.4x) multiplier to push them further out into space, then re-clamps to screen bounds.

### C. Advanced Z-Index DOM Layering
To conquer Chrome/Safari's 3D perspective context occlusion:
*   **Layer 1 (Cards)**: Renders inside a `.table-seat` with dynamic `zIndex` mapped to trigonometry depth (closest to bottom = highest z-index).
*   **Layer 2 (Tags)**: Because 3D children inherit their parent's stack limits, name tags are rendered *outside* the layer loop in a cloned `.active-tag` DOM layer strictly assigned `z-index: 100000`. Ghost blocks are used to preserve exact geometric heights between the two decoupled layers.

### D. CSS Animations (`App.css`)
*   Pristine use of `preserve-3d`, `backdrop-filter: blur`, rotating SVGs, and text-drop shadows. 
*   Turn indicators rely on `@keyframes fast-text-flash` to apply vibrating orange-yellow text shadows on top of the `.active-tag` layout, ensuring visual pop directly over cards without background box stretching.
