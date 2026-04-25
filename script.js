// --- STATE MANAGEMENT ---
let currentUser = JSON.parse(localStorage.getItem('soulUser')) || null;

function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '<i class="fas fa-check-circle text-green-400"></i>';
    if (type === 'error') icon = '<i class="fas fa-exclamation-circle text-red-400"></i>';
    if (type === 'info') icon = '<i class="fas fa-info-circle text-cyan-400"></i>';
    if (type === 'warning') icon = '<i class="fas fa-exclamation-triangle text-orange-400"></i>';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
let isStreamingMode = true;
let currentAbortController = null;

function stopAIStream() {
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
        
        // Clear UI indicators
        const statusEl = document.getElementById('aiStatus');
        const miniStatusEl = document.getElementById('miniAiStatus');
        if (statusEl) statusEl.classList.add('hidden');
        if (miniStatusEl) miniStatusEl.classList.add('hidden');
        
        const quietBtn = document.getElementById('quietBtn');
        const miniQuietBtn = document.getElementById('miniQuietBtn');
        if (quietBtn) quietBtn.classList.add('hidden');
        if (miniQuietBtn) miniQuietBtn.classList.add('hidden');

        showToast("AI silenced.", "warning");
    }
}

function stripMarkdown(text) {
    return text
        .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '$1') // Code blocks - keep content
        .replace(/`(.+?)`/g, '$1')                    // Inline code - keep content
        .replace(/(\*\*|__)(.*?)\1/g, '$2')           // Bold
        .replace(/(\*|_)(.*?)\1/g, '$2')              // Italic
        .replace(/#+\s+(.*?)(?:\n|$)/g, '$1 ')        // Headers
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')           // Links
        .replace(/>\s+(.*?)(?:\n|$)/g, '$1 ')         // Quotes
        .replace(/- \[( |x)\] /g, '')                 // Task lists
        .replace(/[-*+]\s+/g, '')                     // Unordered lists
        .replace(/\d+\.\s+/g, '')                     // Ordered lists
        .replace(/\n+/g, ' ')                         // Newlines to spaces for better TTS flow
        .trim();
}

function speakAIMessage(text, btn) {
    if ('speechSynthesis' in window) {
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            btn.innerHTML = '<i class="fas fa-volume-up text-[10px]"></i>';
            btn.classList.remove('text-cyan-400');
            return;
        }

        const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
        utterance.rate = 1;
        utterance.pitch = 1;
        
        utterance.onstart = () => {
            btn.innerHTML = '<i class="fas fa-stop-circle text-[10px] animate-pulse"></i>';
            btn.classList.add('text-cyan-400');
        };
        
        utterance.onend = () => {
            btn.innerHTML = '<i class="fas fa-volume-up text-[10px]"></i>';
            btn.classList.remove('text-cyan-400');
        };

        window.speechSynthesis.speak(utterance);
    } else {
        showToast("TTS not supported in this browser.", "error");
    }
}

function toggleStreamMode(val) {
    isStreamingMode = val;
    // Sync toggles across UI
    const mainToggle = document.getElementById('streamToggle');
    const mainToggleMobile = document.getElementById('streamToggleMobile');
    const miniToggle = document.getElementById('miniStreamToggle');
    if (mainToggle) mainToggle.checked = val;
    if (mainToggleMobile) mainToggleMobile.checked = val;
    if (miniToggle) miniToggle.checked = val;
    
    const status = isStreamingMode ? "Streaming Active" : "Instant Delivery Mode";
    console.log(status);
}

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
let miniChatHistory = [];
let notes = [];
let noteType = 'note';
let sleepTimer = null;
let noteFilter = 'all';
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
function renderMD(text, noteId = null) {
    let html = marked.parse(text);
    
    // Handle checkboxes generated by Marked (task lists)
    // We replace the disabled attribute and add our class and onclick
    const interactiveCheck = (match) => {
        const isChecked = match.includes('checked');
        return `<input type="checkbox" class="note-checkbox" data-note-id="${noteId || ''}" ${isChecked ? 'checked' : ''} ${noteId ? '' : 'disabled'} onclick="event.stopPropagation(); handleNoteCheckbox(this)">`;
    };

    // This catches marked's typical output for checkboxes and makes them interactive
    html = html.replace(/<input [^>]*type="checkbox"[^>]*>/g, interactiveCheck);

    const div = document.createElement('div');
    div.innerHTML = html;
    
    // Render Math
    if (typeof renderMathInElement === 'function') {
        renderMathInElement(div, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false}
            ],
            throwOnError : false
        });
    }

    return div.innerHTML;
}

// Global bridge for inline checkbox events
async function handleNoteCheckbox(el) {
    const noteId = el.dataset.noteId;
    const isChecked = el.checked;
    await toggleNoteCheckbox(noteId, isChecked, el);
}

