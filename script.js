// --- STATE MANAGEMENT ---
let currentUser = JSON.parse(localStorage.getItem('soulUser')) || null;

// UI Helpers
function setLoading(show, text = "Synchronizing") {
    const loader = document.getElementById('globalLoader');
    const txt = document.getElementById('loaderText');
    if (loader) {
        if (show) {
            txt.innerText = text;
            loader.classList.remove('hidden');
        } else {
            loader.classList.add('hidden');
        }
    }
}
let aiConfig = { keys: [], models: [] };
let currentKeyIndex = 0;
let pendingFiles = [];
let notes = [];
let aiConversations = [];
let selectedConversations = new Set();
let currentChatId = null;
let musicList = [];
let selectedTracks = new Set();
let currentTrackIndex = 0;
let audioPlayer = new Audio();
let isMusicPlaying = false;
let playMode = 'online'; // 'online' or 'offline'
let isVideoMode = false;
let ytPlayer = null;
let ytProgressInterval = null;

// --- MARKDOWN & MATH INIT ---
function renderMD(text) {
    const raw = marked.parse(text);
    const div = document.createElement('div');
    div.innerHTML = raw;
    renderMathInElement(div, {
        delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false}
        ],
        throwOnError : false
    });
    return div.innerHTML;
}

// --- GLOBAL ENTER KEY LISTENER ---
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        const active = document.activeElement;
        if (active.id === 'chatInput') {
            e.preventDefault();
            askAI();
            return;
        }
        if (active.id === 'miniChatInput') {
            e.preventDefault();
            askMiniAI();
            return;
        }
        if (active.id === 'authPass' || active.id === 'authEmail') handleAuth();
        if (active.id === 'donAmount' || active.id === 'donRemark') payNow();
    }
});

// Toggle Password Visibility
function togglePasswordVisibility(id, btn) {
    const input = document.getElementById(id);
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// Markdown Helper
function wrapText(elId, before, after) {
    const el = document.getElementById(elId);
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const selected = text.substring(start, end);
    el.value = text.substring(0, start) + before + selected + after + text.substring(end);
    el.focus();
    el.selectionStart = start + before.length;
    el.selectionEnd = end + before.length;
    if (elId === 'editNoteText') {
        document.getElementById('notePreview').innerHTML = renderMD(el.value);
    }
}

// Smart Bullets for Note Input
document.addEventListener('input', (e) => {
    if (e.target.id === 'noteInput' || e.target.id === 'editNoteText') {
        const val = e.target.value;
        const lastChar = val[val.length - 1];
        if (lastChar === '\n') {
            const lines = val.split('\n');
            const prevLine = lines[lines.length - 2];
            if (prevLine.trim().startsWith('- ')) e.target.value += '- ';
            if (prevLine.trim().startsWith('* ')) e.target.value += '* ';
            if (prevLine.trim().match(/^\d+\. /)) {
                const num = parseInt(prevLine.match(/^\d+/)[0]);
                e.target.value += `${num + 1}. `;
            }
        }
        if (e.target.id === 'editNoteText') {
            document.getElementById('notePreview').innerHTML = renderMD(e.target.value);
        }
    }
});

// --- NAVIGATION ---
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(pageId);
    if(page) page.classList.add('active');
    
    if (pageId === 'dashboard') loadDashboard();
    
    // Close sidebar on navigation (mobile)
    const sidebar = document.getElementById('mobileSidebar');
    if (sidebar && sidebar.classList.contains('translate-x-0')) toggleSidebar();
    
    window.scrollTo(0, 0);
}

function loadDashboard() {
    if (!currentUser) return showPage('login');
    document.getElementById('dashWelcome').innerText = `Hello, ${currentUser.name}`;
    document.getElementById('dashAvatar').innerText = currentUser.name.charAt(0).toUpperCase();
    document.getElementById('dashName').value = currentUser.name;
    document.getElementById('dashEmail').value = currentUser.email;
    document.getElementById('dashStatNotes').innerText = notes.length;
    document.getElementById('dashStatAI').innerText = aiConversations.length;
}

async function updateUserProfile() {
    const name = document.getElementById('dashName').value;
    const password = document.getElementById('dashPass').value;
    
    if (!name) return alert("Name cannot be empty");

    setLoading(true, "Updating Profile");
    try {
        const res = await fetch(`/api/main?route=auth&email=${currentUser.email}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password: password || undefined })
        });
        
        if (res.ok) {
            currentUser.name = name;
            localStorage.setItem('soulUser', JSON.stringify(currentUser));
            updateAuthUI();
            alert("Profile updated successfully!");
            document.getElementById('dashPass').value = '';
        } else {
            const data = await res.json();
            throw new Error(data.error || "Failed to update profile");
        }
    } catch (e) {
        alert(e.message);
    } finally {
        setLoading(false);
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('mobileSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isOpen = sidebar.classList.contains('translate-x-0');
    
    if (isOpen) {
        sidebar.classList.remove('translate-x-0');
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    } else {
        sidebar.classList.add('translate-x-0');
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    }
}

// --- AUTH LOGIC ---
let isLoginMode = true;
function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('authTitle');
    const subtitle = document.getElementById('authSubtitle');
    const btn = document.getElementById('authMainBtn');
    const toggle = document.getElementById('authToggle');
    const regFields = document.getElementById('regFields');

    if (isLoginMode) {
        title.innerText = 'Welcome Back';
        subtitle.innerText = 'Please enter your details to sign in.';
        btn.innerText = 'Sign In';
        toggle.innerText = "Don't have an account? Create one";
        regFields.classList.add('hidden');
    } else {
        title.innerText = 'Create Account';
        subtitle.innerText = 'Join the vision. It only takes a minute.';
        btn.innerText = 'Register Now';
        toggle.innerText = "Already have an account? Sign In";
        regFields.classList.remove('hidden');
    }
}

async function handleAuth() {
    const email = document.getElementById('authEmail').value;
    const pass = document.getElementById('authPass').value;
    const nameInput = document.getElementById('authName').value;
    
    if (!email || !pass) return alert("Fill all fields");
    if (!isLoginMode && !nameInput) return alert("Name is required for registration");

    setLoading(true, isLoginMode ? "Signing In" : "Creating Account");
    const mode = isLoginMode ? 'login' : 'register';
    const name = isLoginMode ? email.split('@')[0] : nameInput;

    try {
        const response = await fetch(`/api/main?route=auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass, name, mode })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Authentication failed");

        currentUser = data;
        localStorage.setItem('soulUser', JSON.stringify(currentUser));
        updateAuthUI();
        await syncAllData();
        showPage('home');
    } catch (err) {
        alert(err.message);
    } finally {
        setLoading(false);
    }
}

async function syncAllData() {
    if (!currentUser) return;
    setLoading(true, "Synchronizing Data");
    try {
        await Promise.all([
            syncNotes(),
            syncAIHistory(),
            syncFunStats(),
            syncCricketHistory()
        ]);
    } finally {
        setLoading(false);
    }
}

function updateAuthUI() {
    const adminBtn = document.getElementById('adminBtn');
    const adminBtnSide = document.getElementById('adminBtnSide');
    const dashBtn = document.getElementById('dashboardBtn');
    const dashBtnSide = document.getElementById('dashboardBtnSide');
    
    if (currentUser) {
        document.getElementById('userNameDisplay').innerText = `Hey, ${currentUser.name}`;
        document.getElementById('authBtn').innerText = 'Logout';
        document.getElementById('authBtn').onclick = logout;
        dashBtn?.classList.remove('hidden');
        dashBtnSide?.classList.remove('hidden');
        if(currentUser.isAdmin) {
            adminBtn?.classList.remove('hidden');
            adminBtnSide?.classList.remove('hidden');
        }
    } else {
        dashBtn?.classList.add('hidden');
        dashBtnSide?.classList.add('hidden');
        document.getElementById('userNameDisplay').innerText = '';
        document.getElementById('authBtn').innerText = 'Login';
        document.getElementById('authBtn').onclick = () => showPage('login');
        adminBtn?.classList.add('hidden');
        adminBtnSide?.classList.add('hidden');
    }
}

function logout() {
    currentUser = null;
    notes = [];
    renderNotes();
    localStorage.removeItem('soulUser');
    updateAuthUI();
    showPage('login');
}

// --- NOTES LOGIC ---
async function addNote() {
    if (!currentUser) return alert("Login to save notes!");
    const input = document.getElementById('noteInput');
    if (!input.value.trim()) return;
    const note = { id: Date.now(), text: input.value, userId: currentUser.email };
    
    notes.unshift(note);
    renderNotes();
    input.value = '';
    await saveNotesToDB(note);
}

function renderNotes() {
    const list = document.getElementById('notesList');
    list.innerHTML = notes.map(n => `
        <div class="glass p-5 rounded-xl border border-white/5 flex flex-col justify-between group">
            <div class="prose prose-invert prose-sm max-h-48 overflow-hidden mb-4">
                ${renderMD(n.text)}
            </div>
            <div class="flex justify-between items-center text-xs text-gray-500 pt-4 border-t border-white/5">
                <span>${new Date(n.id).toLocaleDateString()}</span>
                <div class="flex gap-3">
                    <button onclick="openNote('${n.id}')" class="text-cyan-400 opacity-0 group-hover:opacity-100 transition"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteNote('${n.id}')" class="text-red-400 hover:text-red-300"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
        </div>
    `).join('');
}

function openNote(id) {
    id = Number(id);
    const note = notes.find(n => n.id === id);
    if (!note) return;
    document.getElementById('editNoteId').value = id;
    document.getElementById('editNoteText').value = note.text;
    document.getElementById('notePreview').innerHTML = renderMD(note.text);
    document.getElementById('noteModal').classList.remove('hidden');
}

function closeNoteModal() {
    document.getElementById('noteModal').classList.add('hidden');
}

