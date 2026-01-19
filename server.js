// Install dependencies: npm install express socket.io cors
// Run: node server.js

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
    }
});

app.use(cors());
app.use(express.static('public'));

const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', ({ roomId, userName }) => {
        socket.join(roomId);
        
        if (!rooms.has(roomId)) {
            rooms.set(roomId, { users: [], timer: null, tasks: {} });
        }
        
        const room = rooms.get(roomId);
        room.users.push({ id: socket.id, name: userName });
        room.tasks[socket.id] = [];

        console.log(`${userName} (${socket.id}) joined room ${roomId}`);
        console.log(`Room ${roomId} now has ${room.users.length} users`);

        // Send current room state to new user
        socket.emit('room-state', {
            users: room.users.filter(u => u.id !== socket.id),
            timer: room.timer,
            tasks: room.tasks
        });

        // Notify others in room about new user
        socket.to(roomId).emit('user-joined', { 
            userId: socket.id, 
            userName,
            currentTimer: room.timer,
            allTasks: room.tasks
        });

        // Send list of existing peers to new user for direct connection
        const otherUsers = room.users.filter(u => u.id !== socket.id);
        if (otherUsers.length > 0) {
            socket.emit('existing-users', otherUsers.map(u => ({ id: u.id, name: u.name })));
        }
    });

    socket.on('webrtc-offer', ({ roomId, offer, targetId }) => {
        console.log(`Forwarding offer from ${socket.id} to ${targetId}`);
        socket.to(targetId).emit('webrtc-offer', { offer, senderId: socket.id });
    });

    socket.on('webrtc-answer', ({ roomId, answer, targetId }) => {
        console.log(`Forwarding answer from ${socket.id} to ${targetId}`);
        socket.to(targetId).emit('webrtc-answer', { answer, senderId: socket.id });
    });

    socket.on('webrtc-ice-candidate', ({ roomId, candidate, targetId }) => {
        console.log(`Forwarding ICE candidate from ${socket.id} to ${targetId}`);
        socket.to(targetId).emit('webrtc-ice-candidate', { candidate, senderId: socket.id });
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
                room.users.splice(userIndex, 1);
                delete room.tasks[socket.id];
                
                socket.to(roomId).emit('user-left', socket.id);
                
                console.log(`Room ${roomId} now has ${room.users.length} users`);
                
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
});