async function toggleNoteCheckbox(noteId, isChecked, el) {
    const id = Number(noteId);
    const note = notes.find(n => n.id === id);
    if (!note) return;

    // Identify container to calculate index relative to rendered source
    const container = el.closest('.prose') || el.closest('#notePreview');
    if (!container) return;
    
    const checkboxes = Array.from(container.querySelectorAll('.note-checkbox'));
    const index = checkboxes.indexOf(el);

    let currentIdx = -1;
    const taskRegex = /^([ \t]*[*+-] )\[([ xX])\]/gm;
    
    // 1. Update the status of the clicked checkbox in the raw text
    let updatedText = note.text.replace(taskRegex, (match, prefix, char) => {
        currentIdx++;
        if (currentIdx === index) return `${prefix}[${isChecked ? 'x' : ' '}]`;
        return match;
    });

    // 2. Auto-Sort task blocks: Keep active tasks on top and move completed tasks to bottom of the block
    const lines = updatedText.split('\n');
    const resultLines = [];
    let currentBlock = [];

    const isTaskLine = (l) => /^([ \t]*[*+-] )\[([ xX])\]/.test(l);

    const flushBlock = () => {
        if (currentBlock.length > 0) {
            currentBlock.sort((a, b) => {
                const aChecked = /\[[xX]\]/.test(a);
                const bChecked = /\[[xX]\]/.test(b);
                if (aChecked === bChecked) return 0;
                return aChecked ? 1 : -1; // Unchecked (-1) comes before Checked (1)
            });
            resultLines.push(...currentBlock);
            currentBlock = [];
        }
    };

    for (const line of lines) {
        if (isTaskLine(line)) {
            currentBlock.push(line);
        } else {
            flushBlock();
            resultLines.push(line);
        }
    }
    flushBlock();

    const newText = resultLines.join('\n');
    note.text = newText;
    
    // Refresh the UI to reflect the new order immediately
    renderNotes();
    
    // Synchronize UI if the note is currently open in the immersive editor
    const editIdInput = document.getElementById('editNoteId');
    if (editIdInput && editIdInput.value == id) {
        document.getElementById('editNoteText').value = newText;
        updateEditorStats(document.getElementById('editNoteText'));
    }

    // Sync update to Cloud DB
    try {
        fetch(`/api/main?route=notes&id=${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText })
        });
    } catch (e) { console.error("Checkbox Sync Error:", e); }
}

function filterNotes(query) {
    const searchTerm = query.toLowerCase();
    const list = document.getElementById('notesList');
    
    const filtered = notes.filter(n => {
        const matchesSearch = (n.title && n.title.toLowerCase().includes(searchTerm)) || 
                              (n.text && n.text.toLowerCase().includes(searchTerm));
        const matchesType = noteFilter === 'all' || 
                           (noteFilter === 'note' && (n.type === 'note' || !n.type)) ||
                           (noteFilter === 'todo' && n.type === 'todo');
        return matchesSearch && matchesType;
    });

    renderNotes(filtered);
}

function filterAIHistory(query) {
    const searchTerm = query.toLowerCase();
    const filtered = aiConversations.filter(c => c.name.toLowerCase().includes(searchTerm));
    renderAIHistory(filtered);
}

let autoSaveTimeout;
function debounceAutoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        const modalVisible = !document.getElementById('noteModal').classList.contains('hidden');
        if (modalVisible) saveEditedNote(true);
    }, 2000);
}

function updateEditorStats(el) {
    const text = el.value || "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    
    if (el.id === 'noteInput') {
        document.getElementById('noteWordCount').innerText = words;
        document.getElementById('noteCharCount').innerText = chars;
        // Draft Recovery
        if (text.length > 5) {
            sessionStorage.setItem('soul_note_draft', text);
            document.getElementById('restoreDraftBtn').classList.remove('hidden');
        }
    } else if (el.id === 'editNoteText') {
        document.getElementById('editWordCount').innerText = words;
        document.getElementById('editCharCount').innerText = chars;
        document.getElementById('notePreview').innerHTML = renderMD(text, document.getElementById('editNoteId').value);
        debounceAutoSave();
        // Draft for existing note
        const noteId = document.getElementById('editNoteId').value;
        if (noteId) sessionStorage.setItem(`soul_draft_${noteId}`, text);
    }
}

function restoreDraft() {
    const draft = sessionStorage.getItem('soul_note_draft');
    if (draft) {
        document.getElementById('noteInput').value = draft;
        updateEditorStats(document.getElementById('noteInput'));
        document.getElementById('restoreDraftBtn').classList.add('hidden');
    }
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

// Smart Bullets and Stats for Note Input
document.addEventListener('input', (e) => {
    if (e.target.id === 'noteInput' || e.target.id === 'editNoteText') {
        const el = e.target;
        const val = el.value;
        
        // We handle logic when Enter is pressed (newline appended)
        if (val.endsWith('\n')) {
            const lines = val.split('\n');
            const prevLine = lines[lines.length - 2];
            const trimmedPrev = prevLine.trim();
            
            // Only create next checkbox if previous one is NOT empty
            if ((trimmedPrev.startsWith('- [ ] ') && trimmedPrev.length > 6) || 
                (trimmedPrev.startsWith('- [x] ') && trimmedPrev.length > 6)) {
                el.value += '- [ ] ';
            } 
            else if (trimmedPrev.startsWith('- ') && trimmedPrev.length > 2) {
                el.value += '- ';
            }
            else if (trimmedPrev.startsWith('* ') && trimmedPrev.length > 2) {
                el.value += '* ';
            }
            else if (trimmedPrev.match(/^\d+\. /)) {
                const num = parseInt(trimmedPrev.match(/^\d+/)[0]);
                if (trimmedPrev.length > (num.toString().length + 2)) {
                    el.value += `${num + 1}. `;
                }
            }
        }
        updateEditorStats(el);
    }
});

function setNoteInputType(type) {
    noteType = type;
    const btnNote = document.getElementById('typeBtnNote');
    const btnTodo = document.getElementById('typeBtnTodo');
    const input = document.getElementById('noteInput');
    const toolbar = document.getElementById('noteToolbar');

    if (type === 'todo') {
        btnTodo.className = "px-4 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all bg-purple-600 text-white";
        btnNote.className = "px-4 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all text-gray-400";
        toolbar.classList.add('hidden');
        input.placeholder = "Enter your tasks...";
        if (!input.value.trim()) {
            input.value = "- [ ] ";
        }
    } else {
        btnNote.className = "px-4 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all bg-cyan-600 text-white";
        btnTodo.className = "px-4 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all text-gray-400";
        toolbar.classList.remove('hidden');
        input.placeholder = "Start writing markdown...";
    }
}

function setNoteFilter(filter) {
    noteFilter = filter;
    ['filterAll', 'filterNotes', 'filterTodos', 'filterTrash'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = "text-[10px] font-bold px-3 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10";
    });
    
    const ids = { all: 'filterAll', note: 'filterNotes', todo: 'filterTodos', trash: 'filterTrash' };
    const activeId = ids[filter];
    if (document.getElementById(activeId)) {
        document.getElementById(activeId).className = "text-[10px] font-bold px-3 py-1 rounded-full bg-cyan-600 text-white border border-cyan-500";
    }
    
    syncNotes(true, filter === 'trash');
}

// --- NAVIGATION & ROUTING ---
function showPage(pageId, pushState = true) {
    const validPages = ['home', 'notes', 'ai', 'play', 'random', 'cricket', 'fun', 'support', 'dashboard', 'who', 'manage', 'login', 'legal', 'forgotPass'];
    if (!validPages.includes(pageId)) pageId = 'home';

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(pageId);
    if(page) page.classList.add('active');
    
    // History & URL Management
    if (pushState) {
        const path = pageId === 'home' ? '/' : `/${pageId}`;
        if (window.location.pathname !== path) {
            history.pushState({ pageId }, "", path);
        }
    }

    // Toggle Floating AI Widget visibility based on current page
    const widget = document.getElementById('aiWidget');
    const mini = document.getElementById('miniChat');
    if (pageId === 'ai') {
        widget?.classList.add('hidden');
        mini?.classList.remove('show');
    } else {
        widget?.classList.remove('hidden');
    }

    if (pageId === 'dashboard') loadDashboard();
    if (pageId === 'manage' && currentUser?.isAdmin) {
        loadConfig();
        loadAdminUsers();
    }
    
    // Close sidebar on navigation (mobile)
    const sidebar = document.getElementById('mobileSidebar');
    if (sidebar && sidebar.classList.contains('translate-x-0')) toggleSidebar();
    
    window.scrollTo(0, 0);
}

// Browser Navigation Handler (Back/Forward)
window.addEventListener('popstate', (event) => {
    if (event.state && event.state.pageId) {
        showPage(event.state.pageId, false);
    } else {
        // Fallback to URL path detection if state is missing
        const path = window.location.pathname.substring(1) || 'home';
        showPage(path, false);
    }
});

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
    const theme = document.documentElement.getAttribute('data-theme');
    
    if (!name) return alert("Name cannot be empty");

    setLoading(true, "Updating Profile");
    try {
        const res = await fetch(`/api/main?route=auth&email=${currentUser.email}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password: password || undefined, theme })
        });
        
        if (res.ok) {
            currentUser.name = name;
            currentUser.theme = theme;
            localStorage.setItem('soulUser', JSON.stringify(currentUser));
            updateAuthUI();
            showToast("Profile synchronized successfully!", "success");
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
        const syncTasks = [
            syncNotes(),
            syncAIHistory(),
            syncFunStats(),
            syncCricketHistory(),
            syncRandomHistory(),
            syncMusicPlaylist()
        ];
        
        if (currentUser.isAdmin) {
            syncTasks.push(loadConfig());
            syncTasks.push(loadAdminUsers());
        }

        await Promise.all(syncTasks);
    } finally {
        setLoading(false);
    }
}

async function syncRandomHistory() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=random_history&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            const hist = document.getElementById('omniHistory');
            hist.innerHTML = '';
            
            // Check for saved list content
            const savedList = data.find(item => item.id === 'saved_list_input');
            if (savedList && document.getElementById('listInput')) {
                document.getElementById('listInput').value = savedList.value;
            }

            // Filter out the meta-record from visible history
            const visibleHistory = data.filter(item => item.id !== 'saved_list_input');
            visibleHistory.slice(0, 50).forEach(item => addOmniHistory(item.value, false));
        }
    } catch (e) { console.warn("Random history sync failed", e); }
}

async function saveCurrentList() {
    if (!currentUser) return alert("Login to save your lists!");
    const content = document.getElementById('listInput').value;
    setLoading(true, "Saving List Content");
    try {
        await fetch(`/api/main?route=random_history&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'saved_list_input', value: content })
        });
        alert("List content saved to cloud!");
    } finally {
        setLoading(false);
    }
}

async function saveMusicPlaylist() {
    if (!currentUser) return;
    // We only save non-blob tracks (YouTube or external URLs) to the cloud
    const cloudTracks = musicList.filter(t => {
        // YouTube tracks have 'type' property. External URLs have 'url' but not starting with 'blob:'
        if (t.type === 'youtube') return true;
        if (t.url && !t.url.startsWith('blob:')) return true;
        return false;
    });
    
    try {
        await fetch(`/api/main?route=music_playlist&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'current_playlist', tracks: cloudTracks, timestamp: Date.now() })
        });
    } catch (e) { console.warn("Failed to save playlist to cloud", e); }
}

async function syncMusicPlaylist() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=music_playlist&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            const cloudTracks = data[0].tracks || [];
            // Preserve local tracks currently in the session
            const localTracks = musicList.filter(t => t.url?.startsWith('blob:'));
            musicList = [...cloudTracks, ...localTracks];
            renderPlaylist();
            showToast("Playlist synchronized.", "success");
        }
    } catch (e) { console.warn("Music playlist sync failed", e); }
}

function updateAuthUI() {
    if (currentUser && currentUser.theme) {
        setTheme(currentUser.theme);
    }
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
    localStorage.removeItem('soul_theme');
    setTheme('midnight'); 
    updateAuthUI();
    showPage('login');
}

// --- NOTES LOGIC ---
async function addNote() {
    if (!currentUser) return alert("Login to save notes!");
    const input = document.getElementById('noteInput');
    const titleInput = document.getElementById('noteTitle');
    const deadline = document.getElementById('noteDeadline').value;
    
    if (!input.value.trim() || input.value.trim() === "- [ ]") return;
    
    const note = { 
        id: Date.now(), 
        title: titleInput.value.trim() || null,
        text: input.value, 
        type: noteType,
        userId: currentUser.email,
        deadline: deadline || null
    };
    
    notes.unshift(note);
    renderNotes();
    
    // Clear Draft
    sessionStorage.removeItem('soul_note_draft');
    document.getElementById('restoreDraftBtn').classList.add('hidden');
    
    // Reset fields
    input.value = '';
    titleInput.value = '';
    document.getElementById('noteDeadline').value = '';
    if (noteType === 'todo') input.value = "- [ ] ";
    
    updateEditorStats(input);
    showToast("Note anchored to the vault!", "success");
    await saveNotesToDB(note);
}