async function saveEditedNote() {
    const id = parseInt(document.getElementById('editNoteId').value);
    const text = document.getElementById('editNoteText').value;
    const noteIdx = notes.findIndex(n => n.id === id);
    if (noteIdx > -1) {
        notes[noteIdx].text = text;
        renderNotes();
        closeNoteModal();
        setLoading(true, "Updating Note");
        try {
            await fetch(`/api/main?route=notes&id=${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
        } finally {
            setLoading(false);
        }
    }
}

async function deleteNote(id) {
    id = Number(id);
    if(!confirm("Delete this note?")) return;
    notes = notes.filter(n => n.id !== id);
    renderNotes();
    setLoading(true, "Deleting Note");
    try {
        await fetch(`/api/main?route=notes&id=${id}`, { method: 'DELETE' });
    } finally {
        setLoading(false);
    }
}

async function syncNotes(silent = true) {
    if(!currentUser) {
        if(!silent) alert("Login to sync notes!");
        return;
    }
    const res = await fetch(`/api/main?route=notes&userId=${encodeURIComponent(currentUser.email)}`);
    const data = await res.json();
    if(Array.isArray(data)) {
        notes = data;
        renderNotes();
    }
}

async function saveNotesToDB(note) {
    if(!currentUser) return false;
    try {
        const res = await fetch('/api/main?route=notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(note)
        });
        return res.ok;
    } catch (e) {
        console.error("Failed to save note", e);
        return false;
    }
}

// --- RANDOMIZER LOGIC ---
async function saveRandomHistory(type, value) {
    if (!currentUser) return;
    await fetch(`/api/main?route=random_history&userId=${encodeURIComponent(currentUser.email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value })
    });
}

async function genRandomNum() {
    const min = parseInt(document.getElementById('randMin').value);
    const max = parseInt(document.getElementById('randMax').value);
    const res = Math.floor(Math.random() * (max - min + 1)) + min;
    document.getElementById('numResult').innerText = res;
    await saveRandomHistory('number', res);
}

async function genRandomColor() {
    const color = '#' + Math.floor(Math.random()*16777215).toString(16);
    document.getElementById('colorPreview').style.backgroundColor = color;
    document.getElementById('colorHex').innerText = color.toUpperCase();
    await saveRandomHistory('color', color.toUpperCase());
}

async function pickRandom() {
    const raw = document.getElementById('randChoices').value;
    const choices = raw.split(',').map(c => c.trim()).filter(c => c);
    if(!choices.length) return;
    const res = choices[Math.floor(Math.random() * choices.length)];
    document.getElementById('choiceResult').innerText = res;
    await saveRandomHistory('choice', res);
}

// --- MUSIC PLAYER LOGIC ---
// YouTube API Init
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    ytPlayer = new YT.Player('youtubePlayer', {
        height: '100%',
        width: '100%',
        playerVars: {
            'autoplay': 0,
            'controls': 0,
            'disablekb': 1,
            'fs': 0,
            'rel': 0,
            'modestbranding': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    if (musicList.length > 0 && musicList[currentTrackIndex].type === 'youtube') {
        // Ready
    }
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
        isMusicPlaying = true;
        startYTProgress();
        updateMusicUI();
    } else if (event.data === YT.PlayerState.PAUSED) {
        isMusicPlaying = false;
        stopYTProgress();
        updateMusicUI();
    } else if (event.data === YT.PlayerState.ENDED) {
        if (!isRepeat) musicNext();
    }
}

function startYTProgress() {
    stopYTProgress();
    ytProgressInterval = setInterval(() => {
        if (ytPlayer && ytPlayer.getCurrentTime) {
            const cur = ytPlayer.getCurrentTime();
            const dur = ytPlayer.getDuration();
            const prog = document.getElementById('musicProgress');
            if (dur > 0) {
                prog.value = (cur / dur) * 100;
                document.getElementById('currentTime').innerText = formatTime(cur);
                document.getElementById('durationTime').innerText = formatTime(dur);
            }
        }
    }, 500);
}

function stopYTProgress() {
    if (ytProgressInterval) clearInterval(ytProgressInterval);
}

function setPlayMode(mode) {
    playMode = mode;
    const onlineBtn = document.getElementById('modeOnline');
    const offlineBtn = document.getElementById('modeOffline');
    const searchBox = document.getElementById('ytResultsContainer');
    const addBtn = document.getElementById('addLocalBtn');

    if (mode === 'online') {
        onlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all bg-cyan-600 text-white";
        offlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all text-gray-400";
        searchBox.classList.remove('hidden');
        addBtn.classList.add('hidden');
    } else {
        offlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all bg-cyan-600 text-white";
        onlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all text-gray-400";
        searchBox.classList.add('hidden');
        addBtn.classList.remove('hidden');
    }
}

function toggleVisualMode() {
    isVideoMode = !isVideoMode;
    const disk = document.getElementById('vinylDisk');
    const player = document.getElementById('ytPlayerContainer');
    const btn = document.getElementById('visualModeBtn');

    if (isVideoMode) {
        disk.classList.add('opacity-0');
        player.classList.remove('opacity-0');
        btn.innerHTML = '<i class="fas fa-music mr-1"></i> AUDIO MODE';
        btn.classList.replace('bg-black/60', 'bg-cyan-600');
    } else {
        disk.classList.remove('opacity-0');
        player.classList.add('opacity-0');
        btn.innerHTML = '<i class="fas fa-eye mr-1"></i> VIDEO MODE';
        btn.classList.replace('bg-cyan-600', 'bg-black/60');
    }
}

function handleSearchOrUrl() {
    const input = document.getElementById('ytSearchInput').value.trim();
    if (!input) return;

    // Detect YouTube URL
    const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = input.match(ytRegex);

    if (match) {
        const videoId = match[1];
        const title = prompt("Enter track title:", "YouTube Video") || "YouTube Video";
        addYTTrack(videoId, title, "URL Source");
        document.getElementById('ytSearchInput').value = '';
    } else if (input.startsWith('http') && (input.toLowerCase().includes('.mp3') || input.toLowerCase().includes('.wav') || input.toLowerCase().includes('.ogg') || input.toLowerCase().includes('.m4a'))) {
        // Direct Audio URL
        const defaultName = input.split('/').pop().split('?')[0] || "Audio Stream";
        const name = prompt("Enter track title:", defaultName) || defaultName;
        const track = { name, url: input, artist: "External URL" };
        const newIdx = musicList.length;
        musicList.push(track);
        if (isShuffle) shuffledIndices.push(newIdx);
        renderPlaylist();
        if (musicList.length === 1) playTrack(0);
        document.getElementById('ytSearchInput').value = '';
    } else {
        searchYT();
    }
}

async function searchYT() {
    const query = document.getElementById('ytSearchInput').value;
    if (!query) return;
    const list = document.getElementById('ytResultsList');
    list.innerHTML = '<div class="text-center p-4"><i class="fas fa-spinner fa-spin text-cyan-500"></i></div>';

    try {
        const res = await fetch(`/api/main?route=yt_search&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        list.innerHTML = data.map(v => `
            <div onclick="addYTTrack('${v.videoId}', '${v.title.replace(/'/g, "\\'")}', '${v.author.name.replace(/'/g, "\\'")}')" class="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 cursor-pointer group transition">
                <img src="${v.thumbnail}" class="w-12 h-12 rounded-lg object-cover shadow-lg">
                <div class="flex-grow overflow-hidden">
                    <p class="text-xs font-bold truncate">${v.title}</p>
                    <p class="text-[10px] text-gray-500">${v.author.name} • ${v.duration.timestamp}</p>
                </div>
                <i class="fas fa-plus text-cyan-500 opacity-0 group-hover:opacity-100 transition"></i>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<p class="text-red-500 text-xs">Search failed.</p>';
    }
}

function addYTTrack(id, title, artist) {
    const track = { type: 'youtube', id, name: title, artist: artist };
    const newIdx = musicList.length;
    musicList.push(track);
    if (isShuffle) shuffledIndices.push(newIdx);
    renderPlaylist();
    if (musicList.length === 1) playTrack(0);
}

let isShuffle = false;
let shuffledIndices = [];
let isRepeat = false;
let audioContext, analyser, dataArray, source;
let eqBands = {};

function initAudioContext() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    source = audioContext.createMediaElementSource(audioPlayer);
    
    // Equalizer Bands
    const freqs = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
    let lastNode = source;
    freqs.forEach(freq => {
        const filter = audioContext.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = 0;
        lastNode.connect(filter);
        lastNode = filter;
        eqBands[freq] = filter;
    });

    lastNode.connect(analyser);
    analyser.connect(audioContext.destination);
    analyser.fftSize = 64;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    drawVisualizer();
}

function drawVisualizer() {
    const canvas = document.getElementById('musicVisualizer');
    if (!canvas) return;
    
    // Set internal resolution to match display size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const ctx = canvas.getContext('2d');
    const render = () => {
        requestAnimationFrame(render);
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / dataArray.length) * 2.5;
        let x = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            ctx.fillStyle = `rgba(6, 182, 212, ${dataArray[i]/255})`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    };
    render();
}

function loadMusic(e) {
    const files = Array.from(e.target.files);
    const startIndex = musicList.length;
    const newTracks = files.map(f => ({ name: f.name.replace(/\.[^/.]+$/, ""), url: URL.createObjectURL(f) }));
    musicList = [...musicList, ...newTracks];
    
    if (isShuffle) {
        const newIndices = newTracks.map((_, i) => startIndex + i);
        shuffledIndices = [...shuffledIndices, ...newIndices];
    }
    
    renderPlaylist();
    if(musicList.length > 0 && !audioPlayer.src) playTrack(0);
}

