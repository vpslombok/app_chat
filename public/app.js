// const selectedUserDiv = document.getElementById('selectedUser');
let selectedUserId = null;
let selectedUserName = null;


// Redirect ke login jika tidak ada token
// Tampilkan username login di sidebar
function setMyUsername() {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload && payload.username) {
            document.getElementById('myUsername').textContent = payload.username;
            // Avatar: huruf pertama username
            const firstChar = payload.username.charAt(0).toUpperCase();
            const avatar = document.getElementById('myAvatar');
            if (avatar) {
                // Buat avatar SVG
                const svg = `<svg width='40' height='40' xmlns='http://www.w3.org/2000/svg'><circle cx='20' cy='20' r='20' fill='#007bff'/><text x='50%' y='55%' text-anchor='middle' fill='white' font-size='22' font-family='Arial' dy='.3em'>${firstChar}</text></svg>`;
                avatar.src = 'data:image/svg+xml;base64,' + btoa(svg);
            }
        }
    } catch (e) {}
}
setMyUsername();
if (!localStorage.getItem('token')) {
    window.location.href = 'login.html';
}

// Chat & Call
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const messages = document.getElementById('messages');
const users = document.getElementById('users');
const logoutBtn = document.getElementById('logoutBtn');
const voiceCallBtn = document.getElementById('voiceCallBtn');
const videoCallBtn = document.getElementById('videoCallBtn');
const callContainer = document.getElementById('callContainer');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const endCallBtn = document.getElementById('endCallBtn');
const callModal = document.getElementById('callModal');
const closeCallModal = document.getElementById('closeCallModal');

const socket = io();

// Logout: redirect ke login.html
logoutBtn.onclick = () => {
    localStorage.removeItem('token');
    window.location.href = 'login.html';
    socket.emit('logout');
    endCall();
};

let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isVideo = false;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

logoutBtn.onclick = () => {
    localStorage.removeItem('token');
    window.location.href = 'login.html';
    socket.emit('logout');
    endCall();
};

messageForm.onsubmit = (e) => {
    e.preventDefault();
    const msg = messageInput.value;
    if (msg.trim() && selectedUserId) {
        socket.emit('privateMessage', { to: selectedUserId, text: msg });
        addMessage({ user: 'You', text: msg, time: new Date().toLocaleTimeString() });
        messageInput.value = '';
    } else if (!selectedUserId) {
        alert('Pilih user yang ingin diajak chat.');
    }
};

function addMessage(data) {
    const div = document.createElement('div');
    div.classList.add('message');
    div.innerHTML = `<span class="user">${data.user}</span> <span class="time">${data.time}</span><br>${data.text}`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

voiceCallBtn.onclick = () => startCall(false);
videoCallBtn.onclick = () => startCall(true);
endCallBtn.onclick = endCall;
if (closeCallModal) closeCallModal.onclick = endCall;

function startCall(video) {
    isVideo = video;
    navigator.mediaDevices.getUserMedia({ audio: true, video: video })
        .then(stream => {
            localStream = stream;
            if (video) {
                localVideo.srcObject = stream;
                localVideo.style.display = 'block';
            } else {
                localVideo.style.display = 'none';
            }
            if (callModal) callModal.style.display = 'flex';
            callContainer.style.display = 'flex';
            // Sembunyikan tombol terima/tolak di pemanggil
            const callActionBtns = document.getElementById('callActionBtns');
            if (callActionBtns) callActionBtns.style.display = 'none';
            peerConnection = new RTCPeerConnection(rtcConfig);
            stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));
            peerConnection.ontrack = (event) => {
                if (!remoteStream) {
                    remoteStream = new MediaStream();
                    remoteVideo.srcObject = remoteStream;
                }
                remoteStream.addTrack(event.track);
            };
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('webrtc-candidate', { candidate: event.candidate });
                }
            };
            peerConnection.createOffer().then(offer => {
                peerConnection.setLocalDescription(offer);
                socket.emit('webrtc-offer', { offer, video, to: selectedUserName });
            });
        })
        .catch(() => alert('Tidak bisa mengakses media.'));
}

function endCall() {
    if (peerConnection) peerConnection.close();
    peerConnection = null;
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    remoteStream = null;
    callContainer.style.display = 'none';
    if (callModal) callModal.style.display = 'none';
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    socket.emit('webrtc-end');
}

// WebRTC signaling
socket.on('webrtc-offer', ({ offer, from, video }) => {
    isVideo = video;
    // Tampilkan modal panggilan baru untuk penerima
    if (callModal) {
        callModal.style.display = 'flex';
    }
    callContainer.style.display = 'flex';
    // Tampilkan tombol terima/tolak
    const callActionBtns = document.getElementById('callActionBtns');
    if (callActionBtns) callActionBtns.style.display = 'flex';
    // Default: jangan langsung aktifkan media sebelum diterima
    let mediaReady = false;
    function acceptCall() {
        mediaReady = true;
        navigator.mediaDevices.getUserMedia({ audio: true, video: video })
            .then(stream => {
                localStream = stream;
                if (video) {
                    localVideo.srcObject = stream;
                    localVideo.style.display = 'block';
                } else {
                    localVideo.style.display = 'none';
                }
                peerConnection = new RTCPeerConnection(rtcConfig);
                stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));
                peerConnection.ontrack = (event) => {
                    if (!remoteStream) {
                        remoteStream = new MediaStream();
                        remoteVideo.srcObject = remoteStream;
                    }
                    remoteStream.addTrack(event.track);
                };
                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        socket.emit('webrtc-candidate', { candidate: event.candidate });
                    }
                };
                peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                peerConnection.createAnswer().then(answer => {
                    peerConnection.setLocalDescription(answer);
                    socket.emit('webrtc-answer', { answer });
                });
            })
            .catch(() => alert('Tidak bisa mengakses media.'));
        if (callActionBtns) callActionBtns.style.display = 'none';
    }
    function rejectCall() {
        if (callModal) callModal.style.display = 'none';
        callContainer.style.display = 'none';
        if (callActionBtns) callActionBtns.style.display = 'none';
        socket.emit('webrtc-end');
    }
    // Event tombol
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    if (acceptBtn) {
        acceptBtn.onclick = acceptCall;
    }
    if (rejectBtn) {
        rejectBtn.onclick = rejectCall;
    }
});