function renderNotes(providedNotes = null) {
    const list = document.getElementById('notesList');
    const sourceData = providedNotes || notes;
    
    const filteredNotes = providedNotes ? sourceData : sourceData.filter(n => {
        if (noteFilter === 'trash') return n.isDeleted;
        if (n.isDeleted) return false;
        if (noteFilter === 'all') return true;
        if (noteFilter === 'note') return (n.type === 'note' || !n.type);
        if (noteFilter === 'todo') return n.type === 'todo';
        return true;
    });

    if (filteredNotes.length === 0) {
        list.innerHTML = `<div class="col-span-full py-20 text-center opacity-30">
            <i class="fas ${noteFilter === 'todo' ? 'fa-tasks' : 'fa-sticky-note'} text-6xl mb-4"></i>
            <p>${noteFilter === 'all' ? 'Your vault is empty.' : 'No items found for this category.'}</p>
        </div>`;
        return;
    }

    list.innerHTML = filteredNotes.map(n => {
        let deadlineBadge = '';
        if (n.deadline) {
            const diff = new Date(n.deadline) - new Date();
            const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
            const colorClass = days < 0 ? 'text-red-400 bg-red-400/10' : days <= 2 ? 'text-orange-400 bg-orange-400/10' : 'text-cyan-400 bg-cyan-400/10';
            deadlineBadge = `<span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${colorClass}">${days < 0 ? 'OVERDUE' : days === 0 ? 'DUE TODAY' : days + ' DAYS LEFT'}</span>`;
        }

        const isTodo = n.type === 'todo';
        const displayTitle = n.title || (isTodo ? 'Task List' : 'Untitled Note');
        const isLocked = !!n.lockCode;
        const isPinned = !!n.isPinned;
        const isTrash = !!n.isDeleted;

        return `
            <div onclick="openNote('${n.id}')" class="glass p-5 rounded-2xl border ${isPinned ? 'border-yellow-500 shadow-lg shadow-yellow-500/10' : (isTodo ? 'border-purple-500/20' : 'border-white/5')} flex flex-col h-full cursor-pointer hover:border-cyan-500/30 transition-all group relative overflow-hidden">
                <div class="absolute top-0 right-0 p-3 flex gap-2 z-10">
                    ${deadlineBadge}
                    ${isPinned ? '<i class="fas fa-thumbtack text-yellow-500 pinned-icon transform rotate-45"></i>' : ''}
                </div>
                <div class="mb-3">
                    <span class="text-[9px] font-black uppercase tracking-widest ${isTodo ? 'text-purple-400' : 'text-cyan-400'}">${isTodo ? 'Task List' : 'Note'}</span>
                    <h3 class="text-sm font-bold truncate pr-16">${displayTitle}</h3>
                </div>
                <div class="prose prose-invert prose-sm max-h-48 overflow-hidden mb-6 flex-grow">
                    ${isLocked ? `
                        <div class="flex flex-col items-center justify-center py-4 text-gray-500 opacity-50">
                            <i class="fas fa-lock text-3xl mb-2"></i>
                            <p class="text-[10px] font-bold uppercase">Encrypted sOuLNOTE</p>
                        </div>
                    ` : `
                        ${renderMD(n.text, n.id)}
                    `}
                </div>
                <div class="flex justify-between items-center text-[10px] text-gray-500 pt-4 border-t border-white/5">
                    <div class="flex items-center gap-2">
                        <i class="far fa-calendar-alt"></i>
                        <span>${new Date(n.id).toLocaleDateString()}</span>
                    </div>
                    <div class="flex gap-4">
                        ${!isTrash ? `
                        <button onclick="event.stopPropagation(); togglePin('${n.id}')" class="text-gray-500 hover:text-yellow-500 transition text-sm" title="Pin Note"><i class="fas fa-thumbtack"></i></button>
                        <div class="relative group/export">
                            <button onclick="event.stopPropagation()" class="text-gray-500 hover:text-cyan-400 transition text-sm" title="Export Note"><i class="fas fa-file-export"></i></button>
                            <div class="absolute bottom-full right-0 pb-2 hidden group-hover/export:flex flex-col z-50 animate-fadeIn">
                                <div class="bg-gray-900 border border-white/10 rounded-xl shadow-2xl py-2 min-w-[100px] overflow-hidden">
                                    <button onclick="event.stopPropagation(); exportData('note', '${n.id}', 'pdf')" class="w-full px-4 py-2 text-left hover:bg-cyan-600/20 text-[10px] font-bold">PDF</button>
                                    <button onclick="event.stopPropagation(); exportData('note', '${n.id}', 'markdown')" class="w-full px-4 py-2 text-left hover:bg-cyan-600/20 text-[10px] font-bold">Markdown</button>
                                    <button onclick="event.stopPropagation(); exportData('note', '${n.id}', 'txt')" class="w-full px-4 py-2 text-left hover:bg-cyan-600/20 text-[10px] font-bold">Plain Text</button>
                                </div>
                            </div>
                        </div>
                        ` : `
                        <button onclick="event.stopPropagation(); restoreFromTrash('${n.id}')" class="text-green-400 hover:text-green-300 transition text-sm" title="Restore"><i class="fas fa-undo"></i></button>
                        `}
                        <button onclick="event.stopPropagation(); deleteNote('${n.id}', ${isTrash})" class="text-gray-500 hover:text-red-400 transition text-sm" title="${isTrash ? 'Permanent Delete' : 'Move to Trash'}"><i class="fas ${isTrash ? 'fa-fire' : 'fa-trash-can'}"></i></button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function openNote(id) {
    id = Number(id);
    const note = notes.find(n => n.id === id);
    if (!note) return;

    if (note.lockCode) {
        const code = prompt("This note is protected. Enter access code:");
        if (code !== note.lockCode) {
            showToast("Access Denied", "error");
            return;
        }
    }

    const draft = sessionStorage.getItem(`soul_draft_${id}`);
    if (draft && draft !== note.text) {
        if (confirm("You have an unsaved draft for this note. Restore it?")) {
            note.text = draft;
        } else {
            sessionStorage.removeItem(`soul_draft_${id}`);
        }
    }

    document.getElementById('editNoteId').value = id;
    document.getElementById('editNoteText').value = note.text;
    document.getElementById('editNoteDeadline').value = note.deadline || '';
    document.getElementById('editNoteMeta').innerText = `CREATED: ${new Date(id).toLocaleString()}`;
    document.getElementById('wordGoal').value = note.wordGoal || 0;
    
    updateEditorStats(document.getElementById('editNoteText'));
    updateGoalProgress();
    
    document.getElementById('noteModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Lock background scroll
}

function closeNoteModal() {
    document.getElementById('noteModal').classList.add('hidden');
    document.body.style.overflow = '';
}

async function saveEditedNote(isAutoSave = false) {
    const id = parseInt(document.getElementById('editNoteId').value);
    const text = document.getElementById('editNoteText').value;
    const deadline = document.getElementById('editNoteDeadline').value;
    const wordGoal = parseInt(document.getElementById('wordGoal').value) || 0;

    const noteIdx = notes.findIndex(n => n.id === id);
    
    if (noteIdx > -1) {
        const updatedFields = { 
            text, 
            deadline: deadline || null, 
            wordGoal
        };

        Object.assign(notes[noteIdx], updatedFields);
        renderNotes();
        
        if (!isAutoSave) {
            closeNoteModal();
            sessionStorage.removeItem(`soul_draft_${id}`);
            showToast("Changes committed to cloud.", "success");
        }
        
        try {
            await fetch(`/api/main?route=notes&id=${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedFields)
            });
        } catch (e) { console.error("Cloud sync error:", e); }
    }
}

async function deleteNote(id, permanent = false) {
    id = Number(id);
    const msg = permanent ? "Permanently delete this note? This cannot be undone." : "Move this note to Trash? It will be kept for 30 days.";
    if(!confirm(msg)) return;
    
    if (permanent) {
        notes = notes.filter(n => n.id !== id);
    } else {
        const note = notes.find(n => n.id === id);
        if (note) {
            note.isDeleted = true;
            note.deletedAt = Date.now();
        }
    }
    
    renderNotes();
    showToast(permanent ? "Note purged." : "Note moved to Trash.", "warning");
    
    try {
        await fetch(`/api/main?route=notes&id=${id}&perm=${permanent}`, { method: 'DELETE' });
    } catch (e) { console.error("Delete failed:", e); }
}