function renderPlaylist() {
    const container = document.getElementById('playlistContainer');
    const bulkBar = document.getElementById('musicBulkActions');
    const shuffleTag = isShuffle ? '<span class="text-[8px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded ml-2 font-bold tracking-widest animate-pulse">SHUFFLE ON</span>' : '';
    const repeatTag = isRepeat ? '<span class="text-[8px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded ml-2 font-bold tracking-widest animate-pulse">REPEAT ON</span>' : '';
    
    if (musicList.length === 0) {
        container.innerHTML = `<p class="text-[10px] text-gray-500 italic">No tracks added yet.</p>`;
        bulkBar.classList.add('hidden');
        selectedTracks.clear();
        return;
    }

    bulkBar.classList.remove('hidden');
    document.getElementById('musicSelectionCount').innerText = `${selectedTracks.size} selected`;
    document.getElementById('selectAllMusic').checked = (selectedTracks.size === musicList.length && musicList.length > 0);

    const displayIndices = isShuffle ? shuffledIndices : musicList.map((_, i) => i);

    container.innerHTML = `
        <div class="flex gap-1 mb-3">${shuffleTag}${repeatTag}</div>
        ${displayIndices.map((originalIdx, displayIdx) => {
            const t = musicList[originalIdx];
            const isActive = originalIdx === currentTrackIndex;
            const isSelected = selectedTracks.has(originalIdx);
            return `
                <div class="flex items-center gap-3 p-2 rounded-lg group hover:bg-white/5 transition ${isActive ? 'bg-cyan-500/10 border border-cyan-500/20' : ''}">
                    <input type="checkbox" class="accent-cyan-500" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleTrackSelection(${originalIdx})">
                    <div onclick="playTrack(${originalIdx})" class="w-6 h-6 flex items-center justify-center bg-black/20 rounded text-[10px] font-mono cursor-pointer">${displayIdx + 1}</div>
                    <div onclick="playTrack(${originalIdx})" class="flex flex-col flex-grow overflow-hidden cursor-pointer">
                        <span class="text-xs truncate ${isActive ? 'text-cyan-400 font-bold' : 'text-gray-300'}">${t.name}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        ${isActive && isMusicPlaying ? '<div class="playing-bars"><span></span><span></span><span></span></div>' : ''}
                        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                            ${!isShuffle ? `
                                <button onclick="moveTrack(${originalIdx}, -1)" class="text-[10px] text-gray-500 hover:text-cyan-400" title="Move Up"><i class="fas fa-chevron-up"></i></button>
                                <button onclick="moveTrack(${originalIdx}, 1)" class="text-[10px] text-gray-500 hover:text-cyan-400" title="Move Down"><i class="fas fa-chevron-down"></i></button>
                            ` : ''}
                            <button onclick="renameTrack(${originalIdx})" class="text-[10px] text-gray-500 hover:text-cyan-400" title="Rename"><i class="fas fa-edit"></i></button>
                            <button onclick="deleteTrack(${originalIdx})" class="text-[10px] text-gray-500 hover:text-red-400" title="Delete"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

function toggleTrackSelection(idx) {
    if (selectedTracks.has(idx)) selectedTracks.delete(idx);
    else selectedTracks.add(idx);
    renderPlaylist();
}

function selectAllTracks(checked) {
    if (checked) {
        musicList.forEach((_, i) => selectedTracks.add(i));
    } else {
        selectedTracks.clear();
    }
    renderPlaylist();
}

function deleteSelectedTracks() {
    if (selectedTracks.size === 0) return;
    if (!confirm(`Delete ${selectedTracks.size} tracks?`)) return;
    
    const sortedToKeep = musicList.filter((_, i) => !selectedTracks.has(i));
    
    // Revoke blobs for deleted tracks
    musicList.forEach((t, i) => {
        if (selectedTracks.has(i) && t.url && t.url.startsWith('blob:')) {
            URL.revokeObjectURL(t.url);
        }
    });

    const currentTrack = musicList[currentTrackIndex];
    musicList = sortedToKeep;
    selectedTracks.clear();
    
    // Re-index shuffle if active
    if (isShuffle) {
        shuffledIndices = musicList.map((_, i) => i);
        // ... re-shuffle ... (simplified for now)
    }

    if (musicList.length === 0) {
        audioPlayer.pause(); audioPlayer.src = ''; isMusicPlaying = false;
        document.getElementById('trackName').innerText = "No Track Loaded";
    } else {
        const newIdx = musicList.indexOf(currentTrack);
        currentTrackIndex = newIdx > -1 ? newIdx : 0;
        if (newIdx === -1) playTrack(0);
    }
    
    renderPlaylist();
    updateMusicUI();
}

function deleteTrack(index) {
    const isCurrent = (index === currentTrackIndex);
    if (musicList[index].url && musicList[index].url.startsWith('blob:')) {
        URL.revokeObjectURL(musicList[index].url);
    }
    
    musicList.splice(index, 1);
    
    if (isShuffle) {
        shuffledIndices = shuffledIndices.filter(i => i !== index).map(i => i > index ? i - 1 : i);
    }
    
    if (musicList.length === 0) {
        audioPlayer.pause();
        audioPlayer.src = '';
        isMusicPlaying = false;
        shuffledIndices = [];
        document.getElementById('trackName').innerText = "No Track Loaded";
        document.getElementById('artistName').innerText = "Upload local tracks to begin";
        updateMusicUI();
    } else if (isCurrent) {
        let nextToPlay = index % musicList.length;
        if (isShuffle && shuffledIndices.length > 0) {
            nextToPlay = shuffledIndices[0];
        }
        playTrack(nextToPlay);
    } else if (index < currentTrackIndex) {
        currentTrackIndex--;
    }
    renderPlaylist();
}

function renameTrack(index) {
    const newName = prompt("Rename track:", musicList[index].name);
    if (newName && newName.trim()) {
        musicList[index].name = newName.trim();
        if (index === currentTrackIndex) {
            document.getElementById('trackName').innerText = newName.trim();
        }
        renderPlaylist();
    }
}

function playTrack(index) {
    if (index < 0 || index >= musicList.length) return;
    currentTrackIndex = index;
    const track = musicList[index];

    // Reset both players
    audioPlayer.pause();
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    stopYTProgress();

    document.getElementById('trackName').innerText = track.name;
    document.getElementById('artistName').innerText = track.artist || "Local Storage Track";

    if (track.type === 'youtube') {
        if (ytPlayer && ytPlayer.loadVideoById) {
            ytPlayer.loadVideoById(track.id);
            ytPlayer.playVideo();
            isMusicPlaying = true;
        }
    } else {
        initAudioContext();
        if (audioContext.state === 'suspended') audioContext.resume();
        audioPlayer.src = track.url;
        audioPlayer.play().catch(e => console.log("Playback blocked"));
        isMusicPlaying = true;
    }
    
    updateMusicUI();
    renderPlaylist();
}

function toggleMusic() {
    const track = musicList[currentTrackIndex];
    if (!track) return;

    if (track.type === 'youtube') {
        const state = ytPlayer.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
            ytPlayer.pauseVideo();
            isMusicPlaying = false;
        } else {
            ytPlayer.playVideo();
            isMusicPlaying = true;
        }
    } else {
        if (!audioPlayer.src) return;
        if (audioContext && audioContext.state === 'suspended') audioContext.resume();
        if (isMusicPlaying) audioPlayer.pause();
        else audioPlayer.play();
        isMusicPlaying = !isMusicPlaying;
    }
    updateMusicUI();
    renderPlaylist();
}

function musicNext() {
    if(musicList.length === 0) return;
    if(isShuffle && shuffledIndices.length > 0) {
        let currentDisplayIdx = shuffledIndices.indexOf(currentTrackIndex);
        let nextDisplayIdx = (currentDisplayIdx + 1) % shuffledIndices.length;
        playTrack(shuffledIndices[nextDisplayIdx]);
    } else {
        playTrack((currentTrackIndex + 1) % musicList.length);
    }
}

function musicPrev() {
    if(musicList.length === 0) return;
    if(isShuffle && shuffledIndices.length > 0) {
        let currentDisplayIdx = shuffledIndices.indexOf(currentTrackIndex);
        let prevDisplayIdx = (currentDisplayIdx - 1 + shuffledIndices.length) % shuffledIndices.length;
        playTrack(shuffledIndices[prevDisplayIdx]);
    } else {
        playTrack((currentTrackIndex - 1 + musicList.length) % musicList.length);
    }
}

function musicSkip(seconds) {
    const track = musicList[currentTrackIndex];
    if (track && track.type === 'youtube') {
        if (ytPlayer && ytPlayer.getCurrentTime) {
            ytPlayer.seekTo(ytPlayer.getCurrentTime() + seconds, true);
        }
    } else {
        audioPlayer.currentTime += seconds;
    }
}

function setPlaybackSpeed(speed) {
    const track = musicList[currentTrackIndex];
    if (track && track.type === 'youtube') {
        if (ytPlayer && ytPlayer.setPlaybackRate) {
            ytPlayer.setPlaybackRate(parseFloat(speed));
        }
    } else {
        audioPlayer.playbackRate = parseFloat(speed);
    }
}

function toggleFullScreen(id) {
    const el = document.getElementById(id);
    if (!document.fullscreenElement) {
        el.requestFullscreen().catch(err => {
            alert(`Error attempting to enable full-screen mode: ${err.message}`);
        });
    } else {
        document.exitFullscreen();
    }
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    if (isShuffle && musicList.length > 0) {
        shuffledIndices = musicList.map((_, i) => i);
        for (let i = shuffledIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
        }
    }
    document.getElementById('shuffleBtn').classList.toggle('control-active', isShuffle);
    renderPlaylist();
}

function toggleRepeat() {
    isRepeat = !isRepeat;
    audioPlayer.loop = isRepeat;
    document.getElementById('repeatBtn').classList.toggle('control-active', isRepeat);
    renderPlaylist();
}

