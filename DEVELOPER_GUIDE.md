# UNO Game: Comprehensive Developer & Architecture Guide

This document serves as the ultimate technical manual for the UNO Game application. It provides an expertly detailed breakdown of every feature, function, game rule, and architectural decision within the codebase.

## 1. System Architecture Matrix

The application is built on a **Real-time Stateful Client-Server** architecture.

### Technology Stack
*   **Backend / Server:** Node.js, Express, Socket.IO.
*   **Frontend / Client:** React 19, Vite, TypeScript, Framer Motion (for physics-based animations).
*   **State Protocol:** Bidirectional, event-driven syncing using websockets. The server is the absolute source of truth; clients simply dispatch intents and render the synchronized state.

---

## 2. Server Architecture & Functions (`/server`)

The server is responsible for enforcing rules, validating moves, managing active connections, simulating AI, and broadcasting game states.

### A. Core Entry & Routing (`index.js`)
*   **`setupGlobalMiddleware` / `setupCors`:** Configures HTTP server security and sets up the socket layer.
*   **`io.on('connection')`:** The main event listener block orchestrating client interactions.
    *   **`join_room`:** Initializes or joins a room. Sets up default game configuration and custom rule definitions.
    *   **`start_game`:** Transitions room state from Lobby to Active Game, triggering deck generation and dealing.
    *   **`play_sequence`:** Routes user moves to the `playerActionService`.
    *   **`draw_card` / `pass_turn`:** Handles deck interactions when a player has no valid cards or chooses not to play.
    *   **`say_uno` / `call_no_uno`:** Manages the penalization system for shouting UNO! or catching players who forgot.

### B. Game State Management (`state.js` & `gameCore.js`)
*   **`rooms` Map:** In-memory store holding every active session, including players, deck, discard pile, active rules, turn index, and scores.
*   **`generateDeck()`:** Dynamically builds a standard deck (108 cards): 4 colors, numbers 0-9, skips, reverses, +2s, wild, and +4 wild.
*   **`shuffle()` / `dealCards()`:** Uses Fisher-Yates shuffle algorithms. Calculates remaining deck size and automatically reshuffles the discard pile if the deck runs out.
*   **`advanceTurn(room, skipCount)`:** Core engine utility calculating the next active player. Resolves vector direction (clockwise/counter-clockwise), jumps over eliminated players in non-standard modes, and applies specific `skipCount` logic.

### C. Rule Enforcement Engine (`playerActionService.js`)
This is the heart of the game logic. Every card play goes through strict validation.
*   **`isPlayValid(card, topCard, activeWar, currentSuit)`:** Comprehensive check matrix. Ensures colors match, values map, or wildcards are legally permitted. Interlocks with the `pendingDrawCount` (Draw War system).
*   **`processPlaySequence(room, player, cards)`:** Evaluates Multi-Play functionality. Confirms that if a user submits multiple cards (e.g., three Red 5s), they all have identical values and are valid plays.
*   **`applyCardEffects(room, playedCards)`:** Evaluates side effects based on card types.
    *   **Reverses:** Flips `room.direction`. In 1v1 mode, reverses act as Skips (grants an extra turn).
    *   **Skips:** Increments the internal skip counter to jump the next player.
    *   **+2 / +4 (Draw Wars):** Adds to `room.pendingDrawCount` instead of forcing an immediate draw, allowing the next player to chain/stack another + card to pass the penalty.
*   **`handleUNO`:** Manages the boolean `hasSaidUno` flag for players at 1 card. Applies 2-card penalties for `call_no_uno` events.

### D. Artificial Intelligence (`botService.js`)
The AI simulates human decision-making using a priority-driven heuristic matrix.
*   **`processBotTurn(room, bot)`:** The main entry loop. Simulates "thinking time" using timeouts before emitting an action, preventing the game from moving faster than humans can process.
*   **`evaluateHand(hand, topCard, warActive)`:** Deep analysis function rating every playable card via a scoring system:
    *   *Score 100:* Stacking a + card during an active Draw War (Absolute defense).
    *   *Score 50-70:* Matching current color/value. Prefers dropping higher point cards (Action cards) earlier than number cards.
    *   *Score 20-30:* Wild cards (Kept as last-resort lifelines unless forced to play).
*   **`determineOptimalColor(hand)`:** When playing a Wild card, the bot scans its own hand, tallies color distributions, and strategically declares the color it possesses the most of.

