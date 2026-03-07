import React, { useState } from 'react';

interface Props {
    onJoin: (roomId: string, playerName: string) => void;
}

const Lobby: React.FC<Props> = ({ onJoin }) => {
    const [roomId, setRoomId] = useState('');
    const [name, setName] = useState(() => localStorage.getItem('uno_player_name') || '');

    return (
        <div className="lobby-screen glass floating">
            <h1 className="title">NEO<span>UNO</span></h1>
            <p className="subtitle">The Future of Card Games</p>

            <div className="input-group">
                <input
                    type="text"
                    placeholder="Player Name"
                    className="neo-input"
                    value={name}
                    onChange={(e) => {
                        setName(e.target.value);
                        localStorage.setItem('uno_player_name', e.target.value);
                    }}
                />
                <input
                    type="text"
                    placeholder="Room Code"
                    className="neo-input"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                />
            </div>

            <button
                className="neo-button"
                onClick={() => name && roomId && onJoin(roomId, name)}
                disabled={!name || !roomId}
            >
                Enter Void
            </button>

            <div className="divider">OR</div>

            <button
                className="neo-button secondary"
                onClick={() => {
                    const randomName = name || "Scout_" + Math.floor(Math.random() * 1000);
                    const randomRoom = "SOLO_" + Math.random().toString(36).substr(2, 5);
                    onJoin(randomRoom, randomName);
                }}
            >
                Quick Solo
            </button>
        </div>
    );
};

export default Lobby;