function setEQ(preset) {
    document.querySelectorAll('.eq-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    
    const settings = {
        normal: { 60:0, 170:0, 310:0, 600:0, 1000:0, 3000:0, 6000:0, 12000:0, 14000:0, 16000:0 },
        bass: { 60:10, 170:8, 310:4, 600:0, 1000:0, 3000:0, 6000:0, 12000:0, 14000:0, 16000:0 },
        pop: { 60:-2, 170:-1, 310:0, 600:2, 1000:4, 3000:4, 6000:2, 12000:0, 14000:-1, 16000:-2 },
        rock: { 60:6, 170:4, 310:2, 600:0, 1000:-1, 3000:-1, 6000:2, 12000:4, 14000:6, 16000:6 }
    }[preset];

    Object.keys(settings).forEach(freq => {
        if(eqBands[freq]) eqBands[freq].gain.value = settings[freq];
    });
}

function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

// Event Listeners for Player
audioPlayer.addEventListener('timeupdate', () => {
    const prog = document.getElementById('musicProgress');
    const cur = document.getElementById('currentTime');
    const dur = document.getElementById('durationTime');
    if (!isNaN(audioPlayer.duration)) {
        prog.value = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        cur.innerText = formatTime(audioPlayer.currentTime);
        dur.innerText = formatTime(audioPlayer.duration);
    }
});

audioPlayer.addEventListener('ended', () => {
    if (!isRepeat) musicNext();
});

document.getElementById('musicProgress').addEventListener('input', (e) => {
    const track = musicList[currentTrackIndex];
    if (track && track.type === 'youtube') {
        const seek = (e.target.value / 100) * ytPlayer.getDuration();
        ytPlayer.seekTo(seek, true);
    } else {
        const seekTime = (e.target.value / 100) * audioPlayer.duration;
        audioPlayer.currentTime = seekTime;
    }
});

document.getElementById('volumeControl').addEventListener('input', (e) => {
    const vol = e.target.value;
    audioPlayer.volume = vol;
    if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(vol * 100);
});

function moveTrack(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= musicList.length) return;
    
    const temp = musicList[index];
    musicList[index] = musicList[newIndex];
    musicList[newIndex] = temp;
    
    if (currentTrackIndex === index) {
        currentTrackIndex = newIndex;
    } else if (currentTrackIndex === newIndex) {
        currentTrackIndex = index;
    }
    
    renderPlaylist();
}

document.getElementById('ytSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearchOrUrl();
});

function updateMusicUI() {
    const btn = document.getElementById('playPauseBtn');
    const disk = document.getElementById('vinylDisk');
    const card = document.querySelector('.music-card');
    
    btn.innerHTML = isMusicPlaying ? '<i class="fas fa-pause-circle"></i>' : '<i class="fas fa-play-circle"></i>';
    
    if (isMusicPlaying) {
        disk.classList.add('rotating');
        card.classList.add('playing');
    } else {
        disk.classList.remove('rotating');
        card.classList.remove('playing');
    }
}

// --- AI LOGIC (Key Rotation) ---
async function loadConfig() {
    const res = await fetch('/api/main?route=admin_config');
    const data = await res.json();
    if(data) {
        aiConfig.keys = data.keys || [];
        aiConfig.models = data.models || [];
        aiConfig.miniChatModel = data.miniChatModel || "gemini-1.5-flash";
        aiConfig.razorpayKey = data.razorpayKey;
        updateAIUI();
        document.getElementById('statKeys').innerText = aiConfig.keys.length;
        document.getElementById('statModels').innerText = aiConfig.models.length;
        document.getElementById('apiKeys').value = aiConfig.keys.join(', ');
        document.getElementById('modelList').value = JSON.stringify(aiConfig.models);
        document.getElementById('miniChatModelId').value = aiConfig.miniChatModel;
    }
}

function updateAIUI() {
    const select = document.getElementById('modelSelect');
    if(select) select.innerHTML = aiConfig.models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}

// --- AI LOGIC (Key Rotation + History) ---
async function syncAIHistory() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=ai_conversations&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            aiConversations = data;
            renderAIHistory();
        }
    } catch (e) {
        console.warn("Failed to sync AI history", e);
    }
}

async function saveAIHistory(conversation) {
    const idx = aiConversations.findIndex(c => c.id === conversation.id);
    if (idx > -1) aiConversations[idx] = conversation;
    else aiConversations.unshift(conversation);

    renderAIHistory();

    if (!currentUser) return;

    // Ensure ID is a number for DB consistency
    const payload = { ...conversation, id: Number(conversation.id) };

    setLoading(true, "Syncing Chat History");
    try {
        await fetch(`/api/main?route=ai_conversations&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn("Could not sync AI history to cloud", e);
    } finally {
        setLoading(false);
    }
}

function newConversation() {
    currentChatId = Date.now();
    const conv = { id: currentChatId, name: "New Conversation", messages: [] };
    saveAIHistory(conv);
    loadConversation(currentChatId);
}

function loadConversation(id) {
    id = Number(id);
    currentChatId = id;
    const conv = aiConversations.find(c => c.id === id);
    if (!conv) return;

    document.getElementById('chatBox').innerHTML = '';
    document.getElementById('currentConvName').innerText = conv.name;
    conv.messages.forEach(m => appendAIMessage(m.role, m.content));
    renderAIHistory();
    if(window.innerWidth < 1024) document.getElementById('aiSidebar').classList.add('hidden');
}

function renderAIHistory() {
    const list = document.getElementById('chatHistoryList');
    const bulkBar = document.getElementById('aiBulkActions');
    
    if (aiConversations.length === 0) {
        list.innerHTML = '<p class="text-[10px] text-gray-500 text-center py-4">No chat history.</p>';
        bulkBar?.classList.add('hidden');
        selectedConversations.clear();
        return;
    }

    bulkBar?.classList.remove('hidden');
    const countEl = document.getElementById('aiSelectionCount');
    if (countEl) countEl.innerText = `${selectedConversations.size} selected`;
    
    const selectAllEl = document.getElementById('selectAllAI');
    if (selectAllEl) selectAllEl.checked = (selectedConversations.size === aiConversations.length && aiConversations.length > 0);

    list.innerHTML = aiConversations.map(c => {
        const isSelected = selectedConversations.has(Number(c.id));
        return `
            <div class="relative group flex items-center gap-2">
                <input type="checkbox" class="accent-purple-500 shrink-0" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleConvSelection(${c.id})">
                <div onclick="loadConversation('${c.id}')" class="flex-grow p-3 pr-10 rounded-xl cursor-pointer transition text-[11px] truncate ${c.id === currentChatId ? 'bg-purple-600/30 border border-purple-500' : 'hover:bg-white/5'}">
                    <i class="fas fa-comment-alt mr-2 opacity-50"></i> ${c.name}
                </div>
                <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button onclick="event.stopPropagation(); renameConversation('${c.id}')" class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-cyan-400 transition-colors" title="Rename"><i class="fas fa-pen text-[9px]"></i></button>
                    <button onclick="event.stopPropagation(); deleteConversation('${c.id}')" class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors" title="Delete"><i class="fas fa-trash-alt text-[9px]"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleConvSelection(id) {
    id = Number(id);
    if (selectedConversations.has(id)) selectedConversations.delete(id);
    else selectedConversations.add(id);
    renderAIHistory();
}

function selectAllConversations(checked) {
    if (checked) {
        aiConversations.forEach(c => selectedConversations.add(Number(c.id)));
    } else {
        selectedConversations.clear();
    }
    renderAIHistory();
}

async function deleteSelectedConversations() {
    if (selectedConversations.size === 0) return;
    if (!confirm(`Delete ${selectedConversations.size} conversations?`)) return;

    setLoading(true, "Deleting Chats");
    try {
        const idsToDelete = Array.from(selectedConversations);
        if (currentUser) {
            // Bulk delete via multiple API calls or a batch endpoint if it existed
            // For now, we iterate for simplicity with the existing route
            await Promise.all(idsToDelete.map(id => 
                fetch(`/api/main?route=ai_conversations&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, { method: 'DELETE' })
            ));
        }
        
        aiConversations = aiConversations.filter(c => !selectedConversations.has(Number(c.id)));
        if (selectedConversations.has(Number(currentChatId))) {
            currentChatId = null;
            document.getElementById('chatBox').innerHTML = '';
            document.getElementById('currentConvName').innerText = 'Untitled Chat';
        }
        selectedConversations.clear();
        renderAIHistory();
    } finally {
        setLoading(false);
    }
}

async function renameConversation(id) {
    id = Number(id);
    const conv = aiConversations.find(c => c.id === id);
    const newName = prompt("Enter new name for conversation:", conv.name);
    if (newName) {
        conv.name = newName;
        await saveAIHistory(conv);
        if (id === currentChatId) document.getElementById('currentConvName').innerText = newName;
    }
}

async function deleteConversation(id) {
    id = Number(id);
    if (!confirm("Are you sure you want to delete this conversation?")) return;
    aiConversations = aiConversations.filter(c => c.id !== id);
    if (currentUser) {
        setLoading(true, "Deleting Chat");
        try {
            await fetch(`/api/main?route=ai_conversations&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, {
                method: 'DELETE'
            });
        } finally {
            setLoading(false);
        }
    }
    if (currentChatId === id) {
        currentChatId = null;
        document.getElementById('chatBox').innerHTML = '';
        document.getElementById('currentConvName').innerText = 'Untitled Chat';
    }
    renderAIHistory();
}

function appendAIMessage(role, content, targetBoxId = 'chatBox', isStreaming = false) {
    const box = document.getElementById(targetBoxId);
    let msgDiv = null;

    if (isStreaming || role === 'ai') {
        msgDiv = box.querySelector('.streaming-msg');
    }

    if (!msgDiv) {
        msgDiv = document.createElement('div');
        msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'} relative group ${isStreaming ? 'streaming-msg' : ''}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = "markdown-body";
        msgDiv.appendChild(contentDiv);
        box.appendChild(msgDiv);
    }

    if (!isStreaming && role === 'ai') {
        msgDiv.classList.remove('streaming-msg');
    }

    const contentDiv = msgDiv.querySelector('.markdown-body');
    contentDiv.innerHTML = renderMD(content);

    // Add Copy Buttons to Code Blocks
    contentDiv.querySelectorAll('pre').forEach(pre => {
        if (pre.querySelector('.code-copy-btn')) return;
        const code = pre.querySelector('code');
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.innerHTML = '<i class="far fa-copy"></i>';
        btn.onclick = () => {
            navigator.clipboard.writeText(code.innerText);
            btn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => btn.innerHTML = '<i class="far fa-copy"></i>', 2000);
        };
        pre.appendChild(btn);
    });

    // If finished, add copy button and handle math rendering
    if (role === 'ai' && !isStreaming) {
        if (!msgDiv.querySelector('.msg-copy-btn')) {
            const copyBtn = document.createElement('button');
            copyBtn.className = "msg-copy-btn absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition text-xs bg-white/10 p-1.5 rounded hover:bg-white/20";
            copyBtn.innerHTML = '<i class="far fa-copy"></i>';
            copyBtn.onclick = () => {
                const textToCopy = contentDiv.innerText;
                navigator.clipboard.writeText(textToCopy);
                copyBtn.innerHTML = '<i class="fas fa-check text-green-400"></i>';
                setTimeout(() => copyBtn.innerHTML = '<i class="far fa-copy"></i>', 2000);
            };
            msgDiv.appendChild(copyBtn);
        }
        
        // Final math render pass
        if (typeof renderMathInElement === 'function') {
            renderMathInElement(contentDiv, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError : false
            });
        }
    }

    box.scrollTop = box.scrollHeight;
    return msgDiv;
}

async function handleAIFile(e, isMini = false) {
    const files = e.target ? Array.from(e.target.files) : Array.from(e);
    
    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target.result.split(',')[1];
            const fileObj = { mime_type: file.type, data: base64, name: file.name };
            
            if (file.type.startsWith('text/')) {
                // For text files, we keep a raw copy for editing
                const raw = atob(base64);
                fileObj.raw = raw;
            }
            
            pendingFiles.push(fileObj);
            renderAttachmentChips();
        };
        reader.readAsDataURL(file);
    }
}

