// ============================================
// FRONTEND: public/app.js
// ============================================

const socket = io();
let localStream;
let peerConnections = new Map();
let roomId;
let userName;
let remotePeerId;
let friendName = 'Friend';

// Timer state
let timerInterval;
let timeLeft = 25 * 60;
let totalTime = 25 * 60;
let isRunning = false;
let isBreak = false;

// Tasks
let myTasks = [];
let friendTasks = [];

// Media state
let audioEnabled = true;
let videoEnabled = true;

// WebRTC configuration
const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// ============================================
// Setup & Connection
// ============================================

document.getElementById('joinBtn').addEventListener('click', joinRoom);

async function joinRoom() {
    userName = document.getElementById('nameInput').value.trim();
    if (!userName) {
        alert('Please enter your name');
        return;
    }

    const roomInput = document.getElementById('roomInput').value.trim();
    roomId = roomInput || generateRoomId();

    document.getElementById('connectionStatus').classList.remove('hidden');

    // Show room link
    const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    document.getElementById('roomLink').textContent = link;
    document.getElementById('roomLinkSection').classList.remove('hidden');

    // Initialize media
    await initMedia();

    // Join room via Socket.io
    socket.emit('join-room', { roomId, userName });

    setTimeout(() => {
        document.getElementById('setupScreen').classList.add('hidden');
        document.getElementById('mainScreen').classList.remove('hidden');
    }, 1000);
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 12);
}

async function initMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720 },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        document.getElementById('localVideo').srcObject = localStream;
    } catch (error) {
        console.error('Error accessing media:', error);
        alert('Could not access camera/microphone. Please check permissions.');
    }
}

// ============================================
// Socket.io Events
// ============================================

socket.on('room-state', ({ users, timer, tasks }) => {
    console.log('Room state:', users);
    if (users.length > 0) {
        friendName = users[0].name;
        document.getElementById('friendName').textContent = friendName;
    }
    if (timer) {
        syncTimerState(timer);
    }
    if (tasks) {
        Object.entries(tasks).forEach(([userId, userTasks]) => {
            if (userId !== socket.id) {
                friendTasks = userTasks;
                renderFriendTasks();
            }
        });
    }
});

socket.on('user-joined', ({ userId, userName: name, currentTimer, allTasks }) => {
    console.log('User joined:', name);
    remotePeerId = userId;
    friendName = name;
    document.getElementById('friendName').textContent = friendName;
    document.getElementById('remoteLabel').textContent = friendName;
    document.getElementById('connectionIndicator').classList.remove('hidden');
    
    createPeerConnection(userId);
    
    if (currentTimer) {
        syncTimerState(currentTimer);
    }
    if (allTasks && allTasks[userId]) {
        friendTasks = allTasks[userId];
        renderFriendTasks();
    }
});

socket.on('user-left', (userId) => {
    console.log('User left:', userId);
    if (peerConnections.has(userId)) {
        peerConnections.get(userId).close();
        peerConnections.delete(userId);
    }
    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('remoteLabel').textContent = 'Waiting for friend...';
});

socket.on('webrtc-offer', async ({ offer, senderId }) => {
    console.log('Received offer from:', senderId);
    remotePeerId = senderId;
    
    const pc = createPeerConnection(senderId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('webrtc-answer', { 
        roomId, 
        answer, 
        targetId: senderId 
    });
});

socket.on('webrtc-answer', async ({ answer, senderId }) => {
    console.log('Received answer from:', senderId);
    const pc = peerConnections.get(senderId);
    if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('webrtc-ice-candidate', async ({ candidate, senderId }) => {
    const pc = peerConnections.get(senderId);
    if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('timer-sync', (timerState) => {
    syncTimerState(timerState);
});

socket.on('task-sync', ({ userId, tasks }) => {
    if (userId !== socket.id) {
        friendTasks = tasks;
        renderFriendTasks();
    }
});

// ============================================
// WebRTC
// ============================================

function createPeerConnection(peerId) {
    if (peerConnections.has(peerId)) {
        return peerConnections.get(peerId);
    }

    const pc = new RTCPeerConnection(config);
    peerConnections.set(peerId, pc);

    // Add local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    // Handle remote stream
    pc.ontrack = (event) => {
        console.log('Received remote track');
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            document.getElementById('connectionIndicator').classList.add('hidden');
        }
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-ice-candidate', {
                roomId,
                candidate: event.candidate,
                targetId: peerId
            });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('Connection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            document.getElementById('connectionIndicator').classList.add('hidden');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            document.getElementById('connectionIndicator').classList.remove('hidden');
        }
    };

    // Create offer if initiator
    if (peerId === remotePeerId) {
        pc.createOffer().then(offer => {
            return pc.setLocalDescription(offer);
        }).then(() => {
            socket.emit('webrtc-offer', {
                roomId,
                offer: pc.localDescription,
                targetId: peerId
            });
        });
    }

    return pc;
}

// ============================================
// Media Controls
// ============================================

function toggleAudio() {
    if (localStream) {
        audioEnabled = !audioEnabled;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = audioEnabled;
        });
        
        const btn = document.getElementById('toggleAudio');
        if (audioEnabled) {
            btn.classList.remove('muted');
        } else {
            btn.classList.add('muted');
        }
    }
}

function toggleVideo() {
    if (localStream) {
        videoEnabled = !videoEnabled;
        localStream.getVideoTracks().forEach(track => {
            track.enabled = videoEnabled;
        });
        
        const btn = document.getElementById('toggleVideo');
        if (videoEnabled) {
            btn.classList.remove('muted');
        } else {
            btn.classList.add('muted');
        }
    }
}

