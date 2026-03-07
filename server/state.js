const rooms = new Map();
let ioInstance = null;

const setIo = (io) => { ioInstance = io; };
const getIo = () => ioInstance;

module.exports = {
    rooms,
    setIo,
    getIo
};