// STT Toggle
let recognition;
function toggleSTT(isMini = false) {
    const btnId = isMini ? 'miniSttBtn' : 'sttBtn';
    const inputId = isMini ? 'miniChatInput' : 'chatInput';
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);

    if (!('webkitSpeechRecognition' in window)) {
        return alert("Speech recognition not supported in this browser.");
    }

    if (recognition && recognition.active) {
        recognition.stop();
        return;
    }

    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        btn.innerHTML = `<i class="fas fa-stop-circle text-red-500 animate-pulse ${isMini ? 'text-[10px]' : ''}"></i>`;
        recognition.active = true;
    };

    recognition.onresult = (event) => {
        if (event.results[0].isFinal) {
            const result = event.results[0][0].transcript;
            const start = input.selectionStart || 0;
            const end = input.selectionEnd || 0;
            const text = input.value;
            input.value = text.substring(0, start) + result + " " + text.substring(end);
            const newPos = start + result.length + 1;
            input.focus();
            input.setSelectionRange(newPos, newPos);
            if (!isMini) autoResize(input);
        }
    };

    recognition.onerror = () => {
        btn.innerHTML = `<i class="fas fa-microphone ${isMini ? 'text-xs' : ''}"></i>`;
        recognition.active = false;
    };

    recognition.onend = () => {
        btn.innerHTML = `<i class="fas fa-microphone ${isMini ? 'text-xs' : ''}"></i>`;
        recognition.active = false;
    };

    recognition.start();
}

let editingAttachmentIdx = -1;

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    
    if (textarea.value.length > 3000 && textarea.id === 'chatInput') {
        const content = textarea.value;
        textarea.value = '';
        textarea.style.height = 'auto';
        addTextAsAttachment(content);
    }
}

function addTextAsAttachment(content, name = null) {
    const fileName = name || `Large Text ${pendingFiles.length + 1}.txt`;
    const base64 = btoa(unescape(encodeURIComponent(content)));
    const fileObj = { mime_type: 'text/plain', data: base64, name: fileName, raw: content };
    pendingFiles.push(fileObj);
    renderAttachmentChips();
}

function renderAttachmentChips() {
    const preview = document.getElementById('aiAttachmentPreview');
    const miniPreview = document.getElementById('miniAttachmentPreview');
    [preview, miniPreview].forEach(p => { if(p) p.innerHTML = ''; });

    pendingFiles.forEach((file, idx) => {
        const chip = document.createElement('div');
        chip.className = "bg-purple-600/20 text-purple-400 text-[10px] px-2 py-1 rounded flex items-center gap-2 border border-purple-500/30 group animate-fadeIn";
        
        let icon = '<i class="fas fa-file-alt"></i>';
        let editBtn = '';
        
        if (file.mime_type.startsWith('image/')) {
            icon = `<img src="data:${file.mime_type};base64,${file.data}" class="w-4 h-4 rounded object-cover">`;
        } else if (file.mime_type === 'text/plain' || file.raw) {
            editBtn = `<button onclick="toggleLargeEditor(null, ${idx})" class="hover:text-cyan-400 transition" title="Edit text"><i class="fas fa-edit"></i></button>`;
        }

        chip.innerHTML = `
            ${icon}
            <span class="max-w-[100px] truncate">${file.name}</span>
            <div class="flex items-center gap-1.5 ml-1">
                ${editBtn}
                <button onclick="removeAttachment(${idx})" class="hover:text-red-400 transition"><i class="fas fa-times"></i></button>
            </div>
        `;
        
        const target = (document.getElementById('ai').classList.contains('active')) ? preview : miniPreview;
        if(target) target.appendChild(chip);
    });
}

function removeAttachment(idx) {
    pendingFiles.splice(idx, 1);
    renderAttachmentChips();
}

function toggleLargeEditor(content = null, attachmentIdx = -1) {
    const modal = document.getElementById('largeEditorModal');
    const editor = document.getElementById('largeEditorText');
    const isOpening = modal.classList.contains('hidden');
    
    if (isOpening) {
        editingAttachmentIdx = attachmentIdx;
        if (attachmentIdx !== -1) {
            editor.value = pendingFiles[attachmentIdx].raw || atob(pendingFiles[attachmentIdx].data);
        } else {
            editor.value = content || document.getElementById('chatInput').value;
        }
        modal.classList.remove('hidden');
        editor.focus();
    } else {
        modal.classList.add('hidden');
        editingAttachmentIdx = -1;
    }
}

function saveLargeEditor() {
    const content = document.getElementById('largeEditorText').value;
    if (editingAttachmentIdx !== -1) {
        pendingFiles[editingAttachmentIdx].raw = content;
        pendingFiles[editingAttachmentIdx].data = btoa(unescape(encodeURIComponent(content)));
        renderAttachmentChips();
    } else {
        const input = document.getElementById('chatInput');
        input.value = content;
        autoResize(input);
    }
    toggleLargeEditor();
}