async function restoreFromTrash(id) {
    id = Number(id);
    const note = notes.find(n => n.id === id);
    if (note) {
        note.isDeleted = false;
        renderNotes();
        await fetch(`/api/main?route=notes&id=${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isDeleted: false })
        });
        showToast("Note restored from trash.", "success");
    }
}

async function syncNotes(silent = true, showTrash = false) {
    if(!currentUser) return;
    const res = await fetch(`/api/main?route=notes&userId=${encodeURIComponent(currentUser.email)}&trash=${showTrash}`);
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

function updateRandomMode() {
    const mode = document.getElementById('randMode').value;
    document.querySelectorAll('.rand-cfg').forEach(el => el.classList.add('hidden'));
    document.getElementById(`cfg_${mode}`).classList.remove('hidden');
    
    // UI Reset
    const btn = document.getElementById('mainGenBtn');
    btn.classList.remove('hidden');
    if (mode === 'dice' || mode === 'list') btn.classList.add('hidden');
}

async function generateOmniRandom() {
    const mode = document.getElementById('randMode').value;
    const resText = document.getElementById('omniResultText');
    const resMeta = document.getElementById('omniResultMeta');
    const preview = document.getElementById('omniResultPreview');
    
    let result = "";
    let meta = "";
    preview.style.backgroundColor = 'transparent';

    if (mode === 'number') {
        const min = parseInt(document.getElementById('numMin').value);
        const max = parseInt(document.getElementById('numMax').value);
        const count = parseInt(document.getElementById('numCount').value);
        const unique = document.getElementById('numUnique').checked;
        
        let nums = [];
        if (unique && count > (max - min + 1)) {
            alert("Count cannot be larger than the range for unique numbers.");
            return;
        }

        while (nums.length < count) {
            let r = Math.floor(Math.random() * (max - min + 1)) + min;
            if (!unique || !nums.includes(r)) nums.push(r);
        }
        result = nums.join(', ');
        meta = `Generated ${count} number(s) [${min} to ${max}]`;
    } 
    else if (mode === 'color') {
        const format = document.getElementById('colorFormat').value;
        if (format === 'hex') {
            result = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0').toUpperCase();
        } else if (format === 'rgb') {
            const r = Math.floor(Math.random()*256), g = Math.floor(Math.random()*256), b = Math.floor(Math.random()*256);
            result = `rgb(${r}, ${g}, ${b})`;
        } else {
            const h = Math.floor(Math.random()*361), s = Math.floor(Math.random()*101), l = Math.floor(Math.random()*101);
            result = `hsl(${h}, ${s}%, ${l}%)`;
        }
        preview.style.backgroundColor = result;
        meta = `Random ${format.toUpperCase()} color`;
    }
    else if (mode === 'string') {
        const len = parseInt(document.getElementById('strLen').value);
        const u = document.getElementById('strUpper').checked ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '';
        const l = document.getElementById('strLower').checked ? 'abcdefghijklmnopqrstuvwxyz' : '';
        const n = document.getElementById('strNum').checked ? '0123456789' : '';
        const s = document.getElementById('strSym').checked ? '!@#$%^&*()_+~`|}{[]:;?><,./-=' : '';
        const pool = u + l + n + s;
        if (!pool) return alert("Select at least one character type.");
        
        for (let i = 0; i < len; i++) result += pool.charAt(Math.floor(Math.random() * pool.length));
        meta = `Secure string generated (${len} chars)`;
    }
    else if (mode === 'datetime') {
        const start = new Date(document.getElementById('dateStart').value || '1970-01-01').getTime();
        const end = new Date(document.getElementById('dateEnd').value || Date.now()).getTime();
        const randTime = Math.floor(Math.random() * (end - start + 1)) + start;
        const d = new Date(randTime);
        result = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        meta = "Random timestamp within range";
    }

    resText.innerText = result;
    resMeta.innerText = meta;
    addOmniHistory(result, true);
    showToast("Randomization complete.", "info");
    await saveRandomHistory(mode, result);
}

function pickFromList(type) {
    const raw = document.getElementById('listInput').value;
    const items = raw.split(/[\n,]/).map(i => i.trim()).filter(i => i);
    if (!items.length) return alert("Please enter some items.");

    const resText = document.getElementById('omniResultText');
    const resMeta = document.getElementById('omniResultMeta');
    
    if (type === 'pick') {
        const res = items[Math.floor(Math.random() * items.length)];
        resText.innerText = res;
        resMeta.innerText = `Selected from ${items.length} items`;
        addOmniHistory(res, true);
        saveRandomHistory('list-pick', res);
    } else {
        const shuffled = [...items].sort(() => Math.random() - 0.5);
        const resVal = shuffled.join(' → ');
        resText.innerText = resVal;
        resMeta.innerText = `Shuffled ${items.length} items`;
        addOmniHistory(resVal, true);
        saveRandomHistory('list-shuffle', shuffled.join(', '));
    }
}

function rollDice(sides) {
    const resText = document.getElementById('omniResultText');
    const resMeta = document.getElementById('omniResultMeta');
    
    if (sides === 2) {
        const res = Math.random() > 0.5 ? "HEADS" : "TAILS";
        resText.innerText = res;
        resMeta.innerText = "Coin Toss Result";
    } else {
        const res = Math.floor(Math.random() * sides) + 1;
        resText.innerText = res;
        resMeta.innerText = `D${sides} Dice Roll`;
    }
    addOmniHistory(resText.innerText, true);
    saveRandomHistory('dice', resText.innerText);
}

function addOmniHistory(val, isNew = true) {
    const hist = document.getElementById('omniHistory');
    if (hist.querySelector('p')) hist.innerHTML = '';
    const span = document.createElement('span');
    span.className = "px-2 py-1 bg-white/5 border border-white/5 rounded text-[10px] text-gray-400 font-mono cursor-pointer hover:bg-white/10 transition max-w-[150px] truncate";
    span.innerText = val;
    span.onclick = () => {
        document.getElementById('omniResultText').innerText = val;
        navigator.clipboard.writeText(val);
    };
    hist.prepend(span);
}

function copyOmniResult() {
    const txt = document.getElementById('omniResultText').innerText;
    if (txt === "...") return;
    navigator.clipboard.writeText(txt);
    showToast("Copied to clipboard!", "info");
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
            'modestbranding': 1,
            'origin': window.location.origin
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    const savedVol = localStorage.getItem('soulVolume');
    if (savedVol !== null) {
        event.target.setVolume(parseFloat(savedVol) * 100);
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

        const statusMsg = document.createElement('div');
        statusMsg.className = "fixed bottom-24 right-4 bg-cyan-600 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg animate-bounce z-[100]";
        statusMsg.innerText = "Added to sOuLPLAY Library";
        document.body.appendChild(statusMsg);
        setTimeout(() => statusMsg.remove(), 2000);

        saveMusicPlaylist();
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
    
    showToast(`${title} added to sOuLPLAY Library`, "success");
    saveMusicPlaylist();
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
    saveMusicPlaylist();
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
    saveMusicPlaylist();
}

function renameTrack(index) {
    const newName = prompt("Rename track:", musicList[index].name);
    if (newName && newName.trim()) {
        musicList[index].name = newName.trim();
        if (index === currentTrackIndex) {
            document.getElementById('trackName').innerText = newName.trim();
        }
        renderPlaylist();
        saveMusicPlaylist();
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

function setSleepTimer(minutes) {
    if (sleepTimer) {
        clearTimeout(sleepTimer);
        sleepTimer = null;
    }
    
    if (minutes === 0) {
        alert("Sleep timer disabled.");
        return;
    }
    
    alert(`Sleep timer set for ${minutes} minutes.`);
    sleepTimer = setTimeout(() => {
        if (isMusicPlaying) toggleMusic();
        alert("Sleep timer active: Music paused.");
        sleepTimer = null;
    }, minutes * 60000);
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
    localStorage.setItem('soulVolume', vol);
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
    saveMusicPlaylist();
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
    const adminEmail = currentUser ? currentUser.email : '';
    const res = await fetch(`/api/main?route=admin_config&adminEmail=${encodeURIComponent(adminEmail)}`);
    const data = await res.json();
    if(data) {
        aiConfig.keys = data.keys || [];
        aiConfig.models = data.models || [];
        aiConfig.miniChatModel = data.miniChatModel || "gemini-1.5-flash";
        aiConfig.razorpayKey = data.razorpayKey;
        updateAIUI();
        if (document.getElementById('statKeys')) document.getElementById('statKeys').innerText = aiConfig.keys.length;
        if (document.getElementById('apiKeys')) document.getElementById('apiKeys').value = aiConfig.keys.join(', ');
        if (document.getElementById('modelList')) document.getElementById('modelList').value = JSON.stringify(aiConfig.models);
        if (document.getElementById('miniChatModelId')) document.getElementById('miniChatModelId').value = aiConfig.miniChatModel;
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

function renderAIHistory(providedHistory = null) {
    const list = document.getElementById('chatHistoryList');
    const bulkBar = document.getElementById('aiBulkActions');
    const displayData = providedHistory || aiConversations;
    
    if (displayData.length === 0) {
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

    list.innerHTML = displayData.map(c => {
        const isSelected = selectedConversations.has(Number(c.id));
        const isActive = c.id === currentChatId;
        return `
            <div onclick="loadConversation('${c.id}')" class="group relative flex items-center rounded-xl transition-all duration-200 cursor-pointer overflow-hidden mb-1 ${isActive ? 'bg-purple-600/20 border border-purple-500/50 shadow-lg shadow-purple-900/20' : 'bg-white/5 border border-transparent hover:bg-white/10 hover:border-white/10'}">
                <div class="flex items-center justify-center w-8 pl-2">
                    <input type="checkbox" class="accent-purple-500 w-3.5 h-3.5 rounded cursor-pointer" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleConvSelection(${c.id})">
                </div>
                <div class="flex-grow py-3 pl-1 pr-12 text-[11px] font-medium truncate ${isActive ? 'text-white' : 'text-gray-400'}">
                    <i class="fas fa-comment-alt mr-2 opacity-50"></i> ${c.name}
                </div>
                <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button onclick="event.stopPropagation(); renameConversation('${c.id}')" class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-cyan-500/20 text-gray-400 hover:text-cyan-400 transition-colors" title="Rename"><i class="fas fa-pen text-[8px]"></i></button>
                    <button onclick="event.stopPropagation(); deleteConversation('${c.id}')" class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors" title="Delete"><i class="fas fa-trash-alt text-[8px]"></i></button>
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

    const count = selectedConversations.size;
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
        showToast(`${count} conversations purged.`, "warning");
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
            if (!isAutoSave) setLoading(false);
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

    // If finished, add copy buttons (both Markdown and Plain Text)
    if (!isStreaming) {
        let copyGroup = msgDiv.querySelector('.msg-copy-group');
        if (!copyGroup) {
            copyGroup = document.createElement('div');
            copyGroup.className = "msg-copy-group absolute top-1 right-1 md:top-2 md:right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition z-10";
            msgDiv.appendChild(copyGroup);
        }
        
        copyGroup.innerHTML = ''; // Clear previous

        const btnClass = "bg-black/40 backdrop-blur-sm p-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-gray-400 transition-all flex items-center justify-center min-w-[28px]";
        
        // Markdown Copy Button (Rawest form)
        const copyMD = document.createElement('button');
        copyMD.className = btnClass;
        copyMD.title = "Copy Raw Markdown";
        copyMD.innerHTML = '<i class="fas fa-file-code text-[10px]"></i>';
        copyMD.onclick = () => {
            navigator.clipboard.writeText(content);
            copyMD.innerHTML = '<i class="fas fa-check text-green-400 text-[10px]"></i>';
            setTimeout(() => copyMD.innerHTML = '<i class="fas fa-file-code text-[10px]"></i>', 2000);
        };
        
        // Plain Text Copy Button (Rendered form)
        const copyText = document.createElement('button');
        copyText.className = btnClass;
        copyText.title = "Copy Plain Text";
        copyText.innerHTML = '<i class="far fa-copy text-[10px]"></i>';
        copyText.onclick = () => {
            navigator.clipboard.writeText(contentDiv.innerText);
            copyText.innerHTML = '<i class="fas fa-check text-green-400 text-[10px]"></i>';
            setTimeout(() => copyText.innerHTML = '<i class="far fa-copy text-[10px]"></i>', 2000);
        };

        const speakBtn = document.createElement('button');
        speakBtn.className = btnClass;
        speakBtn.title = "Read Aloud";
        speakBtn.innerHTML = '<i class="fas fa-volume-up text-[10px]"></i>';
        speakBtn.onclick = () => speakAIMessage(content, speakBtn);

        copyGroup.appendChild(speakBtn);
        copyGroup.appendChild(copyMD);
        copyGroup.appendChild(copyText);
        
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
                // For text files, we keep a raw copy for editing using UTF-8 aware decoding
                const raw = new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
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
let sttForceStop = false;
function toggleSTT(isMini = false) {
    const btnId = isMini ? 'miniSttBtn' : 'sttBtn';
    const inputId = isMini ? 'miniChatInput' : 'chatInput';
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);

    if (!('webkitSpeechRecognition' in window)) {
        return alert("Speech recognition not supported in this browser.");
    }

    if (recognition && recognition.active) {
        sttForceStop = true;
        recognition.stop();
        return;
    }

    sttForceStop = false;
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        btn.innerHTML = `<i class="fas fa-stop-circle text-red-500 animate-pulse ${isMini ? 'text-[10px]' : ''}"></i>`;
        btn.classList.add('bg-purple-600/20', 'border-purple-500/50', 'text-purple-400');
        recognition.active = true;
    };

    recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            }
        }
        
        if (finalTranscript) {
            const result = finalTranscript.trim();
            const start = input.selectionStart || 0;
            const end = input.selectionEnd || 0;
            const text = input.value;
            input.value = text.substring(0, start) + result + " " + text.substring(end);
            const newPos = start + result.length + 1;
            input.focus();
            input.setSelectionRange(newPos, newPos);
            if (!isMini && input.id === 'chatInput') autoResize(input);
        }
    };

    recognition.onerror = () => {
        sttForceStop = true;
        btn.innerHTML = `<i class="fas fa-microphone ${isMini ? 'text-xs' : ''}"></i>`;
        btn.classList.remove('bg-purple-600/20', 'border-purple-500/50', 'text-purple-400');
        recognition.active = false;
    };

    recognition.onend = () => {
        if (!sttForceStop) {
            recognition.start();
        } else {
            btn.innerHTML = `<i class="fas fa-microphone ${isMini ? 'text-xs' : ''}"></i>`;
            btn.classList.remove('bg-purple-600/20', 'border-purple-500/50', 'text-purple-400');
            recognition.active = false;
        }
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
    // Modern UTF-8 to Base64 encoding
    const base64 = btoa(new TextEncoder().encode(content).reduce((data, byte) => data + String.fromCharCode(byte), ''));
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
        pendingFiles[editingAttachmentIdx].data = btoa(new TextEncoder().encode(content).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        renderAttachmentChips();
    } else {
        if (content.length > 3000) {
            addTextAsAttachment(content);
            document.getElementById('chatInput').value = '';
        } else {
            const input = document.getElementById('chatInput');
            input.value = content;
            autoResize(input);
        }
    }
    toggleLargeEditor();
}

async function exportData(type, id, format) {
    if (!id) {
        alert("Selection required for export.");
        return;
    }
    let payload = null;
    
    if (type === 'chat') {
        payload = aiConversations.find(c => c.id === Number(id));
    } else {
        payload = notes.find(n => n.id === Number(id));
    }
    
    if (!payload) return;

    setLoading(true, `Generating ${format.toUpperCase()} Document...`);
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // Increased to 60s for large PDFs

        const response = await fetch('/api/main?route=export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, format, data: payload }),
            signal: controller.signal
        }).catch(err => {
            if (err.name === 'AbortError') throw new Error("Export timed out. The file might be too large.");
            throw new Error("Network error: Server connection reset during export.");
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            let errorMsg = "Export failed.";
            const text = await response.text();
            try {
                const errData = JSON.parse(text);
                errorMsg = errData.error || errorMsg;
            } catch(e) {
                errorMsg = text || errorMsg;
            }
            throw new Error(errorMsg);
        }
        
        const blob = await response.blob();
        if (blob.size === 0) throw new Error("Generated file is empty.");

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const ext = format === 'markdown' ? 'md' : format;
        a.download = `sOuLViSiON_${type}_${id}.${ext}`;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);

    } catch (e) {
        console.error("Export Error:", e);
        alert(`Export Failed: ${e.message === 'The user aborted a request.' ? 'Request timed out. The file might be too large for PDF conversion.' : e.message}`);
    } finally {
        setLoading(false);
    }
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
    const persona = document.getElementById('personaSelect').value;
    let input = inputEl.value;
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
    
    const parts = [];
    if (persona && (!conv || conv.messages.length === 0)) {
        parts.push({ text: persona + "\n\n" + (input || " ") });
    } else {
        parts.push({ text: input || " " });
    }
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
    const txt = inputEl.value;
    if(!txt.trim() && pendingFiles.length === 0) return;
    
    const userDisplayMsg = txt + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userDisplayMsg, 'miniChatBox');
    
    inputEl.value = '';
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });

    const parts = [{ text: txt || " " }];
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    
    miniChatHistory.push({ role: 'user', content: userDisplayMsg, parts });

    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];
    
    await callGeminiAPI(txt, 'miniChatBox', miniChatHistory, attachmentsForApi);
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

    const statusEl = document.getElementById(targetBoxId === 'chatBox' ? 'aiStatus' : 'miniAiStatus');
    const loadingPhrases = isStreamingMode ? [
        "Establishing neural stream...",
        "Buffering consciousness...",
        "Decoding tokenized reality...",
        "Synapsing response nodes...",
        "Venturing into latent space..."
    ] : [
        "Analyzing intent vectors...",
        "Querying sOuL-Core matrix...",
        "Synthesizing multi-dimensional context...",
        "Optimizing synaptic weights...",
        "Decrypting intelligence protocols...",
        "Resolving probabilistic outputs...",
        "Formulating definitive response..."
    ];
    let phraseIdx = 0;
    let loadingInterval = null;

    const quietBtn = document.getElementById('quietBtn');
    const miniQuietBtn = document.getElementById('miniQuietBtn');

    if(statusEl) { 
        if (quietBtn) quietBtn.classList.remove('hidden');
        if (miniQuietBtn) miniQuietBtn.classList.remove('hidden');
        statusEl.innerHTML = `
            <div class="neural-loader">
                <div class="neural-grid">
                    <div class="grid-dot"></div>
                    <div class="grid-dot"></div>
                    <div class="grid-dot"></div>
                    <div class="grid-dot"></div>
                </div>
                <div class="flex flex-col">
                    <span class="text-[9px] font-black tracking-[0.2em] text-purple-400 uppercase flex items-center gap-2">
                        <span class="status-dot"></span>
                        ${isStreamingMode ? 'Streaming Core Active' : 'Static Computation'}
                    </span>
                    <span class="neural-text text-[8px] text-gray-500 font-mono mt-0.5">Initializing uplink...</span>
                </div>
                <div class="ml-auto flex gap-1">
                    <div class="pulse-bar"></div>
                    <div class="pulse-bar"></div>
                    <div class="pulse-bar"></div>
                </div>
            </div>`; 
        statusEl.classList.remove('hidden'); 
    }

    const contents = history.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: m.parts || [{ text: m.content }]
    }));

    if (contents.length === 0 || contents[contents.length-1].role === 'model') {
        const currentParts = [{ text: text }];
        attachments.forEach(a => currentParts.push({ inline_data: { mime_type: a.mime_type, data: a.data } }));
        contents.push({ role: 'user', parts: currentParts });
    }

    currentAbortController = new AbortController();
    try {
        const endpoint = isStreamingMode ? 'streamGenerateContent' : 'generateContent';
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${aiConfig.keys[currentKeyIndex]}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents }),
            signal: currentAbortController.signal
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || "API Error");
        }

        if (statusEl) {
            const neuralText = statusEl.querySelector('.neural-text');
            loadingInterval = setInterval(() => {
                if(neuralText) neuralText.innerText = loadingPhrases[phraseIdx] + "...";
                phraseIdx = (phraseIdx + 1) % loadingPhrases.length;
                // Keep scrolling so status stays visible
                const box = document.getElementById(targetBoxId);
                if(box) box.scrollTop = box.scrollHeight;
            }, 1200);
        }

        let fullContent = "";
        
        if (isStreamingMode) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            appendAIMessage('ai', '<div class="typing-dots"><span></span><span></span><span></span></div>', targetBoxId, true);
            
            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
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
                        if (braceCount === 0) { endIdx = i; break; }
                    }
                    if (endIdx === -1) break;
                    const chunkStr = tempBuffer.substring(startIdx, endIdx + 1);
                    try {
                        const chunk = JSON.parse(chunkStr);
                        const textPart = chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
                        if (textPart) {
                            fullContent += textPart;
                            appendAIMessage('ai', fullContent, targetBoxId, true);
                        }
                    } catch (e) {}
                    tempBuffer = tempBuffer.substring(endIdx + 1).trim();
                    if (tempBuffer.startsWith(',')) tempBuffer = tempBuffer.substring(1).trim();
                }
                return tempBuffer;
            }
        } else {
            const data = await response.json();
            fullContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        }

        if (loadingInterval) clearInterval(loadingInterval);
        appendAIMessage('ai', fullContent, targetBoxId, false);
        
        if (quietBtn) quietBtn.classList.add('hidden');
        if (miniQuietBtn) miniQuietBtn.classList.add('hidden');
        currentAbortController = null;
        
        if(statusEl) {
            statusEl.innerHTML = `
                <div class="flex items-center gap-2 animate-fadeOut">
                    <i class="fas fa-check-circle text-green-500 text-xs"></i>
                    <span class="text-[9px] font-black tracking-widest text-green-500/80 uppercase">Intelligence Received</span>
                </div>`;
            setTimeout(() => statusEl.classList.add('hidden'), 1500);
        }

        if (targetBoxId === 'chatBox' && currentChatId) {
            const conv = aiConversations.find(c => c.id === currentChatId);
            if (conv) {
                conv.messages.push({ role: 'ai', content: fullContent });
                await saveAIHistory(conv);
            }
        } else if (targetBoxId === 'miniChatBox') {
            miniChatHistory.push({ role: 'ai', content: fullContent });
        }
    } catch (err) {
        if (loadingInterval) clearInterval(loadingInterval);
        if (quietBtn) quietBtn.classList.add('hidden');
        if (miniQuietBtn) miniQuietBtn.classList.add('hidden');
        
        if (err.name === 'AbortError') {
            currentAbortController = null;
            if (statusEl) statusEl.classList.add('hidden');
            return;
        }
        
        console.warn(`Key ${currentKeyIndex} error: ${err.message}.`);
        if (aiConfig.keys.length > 1) {
            currentKeyIndex = (currentKeyIndex + 1) % aiConfig.keys.length;
            return await callGeminiAPI(text, targetBoxId, history, attachments);
        }
        if(statusEl) statusEl.classList.add('hidden');
        appendAIMessage('ai', `**System Failure:** ${err.message}`, targetBoxId);
    }
}

// AI logic replaced by unified streaming/file functions above
function clearChat() { 
    if(confirm("Purge all visible messages in this view?")) {
        document.getElementById('chatBox').innerHTML = ''; 
    }
}

function clearMiniChat() {
    if(confirm("Purge mini-chat session and history?")) {
        document.getElementById('miniChatBox').innerHTML = '';
        miniChatHistory = [];
    }
}

async function exportMiniChat(format) {
    const box = document.getElementById('miniChatBox');
    const messages = [];
    box.querySelectorAll('.message').forEach(msg => {
        const role = msg.classList.contains('user-msg') ? 'user' : 'ai';
        const content = msg.querySelector('.markdown-body').innerText;
        messages.push({ role, content });
    });
    
    if(messages.length === 0) return alert("Nothing to export!");
    showToast(`Preparing ${format.toUpperCase()} export...`, "info");
    const data = { id: Date.now(), name: "Mini Chat Conversation", messages };
    await exportData('chat', data.id, format);
}

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
    if (window.navigator.vibrate) window.navigator.vibrate(5);
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

function setCricketDifficulty(level, btn) {
    document.getElementById('cricketDifficulty').value = level;
    document.querySelectorAll('.diff-btn').forEach(b => {
        b.className = "diff-btn bg-gray-800 py-2 rounded-lg text-[10px] font-bold border border-white/5 hover:border-cyan-500/50";
    });
    const colors = { easy: 'green', normal: 'cyan', hard: 'red' };
    const color = colors[level];
    btn.className = `diff-btn bg-${color}-600 py-2 rounded-lg text-[10px] font-bold border border-${color}-400/50 shadow-lg shadow-${color}-600/20`;
}

async function startMatch() {
    const tA = document.getElementById('teamAName').value;
    const tB = document.getElementById('teamBName').value;
    const pA = document.getElementById('teamAPlayers').value;
    const pB = document.getElementById('teamBPlayers').value;
    const oversVal = document.getElementById('cricketOversSelect').value;
    const difficulty = document.getElementById('cricketDifficulty').value;
    
    match.difficulty = difficulty;
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
    if (window.navigator.vibrate) window.navigator.vibrate(10);
    const battingTeam = match.teams[match.currentInnings];
    const bowlingTeam = match.teams[match.currentInnings === 0 ? 1 : 0];
    const maxBalls = match.maxOvers * 6;
    
    if(battingTeam.wickets >= 10 || battingTeam.balls >= maxBalls || (match.target && battingTeam.score >= match.target)) {
        endInnings(); return;
    }

    const striker = battingTeam.players[match.strikerIdx];
    const bowler = bowlingTeam.players[match.bowlerIdx];
    
    let outcomes = [0, 1, 2, 3, 4, 6, 'W'];
    if (match.difficulty === 'easy') outcomes = [0, 1, 2, 3, 4, 6, 4, 6, 1, 2, 'W'];
    if (match.difficulty === 'hard') outcomes = [0, 1, 2, 'W', 'W', 3, 0, 1];

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
        
        if (striker.runs >= 100 && !striker.milestoneReached) {
            striker.milestoneReached = true;
            triggerCricketCelebration('milestone', `${striker.name} hits a magnificent 100!`);
        }

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

function triggerCricketCelebration(type, detail) {
    const overlay = document.getElementById('cricketOverlay');
    const trophy = document.getElementById('trophyAnim');
    const milestone = document.getElementById('milestoneAnim');
    const canvas = document.getElementById('confettiCanvas');
    
    overlay.classList.remove('hidden');
    
    if (type === 'victory') {
        trophy.classList.remove('hidden');
        document.getElementById('victoryDetail').innerText = detail;
        setTimeout(() => trophy.classList.add('scale-100'), 10);
    } else {
        milestone.classList.remove('hidden');
        document.getElementById('milestoneDetail').innerText = detail;
    }

    // Basic Confetti
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    let particles = Array.from({ length: 150 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
        size: Math.random() * 8 + 4,
        speed: Math.random() * 5 + 2
    }));

    function draw() {
        ctx.clearRect(0,0, canvas.width, canvas.height);
        particles.forEach(p => {
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.size, p.size);
            p.y += p.speed;
            if (p.y > canvas.height) p.y = -10;
        });
        if (overlay.classList.contains('hidden')) return;
        requestAnimationFrame(draw);
    }
    draw();

    setTimeout(() => {
        overlay.classList.add('hidden');
        trophy.classList.add('hidden', 'scale-0');
        milestone.classList.add('hidden');
    }, 5000);
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
        const isT2Win = t2.score >= match.target;
        let winMsg = isT2Win ? `${t2.name} Wins!` : t2.score === match.target - 1 ? "Match Tied!" : `${t1.name} Wins!`;
        
        document.getElementById('status').innerText = winMsg;
        document.getElementById('newMatchBtn').classList.remove('hidden');
        
        triggerCricketCelebration('victory', winMsg);

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
    const leader = document.getElementById('cricketLeaderboard');
    
    const tabs = { setup: 'cricketSetupTab', history: 'cricketHistoryTab', leaderboard: 'cricketLeaderTab' };
    const pages = { setup: setup, history: archives, ground: ground, leaderboard: leader };

    Object.values(pages).forEach(p => p.classList.add('hidden'));
    Object.values(tabs).forEach(t => {
        const el = document.getElementById(t);
        if (el) el.className = "hover:bg-white/5 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-bold transition text-gray-400";
    });

    if (view === 'setup') {
        setup.classList.remove('hidden');
        document.getElementById('cricketSetupTab').className = "bg-cyan-600/20 text-cyan-400 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-bold border border-cyan-500/30";
    } else if (view === 'history') {
        archives.classList.remove('hidden');
        document.getElementById('cricketHistoryTab').className = "bg-cyan-600/20 text-cyan-400 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-bold border border-cyan-500/30";
        syncCricketHistory();
    } else if (view === 'leaderboard') {
        leader.classList.remove('hidden');
        document.getElementById('cricketLeaderTab').className = "bg-cyan-600/20 text-cyan-400 px-4 md:px-6 py-2 rounded-full text-xs md:text-sm font-bold border border-cyan-500/30";
        syncLeaderboard();
    }
}

async function syncLeaderboard() {
    const body = document.getElementById('leaderboardBody');
    body.innerHTML = '<tr><td colspan="5" class="p-10 text-center"><i class="fas fa-spinner fa-spin text-xl text-yellow-400"></i></td></tr>';
    
    try {
        const res = await fetch('/api/main?route=cricket_leaderboard');
        const data = await res.json();
        
        if (data.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="p-10 text-center text-gray-500">The Hall of Fame is empty. Step up, Legend!</td></tr>';
            return;
        }

        body.innerHTML = data.map((u, i) => `
            <tr class="border-b border-white/5 hover:bg-white/5 transition">
                <td class="p-4 font-black text-gray-500">${i + 1}</td>
                <td class="p-4">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-600 flex items-center justify-center font-bold text-black text-xs">${u.name[0]}</div>
                        <span class="font-bold text-white">${u.name}</span>
                    </div>
                </td>
                <td class="p-4 text-center font-bold text-green-400">${u.wins}</td>
                <td class="p-4 text-center font-mono text-gray-400">${u.avgRR.toFixed(2)}</td>
                <td class="p-4 text-center font-black text-yellow-400">${u.highScore}</td>
            </tr>
        `).join('');
    } catch (e) {
        body.innerHTML = '<tr><td colspan="5" class="p-10 text-center text-red-500">Failed to load legends.</td></tr>';
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
let selectedMatches = new Set();

function toggleMatchSelection(id) {
    id = isNaN(id) ? id : Number(id);
    if (selectedMatches.has(id)) selectedMatches.delete(id);
    else selectedMatches.add(id);
    renderCricketHistoryList();
}

function selectAllMatches(checked) {
    if (checked) {
        cricketHistoryData.forEach(m => selectedMatches.add(isNaN(m.id) ? m.id : Number(m.id)));
    } else {
        selectedMatches.clear();
    }
    renderCricketHistoryList();
}

async function deleteSelectedMatches() {
    if (selectedMatches.size === 0) return;
    if (!confirm(`Permanently delete ${selectedMatches.size} match records?`)) return;

    setLoading(true, "Purging Match Records");
    try {
        const ids = Array.from(selectedMatches);
        await Promise.all(ids.map(id => 
            fetch(`/api/main?route=cricket_history&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, { method: 'DELETE' })
        ));
        
        selectedMatches.clear();
        await syncCricketHistory();
        showToast("Records successfully purged.", "warning");
    } catch (e) {
        showToast("Deletion error.", "error");
    } finally {
        setLoading(false);
    }
}

async function deleteCricketMatch(id) {
    if (!confirm("Delete this match record from history?")) return;
    setLoading(true, "Deleting Match Record");
    try {
        const res = await fetch(`/api/main?route=cricket_history&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await syncCricketHistory();
            showToast("Match record deleted.", "warning");
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
            renderCricketHistoryList();
        } else {
            throw new Error(data.error || "Invalid data format");
        }
    } catch (e) {
        console.error("Cricket Sync Error:", e);
        list.innerHTML = `<div class="col-span-full text-center py-20 text-red-500">Failed to load history: ${e.message}</div>`;
    }
}

function renderCricketHistoryList() {
    const list = document.getElementById('matchHistoryList');
    const bulkBar = document.getElementById('cricketBulkActions');
    const countEl = document.getElementById('cricketSelectionCount');
    const selectAllEl = document.getElementById('selectAllCricket');

    if (cricketHistoryData.length === 0) {
        list.innerHTML = '<div class="col-span-full text-center py-20 text-gray-500">No matches found in archives.</div>';
        bulkBar.classList.add('hidden');
        selectedMatches.clear();
        return;
    }

    bulkBar.classList.remove('hidden');
    countEl.innerText = `${selectedMatches.size} selected`;
    selectAllEl.checked = (selectedMatches.size === cricketHistoryData.length && cricketHistoryData.length > 0);

    list.innerHTML = cricketHistoryData.map((m, idx) => {
        const tA = m.teamA || {};
        const tB = m.teamB || {};
        const tAName = tA.name || 'Unknown';
        const tBName = tB.name || 'Unknown';
        const id = isNaN(m.id) ? m.id : Number(m.id);
        const isSelected = selectedMatches.has(id);
        
        const borderClass = (m.result && tBName !== 'Unknown' && m.result.includes(tBName)) ? 'border-purple-500' : 'border-orange-500';
        
        return `
            <div onclick="toggleMatchSelection('${m.id}')" class="glass p-5 border-l-4 ${borderClass} group hover:scale-[1.02] transition-transform relative cursor-pointer ${isSelected ? 'ring-2 ring-orange-500/50' : ''}">
                <div class="absolute top-2 left-2 flex items-center gap-2">
                    <input type="checkbox" class="accent-orange-500 w-3.5 h-3.5" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleMatchSelection('${m.id}')">
                </div>
                <div class="absolute top-2 right-2">
                    <button onclick="event.stopPropagation(); deleteCricketMatch('${m.id}')" class="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition p-1" title="Delete Match">
                        <i class="fas fa-trash-alt text-[10px]"></i>
                    </button>
                </div>
                <div class="flex justify-between items-start mb-4 pl-6 pr-6">
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
                <button onclick="event.stopPropagation(); viewMatchDetail(${idx})" class="w-full py-2 text-xs bg-white/5 rounded-lg hover:bg-white/10 transition">Deep Dive</button>
            </div>
        `;
    }).join('');
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
        "description": remark || "Support for sOuLViSiON Development",
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
                        paymentId: response.razorpay_payment_id,
                        timestamp: Date.now()
                    })
                });
                showToast("Thank you for your support! Vision fueled.", "success", 5000);
                loadFeedbacks();
            } catch (e) {
                alert("Payment successful, but failed to update wall. We have recorded your contribution internally.");
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
                <p class="text-sm text-gray-300 italic">"${f.remark || 'Supporting sOuLViSiON development!'}"</p>
            </div>
        `).join('');
    } else {
        wall.innerHTML = `
            <div class="text-center py-20 opacity-50">
                <i class="fas fa-mug-hot text-4xl mb-4"></i>
                <p>No supporters yet. Be the first!</p>
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
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('soul_theme', theme);
    if (currentUser) {
        currentUser.theme = theme;
        localStorage.setItem('soulUser', JSON.stringify(currentUser));
    }
}

async function saveAdminConfig() {
    const keys = document.getElementById('apiKeys').value.split(',').map(k => k.trim());
    const models = JSON.parse(document.getElementById('modelList').value);
    const miniChatModel = document.getElementById('miniChatModelId').value.trim();
    const adminEmail = currentUser ? currentUser.email : '';
    
    setLoading(true, "Applying Admin Settings");
    try {
        const res = await fetch(`/api/main?route=admin_config&adminEmail=${encodeURIComponent(adminEmail)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'ai_settings', keys, models, miniChatModel })
        });
        if(res.ok) { alert("Config Updated!"); loadConfig(); }
    } finally {
        setLoading(false);
    }
}

// Admin User Management
let adminUsersCache = [];
async function loadAdminUsers() {
    if (!currentUser || !currentUser.isAdmin) return;
    const adminEmail = currentUser.email;
    setLoading(true, "Fetching Users");
    try {
        const res = await fetch(`/api/main?route=users&adminEmail=${encodeURIComponent(adminEmail)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            adminUsersCache = data;
            document.getElementById('statUsers').innerText = data.length;
            renderAdminUsers(data);
        }
    } finally {
        setLoading(false);
    }
}

function renderAdminUsers(users) {
    const list = document.getElementById('adminUserList');
    if (!users.length) {
        list.innerHTML = '<p class="text-xs text-gray-500">No users found.</p>';
        return;
    }
    list.innerHTML = users.map(user => `
        <div class="bg-white/5 p-3 rounded-lg flex justify-between items-center border border-white/5 group">
            <div class="overflow-hidden">
                <p class="text-xs font-bold text-white truncate">${user.name}</p>
                <p class="text-[10px] text-gray-500 truncate">${user.email}</p>
                <div class="flex gap-2 mt-1">
                    ${user.isAdmin ? '<span class="text-[8px] bg-red-500/20 text-red-400 px-1 rounded font-bold">ADMIN</span>' : ''}
                    ${user.authSource === 'google' ? '<span class="text-[8px] bg-blue-500/20 text-blue-400 px-1 rounded font-bold">GOOGLE</span>' : ''}
                </div>
            </div>
            <button onclick="adminDeleteUser('${user.email}')" class="text-gray-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-2">
                <i class="fas fa-user-slash"></i>
            </button>
        </div>
    `).join('');
}

function filterAdminUsers(query) {
    const q = query.toLowerCase();
    const filtered = adminUsersCache.filter(u => 
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
    renderAdminUsers(filtered);
}

async function adminDeleteUser(email) {
    if (email === currentUser.email) return alert("You cannot delete your own account.");
    if (!confirm(`Permanently delete account for ${email}? This will remove all their data.`)) return;
    
    setLoading(true, "Deleting User Data");
    try {
        const res = await fetch(`/api/main?route=users&adminEmail=${encodeURIComponent(currentUser.email)}&email=${encodeURIComponent(email)}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            alert("User deleted successfully.");
            loadAdminUsers();
        } else {
            const data = await res.json();
            alert("Error: " + (data.error || "Failed to delete user"));
        }
    } finally {
        setLoading(false);
    }
}

// Forgot Password Logic
function showForgotPassword() {
    showPage('forgotPass');
    document.getElementById('forgotStep1').classList.remove('hidden');
    document.getElementById('forgotStep2').classList.add('hidden');
}

async function requestResetOTP() {
    const email = document.getElementById('resetEmail').value.trim();
    if (!email) return alert("Enter your email.");
    
    setLoading(true, "Sending Verification Code");
    try {
        const res = await fetch('/api/main?route=forgot_password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
            alert("A 6-digit verification code has been sent to your email.");
            document.getElementById('forgotStep1').classList.add('hidden');
            document.getElementById('forgotStep2').classList.remove('hidden');
        } else {
            throw new Error(data.error || "Failed to send code.");
        }
    } catch (e) {
        alert(e.message);
    } finally {
        setLoading(false);
    }
}

async function verifyAndResetPassword() {
    const email = document.getElementById('resetEmail').value.trim();
    const otp = document.getElementById('resetOTP').value.trim();
    const newPass = document.getElementById('resetNewPass').value.trim();
    
    if (!otp || otp.length !== 6) return alert("Enter valid 6-digit code.");
    if (!newPass || newPass.length < 6) return alert("Password must be at least 6 characters.");

    setLoading(true, "Updating Password");
    try {
        const res = await fetch('/api/main?route=forgot_password', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp, newPassword: newPass })
        });
        const data = await res.json();
        if (res.ok) {
            alert("Password reset successful! You can now login with your new password.");
            showPage('login');
        } else {
            throw new Error(data.error || "Reset failed.");
        }
    } catch (e) {
        alert(e.message);
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

// --- CUSTOM CURSOR LOGIC ---
function initCustomCursor() {
    const cursor = document.getElementById('custom-cursor');
    if (!cursor) return;

    let mouseX = 0, mouseY = 0;
    let isHidden = true;

    // Movement using top/left for cleaner combined scale transforms in CSS
    const updateCursorPosition = () => {
        cursor.style.left = `${mouseX}px`;
        cursor.style.top = `${mouseY}px`;
        requestAnimationFrame(updateCursorPosition);
    };
    requestAnimationFrame(updateCursorPosition);

    window.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        if (isHidden) {
            cursor.style.opacity = '1';
            isHidden = false;
        }
    });

    document.addEventListener('mouseleave', () => {
        cursor.style.opacity = '0';
        isHidden = true;
    });

    document.addEventListener('mouseenter', () => {
        cursor.style.opacity = '1';
        isHidden = false;
    });

    const interactiveSelectors = 'a, button, input[type="submit"], input[type="button"], [role="button"], .cursor-pointer, [onclick], .note-checkbox, select';
    const textSelectors = 'input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="date"], textarea, [contenteditable="true"]';

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (target.closest(interactiveSelectors)) {
            cursor.classList.add('active');
        } else if (target.closest(textSelectors)) {
            cursor.classList.add('text-mode');
        }
    });

    document.addEventListener('mouseout', (e) => {
        cursor.classList.remove('active');
        cursor.classList.remove('text-mode');
    });

    document.addEventListener('mousedown', () => {
        cursor.classList.add('clicking');
    });

    document.addEventListener('mouseup', () => {
        cursor.classList.remove('clicking');
    });
    
    // Ensure cursor stays visible when dragging
    document.addEventListener('dragstart', (e) => {
        cursor.style.opacity = '0.5';
    });
    document.addEventListener('dragend', (e) => {
        cursor.style.opacity = '1';
    });
}

