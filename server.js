const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(cors());
app.use(express.static('public'));

const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', ({ roomId, userName }) => {
        console.log(`${userName} (${socket.id}) joining room ${roomId}`);
        
        socket.join(roomId);
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, { users: [], timer: null, tasks: {} });
        }
        
        const room = rooms.get(roomId);
        
        // Remove any existing entry for this socket (reconnection case)
        room.users = room.users.filter(u => u.id !== socket.id);
        
        room.users.push({ id: socket.id, name: userName });
        room.tasks[socket.id] = room.tasks[socket.id] || [];

        // Get all other users in the room
        const otherUsers = room.users.filter(u => u.id !== socket.id);
        
        console.log(`Room ${roomId} now has ${room.users.length} users:`, room.users.map(u => u.name));

        // Send current room state to new user
        socket.emit('room-state', {
            users: otherUsers,
            timer: room.timer,
            tasks: room.tasks,
            yourId: socket.id
        });

        // Notify all OTHER users in room about the new user
        socket.to(roomId).emit('user-joined', { 
            userId: socket.id, 
            userName
        });

        console.log(`Notified ${otherUsers.length} other users about ${userName} joining`);
    });

    socket.on('ready-for-webrtc', ({ roomId }) => {
        console.log(`${socket.id} is ready for WebRTC in room ${roomId}`);
        socket.to(roomId).emit('peer-ready', { peerId: socket.id });
    });

    socket.on('webrtc-offer', ({ roomId, offer, targetId }) => {
        console.log(`Forwarding offer from ${socket.id} to ${targetId}`);
        io.to(targetId).emit('webrtc-offer', { 
            offer, 
            senderId: socket.id 
        });
    });

    socket.on('webrtc-answer', ({ roomId, answer, targetId }) => {
        console.log(`Forwarding answer from ${socket.id} to ${targetId}`);
        io.to(targetId).emit('webrtc-answer', { 
            answer, 
            senderId: socket.id 
        });
    });

    socket.on('webrtc-ice-candidate', ({ roomId, candidate, targetId }) => {
        if (candidate) {
            io.to(targetId).emit('webrtc-ice-candidate', { 
                candidate, 
                senderId: socket.id 
            });
        }
    });

    socket.on('timer-update', ({ roomId, timerState }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.timer = timerState;
            socket.to(roomId).emit('timer-sync', timerState);
        }
    });

    socket.on('task-update', ({ roomId, tasks }) => {
        const room = rooms.get(roomId);
        if (room) {
            room.tasks[socket.id] = tasks;
            socket.to(roomId).emit('task-sync', { userId: socket.id, tasks });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        rooms.forEach((room, roomId) => {
            const userIndex = room.users.findIndex(u => u.id === socket.id);
            if (userIndex !== -1) {
                const userName = room.users[userIndex].name;
                room.users.splice(userIndex, 1);
                delete room.tasks[socket.id];
                
                console.log(`${userName} left room ${roomId}. Remaining: ${room.users.length}`);
                
                socket.to(roomId).emit('user-left', socket.id);
                
                if (room.users.length === 0) {
                    rooms.delete(roomId);
                    console.log(`Room ${roomId} deleted (empty)`);
                }
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}`);
});
