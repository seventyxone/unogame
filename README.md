# UNO - Ultimate Multiplayer Experience

A professional, feature-rich UNO game built with **React**, **TypeScript**, and **Socket.io**. This version includes competitive modes, tactical visualizations, and advanced rule configurations.

## 🚀 Unique Features

### 🏆 Competitive Game Modes
*   **Tournament Mode (LMS)**: Survive round after round! The player with the most cards at the end of each round is eliminated until only one remains.
*   **Points Mode**: Compete for the lowest score across multiple rounds. Customize the `Max Rounds` to fit your playtime.
*   **Standard Mode**: The classic UNO experience.

### 🎮 Advanced Rule Toggles
*   **Draw War (Stacking)**: Chain +2 and +4 cards to force opponents into massive card draws.
*   **Multi-Play**: Play sequences of the same number (e.g., all your '7's) in a single turn.
*   **Special Reverse**: In 2-player games, Reverse acts like a Skip.
*   **Custom Deck Config**: Modify the exact count of every card type (0-9, Skip, Wild, etc.) in the deck.

### 👁️ Tactical Visualization
*   **Activity Stream**: Real-time turn history next to the play area showing exactly what cards were played and who took a Draw War hit.
*   **Opponent Hand Graphics**: Beautifully fanned card backs for opponents, representing their actual hand size.
*   **Selection Control**: Plan your sequence before playing, with the ability to cancel and retry.

---

## 🛠️ Technical Setup

### Backend (Server)
*   **Technology**: Node.js, Express, Socket.io
*   **Hosting Recommendation**: [Render.com](https://render.com) (Web Service)
*   **Port**: Dynamically assigned via `process.env.PORT` (defaults to 3001)

### Frontend (Client)
*   **Technology**: React 19, Vite, Framer Motion, Lucide React
*   **Hosting Recommendation**: [Render.com](https://render.com) (Static Site)
*   **Environment**: Configure `VITE_SERVER_URL` in your `.env` to point to your backend.

---

## ⚡ Quick Start (Local)

1.  **Install Dependencies**:
    ```bash
    npm install
    cd server
    npm install
    ```
2.  **Start Services**:
    *   **Frontend**: `npm run dev`
    *   **Backend**: `node index.js` (inside `server/`)

Designed for the ultimate UNO showdown!