// --- sOuLNOTES NEW FEATURES ---

async function togglePin(id) {
    id = Number(id);
    const note = notes.find(n => n.id === id);
    if (!note) return;
    
    note.isPinned = !note.isPinned;
    renderNotes();
    
    await fetch(`/api/main?route=notes&id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: note.isPinned })
    });
}

function lockCurrentNote() {
    const id = document.getElementById('editNoteId').value;
    const note = notes.find(n => n.id == id);
    if (!note) return;
    
    const code = prompt("Set a secret access code for this note (Empty to unlock):");
    note.lockCode = code || null;
    saveEditedNote();
    showToast(code ? "Note Locked" : "Note Unlocked", "info");
}

function updateGoalProgress() {
    const goal = parseInt(document.getElementById('wordGoal').value) || 0;
    const current = parseInt(document.getElementById('editWordCount').innerText) || 0;
    const bar = document.getElementById('goalProgress');
    
    if (goal <= 0) {
        bar.parentElement.classList.add('hidden');
        return;
    }
    
    bar.parentElement.classList.remove('hidden');
    const percent = Math.min((current / goal) * 100, 100);
    bar.style.width = percent + '%';
    
    if (percent >= 100) {
        bar.classList.replace('bg-cyan-500', 'bg-green-500');
        if (percent === 100 && !bar.dataset.notified) {
            showToast("Writing Goal Achieved! 🏆", "success");
            bar.dataset.notified = "true";
        }
    } else {
        bar.classList.replace('bg-green-500', 'bg-cyan-500');
        delete bar.dataset.notified;
    }
}



function toggleSTTNote(inputId) {
    const btnId = inputId === 'noteInput' ? 'noteInputSttBtn' : 'editNoteSttBtn';
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);

    if (!('webkitSpeechRecognition' in window)) return alert("Speech recognition not supported.");

    if (recognition && recognition.active) {
        sttForceStop = true;
        recognition.stop();
        return;
    }

    sttForceStop = false;
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        btn.innerHTML = `<i class="fas fa-stop-circle text-red-500 animate-pulse"></i>`;
        recognition.active = true;
    };

    recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) transcript += event.results[i][0].transcript;
        }
        if (transcript) {
            input.value += (input.value ? " " : "") + transcript;
            updateEditorStats(input);
        }
    };

    recognition.onend = () => {
        btn.innerHTML = `<i class="fas fa-microphone"></i>`;
        recognition.active = false;
    };

    recognition.start();
}

// --- INIT ---
window.onload = async () => {
    initCustomCursor();
    // Initial Route Detection
    const initialPath = window.location.pathname.substring(1) || 'home';
    showPage(initialPath, false); // false because the initial state is already in history

    updateAuthUI();

    // Set dynamic year in footer
    const yearEl = document.getElementById('currentYear');
    if (yearEl) yearEl.innerText = new Date().getFullYear();
    
    // Load Theme
    const savedTheme = (currentUser && currentUser.theme) ? currentUser.theme : (localStorage.getItem('soul_theme') || 'midnight');
    setTheme(savedTheme);

    const savedVol = localStorage.getItem('soulVolume');
    if (savedVol !== null) {
        const vol = parseFloat(savedVol);
        audioPlayer.volume = vol;
        document.getElementById('volumeControl').value = vol;
        // YT volume set happens once player is ready
    }
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