function exportChat() {
    if (!currentChatId) return;
    const conv = aiConversations.find(c => c.id === currentChatId);
    if (!conv) return;
    
    let md = `# Chat: ${conv.name}\n\n`;
    conv.messages.forEach(m => {
        md += `### ${m.role.toUpperCase()}\n${m.content}\n\n---\n\n`;
    });
    
    const blob = new Blob([md], {type: 'text/markdown'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.name.replace(/\s+/g, '_')}.md`;
    a.click();
}

// Paste handling
document.getElementById('chatInput').addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    const files = [];
    for (let item of items) {
        if (item.kind === 'file') {
            files.push(item.getAsFile());
        }
    }
    if (files.length > 0) {
        e.preventDefault();
        handleAIFile(files);
    }
});

async function askAI() {
    const inputEl = document.getElementById('chatInput');
    const input = inputEl.value;
    if(!input.trim() && pendingFiles.length === 0) return;
    
    if(!currentChatId) newConversation();
    const conv = aiConversations.find(c => c.id === currentChatId);
    
    const userMsg = input + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userMsg, 'chatBox');
    inputEl.value = '';
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });

    if(conv && conv.messages.length === 0) {
        conv.name = input.substring(0, 25) || "New Conversation";
    }
    
    const parts = [{ text: input || " " }];
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    
    const messageObj = { role: 'user', content: userMsg, parts };
    if(conv) conv.messages.push(messageObj);

    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];
    
    await callGeminiAPI(input, 'chatBox', conv ? conv.messages : [], attachmentsForApi);
}

async function askMiniAI() {
    const inputEl = document.getElementById('miniChatInput');
    const box = document.getElementById('miniChatBox');
    if(!inputEl.value.trim() && pendingFiles.length === 0) return;
    
    const txt = inputEl.value;
    appendAIMessage('user', txt + (pendingFiles.length ? " [Files attached]" : ""), 'miniChatBox');
    inputEl.value = '';
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });
    
    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];
    
    await callGeminiAPI(txt, 'miniChatBox', [], attachmentsForApi);
}

async function callGeminiAPI(text, targetBoxId = 'chatBox', history = [], attachments = []) {
    let model = "gemini-1.5-flash";
    if (targetBoxId === 'miniChatBox') {
        model = aiConfig.miniChatModel || "gemini-1.5-flash";
    } else {
        const modelSelect = document.getElementById('modelSelect');
        model = (modelSelect && modelSelect.value) ? modelSelect.value : (aiConfig.models[0]?.id || "gemini-1.5-flash");
    }
    
    if(!aiConfig.keys.length) return alert("Please configure API Keys in Admin panel.");

    const statusEl = document.getElementById(targetBoxId === 'chatBox' ? 'aiStatus' : null);
    if(statusEl) { 
        statusEl.innerHTML = `<div class="flex items-center gap-2"><div class="typing-indicator"><span></span><span></span><span></span></div> Connecting to Neural Link...</div>`; 
        statusEl.classList.remove('hidden'); 
    }

    // Map history to Gemini format
    const contents = history.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: m.parts || [{ text: m.content }]
    }));

    // Add current prompt if history doesn't already contain it
    if (contents.length === 0 || contents[contents.length-1].role === 'model') {
        const currentParts = [{ text: text }];
        attachments.forEach(a => currentParts.push({ inline_data: { mime_type: a.mime_type, data: a.data } }));
        contents.push({ role: 'user', parts: currentParts });
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${aiConfig.keys[currentKeyIndex]}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || "API Error");
        }

        if(statusEl) statusEl.innerHTML = `<div class="flex items-center gap-2"><div class="typing-indicator"><span></span><span></span><span></span></div> Receiving Intelligence...</div>`;
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let fullContent = "";
        appendAIMessage('ai', '<div class="typing-dots"><span></span><span></span><span></span></div>', targetBoxId, true);
        
        let buffer = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                // Process any remaining buffer
                if (buffer.trim()) processBuffer(buffer.trim());
                break;
            }
            
            buffer += decoder.decode(value, { stream: true });
            buffer = processBuffer(buffer);
        }

        function processBuffer(data) {
            let tempBuffer = data;
            while (true) {
                let startIdx = tempBuffer.indexOf('{');
                if (startIdx === -1) break;
                
                let braceCount = 0;
                let endIdx = -1;
                for (let i = startIdx; i < tempBuffer.length; i++) {
                    if (tempBuffer[i] === '{') braceCount++;
                    else if (tempBuffer[i] === '}') braceCount--;
                    
                    if (braceCount === 0) {
                        endIdx = i;
                        break;
                    }
                }
                
                if (endIdx === -1) break; // Incomplete JSON object
                
                const chunkStr = tempBuffer.substring(startIdx, endIdx + 1);
                try {
                    const chunk = JSON.parse(chunkStr);
                    const textPart = chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
                    if (textPart) {
                        fullContent += textPart;
                        appendAIMessage('ai', fullContent, targetBoxId, true);
                    }
                } catch (e) {
                    // Log but continue
                }
                tempBuffer = tempBuffer.substring(endIdx + 1).trim();
                if (tempBuffer.startsWith(',')) tempBuffer = tempBuffer.substring(1).trim();
            }
            return tempBuffer;
        }

        appendAIMessage('ai', fullContent, targetBoxId, false); // Final transition
        if(statusEl) {
            statusEl.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-1"></i> Sequence Complete`;
            setTimeout(() => statusEl.classList.add('hidden'), 2000);
        }

        if (targetBoxId === 'chatBox' && currentChatId) {
            const conv = aiConversations.find(c => c.id === currentChatId);
            if (conv) {
                conv.messages.push({ role: 'ai', content: fullContent });
                await saveAIHistory(conv);
            }
        }
    } catch (err) {
        console.warn(`Key ${currentKeyIndex} error: ${err.message}.`);
        if (aiConfig.keys.length > 1) {
            currentKeyIndex = (currentKeyIndex + 1) % aiConfig.keys.length;
            if(statusEl) statusEl.innerText = `Retrying with Key ${currentKeyIndex}...`;
            return await callGeminiAPI(text, targetBoxId, history, attachments);
        }
        if(statusEl) statusEl.classList.add('hidden');
        appendAIMessage('ai', `**System Failure:** ${err.message}`, targetBoxId);
    }
}

// AI logic replaced by unified streaming/file functions above
function clearChat() { document.getElementById('chatBox').innerHTML = ''; }
function toggleAIHistory() {
    const sidebar = document.getElementById('aiSidebar');
    sidebar.classList.toggle('hidden');
}
function toggleMiniChat() { document.getElementById('miniChat').classList.toggle('show'); }

// --- FUN PAGE LOGIC ---
let clickCount = 0;
let clickTime = 10;
let clickActive = false;
function startClicker() {
    if(clickActive) { clickCount++; document.getElementById('clickCounter').innerText = clickCount; return; }
    clickActive = true; clickCount = 1; clickTime = 10;
    document.getElementById('clickCounter').innerText = "1";
    const interval = setInterval(async () => {
        clickTime--;
        document.getElementById('clickTimer').innerText = clickTime + "s remaining";
        if(clickTime <= 0) {
            clearInterval(interval);
            clickActive = false;
            const cps = clickCount / 10;
            alert(`Time's up! Your CPS: ${cps}`);
            if (currentUser) {
                await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'clicker', score: cps })
                });
            }
        }
    }, 1000);
}

async function syncFunStats() {
    if (!currentUser) return;
    const res = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
}

function shakeBall() {
    const answers = ["Yes", "No", "Maybe", "Outlook good", "Ask again later", "Very doubtful", "Absolutely"];
    document.getElementById('ballResponse').innerText = answers[Math.floor(Math.random()*answers.length)];
}

// --- CRICKET LOGIC ---
let match = {
    teams: [],
    currentInnings: 0,
    maxOvers: 1,
    target: null,
    isOver: false,
    strikerIdx: 0,
    nonStrikerIdx: 1,
    bowlerIdx: -1
};

function parsePlayers(raw) {
    return raw.split('\n').filter(l => l.trim()).map(l => {
        const [name, type] = l.split('/');
        return {
            name: name?.trim() || 'Player',
            type: type?.trim() || 'Batsman',
            runs: 0, balls: 0, wickets: 0, runsConceded: 0, ballsBowled: 0, isOut: false
        };
    });
}

function selectBowler() {
    const bowlingTeam = match.teams[match.currentInnings === 0 ? 1 : 0];
    const priorities = { 'Bowler': 1, 'Bowling AR': 2, 'Batting AR': 3, 'Wicketkeeper': 4, 'Batsman': 5 };
    // Max overs a single bowler can bowl (Standard rule: 1/5th of total innings overs)
    const maxPerBowler = Math.ceil(match.maxOvers / 5);
    
    const playersWithIdx = bowlingTeam.players.map((p, idx) => ({ ...p, idx }));
    let available = playersWithIdx.filter(p => {
        const hasNotExhaustedLimit = (p.ballsBowled / 6) < maxPerBowler;
        const isEligibleType = (priorities[p.type] || 5) <= 3;
        return hasNotExhaustedLimit && isEligibleType;
    });
    
    if (available.length === 0) {
        available = playersWithIdx.filter(p => (p.ballsBowled / 6) < maxPerBowler);
    }
    
    if (available.length === 0) available = playersWithIdx;

    available.sort((a, b) => {
        const pA = priorities[a.type] || 5;
        const pB = priorities[b.type] || 5;
        return pA - pB || a.ballsBowled - b.ballsBowled;
    });
    
    const next = available.find(p => p.idx !== match.bowlerIdx) || available[0];
    match.bowlerIdx = next ? next.idx : 0;
    return next;
}

async function startMatch() {
    const tA = document.getElementById('teamAName').value;
    const tB = document.getElementById('teamBName').value;
    const pA = document.getElementById('teamAPlayers').value;
    const pB = document.getElementById('teamBPlayers').value;
    const oversVal = document.getElementById('cricketOversSelect').value;
    
    match.maxOvers = parseInt(oversVal);
    match.teams = [
        { name: tA, players: parsePlayers(pA), score: 0, wickets: 0, balls: 0, history: [] },
        { name: tB, players: parsePlayers(pB), score: 0, wickets: 0, balls: 0, history: [] }
    ];
    match.currentInnings = 0;
    match.target = null;
    match.isOver = false;
    match.strikerIdx = 0;
    match.nonStrikerIdx = 1;
    selectBowler();

    // Auto-save setup to database when match starts if logged in
    if (currentUser) {
        try {
            await fetch(`/api/main?route=cricket_setup&userId=${currentUser.email}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tA, tB, pA, pB, overs: oversVal })
            });
        } catch (e) {
            console.warn("Failed to auto-save cricket setup", e);
        }
    }

    document.getElementById('cricketSetup').classList.add('hidden');
    document.getElementById('cricketGround').classList.remove('hidden');
    updateCricketUI();
}

function playCricket() {
    if(match.isOver) return;
    const battingTeam = match.teams[match.currentInnings];
    const bowlingTeam = match.teams[match.currentInnings === 0 ? 1 : 0];
    const maxBalls = match.maxOvers * 6;
    
    if(battingTeam.wickets >= 10 || battingTeam.balls >= maxBalls || (match.target && battingTeam.score >= match.target)) {
        endInnings(); return;
    }

    const striker = battingTeam.players[match.strikerIdx];
    const bowler = bowlingTeam.players[match.bowlerIdx];
    const outcomes = [0, 1, 2, 3, 4, 6, 'W'];
    const res = outcomes[Math.floor(Math.random() * outcomes.length)];
    
    battingTeam.balls++;
    striker.balls++;
    bowler.ballsBowled++;
    
    if (res === 'W') {
        battingTeam.wickets++;
        striker.isOut = true;
        bowler.wickets++;
        battingTeam.history.push('W');
        document.getElementById('status').innerText = `OUT! ${striker.name} departed!`;
        if (battingTeam.wickets < 10) {
            const nextIdx = Math.max(match.strikerIdx, match.nonStrikerIdx) + 1;
            match.strikerIdx = nextIdx < battingTeam.players.length ? nextIdx : match.nonStrikerIdx;
        }
    } else {
        battingTeam.score += res;
        striker.runs += res;
        bowler.runsConceded += res;
        battingTeam.history.push(res);
        document.getElementById('status').innerText = `${res} runs! Great shot by ${striker.name}`;
        
        if (typeof res === 'number' && res % 2 !== 0) {
            [match.strikerIdx, match.nonStrikerIdx] = [match.nonStrikerIdx, match.strikerIdx];
        }
    }

    if (battingTeam.balls % 6 === 0 && !match.isOver) {
        [match.strikerIdx, match.nonStrikerIdx] = [match.nonStrikerIdx, match.strikerIdx];
        selectBowler();
    }

    updateCricketUI();
    if(battingTeam.wickets >= 10 || battingTeam.balls >= maxBalls || (match.target && battingTeam.score >= match.target)) endInnings();
}

async function endInnings() {
    if(match.currentInnings === 0) {
        match.target = match.teams[0].score + 1;
        match.currentInnings = 1;
        match.strikerIdx = 0;
        match.nonStrikerIdx = 1;
        selectBowler();
        alert(`Innings Break! ${match.teams[1].name} needs ${match.target} to win.`);
        updateCricketUI();
    } else {
        match.isOver = true;
        const t1 = match.teams[0];
        const t2 = match.teams[1];
        let winMsg = t2.score >= match.target ? `${t2.name} Wins!` : t2.score === match.target - 1 ? "Match Tied!" : `${t1.name} Wins!`;
        document.getElementById('status').innerText = winMsg;
        document.getElementById('newMatchBtn').classList.remove('hidden');
        
        if (currentUser) {
            // Create a deep copy of players to ensure data persistence
            const cleanPlayers = (players) => players.map(p => ({
                name: p.name, type: p.type, runs: p.runs, balls: p.balls, 
                wickets: p.wickets, runsConceded: p.runsConceded, ballsBowled: p.ballsBowled, isOut: p.isOut
            }));

            const historyObj = { 
                id: Date.now(),
                result: winMsg, 
                teamA: { name: t1.name, score: t1.score, wickets: t1.wickets, balls: t1.balls, players: cleanPlayers(t1.players) },
                teamB: { name: t2.name, score: t2.score, wickets: t2.wickets, balls: t2.balls, players: cleanPlayers(t2.players) },
                maxOvers: Number(match.maxOvers),
                setup: {
                    pA: document.getElementById('teamAPlayers').value,
                    pB: document.getElementById('teamBPlayers').value
                }
            };
            
            try {
                await fetch(`/api/main?route=cricket_history&userId=${encodeURIComponent(currentUser.email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(historyObj)
                });
                await syncCricketHistory();
            } catch (e) {
                console.error("Failed to save match history", e);
            }
        }
    }
}

