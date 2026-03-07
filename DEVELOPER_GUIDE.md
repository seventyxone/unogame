# UNO Game: Comprehensive Developer Guide

This document provides a technical overview of the UNO Game codebase, covering architecture, logic flow, and component responsibilities.

## Architecture Overview

The application follows a **Real-time Client-Server** architecture:
- **Server**: Node.js with Socket.IO for state management and game logic.
- **Client**: React (Vite) with Framer Motion for a high-performance, animated UI.
- **Communication**: Bidirectional event-based syncing via Socket.IO.

---

## 1. Project Structure

### Server (`/server`)
- `index.js`: Entry point. Sets up Express/Socket.IO and routes incoming events to services.
- `state.js`: Centralized volatile storage for active rooms and player connections.
- `services/`:
    - `playerActionService.js`: Core game rules engine. Handles card plays, drawing, and penalties.
    - `botService.js`: AI tactical engine. Uses a scoring matrix to simulate human-like decision making.
- `utils/`:
    - `gameCore.js`: Workflow for starting games, dealing cards, and turn advancement.
    - `deck.js`: Deck generation logic (colors, values, and quantities).

### Client (`/src`)
- `App.tsx`: The "Brain". Manages socket connections, global state syncing, and view switching (Lobby vs. Game).
- `components/`:
    - `Game.tsx`: The "Arena". Handles local UI state, drag-and-drop (Reorder), and circular layout math.
    - `Lobby.tsx`: Landing page for room joining and initial setup.
    - `UnoCard.tsx`: Primitive component for rendering cards with dynamic themes and states.
- `App.css`: The "Design System". Contains all glassmorphism, glitches, and responsive media queries.

---

## 2. Key Technical Flows

### A. The Game Loop
1.  **Action**: Client emits an event (e.g., `play_sequence`).
2.  **Validation**: `playerActionService.js` verifies the move against the top card and current rules.
3.  **State Mutation**: Server updates the room object (e.g., moves card from hand to discard pile).
4.  **Sync**: Server emits `game_update` to all clients in the room.
5.  **Render**: Clients receive the new state; Framer Motion animates the changes automatically.

### B. AI (Bot) Decision Logic
Bots operate in `botService.js` with a priority scoring system:
- **High Priority (100 pts)**: Stacking onto a Draw War (defensive play).
- **Medium Priority (50 pts)**: Matching current color/value.
- **Low Priority (20-25 pts)**: Playing Wild cards.
- **Strategic Color Choice**: Bots pick the color they hold the most in their hand.

### C. Responsive Arena Math
The player orbit in `Game.tsx` is calculated procedurally:
- Uses `Math.cos` and `Math.sin` to place players in an ellipse.
- Radius and Center-Y shift dynamically based on `window.innerWidth` and `window.innerHeight`.
- Landscape vs. Portrait modes have unique arc constraints to prevent UI overlapping.

---

## 3. Custom Rules Engine
The engine supports heavy customization via the `room.rules` object:
- **Draw War**: Stacking +2/+4 cards.
- **Special Reverse**: 1v1 momentum and double-reverse extra turns.
- **Multi-Play**: Playing multiple cards of the same value.
- **Game Modes**: 
    - `standard`: First to finish wins.
    - `tournament (LMS)`: Eliminated players watch until one is left.
    - `points`: Rounds continue until a target score is reached.

---

## 4. Developer Cheat Sheet

### Adding a New Rule
1.  Add the rule to the `rules` object in `server/index.js` (`join_room`).
2.  Update `server/services/playerActionService.js` to check `room.rules.yourRule`.
3.  Add a UI toggle in `src/App.tsx` (Lobby settings).

### Modifying Card Visuals
Edit `src/components/UnoCard.tsx`. It uses CSS variables defined in `App.css` to handle colors and glows.

### Debugging
- **Server Logs**: Check `server/index.js` console output for move rejections.
- **Client Logs**: Check the browser console; `App.tsx` logs all emitted socket events.