socket.on('webrtc-answer', ({ answer }) => {
    if (peerConnection) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('webrtc-candidate', ({ candidate }) => {
    if (peerConnection) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('webrtc-end', () => {
    endCall();
    // alert('Panggilan berakhir.');
});

socket.on('connect', () => {
    const token = localStorage.getItem('token');
    if (token) {
        socket.emit('join', { token });
        // Request userList langsung setelah join untuk memastikan sidebar selalu terisi
        socket.emit('getUserList');
    } else {
        window.location.href = 'login.html';
    }
// Pastikan frontend bisa request userList manual jika diperlukan
socket.on('userList', (userList) => {
    // ...existing code for rendering userList...
});
});

socket.on('privateMessage', (data) => {
    addMessage(data);
});

// userList: array of { id, name }
socket.on('userList', (userList) => {
    users.innerHTML = '';
    // Ambil username login dari token
    let myUsername = '';
    const token = localStorage.getItem('token');
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if (payload && payload.username) myUsername = payload.username;
        } catch (e) {}
    }
    // Tampilkan user secara realtime
    userList.forEach(u => {
        if (!u.name) return;
        if (u.name === myUsername) return;
        const li = document.createElement('li');
        li.className = 'd-flex align-items-center py-2 px-3 mb-1 rounded user-list-item';
        li.style.cursor = 'pointer';
        // Avatar: huruf pertama username
        const avatar = document.createElement('span');
        avatar.className = 'user-avatar mr-2';
        avatar.style.width = '32px';
        avatar.style.height = '32px';
        avatar.style.display = 'inline-flex';
        avatar.style.alignItems = 'center';
        avatar.style.justifyContent = 'center';
        avatar.style.borderRadius = '50%';
        avatar.style.background = u.online ? '#007bff' : '#bbb';
        avatar.style.color = '#fff';
        avatar.style.fontWeight = 'bold';
        avatar.style.fontSize = '1.1rem';
        avatar.textContent = u.name.charAt(0).toUpperCase();
        li.appendChild(avatar);
        // Username & status
        const info = document.createElement('div');
        info.className = 'flex-grow-1';
        const uname = document.createElement('div');
        uname.className = 'font-weight-bold';
        uname.textContent = u.name;
        info.appendChild(uname);
        const status = document.createElement('div');
        status.className = 'small';
        if (u.online) {
            status.textContent = 'Online';
            status.style.color = '#4caf50';
        } else if (u.lastSeen) {
            status.textContent = 'Last seen: ' + u.lastSeen;
            status.style.color = '#888';
        } else {
            status.textContent = 'Offline';
            status.style.color = '#888';
        }
        info.appendChild(status);
        li.appendChild(info);
        li.onclick = () => {
            selectedUserId = u.id;
            selectedUserName = u.name;
            document.getElementById('chatUsername').textContent = u.name;
            document.getElementById('chatStatus').textContent = u.online ? 'Online' : (u.lastSeen ? 'Last seen: ' + u.lastSeen : 'Offline');
            messages.innerHTML = '';
            socket.emit('getHistory', { withUser: u.name });
        };
        users.appendChild(li);
    });
    // Pastikan update realtime: listen event userList setiap kali ada perubahan
    // (Sudah otomatis karena socket.io emit dari backend setiap perubahan status user)
// Tangani riwayat chat dengan baik
socket.on('chatHistory', (rows) => {
    messages.innerHTML = '';
    if (Array.isArray(rows) && rows.length > 0) {
        rows.forEach(msg => {
            addMessage({
                user: msg.fromUser === selectedUserName ? selectedUserName : 'You',
                text: msg.text,
                time: msg.time
            });
        });
    } else {
        const div = document.createElement('div');
        div.classList.add('message');
        div.textContent = 'Belum ada riwayat chat.';
        messages.appendChild(div);
    }
});
    // Reset selection jika user tidak ditemukan
    if (!userList.some(u => u.id === selectedUserId)) {
        selectedUserId = null;
        selectedUserName = null;
        document.getElementById('chatUsername').textContent = 'Pilih user untuk mulai chat';
        document.getElementById('chatStatus').textContent = '';
        messages.innerHTML = '';
    }
});

socket.on('forceLogout', () => {
    localStorage.removeItem('token');
    alert('Sesi Anda telah berakhir. Silakan login kembali.');
    window.location.href = 'login.html';
});