async function saveCricketSetup() {
    if (!currentUser) return alert("Login to save your teams!");
    const setup = {
        tA: document.getElementById('teamAName').value,
        tB: document.getElementById('teamBName').value,
        overs: document.getElementById('cricketOversSelect').value,
        pA: document.getElementById('teamAPlayers').value,
        pB: document.getElementById('teamBPlayers').value
    };
    setLoading(true, "Saving Match Setup");
    try {
        await fetch(`/api/main?route=cricket_setup&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(setup)
        });
        alert("Match setup saved to cloud!");
    } finally {
        setLoading(false);
    }
}

async function loadCricketSetup() {
    if (!currentUser) return;
    const res = await fetch(`/api/main?route=cricket_setup&userId=${encodeURIComponent(currentUser.email)}`);
    const data = await res.json();
    if (data && data.length > 0) {
        // Since API sorts by timestamp: -1, index 0 is the most recent setup
        const latest = data[0];
        document.getElementById('teamAName').value = latest.tA || '';
        document.getElementById('teamBName').value = latest.tB || '';
        document.getElementById('cricketOversSelect').value = latest.overs || '1';
        document.getElementById('teamAPlayers').value = latest.pA || '';
        document.getElementById('teamBPlayers').value = latest.pB || '';
    }
}

function toggleCricketView(view) {
    const setup = document.getElementById('cricketSetup');
    const archives = document.getElementById('cricketArchives');
    const ground = document.getElementById('cricketGround');
    const setupTab = document.getElementById('cricketSetupTab');
    const historyTab = document.getElementById('cricketHistoryTab');

    if (view === 'setup') {
        setup.classList.remove('hidden');
        archives.classList.add('hidden');
        ground.classList.add('hidden');
        setupTab.className = "bg-cyan-600/20 text-cyan-400 px-6 py-2 rounded-full font-bold border border-cyan-500/30";
        historyTab.className = "hover:bg-white/5 px-6 py-2 rounded-full font-bold transition";
    } else {
        setup.classList.add('hidden');
        archives.classList.remove('hidden');
        ground.classList.add('hidden');
        historyTab.className = "bg-cyan-600/20 text-cyan-400 px-6 py-2 rounded-full font-bold border border-cyan-500/30";
        setupTab.className = "hover:bg-white/5 px-6 py-2 rounded-full font-bold transition";
        syncCricketHistory();
    }
}

function resetCricketMatch() {
    document.getElementById('cricketGround').classList.add('hidden');
    document.getElementById('cricketSetup').classList.remove('hidden');
    document.getElementById('newMatchBtn').classList.add('hidden');
    document.getElementById('status').innerText = "Wait for Bowler...";
    toggleCricketView('setup');
}

let cricketHistoryData = [];
async function deleteCricketMatch(id) {
    if (!confirm("Delete this match record from history?")) return;
    setLoading(true, "Deleting Match Record");
    try {
        const res = await fetch(`/api/main?route=cricket_history&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await syncCricketHistory();
        } else {
            throw new Error("Failed to delete record");
        }
    } catch (e) {
        alert(e.message);
    } finally {
        setLoading(false);
    }
}