// ============================================
// Timer
// ============================================

function toggleTimer() {
    if (isRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
}

function startTimer() {
    isRunning = true;
    document.getElementById('startBtn').innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        <span>Pause</span>
    `;
    
    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
        
        if (timeLeft <= 0) {
            playNotificationSound();
            switchMode();
        }
    }, 1000);

    broadcastTimerState();
}

function pauseTimer() {
    isRunning = false;
    clearInterval(timerInterval);
    document.getElementById('startBtn').innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        <span>Start</span>
    `;
    broadcastTimerState();
}

function resetTimer() {
    pauseTimer();
    isBreak = false;
    const focusTime = parseInt(document.getElementById('focusTime').value);
    timeLeft = focusTime * 60;
    totalTime = focusTime * 60;
    updateTimerDisplay();
    document.getElementById('timerStatus').textContent = 'Ready to focus';
    broadcastTimerState();
}

function switchMode() {
    isBreak = !isBreak;
    
    if (isBreak) {
        const breakTime = parseInt(document.getElementById('breakTime').value);
        timeLeft = breakTime * 60;
        totalTime = breakTime * 60;
        document.getElementById('timerStatus').textContent = 'Break time! 🎉';
    } else {
        const focusTime = parseInt(document.getElementById('focusTime').value);
        timeLeft = focusTime * 60;
        totalTime = focusTime * 60;
        document.getElementById('timerStatus').textContent = 'Focus time! 💪';
    }
    
    updateTimerDisplay();
}

function updateTimerDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    document.getElementById('timerDisplay').textContent = 
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    const progress = ((totalTime - timeLeft) / totalTime) * 100;
    document.getElementById('progressBar').style.width = `${progress}%`;
}

function syncTimerState(state) {
    timeLeft = state.timeLeft;
    totalTime = state.totalTime;
    isBreak = state.isBreak;
    
    updateTimerDisplay();
    
    if (state.isRunning && !isRunning) {
        startTimer();
    } else if (!state.isRunning && isRunning) {
        pauseTimer();
    }
    
    document.getElementById('timerStatus').textContent = state.status;
}

function broadcastTimerState() {
    socket.emit('timer-update', {
        roomId,
        timerState: {
            timeLeft,
            totalTime,
            isRunning,
            isBreak,
            status: document.getElementById('timerStatus').textContent
        }
    });
}

function playNotificationSound() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Create a more pleasant chime sound
    [523.25, 659.25, 783.99].forEach((freq, i) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'sine';
        
        const startTime = audioContext.currentTime + (i * 0.15);
        gainNode.gain.setValueAtTime(0.2, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
        
        oscillator.start(startTime);
        oscillator.stop(startTime + 0.5);
    });
}

// ============================================
// Tasks
// ============================================

document.getElementById('myTaskInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addMyTask();
});

function addMyTask() {
    const input = document.getElementById('myTaskInput');
    const text = input.value.trim();
    
    if (text) {
        myTasks.push({
            id: Date.now(),
            text,
            completed: false
        });
        input.value = '';
        renderMyTasks();
        broadcastTasks();
    }
}

function toggleMyTask(id) {
    const task = myTasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        renderMyTasks();
        broadcastTasks();
    }
}

function deleteMyTask(id) {
    myTasks = myTasks.filter(t => t.id !== id);
    renderMyTasks();
    broadcastTasks();
}

function renderMyTasks() {
    const container = document.getElementById('myTasks');
    const count = document.getElementById('myTaskCount');
    
    count.textContent = myTasks.filter(t => !t.completed).length;
    
    if (myTasks.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No tasks yet. Add one above!</p>';
        return;
    }
    
    container.innerHTML = myTasks.map(task => `
        <div class="task-item ${task.completed ? 'completed' : ''}">
            <input type="checkbox" ${task.completed ? 'checked' : ''} 
                   onchange="toggleMyTask(${task.id})">
            <span class="task-text">${escapeHtml(task.text)}</span>
            <button class="task-delete" onclick="deleteMyTask(${task.id})">Delete</button>
        </div>
    `).join('');
}

function renderFriendTasks() {
    const container = document.getElementById('friendTasks');
    const count = document.getElementById('friendTaskCount');
    
    count.textContent = friendTasks.filter(t => !t.completed).length;
    
    if (friendTasks.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No tasks yet</p>';
        return;
    }
    
    container.innerHTML = friendTasks.map(task => `
        <div class="task-item ${task.completed ? 'completed' : ''}">
            <input type="checkbox" ${task.completed ? 'checked' : ''} disabled>
            <span class="task-text">${escapeHtml(task.text)}</span>
        </div>
    `).join('');
}

function broadcastTasks() {
    socket.emit('task-update', { roomId, tasks: myTasks });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Theme Toggle
// ============================================

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const icon = document.querySelector('.theme-icon');
    icon.textContent = document.body.classList.contains('dark-mode') ? '🌙' : '☀️';
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}

// Load saved theme
window.addEventListener('load', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-mode');
        document.querySelector('.theme-icon').textContent = '☀️';
    }
    
    // Check for room in URL
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
        document.getElementById('roomInput').value = room;
    }
});

// ============================================
// Utility
// ============================================

function copyRoomLink() {
    const link = document.getElementById('roomLink').textContent;
    navigator.clipboard.writeText(link).then(() => {
        const btn = event.target.closest('button');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        `;
        setTimeout(() => {
            btn.innerHTML = originalHTML;
        }, 2000);
    });
}