---

## 3. Client Architecture & UI (`/src`)

The client focuses on immersive rendering, 3D math, animations, and providing a responsive command center.

### A. Central Sync & Routing (`App.tsx`)
*   **`Socket Context:`** Maintains a single socket connection throughout the lifecycle.
*   **`Room Sync:`** Listens to `game_update` events and replaces the local React state with the authoritative server object.
*   **`View Router:`** Dynamically switches rendering between `<Lobby />` (configuration) and `<Game />` (active match) based on `gameState.status`.

### B. The 3D Render Arena (`Game.tsx`)
This is the most mathematically complex view, rendering the game board in pseudo-3D utilizing CSS transforms and trigonometric positioning.
*   **`arenaConfig`:** Defines spatial boundaries (radius X/Y, orbit centers). Distinct configurations dynamically apply based on whether the device is Desktop, Landscape Mobile, or Portrait Mobile.
*   **`getSeatPosition(index, total)`:** Calculates the geometric position of opponents around an ellipse.
    *   *Polar Math:* Uses `Math.sin`/`Math.cos` to calculate X/Y coordinates.
    *   *Constraints Solver:* Prevents players from overlapping the center game board or drifting off the edge of the screen.
    *   *Perspective Scaling:* Computes depth factors to make players "further away" (top of orbit) visibly smaller than players "closer" (bottom of orbit).
*   **`Multi-Layer Z-Indexing:`** Solves 3D occlusion bugs by maintaining strictly decoupled layers.
    *   *Layer 1 (Cards/Hands):* Physically sort front-to-back based on depth math.
    *   *Layer 2 (Nametags):* An invisible ghosting layer set to `z-index: 100000` to ensure text is never covered by standard 3D elements.
*   **`Hand Command Center:`** The player's interaction zone.
    *   *Panoramic Fanning:* Computes aggressive margins and rotational degrees using `Reorder.Group` to fan cards smoothly like a real hand of Uno.
    *   *Multi-Select:* UI mechanics allowing users to buffer multiple identical cards before submitting the `play_sequence` event.

### C. UI Primitives & Animations (`UnoCard.tsx` & `App.css`)
*   **`UnoCard.tsx`:** Renders exact SVG/CSS replicas of Uno cards. Handles themes (Red, Blue, Green, Yellow, Wild, Dark Mode logic).
*   **Animations:** Powered by `framer-motion` (`AnimatePresence`, spring transitions).
*   **`App.css` (The Design System):** 
    *   Contains deep integration with CSS Variables for dynamic heights/widths.
    *   Features glassmorphism `backdrop-filters`, heavy `box-shadow` rendering, and specific `@keyframes` for "Active turn" pulses.

---

## 4. Comprehensive Feature Overview

### Game Modes
1.  **Standard Mode:** Classic Uno. The first player to clear their hand immediately wins the game.
2.  **Last Man Standing (LMS):** Battle-Royale style. When a player clears their hand, they are marked "Finished" and spectate. The game continues until only one player remains holding cards (the ultimate loser).
3.  **Points Mode:** Competitive scaling. Each round concludes when a player finishes. The winner earns points based on the cards left in opponents' hands. The game auto-resets rounds until a specified Target Score is reached.

### Rule Modifiers (Configurable in Lobby)
*   **Stacking (Draw Wars):** Allows players to chain +2s onto +2s, and +4s onto +4s. The penalty accumulates until a player cannot respond, forcing them to draw the massive total.
*   **Draw Sequencing:** If a player has no moves, they continually draw from the deck until a valid, playable card is drawn (or they can optionally pass if configured).
*   **Multi-Play:** Advanced mechanic enabling a player to discard multiple identical cards (e.g., two Green 7s) in a single turn to rapidly clear their hand.
*   **Special Reverse (1v1):** Fixes standard Uno rules where a Reverse card played with only two players acts as a Skip, giving the player a consecutive turn.

---

## 5. Extensibility & Future Development

*   **Adding New Cards:** Create the logic handler in `applyCardEffects` (Server), add the card definition to `generateDeck` (Server), and update switch statements in `UnoCard.tsx` (Client).
*   **Adding Visual Themes:** Update the CSS variables inside `App.css` and map them to game states inside `Game.tsx`.
*   **Server Scalability:** The `state.js` in-memory store can be swapped for a Redis instance to allow multi-server scaling if required.