async function syncCricketHistory() {
    if (!currentUser) return;
    const list = document.getElementById('matchHistoryList');
    list.innerHTML = '<div class="col-span-full text-center py-10"><i class="fas fa-spinner fa-spin text-2xl"></i></div>';
    
    try {
        const res = await fetch(`/api/main?route=cricket_history&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        
        if (Array.isArray(data)) {
            cricketHistoryData = data;
            if (data.length > 0) {
                list.innerHTML = data.map((m, idx) => {
                    // Safe fallbacks for historical records
                    const tA = m.teamA || {};
                    const tB = m.teamB || {};
                    const tAName = tA.name || 'Unknown';
                    const tBName = tB.name || 'Unknown';
                    
                    const borderClass = (m.result && tBName !== 'Unknown' && m.result.includes(tBName)) ? 'border-purple-500' : 'border-orange-500';
                    
                    return `
                    <div class="glass p-5 border-l-4 ${borderClass} group hover:scale-[1.02] transition-transform relative">
                        <button onclick="deleteCricketMatch('${m.id}')" class="absolute top-2 right-2 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition p-1" title="Delete Match">
                            <i class="fas fa-trash-alt text-[10px]"></i>
                        </button>
                        <div class="flex justify-between items-start mb-4 pr-6">
                            <span class="text-[10px] text-gray-500">${new Date(m.timestamp || m.id).toLocaleString()}</span>
                            <span class="text-[10px] font-bold text-cyan-400 uppercase tracking-tighter">${m.maxOvers || '?'} Overs</span>
                        </div>
                        <div class="flex justify-between items-center mb-4">
                            <div class="text-left">
                                <p class="text-xs font-bold">${tAName}</p>
                                <p class="text-xl font-black">${tA.score ?? 0}/${tA.wickets ?? 0}</p>
                            </div>
                            <div class="text-gray-600 font-bold">VS</div>
                            <div class="text-right">
                                <p class="text-xs font-bold">${tBName}</p>
                                <p class="text-xl font-black">${tB.score ?? 0}/${tB.wickets ?? 0}</p>
                            </div>
                        </div>
                        <div class="text-center p-2 bg-black/20 rounded-lg text-xs font-bold text-gray-300 mb-4">
                            ${m.result || 'Match Completed'}
                        </div>
                        <button onclick='viewMatchDetail(${idx})' class="w-full py-2 text-xs bg-white/5 rounded-lg hover:bg-white/10 transition">Deep Dive</button>
                    </div>
                `}).join('');
            } else {
                list.innerHTML = '<div class="col-span-full text-center py-20 text-gray-500">No matches found in archives.</div>';
            }
        } else {
            throw new Error(data.error || "Invalid data format");
        }
    } catch (e) {
        console.error("Cricket Sync Error:", e);
        list.innerHTML = `<div class="col-span-full text-center py-20 text-red-500">Failed to load history: ${e.message}</div>`;
    }
}

function viewMatchDetail(idx) {
    const m = cricketHistoryData[idx];
    if (!m) return;
    const tA = m.teamA || { name: 'Unknown', players: [] };
    const tB = m.teamB || { name: 'Unknown', players: [] };

    document.getElementById('detailMatchTitle').innerText = `${tA.name || 'Unknown'} vs ${tB.name || 'Unknown'}`;
    const content = document.getElementById('matchDetailContent');
    
    const renderTeamScorecard = (team) => `
        <div class="bg-white/5 p-4 rounded-xl border border-white/5">
            <h4 class="font-bold text-cyan-400 border-b border-white/10 mb-3 pb-1">${team.name || 'Unknown'} Scorecard</h4>
            <div class="space-y-2">
                ${(team.players || []).length > 0 ? (team.players || []).filter(p => p.balls > 0 || !p.isOut).map(p => `
                    <div class="flex justify-between text-xs">
                        <span class="${p.isOut ? 'text-gray-500' : 'text-white'}">${p.name || 'Player'} ${p.isOut ? '(out)' : ''}</span>
                        <span class="font-mono">${p.runs || 0}(${p.balls || 0}) SR: ${(((p.runs || 0)/((p.balls || 1) || 1))*100).toFixed(1)}</span>
                    </div>
                `).join('') : '<p class="text-[10px] text-gray-500 italic">No player data available</p>'}
            </div>
            <div class="mt-4 pt-3 border-t border-white/5">
                <p class="text-[10px] text-gray-500 uppercase font-bold mb-2">Bowling Performance</p>
                ${(team.players || []).length > 0 ? (team.players || []).filter(p => p.ballsBowled > 0).map(p => `
                    <div class="flex justify-between text-xs text-gray-400">
                        <span>${p.name || 'Player'}</span>
                        <span class="font-mono">${p.wickets || 0}-${p.runsConceded || 0} (${Math.floor((p.ballsBowled || 0)/6)}.${(p.ballsBowled || 0)%6})</span>
                    </div>
                `).join('') : '<p class="text-[10px] text-gray-500 italic">No bowling data</p>'}
            </div>
        </div>
    `;

    content.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${renderTeamScorecard(tA)}
            ${renderTeamScorecard(tB)}
        </div>
        <div class="bg-cyan-500/10 p-4 rounded-xl border border-cyan-500/20 text-center">
            <p class="text-sm font-bold text-cyan-400">${m.result || 'No result data'}</p>
        </div>
    `;

    const rematchBtn = document.getElementById('rematchBtn');
    rematchBtn.onclick = () => {
        closeMatchDetail();
        document.getElementById('teamAName').value = tA.name;
        document.getElementById('teamBName').value = tB.name;
        document.getElementById('cricketOversSelect').value = m.maxOvers;
        document.getElementById('teamAPlayers').value = m.setup?.pA || '';
        document.getElementById('teamBPlayers').value = m.setup?.pB || '';
        toggleCricketView('setup');
        startMatch();
    };

    document.getElementById('matchDetailModal').classList.remove('hidden');
}

function closeMatchDetail() {
    document.getElementById('matchDetailModal').classList.add('hidden');
}

function updateCricketUI() {
    const team = match.teams[match.currentInnings];
    const crr = (team.score / (team.balls / 6 || 1)).toFixed(2);
    document.getElementById('battingTeamName').innerText = team.name;
    document.getElementById('score').innerText = `${team.score}/${team.wickets}`;
    document.getElementById('overs').innerText = `${Math.floor(team.balls/6)}.${team.balls%6}`;
    
    let statsText = `CRR: ${crr}`;
    if (match.target) {
        const remainingBalls = (match.maxOvers * 6) - team.balls;
        const runsNeeded = match.target - team.score;
        const rrr = remainingBalls > 0 ? ((runsNeeded / remainingBalls) * 6).toFixed(2) : '0.00';
        statsText += ` | RRR: ${rrr}`;
        document.getElementById('targetDisplay').innerText = `Target: ${match.target} (Need ${runsNeeded} off ${remainingBalls} balls)`;
    } else {
        document.getElementById('targetDisplay').innerText = '';
    }
    
    document.getElementById('battingPartnership').innerText = statsText;
    
    const hist = document.getElementById('cricketHistory');
    hist.innerHTML = team.history.slice(-12).map(r => `<span class="w-8 h-8 rounded-full flex items-center justify-center text-xs ${r === 'W' ? 'bg-red-600' : 'bg-gray-700'}">${r}</span>`).join('');

    const scorecard = document.getElementById('liveScorecard');
    scorecard.innerHTML = match.teams.map(t => `
        <div class="mb-6 bg-white/5 p-3 rounded-lg">
            <h4 class="font-bold text-cyan-400 border-b border-white/10 mb-2">${t.name} ${t.score}/${t.wickets} (${(t.balls/6).toFixed(1)} ov)</h4>
            <div class="space-y-1">
                ${t.players.filter(p => p.balls > 0 || !p.isOut).map(p => {
                    const sr = ((p.runs / (p.balls || 1)) * 100).toFixed(1);
                    return `<div class="flex justify-between text-[10px] ${p.isOut ? 'opacity-50' : 'text-white'}">
                        <span>${p.name}${p.isOut ? ' (out)' : ''}</span>
                        <span>${p.runs}(${p.balls}) SR: ${sr}</span>
                    </div>`;
                }).join('')}
            </div>
            <div class="mt-2 pt-2 border-t border-white/5 text-[10px] text-gray-400">
                <p class="font-bold mb-1">Bowling</p>
                ${t.players.filter(p => p.ballsBowled > 0).map(p => `
                    <div class="flex justify-between">
                        <span>${p.name}</span>
                        <span>${p.wickets}-${p.runsConceded} (${Math.floor(p.ballsBowled/6)}.${p.ballsBowled%6})</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

// --- SUPPORT & RAZORPAY ---
async function payNow() {
    const amount = document.getElementById('donAmount').value;
    const remark = document.getElementById('donRemark').value;
    const key = aiConfig.razorpayKey || "rzp_live_RuDJUlLd5GCYqf";
    
    if (!amount || amount < 1) return alert("Please enter a valid amount.");

    const options = {
        "key": key, 
        "amount": amount * 100,
        "currency": "INR",
        "name": "sOuLViSiON Support",
        "description": remark || "Donation for sOuLViSiON",
        "prefill": {
            "name": currentUser?.name || "",
            "email": currentUser?.email || ""
        },
        "handler": async function (response){
            setLoading(true, "Verifying Payment");
            try {
                await fetch('/api/main?route=feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        name: currentUser?.name || 'Anonymous', 
                        amount, 
                        remark,
                        paymentId: response.razorpay_payment_id
                    })
                });
                alert("Thank you for your support!");
                loadFeedbacks();
            } catch (e) {
                alert("Payment recorded, but failed to update wall.");
            } finally {
                setLoading(false);
            }
        },
        "theme": { "color": "#06b6d4" }
    };
    
    try {
        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function (response){
            alert("Payment Failed: " + response.error.description + ". Note: Ensure your domain is whitelisted in Razorpay Dashboard.");
        });
        rzp.open();
    } catch (e) {
        alert("Razorpay failed to initialize. Check your API key and domain whitelisting in Razorpay Settings.");
    }
}

async function loadFeedbacks() {
    const wall = document.getElementById('feedbackWall');
    wall.innerHTML = '<div class="text-center p-10"><i class="fas fa-spinner fa-spin text-3xl text-cyan-500"></i></div>';
    
    const res = await fetch('/api/main?route=feedback');
    const data = await res.json();
    
    if(Array.isArray(data) && data.length > 0) {
        wall.innerHTML = data.map(f => `
            <div class="bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-cyan-500/30 transition-all transform hover:-translate-y-1">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-bold text-cyan-400">${f.name}</span>
                    <span class="bg-cyan-500/20 text-cyan-400 text-[10px] px-2 py-0.5 rounded-full font-bold">₹${f.amount}</span>
                </div>
                <p class="text-sm text-gray-300 italic">"${f.remark || 'Helping sOuLViSiON grow!'}"</p>
            </div>
        `).join('');
    } else {
        wall.innerHTML = `
            <div class="text-center py-20 opacity-50">
                <i class="fas fa-heart-broken text-4xl mb-4"></i>
                <p>No donations yet. Be the pioneer!</p>
            </div>
        `;
    }
}

// --- CONTACT FORM LOGIC ---
async function handleContact(e) {
    e.preventDefault();
    const name = document.getElementById('contactName').value;
    const email = document.getElementById('contactEmail').value;
    const message = document.getElementById('contactMessage').value;
    const status = document.getElementById('contactStatus');

    setLoading(true, "Sending Message");
    try {
        const res = await fetch('/api/main?route=messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, message, timestamp: Date.now() })
        });

        if (res.ok) {
            status.innerText = "Message sent successfully! We'll get back to you soon.";
            status.className = "mt-4 text-center text-xs text-green-400 block";
            document.getElementById('contactForm').reset();
        } else {
            throw new Error("Failed to send message");
        }
    } catch (err) {
        status.innerText = "Error: " + err.message;
        status.className = "mt-4 text-center text-xs text-red-400 block";
    } finally {
        setLoading(false);
        setTimeout(() => { if(status) status.classList.add('hidden'); }, 5000);
    }
}

// --- ADMIN ---
async function saveAdminConfig() {
    const keys = document.getElementById('apiKeys').value.split(',').map(k => k.trim());
    const models = JSON.parse(document.getElementById('modelList').value);
    const miniChatModel = document.getElementById('miniChatModelId').value.trim();
    setLoading(true, "Applying Admin Settings");
    try {
        const res = await fetch('/api/main?route=admin_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'ai_settings', keys, models, miniChatModel })
        });
        if(res.ok) { alert("Config Updated!"); loadConfig(); }
    } finally {
        setLoading(false);
    }
}

// --- GOOGLE LOGIN ---
function handleGoogleCredentialResponse(response) {
    setLoading(true, "Authenticating with Google");
    fetch(`/api/main?route=auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            mode: 'google', 
            credential: response.credential 
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        currentUser = data;
        localStorage.setItem('soulUser', JSON.stringify(currentUser));
        updateAuthUI();
        syncAllData();
        showPage('home');
    })
    .catch(err => alert(err.message))
    .finally(() => setLoading(false));
}

function initGoogleLogin() {
    if (typeof google === 'undefined') {
        setTimeout(initGoogleLogin, 500);
        return;
    }
    google.accounts.id.initialize({
        client_id: "117626690354-1d85pk16ojvju3o3oc5e6gpcmtfno1kj.apps.googleusercontent.com",
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
    });
    google.accounts.id.renderButton(
        document.getElementById("googleBtnContainer"),
        { theme: "outline", size: "large", width: "320", shape: "rectangular" }
    );
}

// --- INIT ---
window.onload = async () => {
    updateAuthUI();
    initGoogleLogin();
    if (currentUser) {
        await syncAllData();
        await loadCricketSetup();
    }
    loadConfig();
    loadFeedbacks();
    renderAIHistory();

    // Init Greetings
    const aiWelcome = "### Greetings.\nI am the **sOuLAI** interface. How can I assist your vision today?";
    appendAIMessage('ai', aiWelcome, 'chatBox');
    appendAIMessage('ai', "Hello! I am your quick AI assistant. Ask me anything.", 'miniChatBox');

    document.getElementById('aiWidget').onclick = toggleMiniChat;
    
    // Marked.js options
    marked.setOptions({
        highlight: function(code, lang) {
            return hljs.highlightAuto(code).value;
        },
        breaks: true,
        gfm: true
    });
};