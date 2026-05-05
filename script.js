// --- STATE MANAGEMENT ---
let currentUser = JSON.parse(localStorage.getItem('soulUser')) || null;

let solveState = {
    mode: 'pro', // simple or pro
    history: [],
    lastAnswer: 0,
    isAIWorking: false,
    activeExpression: ""
};

let quizState = {
    active: false,
    questions: [],
    currentIndex: 0,
    score: 0,
    timer: null,
    timeLeft: 0,
    category: '',
    results: []
};

let consecutiveApiFailures = 0;
let isAICooldownActive = false;
let aiCooldownTimer = null; // To automatically clear cooldown

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

function toggleSendButton(type, isStopping) {
    // type can be 'main', 'mini', 'code', 'solve'
    let btnId;
    let baseColor = 'bg-purple-600';
    let hoverColor = 'hover:bg-purple-700';
    let shadowColor = 'shadow-purple-600/20';
    let iconSize = 'text-xs md:text-base';
    let clickFn;

    if (type === 'main') {
        btnId = 'aiSendBtn';
        clickFn = askAI;
    } else if (type === 'mini') {
        btnId = 'miniAiSendBtn';
        iconSize = 'text-xs';
        clickFn = askMiniAI;
    } else if (type === 'code') {
        btnId = 'codeAISendBtn';
        baseColor = 'bg-blue-600';
        hoverColor = 'hover:bg-blue-500';
        shadowColor = 'shadow-blue-900/20';
        iconSize = 'text-xs';
        clickFn = askCodeAI;
    } else if (type === 'solve') {
        btnId = 'solveAISendBtn';
        iconSize = 'text-[10px]';
        clickFn = askSolveAI;
    } else {
        // Fallback for older boolean type param
        btnId = type ? 'miniAiSendBtn' : 'aiSendBtn';
        clickFn = type ? askMiniAI : askAI;
        if (type) iconSize = 'text-xs';
    }

    const btn = document.getElementById(btnId);
    if (!btn) return;
    
    if (isStopping) {
        btn.innerHTML = `<i class="fas fa-stop ${iconSize}"></i>`;
        btn.classList.remove(baseColor, hoverColor, shadowColor);
        btn.classList.add('bg-red-600', 'hover:bg-red-700', 'shadow-red-600/20', 'animate-pulse');
        btn.onclick = stopAIStream;
    } else {
        btn.innerHTML = `<i class="fas fa-paper-plane ${iconSize}"></i>`;
        btn.classList.add(baseColor, hoverColor, shadowColor);
        btn.classList.remove('bg-red-600', 'hover:bg-red-700', 'shadow-red-600/20', 'animate-pulse');
        btn.onclick = clickFn;
    }
}

function stopAIStream() {
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
        
        // Reset all buttons
        ['main', 'mini', 'code', 'solve'].forEach(t => toggleSendButton(t, false));
        
        // Clear UI indicators
        ['aiStatus', 'miniAiStatus', 'codeAIStatus', 'solveAIStatus'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        
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
let isCheckingHealth = false;
async function checkSystemHealth() {
    if (isCheckingHealth) return;
    isCheckingHealth = true;
    
    const start = Date.now();
    const dot = document.getElementById('healthDot');
    const text = document.getElementById('healthText');
    const indicator = document.getElementById('globalHealthIndicator');
    const latencyEl = document.getElementById('healthLatency');
    const cloudEl = document.getElementById('healthCloudStatus');

    if (currentUser && currentUser.isAdmin) indicator?.classList.remove('hidden');

    try {
        // Ping config to check DB and Server connectivity
        const res = await fetch(`/api/main?route=admin_config`, { priority: 'low' });
        const latency = Date.now() - start;
        
        if (res.ok) {
            const data = await res.json();
            const hasKeys = data.keys && data.keys.length > 0;
            
            if (dot) {
                dot.className = "relative inline-flex rounded-full h-2 w-2 " + (hasKeys ? "bg-green-500" : "bg-yellow-500");
                const ping = dot.previousElementSibling;
                if (ping) ping.className = "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 " + (hasKeys ? "bg-green-400" : "bg-yellow-400");
            }
            if (text) text.innerText = hasKeys ? "Stable" : "Degraded";
            if (latencyEl) {
                latencyEl.innerText = `${latency}ms`;
                latencyEl.className = `text-xl font-black ${latency < 200 ? 'text-green-400' : 'text-yellow-400'}`;
            }
            if (cloudEl) {
                cloudEl.innerText = "ACTIVE";
                cloudEl.className = "text-xl font-black text-green-400";
            }
        } else {
            throw new Error();
        }
    } catch (e) {
        if (dot) {
            dot.className = "relative inline-flex rounded-full h-2 w-2 bg-red-500";
            const ping = dot.previousElementSibling;
            if (ping) ping.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75";
        }
        if (text) text.innerText = "Offline";
        if (latencyEl) {
            latencyEl.innerText = "ERR";
            latencyEl.className = "text-xl font-black text-red-500";
        }
        if (cloudEl) {
            cloudEl.innerText = "FAILED";
            cloudEl.className = "text-xl font-black text-red-500";
        }
    } finally {
        isCheckingHealth = false;
    }
}

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

function showBetterError(msg) {
    const overlay = document.getElementById('errorOverlay');
    const desc = document.getElementById('errorDescription');
    if (overlay && desc) {
        desc.innerText = msg;
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    }
    setLoading(false);
}

function closeErrorOverlay() {
    const overlay = document.getElementById('errorOverlay');
    if (overlay) overlay.classList.add('hidden');
}
let aiConfig = { keys: [], models: [] };
let currentKeyIndex = 0;
let pendingFiles = [];
let miniChatHistory = [];

// --- TIME & CALENDAR STATE ---
let clockType = 'digital';
let timeFormat = localStorage.getItem('soul_time_format') || '12h';
let calendarDate = new Date();
let notes = [];
let noteType = 'note';
let sleepTimer = null;
let noteFilter = 'all';
let aiConversations = [];
let selectedConversations = new Set();
let currentChatId = null;
let seekHistory = [];
/** 
 * ACTION REQUIRED: Paste the actual text content from the Numerology PDF here.
 * The AI uses this as the primary reference for calculations and personality traits.
 */
const HARISH_JOHARI_KNOWLEDGE = `
NUMEROLOGY
With	Tantra,	Ayurveda,	and	Astrology
HARISH	JOHARI
Illustrated	by	Pieter	Weltevrede
Destiny	Books
Rochester,	Vermont
Contents
Introduction
The	Vedic	Square
The	Sun	and	Number	1
The	Moon	and	Number	2
Jupiter	and	Number	3
Rahu	and	Number	4
Mercury	and	Number	5
Venus	and	Number	6
Ketu	and	Number	7
Saturn	and	Number	8
Mars	and	Number	9
Summary	of	Interaction	Between	Numbers
The	Compound	Numbers
Projecting	Into	the	Future
Relationships	and	Characteristics	of	Numbers	Table
Footnotes
Sources
About	the	Author
About	Inner	Traditions
Books	of	Related	Interest
Copyright

Introduction
Numerology	uses	numbers	as	a	key	to	human	behavior.	It	is	an	easy-to-learn
method	that	exercises	the	mind’s	intuitive	faculty	to	fathom	the	depths	of	human
personality.
Numerologists	have	to	forget	their	own	identities	and	devote	themselves
totally	to	exploring	the	personalities	of	others.	They	must	learn	to	become	calm
and	empty	before	they	are	able	to	use	their	intuition.	Practicing	the	art	of
numerology	creates	endurance,	patience,	and	pointedness.	Experience	teaches
numerologists	more	than	books	can	teach.	The	information	contained	in	books
only	opens	the	windows	of	the	mind.	One	then	has	to	work	with	one’s	personal
understanding	of	that	information.	Information	alone	is	not	knowledge;	direct
experience	must	be	added	before	information	becomes	knowledge.	Numerology
is	simple	to	learn	and	very	engaging,	like	the	creative	arts.	It	teaches	one
sympathy	toward	others.
I	advise	my	readers	not	simply	to	accept	blindly	the	information	that	follows.
By	observing	their	three	numbers	(psychic,	destiny,	and	name)	and	the
relationship	of	these	to	the	numbers	of	other	people,	they	should	formulate	their
own	language	to	explain	what	they	understand.	They	should	remember:	All
numbers	are	both	good	and	bad.	No	one	number	is	superior	to	any	other.	All
numbers	work	differently	through	different	human	bodies,	each	with	its	own
genetic	behavioral	pattern.	All	numbers	are	influenced	by	the	unique	qualities	of
their	environment	and	by	the	collective	unconscious.	We	can	try	to	understand
them,	but	we	have	no	right	to	judge	and	categorize	them.
Numerology	is	a	method	of	linking	the	microcosm	with	the	macrocosm.	With
practice,	a	numerologist	starts	to	comprehend	the	influence	of	celestial	bodies	on
human	understanding	and	conduct.	All	objects	of	the	material	world	are	related
to	the	nine	planets.
For	a	numerologist	the	planets	become	embodied	in	a	human	form,	and	he	or
she	can	closely	observe	them	as	a	part	of	the	cosmic	play.
Those	people	who	do	not	allow	themselves	the	freedom	of	seeing	the
influence	of	the	celestial	and	astral	bodies	cannot	observe	this	play.	Planets	for
them	are	objects	in	outer	space	that	have	no	influence	on	their	physical	and
mental	make-up.	To	them	all	predictive	sciences	are	useless.	People	who	have
time,	faith,	and	enough	patience,	however,	can	watch	this	play	and	learn	from	it
the	lessons	that	will	guide	the	consciousness	of	coming	generations.
Numerology	is	not	a	complete	science.	It	is	just	one	branch	of	the	predictive
sciences.	To	be	a	good	numerologist	one	must	become	a	good	observer	and	a
patient	listener.	Study	of	physiognomy	and	astrology	is	very	necessary.
Numerology	is	much	simpler	than	astrology	and	does	not	require	complicated
mathematical	calculations.	There	are	just	three	things	a	numerologist	needs	to
know:	the	day	of	the	month	a	person	was	born,	the	numerological	value	of	his	or
her	popular	name,	and	the	person’s	total	birth	information	(date,	month,	and
year).	From	astrology,	the	numerologist	needs	to	know	about	all	the	zodiac
signs,	and	a	person’s	day	of	birth,	sun	sign,	and	moon	sign.	In	India,	the	season
during	which	a	person	was	born	also	has	to	be	known,	since	that	has	an	effect	on
one’s	temperament.	Certain	information	from	physiognomy	needs	to	be	learned
as	well,	such	as	how	the	shape	and	form	of	the	various	body	parts	correlate	with
an	individual’s	thinking	process.	(It	is	known,	for	example,	that	the	perceptual
world	of	tall	people	is	different	from	that	of	short	people.)
The	purpose	of	working	with	numbers	is	to	save	energy.	People	who	act
without	a	proper	understanding	of	the	right	moment	to	start	a	job	waste	a	lot	of
energy	by	making	the	wrong	moves.	Numerology	provides	the	knowledge	for
such	things	as	how	to	select	the	right	moment,	the	right	relationship,	the	right
dwelling	place—thereby	saving	energy.
Numerology	must	not	be	used	to	gain	power	and	control	over	others.	Also,
money	should	not	be	earned	with	this	knowledge.	Using	one’s	mind	to	explore
the	personality	of	others	for	money	alone	will	result	in	stress.	Through	the
selfless	use	of	numerology,	one	earns	good	karma.
Simply	guessing	what	number	a	stranger	is	could	be	fun,	but	it	is	more	fun	to
know	how	to	practice	numerology.	By	asking	someone	his	or	her	date	of	birth,
one	can	then	find	out	what	sort	of	person	he	or	she	could	be.	This	exercise	is	also
a	good	mind	game.	On	one	hand,	it	makes	students	of	numerology	use	their
memory	(their	numerological	information	bank)	and	their	intuition;	on	the	other,
it	makes	them	stay	in	the	present	and	pay	proper	attention	to	the	person	in
question.	The	student	becomes	free	from	his	or	her	little	world	and	launches	an
adventurous	trip	into	a	new	personality.
Through	numerology,	all	the	aspects	of	life	in	various	forms	are	explored.	The
student	sees	how	planets	act	differently	within	different	people.	The	study	of	this
science	requires	that	one	have	the	alertness	and	openness	of	an	explorer—it	also
brings	with	it	the	joy	that	follows	a	successful	exploration.
Having	knowledge	of	the	numbers	and	a	good	memory	can	save	much	energy
and	time.	A	keen	interest	in	numerology	can	work	to	enhance	memory	and
pointedness;	it	can	also	promote	the	intuitive	faculty	of	the	mind.
The	advice	that	accompanies	the	discussion	of	each	number	regarding	fasting
or	gemstones	is	based	on	Ayurvedic	and	Tantric	knowledge.	Following	the
prescriptions	given	will	help	to	create	a	better	environment	for	the
microorganisms	living	in	our	bodies.	As	receptors	of	cosmic	energy,	they	serve
to	create	harmony	in	our	lives.
Thus,	numerology	can	provide:
a	better	understanding	of	both	our	good	and	bad	sides
a	method	of	accepting	our	weaknesses,	and	those	of	others
a	vehicle	for	discussing	these	weaknesses
a	joyful	way	of	passing	time
freedom	and	escape	from	our	own	personal	worries
a	good	focal	point,	or	method	of	paying	attention	and	getting	attention
popularity	and	respect
a	tool	for	entering	into	the	unknown
friendly	interactions.
To	practice	numerology,	we	develop:
the	mind	of	a	scholar	researching	life
the	alertness	of	an	explorer
a	good	memory	and	pointedness
an	intuitive	mind
good	conversational	skills.
NUMBERS	AND	THE	NUMEROLOGIST
For	a	numerologist	there	are	only	nine	numbers	from	which	all	calculations	of
the	material	world	are	made.	All	numbers	beyond	9	are	repetitions.	By	a	simple
method	of	addition,	they	can	be	reduced	to	single	whole	numbers.	The	number
10	is	not	a	whole	number;	it	is	simply	a	1	with	a	zero.
Zero
Zero	is	not	a	number	and	has	no	numerological	value.	In	the	Western	occult
tradition,	zero	is	regarded	as	a	symbol	of	eternity.	It	is	surprising	to	learn	that	the
zero	made	its	first	entrance	into	the	Western	hemisphere	only	a	few	hundred
years	ago.	Its	introduction	helped	considerably	in	the	development	of
mathematics,	science,	and	modern	technology.	In	the	East,	where	it	was	known
from	the	dawn	of	civilization,	the	zero	is	known	as	Sunya	(shoonya)	or	the	Void,
which	is	the	foundation	stone	of	Buddhism.	Zero	has	no	value	when	it	is	alone,
because	it	is	abstract	and	numbers	are	concrete.	When	zero	combines	with	a
number,	it	gives	birth	to	arithmetical	progressions	and	the	series	of	double,
triple,	and	multiple	numbers,	such	as	10,	100,	and	1000.	When	you	do	not	know
about	zero,	you	cannot	play	with	numbers	beyond	9	(that	is,	beyond	the	material
world).	When	you	do	know	about	it,	its	mystic	nature	leads	you	towards	eternity
and	impairs	your	material	progress.	Zero	is	considered	unfortunate.	When	a	zero
appears	in	a	date	of	birth,	it	brings	misfortune.	Even	the	tenth	month	of	the	year
(October),	being	a	10,	brings	misfortune,	although	to	a	lesser	degree.	The
appearance	of	a	zero	in	the	year	of	birth	brings	the	least	misfortune.	The
combination	of	zero	with	any	number	reduces	the	influence	of	that	number.
People	with	a	zero	in	their	birthdate	numbers	generally	have	to	struggle	harder
than	those	without.	The	presence	of	more	than	one	zero—October	(tenth	month)
10,	1950—makes	one	have	to	work	even	more	in	life.	All	numbers	from	1	to	9
are	present	in	zero,	and	when	zero	combines	with	these	numbers,	a	whole	series
of	numbers	evolves.	For	example,	when	zero	combines	with	number	1,	the
numbers	11	through	19	that	belong	to	that	series	evolve.1
The	introduction	of
zero	aided	the	development	of	math,	science,	and	the	modern	technology	that
brought	mankind	to	the	computer	age,	but	it	does	not	“exist.”
QUALITIES	OF	NUMBERS
Even	and	Odd
Numbers	can	be	categorized	into	two	basic	groups:
Odd:	1,	3,	5,	7,	9	and	Even:	2,	4,	6,	8.
Odd	numbers	have	an	odd	total;	there	are	five	of	them.	Even	numbers	have	an
even	total	(four).
Odd	numbers	are	solar,	masculine,	electrical,	acidic,	and	dynamic.	They	are
additional	(they	add).
Even	numbers	are	lunar,	feminine,	magnetic,	alkaline,	and	static.	They	are
subtractional	(they	reduce).	They	remain	without	movement,	because	they	have
an	even	group	of	pairs	(2	and	4,	6	and	8).	If	we	pair	odd	numbers,	one	number
always	remains	without	a	counterpart	(1	and	3,	5	and	7,	9).	This	makes	them
dynamic.
In	general,	two	similar	numbers	(two	odd	numbers	or	two	even)	are	not	very
good.
even	+	even	=	even	(static)
2	+	2	=	4
odd	+	even	=	odd	(dynamic)
3	+	2	=	5
odd	+	odd	=	even	(static)	3	+	3	=	6
Some	numbers	are	friendly;	some	are	in	opposition	to	each	other.	Their
relationships	are	determined	by	the	relationships	between	their	ruling	planets
(see	chart	on	pages	188-189).	When	two	friendly	numbers	come	together,	they
are	not	very	productive.	Like	two	friends,	they	both	relax	and	nothing	happens.
But	when	enemy	numbers	come	in	combination,	they	make	each	other	alert	and
active;	both	people	have	to	work	more.	Seen	in	this	way,	enemy	numbers	are
actually	friends,	and	friendly	numbers	are	really	enemies	that	stop	progress	and
activity.
Neutral	numbers	remain	inactive.	They	do	not	give	any	support	nor	do	they
induce	or	oppose	activity.
Universal	Friend
Number	6	is	unique	in	that	it	is	common	to	both	odd	and	even	numbers.	It	can	be
the	result	of	a	combination	of	either	3	(odd)	even	numbers,	or	2	(even)	odd
numbers.	In	2+2+2=6,	the	even	number	2	is	repeated	three	times,	which	is	an
odd	number	of	repetitions.	In	3+3=6,	the	odd	number	3	is	repeated	twice,	which
is	an	even	number	of	repetitions.
Being	common	to	both	groups,	number	6	is	therefore	known	as	a	“universal
friend.”
NUMBERS	AND	ASTROLOGY
There	are	nine	single	numbers.	The	relationship	of	numbers	to	planets	is	the	key
to	numerology.	In	the	Hindu	system,	this	relationship	is	the	same	as	in	the	West,
with	the	two	following	exceptions.	The	number	4	in	the	Hindu	system
corresponds	to	Rahu	(the	north	node	of	the	Moon),	whereas	in	the	West	this
number	is	related	to	the	Sun	and	Uranus.	And	the	number	7	in	the	Hindu	system
corresponds	to	Ketu	(the	south	node	of	the	Moon),	whereas	in	the	West	it	is
related	to	the	Moon	and	Neptune.	The	nature	or	behavior	of	a	number	comes
from	its	ruling	planet:
Planet Number Behavioral	Qualities
Sun
1
Moon 2
Jupiter 3
Rahu 4
Mercury 5
Venus 6
Ketu
7
Saturn 8
Mars
9
kinglike,	kind,	royal,	disciplined,	authoritative,	strong,
original
queenlike,	royal,	attractive,	everchanging,	delicate
spiritual,	counseling,	friendly,	self-centered,	disciplined
rebellious,	impulsive,	short-tempered,	secretive
princely,	entertaining,	wily,	intelligent,	sensitive
romantic,	slow,	sensual,	sweet	spoken,	diplomatic,
manipulative
mystical,	dreamlike,	intuitive,	inventive
wise,	malefic,	servant-like,	laborious,	struggling,	suffering
warlike,	strong,	rough,	rustic,	perfectionist,	doubting,
fighting,	alienating,	discriminating
Each	individual	is	influenced	by	three	numbers:	psychic,	name,	and	destiny.
The	influence	of	these	numbers	is	distinct	from	that	of	the	nine	planets	in	the
astrological	houses.	The	influence	of	the	Sun	itself,	for	example,	changes
depending	on	the	house	and	the	zodiac	sign	in	which	it	is	posited	in	a	natal	chart.
With	the	Sun	sign	change	comes	a	change	in	one’s	behavior.
In	numerology,	all	psychic	number	1	people	have	some	characteristics	of	that
number	(1),	regardless	of	the	month	in	which	they	are	born.	The	difference	in
month,	Moon	sign,	Sun	sign,	and	ascendant	only	changes	their	attitude.
All	number	1	people	have	the	same	good	days,	dates,	and	years;	they	also
have	the	same	colors,	gems,	deity,	and	mantra.	By	contrast,	in	astrology	the
power	of	a	planet,	and	therefore	its	ruling	number,	changes,	depending	on	the
house	it	is	in.	For	example,	an	exalted	Sun	posited	in	Aries	sitting	in	the	eighth
or	twelfth	house	becomes	fruitless,	because	it	is	posited	in	an	inauspicious
house.	The	same	Sun	in	Aries	becomes	great	when	posited	in	the	tenth	house.
Similarly,	an	exalted	Saturn	is	not	good	in	the	first,	fourth,	seventh,	or	tenth
house,	but	is	very	good	in	the	third,	sixth,	ninth,	or	eleventh,	and	so	on.
Astrology	is	more	precise	than	numerology.	These	specific	details	help	an
astrologer	understand	the	status	of	an	individual.	Numerology	is	a	more	general
study	and	covers	only	the	behavioral	aspect	of	human	personality.	It	has
developed	its	own	language	that	deals	with	broad	personality	traits.	But	it	is	also
simpler	to	learn	than	astrology.	It	easily	engages	the	mind	without	going	into
elaborate	detail,	such	as	studying	the	movement	of	the	planets.	Numerology	is	a
do-it-yourself	science.
NUMBERS	AND	PSYCHE,	DESTINY,	AND	NAME
Psychic	Number
Our	mental	make-up	is	directly	related	to	the	date,	time,	and	place	of	our	birth—
to	that	moment	when	we	breathe	air	in	for	the	first	time	from	the	outer
environment.	It	is	sad	that	this	moment	starts	with	a	cry	instead	of	laughter.	An
astrologer	gives	a	precise	shape	to	this	moment	with	a	chart,	but	for	a
numerologist	the	actual	date	of	birth	itself	is	enough.
The	psychic	number	is	obtained	by	making	a	simple	whole	number	of	the	date
of	birth.	For	example	I	was	born	on	May	12	and	since	1+2	equals	3,	my	psychic
number	is	3.2
A	person’s	psychic	number	reveals	the	way	the	person	looks	at	oneself.	The
psychic	number	plays	an	important	role	in	one’s	choice	of	food,	sex,	friendship,
marriage,	as	well	as	one’s	needs,	ambitions,	and	desires.	In	Hindu	astrology,	the
Moon	sign	is	the	sign	of	the	psyche.	In	the	Western	system,	people	try	to
understand	the	psyche	through	the	Sun	sign.	Numerology	does	not	concern	itself
with	a	Sun	sign,	Moon	sign,	or	ascendant,	but	rather	it	approaches	the	individual
directly	through	numbers.	As	we	have	seen,	however,	numbers	are	related	to	the
influence	of	planets	on	behavior,	ambitions,	needs,	and	desires.
The	planetary	influence	affecting	one’s	psyche	can	be	easily	understood	by
knowing	the	psychic	number.	This	number	remains	active	throughout	one’s	life
and	is	very	powerful	up	to	the	age	of	thirty-five	to	forty.	After	thirty-five	the
other	significant	number,	which	is	called	the	destiny	number,	becomes	more
active.	One	starts	feeling	a	change	in	attitude.	The	psychic	number,	however,
never	loses	its	importance.	The	psychic	number	can	be	influenced	by	changing
one’s	name.	It	can	also	be	influenced	by	education,	initiation,	and	marriage	(by
marrying	someone	whose	influence	changes	one’s	mental	make-up).	The
numerologist	must	know	that	each	person	has	two	images:	one’s	self	image	and
one’s	image	in	the	eyes	of	others—the	community,	society,	and	world.	The
psychic	number	indicates	what	one	thinks	about	oneself;	the	destiny	number
indicates	what	the	world	thinks	of	that	person.
Destiny	Number
The	single	whole	number	obtained	from	the	addition	of	the	date,	month,	and
year	of	birth	is	called	the	destiny	number.
For	example,	I	was	born	on	May	12,	1934.
5	+	1	+	2	+	1	+	9	+	3	+	4	=	25	=	7
The	25	here	must	not	be	ignored,	as	the	2	and	the	5	will	have	some	effect	on
one’s	destiny.	However,	the	7	will	be	the	dominant	number.	Of	these	three	digits,
the	7	and	the	2	play	an	important	role,	whereas	the	5	will	have	much	less
influence.
The	destiny	number	is	more	important	than	either	the	psychic	number	or	name
number.	One	always	thinks	in	the	same	way,	but	destiny	does	not	always	work
the	way	one	wants.	Because	destiny	is	more	powerful	after	thirty-five,	one	has	to
start	compromising	what	one	wants	to	have	and	to	achieve.	The	psyche	is	free	to
think,	expect,	and	desire,	but	destiny	brings	only	what	one	really	deserves.	This
is	because	destiny	is	related	to	one’s	past	life	karmas.	In	the	Bhagavad	Gita
rendered	by	Veda	Vyasa,	Krishna	says	to	Arjuna:
O,	Arjuna,	man	is	free	to	perform	any	kind	of	action,	but	there	is	no
freedom	in	getting	the	fruits	of	one’s	karmas	as	one	wants.
So	one	should	become	selfless—in	performing	actions,	one	should	not	care
about	the	outcome,	the	fruits.	By	not	caring	for	the	fruits	of	one’s	karmas,	one
gets	beyond	pleasure	and	pain.	Pain	is	caused	by	attachment	to	one’s	karmas.
Expectations	are	the	real	cause	of	pain.	Up	to	the	age	of	thirty-five	one	learns
this	lesson.	Then,	to	the	extent	that	one	gets	away	from	expectations	and
performs	one’s	duty	for	its	own	sake,	one	remains	happy.	The	destiny	number	is
not	subject	to	external	influences.
The	destiny	number	is	related	to	our	samskaras—vibrational	patterns	acquired
by	actions	in	past	incarnations,	or	karmas.	It	allows	us	little	freedom	of	action,
but	much	freedom	in	reaping	the	fruits	of	our	past	karmas.	Whatever	we	do	now
will	be	returned	to	us	in	the	future	or	in	our	next	life;	whatever	fruits	we	are
receiving	now	reflect	what	we	have	earned	in	our	past	lives.
Life	is	a	continuum.	It	is	not	a	broken	mosaic.	Death	is	not	the	end.	In	fact,
there	is	no	death.	Death	is	a	change	from	one	pattern	to	another.	Whatever	we
sow,	we	will	reap.	There	is	no	getting	away	from	the	fruits	of	our	action,	our
karmas.	The	residue	of	my	karmas,	good	or	bad,	come	to	me	as	my	debits	or
assets.	Work	done	in	a	past	life	comes	easily;	work	I	have	not	done	before	brings
with	it	challenges	and	obstacles.	Knowing	this,	my	mind	and	my	attitude	direct
me	on	a	natural	life	course,	one	through	which	I	can	easily	move.	My	past	life
karmas	help	me	and	come	to	me	as	friends,	gifts,	rewards,	and	I	am	able	to	fulfill
my	duties.	When	I	have	done	bad	karmas,	the	same	efforts	bring	enmity,
opposition,	loss,	and	punishment.	The	fruits	of	my	karma	are	according	to	their
seeds,	which	I	have	sown	in	my	past	lives.	This	friendship	or	enmity,	unexpected
reward	or	punishment,	is	all	the	result	of	pastlife	karmas—its	cause	cannot	be
traced	in	the	present	life.	The	fruits	of	karmas	performed	in	this	life	can	create	a
good	and	supporting	environment	for	a	person—in	this	case,	the	cause	of	the
fruits	can	be	traced.
When	one’s	destiny	number	is	bad,	a	good	psychic	number,	a	good	name
number,	the	use	of	gems,	and	donations	to	charity	can	create	a	congenial	inner
environment.	One	will	have	to	go	through	what	destiny	brings,	but	it	will	be	easy
to	bear.	There	are	many	stories	of	saints,	and	saintly	beings,	who	performed
good	karmas	but	had	to	face	much	opposition	and	suffering	during	their	lifetime.
And,	as	well,	there	are	many	stories	of	bad	people	who	performed	only	bad
karmas	but	lived	happy	and	luxurious	lives.	These	stories	point	toward	the
destiny	of	these	people:	they	performed	good	(or	bad)	karmas	in	their	past	lives,
and	the	good	(or	bad)	karmas	of	this	life	did	not	affect	them.	They	either	lived
happily	or	miserably.
Name	Number
This	number	is	obtained	by	adding	the	numerological	value	given	to	the	letters
of	the	popular	name.
For	example	my	popular	name	is	HARISH	JOHARI.	According	to	the	Unit
System,	the	value	of	each	letter	is	as	follows:
The	numerical	value	of	my	letters	comes	to	7.
In	most	cases,	people	are	known	by	their	first	name	or	family	name.	The
numbers	obtained	from	these	two	names	are	also	important,	but	popular	name
means	the	name	with	which	one	is	identified	in	work—the	full	name.	So	we	find
that	three	numbers	are	important:
first	name	number
family	name	number
full	name	or	popular	name	number.
The	influence	of	these	three	numbers	is	experienced	in	three	different
circumstances.	The	effect	of	the	first	name	number	is	in	whichever	circle	one’s
first	name	is	used.	The	effect	of	the	family	name	number	is	in	whichever	circle
one	is	called	by	that	name.	And	the	effect	of	the	full	name	number	is	in	the	area
of	official	documents	and	business.	Generally	the	full	name,	which	is	used	with
the	bank	and	on	a	driver’s	license	and	passport,	is	called	the	name	number.	But	it
does	not	always	work	out	so	simply.	For	example,	the	name	on	my	passport	is
Harish	Chandra	Johari,	but	with	the	bank	and	on	my	books	I	use	the	name
Harish	Johari.	A	small	group	of	people	in	India	call	me	by	my	first	name,	Harish,
and	an	even	smaller	group	of	people	call	me	Mr.	Johari.	Since	my	popular	name
is	Harish	Johari,	and	the	numerical	value	of	this	name	is	7,	my	name	number
will	be	7.	This	is	the	name	I	am	most	known	by	in	my	worldly	dealings.	(A
considerably	larger	group	calls	me	Dada,	which	is	a	1.	However,	since	I	do	not
use	this	name	on	my	books	and	official	documents,	my	name	number	will
remain	7.)
While	the	name	number	has	a	strong	influence	upon	an	individual	life,	and	it
does	affect	the	psyche,	it	has	no	influence	over	the	destiny	number.
The	name	number	plays	a	key	role	in	one’s	social	life	and	marriage.	This	is
the	reason	it	was	popular	to	add	the	family	name	to	the	maiden	name	after
marriage.	Adding	the	family	name	to	the	maiden	name	creates	harmony	with	the
husband	in	the	family	name;	the	woman	shares	the	advantages	of	the	new	family
name.	Yet	even	though	the	addition	of	the	husband’s	name	can	bring	desired
harmony,	sometimes	this	addition	can	change	the	woman’s	name	number	into	an
enemy	number,	creating	problems	in	social	relationships	and	business.	Adding
the	family	name	changes	a	woman’s	identity	and	also	influences	her	psyche.	One
should	check	the	proposed	name	number	before	adding	or	dropping	a	word	or	a
letter	in	a	name.	In	some	cases,	this	addition	can	bring	good	luck	and	increase
one’s	happiness.	The	name	number	is	very	important	for	such	professionals	as
writers,	poets,	architects,	and	politicians	because	the	influence	of	one’s	name
number,	unlike	one’s	psychic	and	destiny	numbers,	continues	even	after	one
leaves	one’s	body.
The	name	number	can	also	be	changed	so	that	it	is	more	compatible	with
either	one’s	psychic	or	destiny	number.	Harmony	between	the	name	number	and
psychic	number	creates	a	good	environment	for	friendships	and	social
relationships.	One	whose	name	number	and	destiny	number	are	in	harmony	is
remembered	after	death.	The	name	number	creates	a	vibrational	pattern	with
which	one	identifies	throughout	life.	The	first	letter	of	one’s	full	name	has	more
influence	than	any	other	letter	in	the	name.	For	example,	of	all	the	letters	in
Harish	Chandra	Johari,	H	is	the	most	potent.
Influence	of	Compound	Numbers
Although	a	person	ultimately	has	three	single	digit	numbers—psychic,	destiny,
and	name—the	composite	numbers	from	which	these	single	numbers	come	are
important.	If	we	look	at	the	psychic	number,	for	example,	those	whose	birthdates
fall	on	a	single	whole	number	from	1	to	9	are	purely	that	psychic	number.
However,	those	who	have	a	double	digit	birthdate,	from	10	to	31,	will	be
affected	by	both	the	composite	numbers	and	the	resulting	whole,	or	psychic,
number.
Number	1	people,	those	born	on	day	1,	10,	19,	or	28	of	any	month,	generally
have	a	bilious	(pitta)	temperament	and	are	often	active.	They	are,	however,	all
different	from	one	another.	Those	born	on	the	first,	pure	number	1	people,	are
considered	fortunate	by	numerologists.	Those	born	on	the	tenth	are	a	little	less
fortunate,	those	born	on	the	nineteenth	tend	to	be	more	assertive,	and	those	born
on	the	twenty-eighth	tend	to	be	calmer	and	more	hardworking.	These	differences
are	due	to	the	combined	influence	of	their	double	numbers	(10,	19,	28).	In	a
birthdate	of	19,	for	example,	the	numbers	1	and	9	are	both	associated	with	a
bilious	temperament:	number	9	(Mars)	people	make	number	1	(Sun)	people
angry	and	impulsive.	In	a	birthdate	of	28,	number	2	is	ruled	by	the	Moon	which
is	ever	changing;	number	8	is	connected	with	Saturn,	a	slow	moving	planet	that
causes	things	to	happen	more	slowly.
The	first	number	of	a	composite	is	more	important	than	the	second	because	it
determines	to	which	series	the	composite	belongs.	The	birthdate	of	12	(1	+	2)
belongs	to	the	series	of	1	(numbers	from	1	to	19),	while	the	birthdate	of	21	(2	+
1)	belongs	to	the	series	of	2	(numbers	from	21	to	29).	Both	of	these
combinations	add	up	to	a	3,	but	number	3s	born	on	the	third	of	the	month	will	be
different	from	those	born	on	the	twelfth	or	twenty-first.	The	number	1	dominates
the	life	of	the	native	born	on	the	twelfth,	and	the	number	2	dominates	the	life	of
the	native	born	on	the	twenty-first	of	any	month.	In	this	way	we	see	how	people
who	share	a	common	number	(such	as	1)	are	influenced	by	the	double	digits	of
their	birthdate	(such	as	10,	19,	or	18).
A	numerologist	must	be	aware	of	the	combination	numbers,	along	with	the
single	whole	number,	to	obtain	a	comprehensive	understanding	of	the	individual
in	question.	Doing	so	will	increase	the	scope	of	information	available,	since	each
double	number	also	assumes	a	personality.	Clarity	in	understanding	will	start	to
develop.	When	one	only	thinks	in	terms	of	nine	numbers,	the	canvas	is	limited.
But	when	one	plays	with	combinations	of	the	nine	numbers	and	zero,	the	canvas
seems	to	become	infinite.	To	enlarge	one’s	range	of	understanding	by	seeing	the
same	thing	from	many	sides	frees	the	intuition.	To	form	an	image	of	a	number,
in	accordance	with	the	celestial	body	to	which	it	is	related,	and	to	see	people
living	their	lives	through	frequencies	identical	to	that	number,	is	working	with
numerology—it	is	not	addition,	subtraction,	division,	and	multiplication.	A
numerologist	needs	many	chips	of	information	for	his	“computer.”	The	more
chips	there	are,	the	more	possibilities	of	mutation.	So	the	first	job	is	to
understand	the	nine	numbers	as	nine	basic	characteristics	and	then	to	understand
the	“mixed	temperament”	of	double	numbers.	When	the	images	of	compound
numbers	get	fixed	personalities,	then	the	numerologist	can	become	more
accurate	in	ascertaining	the	characteristics	of	any	given	individual	at	any	given
moment.
It	is	necessary	to	understand	the	following:
All	numbers	are	mysterious	agents	of	cosmic	energy.	They	are	not	real,
existing	entities,	but	symbols.
Numbers	are	connected	with,	and	influenced	by,	the	celestial	bodies.
These	celestial	bodies,	which	emit	measurable	frequencies,	exert	their
influence	through	the	temperament.
Numbers	provide	a	key	to	the	human	personality	and	all	finite	existence.
All	numbers	have	both	a	good	and	bad	side.
COMPARISON	OF	NUMBERS
As	a	general	rule,	all	numbers	are	good.	We	find	by	observation,	however,	that
some	numbers	are	difficult	as	psychic	numbers,	but	good	as	destiny	numbers.
For	example,	the	number	1	is	difficult	to	deal	with	as	a	psychic	number,	but
becomes	lucky	for	those	who	have	it	as	a	destiny	number.	The	number	2	is	good
as	a	psychic	number,	but	presents	difficulties	as	a	destiny	number.	The	number	3
is	good	as	a	psychic	number,	but	creates	problems	when	it	is	a	destiny	number.
The	number	4	is	good	as	a	psychic	number,	but	creates	difficulties	as	a	destiny
number.	The	number	5	is	good	when	it	is	a	destiny	number.	The	number	6	is
good	for	women	when	it	is	a	psychic	number.	As	a	destiny	number,	6	is	not	good
for	either	men	or	women,	although	being	a	friendly	number,	it	gets	much	help
from	“friends.”	The	number	7	is	a	good	number	for	destiny	(it	is	my	destiny
number!),	but	as	a	psychic	number	it	makes	one	very	self-centered,	dreamy,	and
difficult	to	reach.	The	number	8	is	good	as	a	psychic	number,	but	not	as	a	destiny
number.	The	number	9	is	good	as	destiny	number	but	creates	discomfort	as	a
psychic	number,	especially	for	a	conjugal	relationship.	We	will	see	when	we
discuss	specific	destiny	numbers	how	using	gemstones	and	making	a	name
change	in	accordance	with	one’s	destiny	can	be	helpful.
To	obtain	proper	information	about	a	person,	one	number	is	not	enough.
According	to	most	literature	on	numerology,	all	three	numbers—psychic,	name,
and	destiny—must	be	known.
COMPATIBILITY	OF	NUMBERS
Sometimes	a	person’s	three	numbers	are	very	compatible	with	one	another;
sometimes	they	are	not.	The	numbers	3,	6,	and	9	are	compatible;	3,	5,	and	7	and
2,	5,	and	7	are	incompatible.	When	the	numbers	are	compatible,	there	is	more
harmony	in	one’s	life.	The	more	these	images	differ	from	each	other,	the	more
problems	one	has	in	life.	Such	people	complain	that	the	world	does	not
understand	them.	They	never	think	that	this	could	be	due	to	a	numerological
disharmony—an	incompatibility,	for	example,	between	their	name	and	destiny
numbers.	Sometimes	people	change	their	name	and	the	attitude	of	the	world
around	them	changes.	Name	plays	a	very	important	role	in	one’s	life;	sometimes
a	fictitious	name	even	becomes	legendary,	like	Mickey	Mouse.	Harmony
between	the	destiny	and	the	name	number	has	a	great	impact	on	one’s	life.
Astrologers	sitting	on	the	roadside	in	India	are	able	to	tell	a	lot	to	strangers,	with
only	the	help	of	the	first	letter	of	their	first	name	or	popular	name.	One’s	image
in	the	world	is	very	much	influenced	by	one’s	destiny	and	name	number.
Harmony	between	these	numbers	is	necessary	to	obtain	good	results	from	the
karmas	of	the	present	life.	In	India	the	astrologer	gives	a	name	to	a	child	that
always	begins	with	the	first	letter	of	the	child’s	Moon	sign,	or	Rashi.	This	creates
harmony	between	the	psyche	and	the	name.	But	that	name	is	only	used	by
astrologers.	Today	people	in	India	have	two	names—one	based	on	their	Moon
sign	and	Nakshatra3
and	the	other	according	to	the	fashion	of	the	day.
It	is	therefore	necessary	for	everybody	in	general,	and	numerologists	in
particular,	to	refer	to	the	information	in	the	chart	on	pages	188193	when
considering	the	relationship	between	the	numbers.
Residential	Numbers
The	numerological	information	that	follows	is	most	often	applied	to	the
relationships	between	people.	It	also	can	be	applied	to	the	relationships	between
a	person	and	an	object,	house	number,	street	number,	and	the	number	of	a
country,	city,	or	town.	Residential	numbers	include	the	house	number,	the
number	of	the	street,	and	the	number	of	the	city,	town,	or	country	of	residence.
For	calculating	the	house	number	and	the	street	number,	the	numbers	should	be
added	together	to	make	a	single	whole	number	(if	the	numbers	are	not	already
single	whole	numbers).	The	number	of	the	city,	town,	or	country	is	calculated	by
adding	the	numerical	value	of	the	letters	forming	the	name	of	the	city,	town,	or
country	(see	page	10	for	the	numerical	value	of	letters).	These	separate	name
numbers	do	not	get	combined	to	form	a	single	whole	number	because	of	the
individual	relationship	each	has	to	one’s	destiny	number	during	the	time	period
one	lives	in	that	city,	town,	or	country.	If	the	number	of	the	residence	one	is
going	to	buy	or	rent	is	not	compatible	with	one’s	destiny	number,	one	should	not
move	into	it.
NUMBERS	AND	AYURVEDA
According	to	Ayurveda,	the	ancient	Indian	system	of	medicine,	one’s
temperament	or	chemical	nature	is	composed	of	the	three	humors:	Wind	(vatta),
Bile	(pitta),	and	Mucus	(kapha).	The	dominant	humor	within	each	individual	is
produced	by	the	influence	of	the	planet	that	rules	his	or	her	Sun	sign	(see	chart
on	page	16).	This	chemical	nature	determines	the	physical	and	mental
environment	inside	the	body,	which	the	mind	interprets	as	feelings	and	emotions.
When	any	one	of	these	humors	increase	or	get	aggravated,	it	produces	a	specific
array	of	diseases.	Under	the	heading	“Balancing	the	Interior	and	Exterior
Environments”	in	the	chapters	that	follow,	diseases	associated	with	a	particular
number	(thus,	a	particular	planet	and	body	type)	are	discussed	from	an
Ayurvedic	point	of	view.
One	method	of	cleansing	and	purifying	the	physical	body	in	Ayurveda	is	by
fasting.	Fasting	does	not	mean	complete	abstinence	from	food.	Fasting	means
observing	a	particular	attitude	on	the	day	of	fast.	One	should	avoid	working	on
this	day	and	relax	but	not	lie	down	and	sleep.	One	should	become	slow,	avoid
stress,	and	eat	only	once,	in	the	evening	after	meditation.	Depending	on	the
number	in	question,	certain	specified	foods	are	recommended.	One	should	avoid
anger,	aggressive	thoughts,	negativity,	and	indulgence	with	members	of	the
opposite	sex	the	night	before	the	fasting	day	and	on	the	day	of	the	fast.
The	pharmaceutical	aspect	of	Ayurveda	includes	the	ingestion	or	topical
application	of	certain	powdered	gems,	which	are	used	to	heal	the	body
electrochemically.	Gems	are	minerals	in	pure	crystalline	form	that	are	created
when	the	earth	is	in	the	form	of	molten	lava.	Our	body	is	also	composed	of	these
minerals,	and	a	deficiency	of	minerals	causes	sickness.	When	gems	are	ingested
orally,	the	body	gets	its	supply	of	minerals	to	carry	out	its	metabolic	functions
smoothly,	thus	one	feels	healthy.	When	gems	are	worn	as	rings	and	pendants,
they	react	with	light	to	influence	the	electromagnetic	field	of	the	body,	creating
an	electrochemical	balance	in	the	body.	Proper	rituals	make	the	body	ready	to
absorb	energy	and	go	through	these	chemical	changes.
Mixed	Temperament
In	the	case	of	number	1	people	born	on	day	28,	the	2	reveals	a	mucus-dominated
temperament	because	of	the	Moon,	and	8	a	wind-dominated	temperament
because	of	Saturn.	Both	humors	working	together	in	the	number	28	will	create	a
person	who	will	have	frequent	problems	with	colds	and	coughs	and	body	gasses.
However,	the	influence	of	2	and	8	together	will	make	these	1s	less	authoritative
than	those	born	on	the	day	1	of	any	month.
NUMBERS	AND	MYTHOLOGY
In	this	book	we	are	working	with	numbers	as	agents	of	the	divine,	mysterious
energy	of	the	cosmos—not	as	agents	of	the	planets	alone.	Another	tool	that	can
help	the	numerologist	explain	the	characteristics	of	numbers	is	the	knowledge
that	can	be	derived	from	mythological	stories.	For	persons	practicing
numerology	in	the	West,	these	stories	must	come	from	Western	mythology,
although	knowledge	of	stories	from	the	Hindu	tradition	can	provide	additional
insight.	This	mythological	information	is	not	included	in	the	present	volume,	but
it	deserves	consideration	as	a	separate	book.
Numbers	of	Exaltation
The	number	of	exaltation	refers	to	single	numbers	(psychic,	destiny,	or	name)
that	are	arrived	at	by	a	particular	combination	of	double	numbers.	For	example,
those	people	whose	single	number	1	comes	from	28	will	have	a	special	force
behind	them	and	will	be	more	successful	in	life	than	other	1s.	The	number	1	can
be	the	result	of	1,	10,	19,	28,	37,	46,	55,	64,	73,	82,	or	91.	But	a	1	that	comes
specifically	from	28	is	called	exalted.
The	same	is	true	for	2	resulting	from	29,	3	from	12,	4	from	31,	5	from	23	and
32,	6	from	24	and	33,	7	from	25	and	34,	8	from	26	and	35,	and	9	from	27	and	36
—these	single	numbers	are	all	exalted.	In	determining	the	number	of	exaltation,
we	have	to	see	the	double	numbers	as	the	conjunction	of	two	planets.	The	effect
of	this	conjunction	guides	the	numerologist	to	determine	which	numerical
combinations	create	a	more	dynamic	effect.	Their	effect	on	vata,	pitta,	kapha
(Tridoshas)	shows	the	mental	and	physical	makeup	of	the	native	having	a	double
number.	If	the	conjunction	creates	a	balanced	temperament	it	is	called	exalted.
The	Relationships	and	Characteristics	of	Numbers	table	summarizes	the
numbers	of	exaltation	for	each	of	the	nine	single	numbers	(see	pages	188-193).
This	table	should	be	consulted	on	two	occasions:	before	the	numerologist	forms
his	opinion	about	any	person	or	couple	and	before	a	student	of	numerology	starts
a	new	job	or	a	new	enterprise.	The	chapter	on	Compound	Numbers	also
describes	the	characteristics	of	these	numbers	of	exaltation.
In	each	of	the	chapters	that	follow	we	will	discuss	in	detail	the	planets,	the
psychic,	name,	and	destiny	numbers	and	the	relationship	between	people	with
numbers	in	like	categories	(e.g.,	psychic	1	with	psychic	3,	name	4	with	name	7,
etc.).	Remember,	odd	numbers	are	dynamic	and	even	numbers	are	static.
Friendly	numbers	lead	to	relaxation	and	inactivity;	enemy	numbers,	which	create
alertness	and	activity,	are	helpful	for	one’s	growth	and	are	actually	“friends.”
The	Vedic	Square
The	presence	of	magic	squares	related	to	the	planets,	known	as	astrological
Yantras,	clearly	shows	that	the	mystic	power	of	numbers	was	known	in	ancient
India.	The	Vedic	Square	is	a	good	example	of	this	knowledge.	Nothing	about	the
origin	of	the	Vedic	Square	is	known	in	India.	The	designs	obtained	from	this
square	are	used	as	decorative	patterns	in	various	palaces	and	shrines	throughout
India.	Although	not	popular	in	India	now,	it	has	played	a	significant	role	there	in
the	past.	Muslim	artists	and	craftsmen	as	well	have	used	the	Vedic	Square	to
obtain	many	of	their	patterns.
The	book	Islamic	Patterns1
contains	the	Vedic	Square,	as	well	as	dozens	of
fantastic	designs	and	patterns	which	were	obtained	from	it.	The	square	itself	is	a
table	of	multiplication	of	numbers.	Instead	of	using	the	double	numbers	obtained
by	multiplication	of	single	numbers,	they	are	reduced	here	to	single	whole
numbers.	For	example,	7	x	6	=	42	=	6.	This	use	of	single	numbers	makes	the
Vedic	Square	very	unique	and	significant.	We	can	see	the	repetition	of	numbers
1	to	9	very	clearly	(see	page	19).
With	the	exception	of	number	3	and	number	6,	each	number	appears	in	six
squares.	Numbers	3	and	6	appear	in	twelve	squares.	The	number	9	is	unique	in
the	Vedic	Square—it	repeats	21	times!	By	joining	the	midpoints	of	the	square	of
any	of	the	nine	numbers,	a	diagram	can	be	obtained.	The	book	Islamic	Patterns
shows	how,	by	using	these	basic	patterns,	the	craftsmen	of	the	Islamic	world
developed	intricate	and	beautiful	patterns.
These	patterns	can	greatly	assist	numerologists.	I	use	them	to	examine	how
numbers	relate	to	each	other	visually.	The	patterns	in	this	book	are	provided	as	a
visual	aid	to	readers	and	numerologists	who	care	to	work	with	them.	The	visuals
from	the	Vedic	Square	are	purely	geometric.	Playing	with	these	patterns	will
engage	both	hemispheres	of	the	brain	and	will	help	the	intuitive	faculty	obtain
the	information	hidden	behind	these	figures.	By	joining	midpoints	of	the	six
squares	where	the	number	1	repeats	itself,	the	pattern	of	a	number	1	is	formed.
When	we	place	this	pattern	over	other	patterns	obtained	by	superimposing	other
like	numbers,	we	can	literally	see	their	inter-relationships.	If	we	color	these
squares	with	the	colors	of	the	planets	that	correspond	to	each	number,	we	can
obtain	color	visuals.	Anyone	can	make	a	visual	by	superimposing	the	pattern
formed	by	their	psychic	number,	name	number,	and	destiny	number.	(See	pages
7-11	for	how	to	obtain	these	numbers).
The	following	pages	describe	the	Vedic	Square	and	show	the	different	patterns
of	the	numbers	derived	from	the	square.
CREATING	THE	SQUARE
The	Vedic	Square	is	a	square	of	nine	tables	of	multiples	of	the	basic	nine
numbers.	To	make	a	Vedic	Square	we	must	have	a	square	with	nine	equal
divisions	on	each	side.	By	joining	the	dividing	marks	on	all	sides,	we	get	a
square	with	81	units	of	equal	size.	Now	place	in	both	the	top	row	and	the	left
column	the	numbers	1	through	9.	All	remaining	rows	are	created	by	multiplying
the	elements	in	these	two	rows.	All	double	numbers	are	reduced	(by	addition)	to
single	whole	numbers.	When	you	put	the	numbers	under	the	table	of	2,	for
example,	you	have	to	use	the	following	method:
The	table	of	2	will	be	2,	4,	6,	8,	1,	3,	5,	7,	9.	The	table	of	3	will	be	3,	6,	9,	3,	6,	9,
3,	6,	9.	The	table	of	4	will	be	4,	8,	3,	7,	2,	6,	1,	5,	9	and	so	forth.
THE	NUMBER	NINE
One	thing	that	becomes	immediately	apparent	is	the	persistent	appearance	of	the
number	9.	We	see	that	this	elegant	number	alone	forms	the	other	two	edges	of
the	square.	Nine,	the	last	number,	does	not	change;	all	multiples	of	nine	are	nine.
If	you	add	any	number	to	the	number	nine,	it	will	remain	the	same—nine	will
not	lose	its	identity:
9	+	1	=	10	=	1
9	+	2	=	11	=	2
9	+	3	=	12	=	3
and	so	forth.
So	by	examining	the	Vedic	Square	we	have	discovered	something	very	basic
to	Hindu	numerology.	Since	adding	9	to	any	number	does	not	alter	that	number,
in	this	system	of	numerology	the	number	9	(or	any	numbers	adding	up	to	9)	is
dropped	before	calculations	begin.
When	calculating	single	whole	numbers,	it’s	easier	to	simply	omit	the	number
nine,	and	not	waste	energy.	To	make	a	simple	whole	number	for	someone	born
on	May	12,	1934:
Add	the	remaining	digits.
1	+	2	+	1	+	3	=	7
Similarly,	to	make	a	single	whole	number	of	the	random	digits
1	8	7	6	3	2	9	5	4
cancel	the	9	itself	and	the	following	combinations:
1	+	8	=	9				6	+	3	=	9				7	+	2	=	9				5	+	4	=	9
Since	all	the	numbers	cancel	out,	the	resulting	single	whole	number	=	9.	Thus
we	see,	the	number	9	should	be	omitted	for	ease	in	calculation.	In	the	Hindu
system,	the	number	nine	is	beyond	the	“	octave	of	Prakriti”	(or	the	manifested
universe).	Known	as	Primordial	Nature,	Prakriti	is	composed	of	the	three	Gunas
(3)	and	Five	Elements	(5).	Going	beyond	this	transitory	nature,	nine	is,	therefore,
the	number	of	the	unchangeable	Purusha	(Consciousness).
The	eight	numbers	of	Prakriti	plus	One,	the	Purusha,	form	nine—the
manifested	world	of	names	and	forms.	This	one	Purusha	becomes	many	and
creates	forms	in	combination	with	the	eightfold	Prakriti.	If	we	look	at	the
multiples	of	the	number	8	in	the	Vedic	Square,	we	will	observe	a	gradual
reduction	from	8	to	7	to	6,	(8	x	1	=	8,	8	x	2	=	16	=	7,	8	x	3	=	24	=	6)	and	so	on
down	to	1;	then	when	8	gets	multiplied	by	9	again	it	achieves	full	power	and
becomes	9	(8	x	9	=	72	=	9).	It	comes	back	to	8	when	multiplied	by	10	(which	is
a	1	with	a	zero),	regains	its	basic	number	8	with	a	zero:	8	x	10	=	80	=	8,	and	can
create	a	series	of	8	with	1	and	2	and	so	on	up	to	89,	where	a	combination	of	9
leaves	it	behind	and	starts	its	own	series	of	9.	Nine	is	therefore	the	number	of
Purusha	and	refers	to	completion.	Eight	is	the	number	of	Prakriti	and	reduces
gradually	to	evolve	other	numbers.
These	concepts,	which	are	basically	mathematical	in	nature,	gave	birth	to	the
mystic	science	of	numbers	known	as	numerology.	This	science	starts	with	the
study	of	numbers	as	representatives	of	cosmic	energy,	which	embody	hidden
power	and	significance.	Giving	a	particular	number	to	Primordial	Nature,	calling
it	eightfold,	and	perceiving	existence	through	the	vehicles	of	the	Five	Elements
and	three	Gunas,	enabled	the	human	mind	to	see	unity	in	diversity	and	to
observe	fundamental	laws	working	at	the	base	of	all	existence.	Reducing	the
innumerable	to	numbers,	and	contemplating	the	innumerable	through	numbers,
made	man	think	about	the	basic	nine	numbers	as	not	merely	digits,	but	as	agents
of	cosmic	energy.	Each	number	soon	came	to	assume	a	personality	of	its	own,
which	helped	man	determine	the	dynamics	of	his	relationships	to	people	and
objects.
PLAY	OF	OPPOSITES
The	Vedic	Square	clearly	reveals	the	play	of	opposites	that	occurs	in	the	process
of	multiplication	of	numbers.	The	visual	pattern	created	by	combining	number	1
to	number	4	forms	a	diagonal,	connecting	the	top	left	and	bottom	right	portions
of	the	square.	And	the	pattern	created	from	linking	number	5	to	number	8	is	just
the	opposite,	connecting	the	top	right	corner	with	the	bottom	left	portion	of	the
square.	Patterns	1	and	8	are	exact	opposites	of	each	other,	as	are	2	and	7,	3	and	6,
and	4	and	5.	Nine	makes	its	own	unique	pattern,	not	complemented	by	any	other
number	in	the	Vedic	Square.
These	“opposites	of	nature”	can	also	be	found	in	the	numerological
progressions.	In	column	1	of	the	Vedic	Square	the	numbers	progress	sequentially
from	1	to	9,	whereas	in	column	8,	which	is	opposite	of	number	1,	they	go	in
reverse	order.	Similarly,	this	is	the	case	with	2	and	7,	3	and	6,	and	4	and	5.
It	is	worth	noting	that	all	numbers	come	back	to	9	before	they	get	multiplied
by	10	and	start	their	own	series	of	numbers	(see	the	description	of	zero	on	page	4
for	further	details	about	these	series).
These	numerological	oppositions	can	also	be	seen	when	we	assign	numbers	to
the	nine	cosmic	energies	that	influence	our	solar	system:
According	to	the	information	obtained	from	the	Vedic	Square	(see	page	19),
linking	opposing	numbers	creates	the	same	basic	pattern,	only	they	are	reversed.
However,	according	to	astrology	the	Sun	(1)	and	its	opposite,	Saturn	(8),	have
entirely	different	energies—both	in	pattern-aspects	and	behavior.	So	the	Vedic
Square	is	helpful	only	up	to	a	particular	point	in	our	understanding	of	the
numbers:	for	observing	the	visual	patterns	of	the	numbers	and	their	relationships
when	superimposed.	The	mystic	power	hidden	in	the	numbers,	which	reveals	at
any	given	moment	the	unpredictable,	is	not	revealed	in	the	Vedic	Square.	For
this,	the	numerologist	must	cull	information	from	many	different	sources,
including	mythology,	astrology,	and	the	Cabala.

The	Sun	and	Number	1
The	Sun	is	the	ruling	planet	of	people	born	on	day	1,	10,	19,	or	28	of	any	month,
or	whose	destiny	or	name	number	adds	up	to	1.	The	qualities	of	the	Sun
described	below	are	most	clearly	visible	in	people	who	have	a	psychic	number
of	1.
The	Sun	is	the	father	of	our	solar	system,	around	which	all	of	our	planets
revolve.	All	living	forms	within	our	solar	system	depend	on	the	Sun	for	their	life
force.	Any	planet	that	is	in	conjunction	with	the	Sun	loses	its	power;	any	planet
that	comes	too	near	the	Sun	becomes	retrograde.	King	of	the	solar	system,	the
Sun	follows	the	laws	inherent	in	the	particles	of	energy,	the	cosmic	law.	The
Sun,	known	for	its	regularity	of	movement,	completes	one	revolution	around	its
own	axis	in	twenty-five	days.
According	to	the	Hindu	scriptures,	the	Sun	is	the	dwelling	place	of	ancestors
and	is	the	first	of	eight	vasus	(dwelling	places	of	consciousness).	The	luminous,
effulgent	mass,	visible	with	the	naked	eye,	is	the	Sun’s	body;	its	consciousness	is
represented	by	a	kshatriya	(warrior	king)	on	his	chariot,	driven	by	seven	horses
(which	represent	the	seven	rays	of	light).	His	chariot	moves	steadily	on	a	solitary
wheel.
The	Sun	gives	an	assertive,	individualistic,	exuberant,	and	proud	nature.
The	Sun	represents	a	purifying	male	energy.	Associated	with	Vishnu,	the	Lord
of	preservation,	the	Sun	is	characterized	as	having	a	stable	and	selfless	nature,
one	that	is	strong,	firm,	authoritative,	royal,	and	respectable.	It	is	lord	of	the
East.	The	Moon,	Mars,	and	Jupiter	are	friends	to	the	Sun.	Saturn,	Venus,	Rahu,
and	Ketu	(north	and	south	nodes	of	Moon)	are	its	enemies.	Mercury	has	a
neutral	relationship	with	the	Sun.
According	to	astrologers,	the	Sun	passes	through	one	of	the	twelve	zodiac
signs	each	month.	The	Sun	is	exalted	(at	its	peak)	in	Aries;	this	power	decreases
gradually,	until	the	Sun	passes	Virgo.	From	Libra	onward,	the	energy	starts	its
full	descent	and	becomes	weakest	when	it	reaches	the	zodiac	sign	Pisces.	From
there,	it	again	rises	to	its	peak	in	Aries.	It	rules	the	zodiac	sign	Leo.
The	Sun	influences	the	intellect—it	makes	its	natives	masculine,	authoritative,
harsh,	strong,	witty,	extroverted,	helpful	to	friends,	and	brutal	to	enemies.	Like	a
lion,	the	upper	torso	of	a	native	influenced	by	the	Sun	is	more	developed	than
the	lower	half.	They	become	famous	and	achieve	top	positions	in	their	field	of
work.	Sun	natives	have	bile-dominated	temperaments.	The	Sun	rules	over	the
right	eye,	right	nostril,	pingala	nadi	(right	channel),	the	right	side	of	the	body,
and	the	left	hemisphere	of	the	brain.
NUMBER	1
Psychic	Number	1
One	is	the	psychic	number	of	those	born	on	day	1,	10,	19,	or	28	of	any	month.
Psychic	number	1	people	are	ruled	by	the	Sun,	which	gives	them	fixity	of
purpose	and	ideas.	They	tend	to	adhere	to	their	ideas,	especially	when	convinced
that	they	are	on	the	right	track.	It	is	difficult	to	persuade	them	to	change	their
mode	of	behavior,	opinion,	conviction,	or	decision.	They	also	formulate	their
ideas	quickly.
They	have	a	clear	understanding	and	a	particular	point	of	view,	which
dominates	throughout	all	the	things	they	do	in	life.	They	are	sober,	solid,
punctual,	and	clear	in	their	expressions.
They	have	a	strong	individuality	and	need	a	lot	of	attention	and	respect;	they
are	themselves	caring	for	others	and	wish	others	to	reciprocate.	They	make
friends	easily	and	break	friendships	with	difficulty.
They	are	authoritative	and	also	are	very	fortunate	in	getting	help	from	persons
of	authority.	Their	good	fortune	helps	them	in	every	walk	of	life.	They	are
known	as	lucky	people.
They	like	freedom	and	dislike	restraint;	they	cannot	bear	interference	in	their
work,	at	any	cost.
They	love	novelty	and	try	to	use	the	latest	methods	and	technologies	in
whatever	they	do.	They	present	well	known	ideas	as	their	own,	from	a	new	point
of	view.	They	are	creative	and	inventive	and,	most	of	the	time,	have	positive	and
optimistic	attitudes.
They	have	strong	builds,	more	vitality	than	other	people,	and	are	capable	of
doing	hard	physical	labor.	Generally	high	spirited,	they	are	large	hearted	and
hardworking	people,	free	from	envy,	malice,	and	grudge.	They	are	efficient	in
their	jobs,	honest	and	true,	and	right	most	of	the	time,	because	they	make	the
correct	decisions	at	the	appropriate	time.	These	qualities	help	them	excel.	They
rise	in	their	jobs	because	they	always	think	of	reaching	the	highest	ranks.	They
labor	hard	to	achieve	the	top	and	most	of	the	time	do	so.	If	they	do	not	succeed,
they	become	sad,	pessimistic,	upset,	irritated,	and	depressed.
Psychic	number	1	people	have	a	fertile	brain,	brimming	over	with	new
thoughts	and	ideas.	They	promote	new	ventures	and	new	schemes.
They	like	to	live	luxuriously	and	in	a	royal	way	and	spend	money	on	pomp
and	show,	though	basically	they	are	spendthrifts.	They	also	spend	money	freely
to	buy	gifts	and	presents	for	others.	They	share	with	guests	and	friends	and
spend	freely	on	them.
They	are	enthusiastic	in	religious	matters	and	often	believe	that	they	are	born
with	a	special	mission.	They	constantly	work	hard	to	fulfill	their	mission,	even	if
it	means	sacrifice	or	inconvenience.
They	are	obstinate,	and	face	ups-and-downs	in	their	life	without	losing	nerve
or	courage.
They	dislike	criticism	but	like	to	criticize	others.
They	have	good	manners	and	good	taste;	they	dislike	disorder,	laziness,
slackness,	false	pride,	false	praise,	false	promises,	egotism,	and	flattery.
They	want	freedom	with	no	boundaries.
They	are	clear	in	expressing	themselves	and	like	concise	answers	to	their
questions.
They	join	religious	and	social	organizations,	but	leave	if	they	are	not	given
key	positions.	They	can	help	only	when	they	are	given	attention	and	recognition
and	are	admired	for	their	hard	labor.
They	are	benefited	by	members	of	the	opposite	sex	in	general	and	are	liked	by
them.
They	are	influential	and	influence	their	friends	and	colleagues.	The	active
years	of	their	life	are	between	thirty-five	and	forty-nine.
They	are	disciplined,	straightforward,	practical,	and	serious-minded	people.
They	are	extremely	kind,	cooperative,	and	can	control	their	nerves.	They	remain
firm	and	steady	under	unfavorable	conditions	and	are	sometimes	obstinate	and
easily	irritable.
Like	the	Sun,	they	are	a	source	of	light	and	delight	and	are	dedicated	to
serving	humanity	at	large.
They	are	fond	of	traveling	and	can	adjust	themselves	to	all	kinds	of	situations.
They	enjoy	life	and	can	appreciate	art	and	beauty.
They	are	ready	to	accept	truth	and	change	their	opinions,	because	to	them
truth	is	more	important	than	their	opinions.	They	accommodate	ideas	from
everywhere	and	create	their	own	path,	instead	of	following	the	traditional
religions	into	which	they	were	born.
They	are	very	conscious	of	their	public	image.
They	are	basically	friendly	and	helpful	and	can,	in	a	short	period	of	time,
make	contact	with	strangers	and	inspire	them.	They	encourage	young	people	to
become	leaders.	They	become	famous	in	their	society	and	are	admired	for	their
hard	work,	poise,	graciousness,	and	generosity.
Precautions	for	Psychic	Number	1	People
Psychic	number	1s	should	think	of	their	budgets	before	spending	extravagantly
on	pomp	and	show,	buying	costly	gifts,	lending	money,	and	investing	in
business.	They	should	not	take	risks	in	money	matters.
They	should	not	make	hasty	judgments,	for	these	will	bring	failure.
They	should	refrain	from	the	following:
Being	overly	ambitious.
Being	too	independent,	lawless,	or	reckless.
Being	too	authoritative,	bossy,	or	dictatorial.
Being	too	critical.
Demanding	attention	all	the	time.
Boasting.
Sensuality	(if	males).
Struggling	alone	and	not	asking	for	help.
Sharing	beyond	their	limits	with	friends	and	guests.
Destiny	Number	1
One	is	very	good	as	a	destiny	number.	As	a	psychic	number,	1	makes	individuals
work	very	hard	to	achieve	prominence	in	life.	But	destiny	number	1	people
enjoy	the	fruits	of	work	done	by	others.	Destiny	number	1	people	become
important	in	their	own	circles,	consciously	or	unconsciously,	while	psychic
number	one	people	want	to	become	important,	to	become	known	and	number
one	in	everything.	Destiny	1	people	are	considered	lucky	by	others.	They	are
favored	with	a	strong	mind	in	a	strong	body.	They	become	leaders	and	heads	of
their	circle.	Able	to	see	the	future	clearly	and	plan	accordingly,	they	achieve
success	without	effort.	They	get	money	unexpectedly	and	spend	it	with	ease.
Destiny	1	people	become	known	for	their	forbearance,	patience,
organizational	abilities,	and	persistence.	If	spiritually	inclined,	they	become
heads	of	spiritual	organizations	and	real	teachers.	As	teachers	they	are	clear,
precise,	to	the	point;	and	they	adhere	to	the	truth.	But	since	1	is	primarily	a
number	for	worldly	achievement	and	success,	it	is	rare	to	find	a	great	spiritual
leader	with	1	as	a	destiny	number.	Destiny	number	1	people	are	materialistic,
logical,	and	intellectual.	Spirituality	requires	emotionality	and	faith,	not	logic.
Destiny	number	1	makes	its	natives	idealistic,	courteous,	kind,	helpful,
popular,	and	quick	in	making	judgments.	Although	they	are	right	most	of	the
time,	in	periods	when	the	Sun	is	weak	(October,	November,	and	December),
they	can	make	mistakes.	These	bring	them	disappointments	but	teach	them
tolerance.
They	encourage	their	colleagues	to	excel,	and	they	encourage	young	people	to
become	leaders.	They	are	clever,	always	smiling,	attractive,	and	draw	attention.
Destiny	number	1	people	are	not	very	romantic;	they	are	unfortunate	in
matters	of	marriage	and	love.	They	do,	however,	become	great	storytellers.
They	are	favored	by	government	officials.
If	their	psychic	number	and	name	number	are	favorable	(see	chart	on	pages
188-189),	destiny	number	1	people	rise	beyond	all	expectations	and	become	the
best	in	whatever	they	do.	However,	if	these	numbers	are	unfavorable,	they
withdraw	their	participation	and	become	introverted.	Nevertheless,	being	lucky,
they	achieve	success	and	rise	in	the	material	field	unobstructed.	(This	is	not	the
case	when	1	is	the	psychic	number	or	name	number.)	Destiny	1	people	are	born
with	a	missionary	spirit	and	have	a	purpose	in	life.
Destiny	1	Women
Destiny	1	women	who	are	not	working	in	an	organization	devote	their	energy	to
domestic	life.	They	create	a	good	environment	for	the	friends,	guests,	and	family
members.	They	help	the	needy	and	poor,	and	they	become	popular	mother
figures.	They	are	bold,	cautious,	sensitive,	and	face	difficulties	with	grace.
If	they	do	work	in	an	organization,	they	hold	important	positions	because	of
their	good	qualities.	They	are	sociable	and	have	a	regal	way	of	handling	things.
They	have	strong	characters,	orderly	and	systematic	methods,	and	good
manners.
Destiny	1	Men
Destiny	1	men	with	a	political	career	who	are	not	allied	with	any	party	or
working	in	an	organization,	become	popular	and	achieve	high	posts.	They	spend
their	energy	in	planning	to	improve	the	living	situation	of	the	poor.	They	are
highly	ambitious,	authoritative,	and	pioneers	in	their	fields.	If	they	are	writers,
they	are	scholarly	and	are	very	clear	in	expression;	their	topics	are	original.
If	destiny	1	men	work	in	an	organization,	they	become	heads	of	their
department.	If	they	are	born	either	when	the	Sun	is	strong,	or	on	the	twenty
eighth	of	any	month,	they	make	good	progress	in	their	work.	They	gain	the	favor
of	their	superiors	and	subordinates	and	acquired	top	executive	powers.	If
businessmen,	they	make	their	fortunes	between	thirty-five	to	forty-nine	years	of
age,	and	save	enough	in	the	form	of	properties	and	bank	deposits	to	secure	their
future.	They	then	devote	their	time	and	energy	to	the	welfare	of	humanity.	If
politicians,	they	are	heads	of	their	organizations.
Name	Number	1
One	as	a	name	number	can	be	beneficial.	People	with	this	name	number	are
remembered	for	a	long	time.	As	a	name	number	alone,	1	is	not	capable	of
bringing	great	success,	but	if	aided	by	a	destiny	number	of	1,	it	brings	great
benefit—popularity,	cooperation,	fame,	and	attention.	Having	1	as	a	name
number	facilitates	progress	in	all	areas;	it	is	very	helpful	for	writers,	poets,
musicians,	actors,	and	leaders.	The	name	number	continues	to	work	even	after
death.	It	is	effective	and	beneficial	only	in	the	social	field.
BALANCING	INTERNAL	AND	EXTERNAL
ENVIRONMENTS
By	observing	fasts,	using	the	proper	spices	and	gem	powders,	meditatingon	the
mantras,	and	using	the	yantras,	one	can	balance	the	internal	environment.
Balancing	the	external	environment	is	possible	by	choosing	the	right	time	for
activities	(in	the	ascending	cycle	or	descending	cycle),	selecting	good	friends
(finding	compatible	numbers),	and	starting	a	job	at	the	appropriate	time
(observing	weak	period	and	strong	periods).	Balance	is	achieved	by	working
with	the	energy	flow	that	is	already	available,	as	described	in	the	sections	that
follow.	The	information	that	follows	applies	to	people	with	psychic	number	1.
Weak	Periods
The	weak	periods	for	1	correspond	to	times	when	the	Sun	is	weak:	during	the
months	of	October,	November,	and	December.
During	these	times	they	can	feel	a	lack	of	interest	in	their	work,	setbacks	in
their	health,	and	stresses	and	strain.	They	can	suffer	from	financial	losses,	have
unnecessary	worries,	get	blamed	for	errors,	and	earn	a	bad	reputation.
They	should	not	make	new	plans,	startnewjobs,	or	embark	on	any	new
adventures;	investments	during	this	period	do	not	bring	good	returns.
Number	1	men	should	refrain	from	excessive	interaction	with	members	of	the
opposite	sex	during	these	months.
Strong	Periods
The	strong	periods	for	1s	are	from	March	21	to	April	28	and	from	July	10	to
August	20.
These	periods	are	best	suited	for	making	new	plans,	investments,	new
promises,	new	contracts,	and	starting	new	jobs.
Good	Dates
Days	1,	4,	10,	13,	19,	22,	28,	and	31	of	any	month	are	good	for	them,	but	1,	19,
and	28	are	especially	good;	all	jobs	started	on	these	dates	are	easily
accomplished.	These	dates	can	be	turning	points	in	their	life	and	are	especially
lucky	if	they	fall	within	one	of	their	strong	periods.
Good	Days
Sunday	and	Monday	are	good	days.	If	a	Sunday	or	Monday	falls	on	day	19	or	28
of	any	month,	it	becomes	even	more	beneficial.
Favorable	Colors
Orange,	yellow,	golden	yellow,	copper,	and	gold	are	best	suited	for	them.	They
should	keep	these	colors	around	their	living	spaces	and	places	of	work,	in	the
form	of	curtains,	pillows,	sheets,	tablecloths,	and	covers.	A	handkerchief	in	any
of	these	colors	is	very	helpful	during	hours	of	stress	and	weak	periods.	Just
looking	at	these	colors	will	bring	them	good	energy.
Precious	Stones
A	ruby	of	five	rattikas	(3	carats)	worn	as	a	ring,	with	an	open-back	setting	on	the
ring	finger	of	the	left	hand,	is	lucky	for	men	only.	The	ruby	should	be	bought	on
a	Sunday	or	Monday	and	worn	after	the	proper	rituals	have	been	performed.1
Women	who	are	1s,	however,	are	not	advised	to	wear	rubies.	They	can	wear	red
spinel,	garnet,	and	other	ruby	substitutes,	such	as	red	sapphire.
All	men	who	are	born	on	the	tenth	day	or	in	the	tenth	month,	or	who	have	a
zero	in	their	date,	month,	or	year	of	birth,	should	definitely	wear	ruby	rings.
Women	in	this	same	category	should	wear	garnet	jewelry	(rings,	pendants,	etc.)
or	another	ruby	substitute.	Both	men	and	women	can	decrease	the	misfortune
that	comes	from	the	zero	by	meditating	on	their	gemstones.	They	should	get	up
before	sunrise	and	before	seeing	anyone,	kiss	their	gemstone,	and	gaze	upon	it
with	love.	If	possible	they	should	perform	worship	or	donate	money	to	holy
men,	to	please	the	Sun.
Number	1	men	born	on	the	nineteenth	should	wear	rings	set	with	ruby;
number	1	women	should	wear	rings	set	with	coral.
Men	born	on	the	twenty-eighth	should	wear	rings	set	with	ruby;	these	number
1	women,	rings	set	with	pearl.
All	1s	should	take	ruby	powder	to	help	their	bodies	heal	electrochemically.
After	fifty	years	of	age,	number	1	people	should	use	ruby	powder	with	honey	(or
cream)	and	powdered	pearls.
Meditation
Ones	are	prescribed	to	meditate	on	the	rising	Sun.	If	this	is	not	possible,	they
should	meditate	on	a	ruby.
Deity
Their	deity	is	the	Sun-god.	The	Sun	is	personified	as	seated	on	a	pink	lotus	in
lotus	posture.	While	driving	a	chariot	led	by	seven	white	horses,	he	is	holding
lotus	flowers	in	his	hands,	giving	blessings	and	smiling.
Mantra
Japa2
(repetition)	of	the	mantra	of	any	planet	should	be	completed	within	the
ascending	cycle	of	the	moon	and	should	be	repeated	the	prescribed	number	of
times.
AUM	HRIM	HRIM	SURIYAYE	NAMAH	AUM
Number	1s	should	repeat	the	above	mantra	7,000	times	within	the	ascending
cycle	of	the	moon.
Yantra	of	the	Sun3
Health	and	Diseases
Although	all	1s	have	strong	builds,	they	always	have	problems	with	their
circulatory	system	and	suffer	from	high	blood	pressure	in	old	age.	Their	eyes
often	cause	them	trouble.	After	fifty-six	they	may	be	hospitalized	often,	but	they
will	recover	quickly	and	live	a	long	life.	They	are	advised	to	use	foods	that
purify	the	blood	and	refrain	from	hard	work	after	they	pass	fifty.	They	should
massage	their	body	with	sesame	or	almond	oil	to	maintain	good	blood
circulation.	Any	exercises	that	enhance	circulation	can	be	very	helpful	to	them.
They	should	not	ingest	foods	that	increase	acidity.	Their	temperament	is	bile
dominated	(pitta),	and	they	need	to	maintain	an	alkaline	blood	chemistry.	Bile
gets	aggravated	by	anger,	grief,	fear,	physical	exertion,	improper	digestion,	and
the	use	of	bitter,	pungent,	acidic,	salty,	and	dry	substances.	Exposure	to	sun	and
heat	also	aggravates	bile.	Bile	is	naturally	aggravated	in	summer	and	autumn,
and	at	noon	and	midnight.	They	should	avoid	oily	foods,	fish,	meat,	wine,	yogurt
(curd),	and	whey;	they	also	should	not	eat	in	the	late	hours	of	the	evening.
Before	starting	on	any	medicine	they	should	use	mukta	pishthi	(powdered	pearls)
and	manikya	pishthi	(powdered	rubies).	Powdered	rubies	provide	strength	during
their	weak	period,	and	powdered	pearls	help	to	keep	their	body	chemistry
alkaline.
Fasting
Fasting	all	day	on	Sunday	and	eating	salt-free	fasting	food	(such	as	sweet
chickpea	bread	and	milk	sweetened	with	dates,	flavored	with	cardamom	and
anise)	once	a	day	before	sunset	is	beneficial	for	all	number	1	people.	Fasting	for
purification	of	the	blood	on	lemon	water	for	three	days	is	also	good	occasionally
in	summer	and	autumn	when	the	bile	is	naturally	aggravated.
Friendship
Psychic	number	1s,	those	born	on	day	1,	10,	19,	or	28	of	any	month,	make	good
friends	for	one	another	and	for	destiny	and	name	number	1	people.	Number	1
people	born	between	July	10	and	August	20	become	especially	good	friends.
Romance
Number	1	people	are	naturally	attracted	to	members	of	the	opposite	sex	who	are
born	on	any	date	that	adds	up	to	either	number	1,	4,	or	7.	Number	1s	together
form	a	relationship	that	remains	good	for	a	few	years.	After	that	they	need	to
find	a	project	they	can	work	on	which	is	interesting	for	both	of	them	or	else	the
relationship	becomes	troublesome.	Number	1s	are	not	compatible	with	4s	for
romance	or	marriage;	4s,	however,	give	1s	energy.	Number	7s	are	not	good	for
long-term	partnerships.	Although	1s	find	4s	and	7s	both	easy	in	friendship,	4s
are	preferred.	Number	8	people	should	be	avoided	as	marriage	partners,	although
they	can	be	beneficial	in	business	partnerships	and	love	affairs.
Women	with	a	psychic	number	of	1	are	advised	not	to	marry	men	with	a
psychic,	destiny,	or	name	number	of	8.	They	should	also	avoid	marrying
someone	whose	year	of	birth	adds	up	to	8,	or	even	getting	married	on	the	eighth
of	any	month.
Good	Years	in	Life
The	1st	year,	10th	year,	19th,	28th,	37th,	46th,	55th,	64th,	73rd,	82nd,	and	91st
are	good.
Special	Note
Persons	born	on	the	twenty-eighth	are	advised	to	care	for	and	save	money	for
their	future.	They	should	be	careful	in	spending	money	and	take	measures	to
prevent	its	loss,	either	through	business	or	litigation.
NUMBER	1	PEOPLE	IN	RELATIONSHIP
The	information	given	below	is	based	upon	a	comparison	of	psychic	number	1s
to	other	psychic	numbers.	It	can	also	be	used	to	compare	destiny	1s	to	other
destiny	numbers,	and	name	1s	to	other	name	numbers.	(The	comparisons	are
based	upon	like	categories.)
Number	1	and	Number	1
Two	number	1	people	are	compatible,	but	they	do	not	help	each	other	grow	and
develop.	The	laws	of	magnetism	state	that	when	two	similar	objects	come
together,	they	repel	each	other;	only	opposite	poles	attract.	When	two	people
with	the	same	number	come	together,	they	become	friends	easily	because	they
have	similar	vibrations.	But	they	offer	no	challenge	to	each	other.	They	relax,
and	they	become	inactive.
If	any	of	their	residential	numbers	total	1,	it	will	be	very	helpful	in	the	lives	of
number	1	people.	In	friendship	and	business,	number	1s	are	helpful	to	each
other,	but	because	they	are	both	interested	in	power	and	authority	they	do	not
make	good	long-term	partners.	Two	number	1s	do	not	make	ideal	marriage
partners—they	should	simply	live	together.
Number	1	and	Number	2
The	Sun	and	Moon	are	usually	thought	of	as	male	and	female,	father	and	mother.
However,	Is	and	2s,	who	are	ruled	by	the	Sun	and	Moon	respectively,	do	not
form	ideal	friendships	or	marriages.	Although	called	the	eternal	pair	of
opposites,	their	relationship	is	not	ideal	because	of	their	unequal	status.	As	a
Sun-dominated	person,	a	1	is	too	powerful	and	dominates	the	weak	and
tenderhearted	2.	Number	2	people	are	easily	influenced	and	sometimes
brainwashed	by	1s—they	act	like	followers,	subordinates,	or	slaves.	This	creates
psychological	problems	for	2s,	who	by	nature	are	temperamental	and	unstable.	If
a	number	1	man	is	interested	in	having	a	slave	as	a	friend	or	wife,	he	should
definitely	select	a	2.	Otherwise	having	a	2	as	a	wife	will	create	problems—she
will	make	him	even	more	authoritative	and	stubborn.	To	become	more	powerful
in	politics,	1s	should	try	to	get	2s	into	their	party.
Number	1	and	Number	3
The	number	3,	which	is	ruled	by	Jupiter—a	friend	and	teacher	to	the	Sun—is
favorable	for	1s.	Number	1s	should	select	residential	numbers	with	the
numerical	value	of	3	for	favorable	and	comfortable	living	conditions.	As	well,	1s
should	select	dates	with	the	numerical	value	of	3	for	making	appointments	and
starting	new	projects.	In	marriage	and	business	partnerships,	3s	benefit	more
from	1s	than	vice	versa.	Number	3	people	are	good	advisers	and	fond	of
discipline.	However,	being	a	little	self-centered	and	often	surrounded	by
members	of	the	opposite	sex,	they	do	not	make	ideal	life	partners	for	1s.
As	business	partners,	3s	are	also	less	than	ideal.	Number	1s,	by	nature	good
workers,	work	hard,	while	3s	get	all	the	benefit	and	credit	for	their	hard	work.	In
politics,	the	friendship	of	3s	are	very	beneficial	to	1s,	because	3s	are	extroverts,
orators,	and	universal	friends.	These	qualities	make	1s	popular	and	famous
leaders	or	politicians.
The	farseeing	vision	and	advice	of	3s	becomes	an	asset	to	1s.	Number	3s	can
easily	accept	number	1s	as	heads	of	political	organizations.	Threes	have	a
fantastic	ability	to	organize.	Since	1s	are	also	good	organizers,	they	make	a	very
practical	political	team,	whose	ideals	and	work	benefit	the	masses.
Number	1	and	Number	4
The	number	4	is	ruled	by	Rahu,	an	enemy	of	the	Sunin	Indian	mythology	and
astrology.	A	number	4	person	is	an	enemy	of	a	1,	who	is	always	attracted	by
enemy	numbers	(opposite	poles	attract);	paradoxically,	they	become	friendly.
Number	1s	are	naturally	attracted	to	4s,	and	provide	them	with	a	helping	hand.
Although	4s	do	not	reciprocate	this	energy,	they	can	provide	them	with	romance.
They	make	friends	easily.	Friendship	should	benefit	both	friends	equally,	but	in
this	case	4s	are	the	only	ones	who	benefit.	In	short,	number	4	people	are	not	very
beneficial	for	psychic	and	name	number	1s;	they	are	good	for	people	with	1	as	a
destiny	number.
Number	1	and	Number	5
The	numbers	1	and	5	are	friendly	but	people	with	these	numbers	do	not	make
ideal	friends,	life	partners,	or	business	partners.	The	number	5	is	ruled	by
Mercury,	the	planet	that	is	nearest	to	the	Sun.	But	this	nearness	to	the	Sun	creates
a	restlessness	in	Mercury,	and	many	times	a	year	it	becomes	retrograde.	Number
5	people	become	more	unstable	in	the	company	of	1s	and	refuse	to	accept	their
influence.	Although	number	5s	are	not	in	any	way	harmful	to	1s,	since	both	have
independent	natures,	they	do	not	work	in	harmony.	Number	1	s	make	5s	nervous
by	nature.	Fives	try	to	make	everybody	happy,	and	they	have	to	work	hard	to
please	1s.	Both	numbers	are	lovers	of	what	is	novel	and	modern	and	neither
believe	in	popular	religion,	so	they	can	work	on	their	common	interests	together.
But	1s	are	idealistic	while	5s	are	not.	They	always	have	differences	of	opinion.
However,	in	the	political	and	social	fields	they	can	work	together,	and	a	5	can	be
helpful	to	a	1.
Number	1	and	Number	6
The	number	6	is	ruled	by	Venus.	The	Sun	and	Venus	are	enemies.	Number	6
men	and	women	are	very	different,	so	we	have	to	examine	their	relationships	in
four	ways:
number	1	men	and	number	6	men
number	1	men	and	number	6	women
number	1	women	and	number	6	women
number	1	women	and	number	6	men
These	variables	should	also	be	considered	when	working	with	other	numbers,
but	with	number	6	it	is	essential	and	of	special	value.
Number	1	Men	and	Number	6	Men
Number	1	men	easily	befriend	number	6	men,	but	the	friendship	does	not	last
long.	This	is	because	the	6	does	not	have	moral	laws	and	believes	that
everything	is	fair	in	love	and	war.	Number	6s	do	not	understand	the	idealistic	1s,
who	believe	in	a	disciplined	life.	Those	number	1	men	who	are	involved	in
politics	can	be	benefited	by	6s	of	either	gender.	This	is	not	true,	however,	in
business	partnerships.
Number	1	Men	and	Number	6	Women
While	number	1	men	are	beneficial	for	number	6	women	and	give	them	precious
gifts,	this	is	not	a	good	combination	for	life	partners.	Number	6	women	do	not
understand	number	1	men,	and	because	of	poor	communication	their
relationships	become	frozen.	Number	6	women	can	work	as	their	secretaries	or
in	their	public	relations	departments.	Since	number	6	women	are	talented	and
have	good	taste	and	number	1	men	love	beauty,	it	is	very	easy	for	them	to
become	friends.	But	as	these	women	lack	discipline	and	are	easily	disturbed	if
interrupted	while	they	work,	they	do	not	make	ideal	life	partners	for	1s.	Also,
number	1	men	are	too	ambitious,	demanding,	direct,	and	linear	for	number	6
women.
Number	1	Women	and	Number	6	Men
Number	6	men	are	not	suitable	for	number	1	women.	They	are	always	involved
with	other	women.	Since	number	1	women	are	idealistic,	disciplined,	and
possessive	by	nature,	they	have	a	problem	with	this	behavior.	They	can	have	a
good	relationship	as	coworkers,	not	as	life	partners.	They	make	very	good
traveling	companions.
Number	1	Women	and	Number	6	Women
This	relationship	can	be	a	good	one;	however	number	1	women	are	talkative	and
number	6	women	lack	clarity	of	expression.	The	ambiguity	of	6s	may	annoy	1s.
Number	1	women	love	the	slow-natured	number	6	women	and	present	them	with
costly	gifts.
Number	1	and	Number	7
In	the	Indian	system	the	number	7	is	ruled	by	Ketu,	an	enemy	of	the	Sun.	In	the
Western	system	it	is	ruled	by	Neptune.	Number	7s	are	intuitive,	imaginative,	and
tend	to	fantasize.	Number	1s	are	fascinated	by	these	qualities	and,	being
ambitious	and	lovers	of	the	novel	and	modern,	want	to	make	these	creative	ideas
into	practical	reality.	When	they	point	out	to	7s	how	impractical	their	attitudes
are,	7s	feel	disturbed	and	inferior.	This	makes	it	difficult	for	them	to	work
together.	They	always	differ,	but	1s	are	very	strong	and	successful	and	cannot	be
disturbed	by	7s.	Number	1s	can	benefit	by	this	friendship;	they	should	employ	7s
as	planners	and	designers.	In	fact,	friendship	with	7s	brings	good	luck	to	all
numbers.	Sevens	are	also	good	numbers	for	romance;	they	can	enhance	and
bring	pleasant	dreams	to	the	dry	lives	of	1s.	Sometimes	the	impractical	fantasies
of	7s	can	prove	destructive	for	the	business	endeavors	of	1s.	It	is,	therefore,	not
advisable	for	this	combination	to	enter	into	a	business	partnership.	In	politics,	1	s
and	7s	can	work	well	together	but	they	always	differ.	If	7s	cooperate,	1s	can
achieve	popularity	and	fame	through	them.
Number	1	and	Number	8
The	number	8	is	ruled	by	Saturn,	which	represents	darkness.	The	Sun	represents
light	and	rules	number	1.	Numbers	1	and	8	are	exact	opposites	of	each	other.
According	to	Hindu	mythology,	Saturn	is	the	issue	of	the	Sun	and	his	wife,
Chaya	(shadow).	Saturn	is	a	rebellious	child,	exactly	the	opposite	of	his	father.
This	opposition	creates	attraction,	especially	between	members	of	the	opposite
sex.	Number	Is	can	have	secret	love	affairs	with	8s,	especially	when	the	1	is	a
man	and	the	8	is	a	women.
A	number	1	often	is	head	of	an	institution	and	a	lawmaker.	An	8	does	not	like	to
obey	laws.	A	number	1	likes	discipline	and	obedience	to	the	law,	whereas	an	8
creates	disturbances	and	agitation.	Since	the	influence	of	8s	is	detrimental	to	Is,
number	1	women	are	specifically	advised	to	not	marry	number	8	men,	or	to
marry	on	the	eighth	of	any	month.	In	politics,	8s	will	always	oppose	1s.
Note	about	Psychic	Number	1	and	Destiny	Number	8
Psychic	number	1	natives	should	donate	black	cloth,	black	beans,	sesame	seeds,
as	well	as	a	blue	sapphire	or	lapis	lazuli,	to	a	needy	destiny	8	person	who	is	old
and	learned.	This	donation	helps	1s	to	avoid	problems	they	might	face	because
of	their	own	destiny	number	8.	They	should	do	this	at	least	once	in	their	life,	on
a	Saturday	that	falls	on	a	date	that	totals	to	number	1.	In	India	there	is	a	special
caste	of	Brahmins	who	except	the	donation	for	Saturn,	but	in	the	West	one	can
select	a	person	who	is	dark	in	color,	old,	learned,	needy,	has	difficulties	in	life,
and	whose	destiny	number	is	8.	A	psychic	number	1	native	also	should	wear	a
ruby	embedded	in	a	mixture	of	copper	and	gold	and	should	meditate	on	a	ruby
embedded	in	the	middle	of	a	Sun	yantra	engraved	on	copper.4
Number	1	and	Number	9
The	number	9	is	ruled	by	Mars,	a	friend	of	the	Sun.	The	Sun	is	exalted	in	the
zodiac	sign	Aries,	which	is	ruled	by	Mars.	The	company	of	9s	provides	positive
vibrations	and	energy	to	1s	and	causes	them	to	lose	their	identity;	in	each	other’s
company,	they	act	as	one	person.	In	numerology	the	numbers	9	and	1	are
identical—1	is	the	beginning	and	9	is	the	end.	Although	both	are	powerful,
energetic,	and	perfectionistic,	1s	are	successful	and	lucky,	while	9s	are	not	so
lucky	and	suffer	from	doubt.	Being	assertive	and	direct,	1s	can	help	9s	in	this
area.	Number	1s	are	hardworking	and	practical.	A	number	1	man	should	prepare
himself	for	problems	when	he	marries	a	number	9	woman.	Her	tendency	toward
isolation	is	not	easily	tolerated	by	the	number	1	man,	who	is	very	sociable.
When	the	sexes	are	reversed,	however,	the	number	1	woman	finds	the	isolation
of	the	number	9	man	very	liberating.	They	form	an	ideal	pair.	Although	9s	are
good	for	Is	in	any	kind	of	relationship,	1s	have	to	work	hard.

The	Moon	and	Number	2
The	Moon	is	the	ruling	planet	of	people	born	on	days	2,	11,	20,	or	29	of	any
month,	or	whose	destiny	or	name	number	adds	up	to	2.	The	qualities	of	the
moon	described	below	are	most	clearly	visible	in	people	who	have	2	as	a	psychic
number.
The	Moon	is	the	most	important	planet	for	our	Earth	and	our	life.	We	do
depend	on	the	Sun,	for	our	life	force;	but	if	we	were	to	receive	it	directly	from
the	Sun,	life	on	planet	Earth	would	not	survive.	The	Moon	reflects	this	sunlight
through	its	alchemical	reflector,	which	is	made	of	a	special	gem	material	called
chandra	mukhi	mani	(moon	crystals).	Those	crystals	reflect	the	sunlight,	adding
to	it	colors	and	hues	of	light	that	have	a	medicinal	effect	on	our	planet.	For	this
reason	medicinal	plants	grow	more	at	night	under	the	moonlight.	Sun	rays	are
charged	with	positive	ions;	the	Moon	converts	these	into	life-giving	negative
ions.	The	Moon	is	known	as	lord	of	herbs	and	medicinal	plants	in	the	Ayurvedic
scriptures.	The	word	Soma,	which	means	nectar,	is	another	name	for	the	Moon.
Etymologically,	this	reveals	the	presence	of	nectar	in	Moon.1
The	Moon	is	not
only	a	physical	body	composed	of	particles	of	energy,	it	is	also	energy	that
nurtures	the	world	of	names	and	forms.	It	is	the	life-giving	mother	energy,	the
creative	energy,	which	is	magnetic	and	positive.	The	planet	itself	is	only	the
vehicle	that	makes	the	energy	available	to	our	planet	Earth.	This	energy	acts
upon	our	imaginative,	reflective,	intuitive	nature,	also	known	as	our	psyche.	Just
as	the	Sun	acts	on	our	intellect	and	Mars	on	our	behavior,	so	the	Moon	acts	on
our	psyche	and	subconscious.	It	gives	us	sensitivity	and	sentimentality.
Astrological	scriptures	describe	the	Moon	as	rajasic,	imaginative,	receptive,	and
changeable.	The	irregular	movement	of	the	Moon	makes	it	more	important	to
our	Earth	than	some	other	planets.	A	variety	of	patterns	and	an	everchanging
play	of	energy	fields	exist	between	the	Earth	and	Sun.	It	is	through	these
fluctuations	that	the	Moon	plays	a	major	role	in	the	emotional	life	of	every
individual.
natives2
The	Moon	gives	people	a	fluctuating	nature,	a	love	of	aromas	and	perfumes,	a
love	of	water,	and	of	nurturing.	It	brings	prosperity,	respect,	and	honor	to	its
and	makes	them	lovers	of	privacy.	Its	natives	are	moody	and	easily
susceptible	to	coughs,	colds,	skin	diseases,	and	heart	ailments.	They	are	mostly
fair	in	color	with	round	faces	and	curly	hair;	the	lower	portion	of	their	bodies	is
often	more	attractive	than	the	upper	portion.
The	Moon	rules	over	the	zodiac	sign	Cancer	and	is	exalted	in	Taurus.	In
Capricorn	the	Moon	is	debilitated	(weak)	and	Scorpio	is	its	sign	of	fall.	The	Sun,
Mars,	and	Jupiter	are	its	friends	while	Mercury,	Venus,	Saturn,	Rahu,	and	Ketu
are	its	enemies.
Natives	born	as	2s	are	peaceful,	lovers	of	justice,	tender,	sensuous,	lovers	of
poetry,	music,	and	art.	If	women,	they	are	beautiful	and	very	feminine.	They
have	a	mucus-dominated	temperament.	The	Moon	rules	over	the	left	eye,	left
nostril,	ida	nadi,	the	left	side	of	the	body,	and	the	right	hemisphere	of	the	brain.
NUMBER	2
Psychic	Number	2
Two	is	the	psychic	number	of	people	born	on	day	2,	11,	20,	or	29	of	any	month.
Among	these	people,	those	born	on	the	twenty-ninth	of	any	month	are	the	most
fortunate.
The	number	2	is	ruled	by	the	Moon,	which	gives	its	natives	tenderness,	artistic
inclinations,	and	a	romantic	nature.	They	are	peaceful	and	gentle.	Their
imaginative	nature	makes	them	inventive,	but	they	lack	determination	and
cannot	execute	their	ideas	as	forcefully	as	Is	can.	They	need	guides	to	assure
them	about,	promote,	and	execute	their	ideas.
The	constant	waxing	and	waning	of	the	Moon	influences	psychic	2	natives
more	than	it	influences	any	other	number.	Women	in	this	group	feel	more
emotional	ups-and-downs	than	men.	Sometimes	they	feel	very	hopeful,
sometimes	depressed;	they	are	especially	sensitive,	moody,	and	sentimental.	If
the	Moon	is	well	placed	in	their	natal	charts,	they	use	this	energy	in	creative	or
positive	ways.	Otherwise,	this	quick-changing	emotional	nature	brings	them
mental	agony.	Those	born	on	the	twentieth	of	any	month	feel	this	mental	agony
very	strongly.	If	the	Moon	is	not	well	posited	in	their	natal	chart,	they	experience
difficulties	in	life.	If	they	are	born	on	the	twenty-ninth	of	any	month,	help	is
easily	available	to	them	and	they	have	a	comparatively	easy	life.	Men	born	on
the	twenty-ninth	are	mentally	strong,	hard	working,	and	fortunate.	Those	born	on
the	eleventh	have	very	strong	psyches,	but	as	a	rule	they	are	delicate	and	do	not
have	very	strong	builds.	They	have	personal	problems	because	their	strong	and
demanding	nature	isolates	them	from	their	circle	of	friends.	While	all	psychic
number	2s	love	to	live	alone,	those	born	on	the	eleventh	go	out	of	their	way	to
isolate	themselves.
In	the	same	way	as	the	Moon	reflects	sunlight,	psychic	number	2	natives
reflect	the	influence	of	the	environment	that	surrounds	them.	If	interested	in
politics,	they	introduce	reforms	to	change	social	structures.	If	they	are	writers,
through	their	writings	they	introduce	changes	that	lead	to	a	better	and	more
peaceful	world.	They	devote	their	life	to	selfless	service	and	helping	others.
The	Moon	gives	them	a	love	of	aromas	and	fragrances.	They	have	refined
natures	with	good	aesthetic	sensibilities.	If	women,	they	are	especially	fond	of
perfumes	and	prepare	sweet	dishes,	cakes,	or	pastries	with	special	fragrant
spices.	They	also	use	fragrant	water	for	bathing.	Although	psychic	number	2
women	are	family	oriented	and	sincere	with	their	husbands,	they	are	very
romantic	and	quick	changing.	They	do	not	restrict	themselves	to	having	a
relationship	with	only	one	man.
When	psychic	number	2s	are	humiliated	or	hurt,	they	become	very	strong,
tough	fighters.	They	adhere	to	their	decisions,	commitments,	or	convictions	and
face	all	opposition	until	they	achieve	what	they	want.	They	are	not	easily
disheartened,	nor	do	they	surrender	easily.
The	Moon	represents	the	mother	principle—forbearance,	patience,	love,	and
tender	care.	Psychic	number	2s	have	all	of	these	qualities	except	patience.	They
are	kind-hearted,	gentle,	helpful,	caring,	and	faithful	to	their	duties.	They	treat
friendships	as	sacred	and	sacrifice	everything	of	their	own	for	others.	As	the
moon	depends	on	the	Sun	for	light,	so	they	depend	on	other	numbers—they
become	more	social	and	socialize	easily.	Because	of	their	changeable	nature,
they	are	fast	thinking.	They	become	involved	with	others	emotionally	and	face
difficulties.	As	well	wishers	of	humanity	at	large,	they	develop	a	philosophy	of
peaceful	coexistence—live	and	let	live.
Because	they	do	not	like	quarrels,	they	become	good	peacemakers.	They
arbitrate	and	settle	disputes	in	such	a	beautiful	manner	that	both	parties	feel
satisfied.
They	are	also	good	diplomats	and,	as	diplomats,	they	use	their	instinctive	and
intuitive	faculties	to	benefit	the	groups	that	they	represent.
They	love	traveling	and	visits	to	foreign	lands	give	them	a	cosmopolitan
outlook.
They	do	not	like	plans	or	arrangements	made	by	others	for	them;	they	like
freedom.
They	are	less	courageous	and	also	less	ambitious	than	some	other	numbers.
They	are	reserved	by	nature,	somewhat	shy,	and	never	tell	lies.	Although	they
do	not	hesitate	to	accept	their	follies,	sometimes	people	make	use	of	their
weakness	and	exploit	or	blackmail	them.
Due	to	their	constant	worrying,	which	is	supported	by	their	imaginative	and
fantasizing	nature,	they	sometimes	have	to	hear	harsh	words	from	their	friends
and	relatives.
They	dislike	people	who	make	false	promises.
They	are	impatient	and	seldom	have	to	repent	for	it.
Although	they	accept	their	mistakes	easily	and	feel	regret,	they	never	change
their	behavior	nor	ever	improve.	They	commit	the	same	mistakes	again	and
again,	and	suffer.
They	do	not	much	like	logic	and	criticism.
When	the	Moon	is	not	well	placed	in	their	natal	chart,	they	fall	victim	to	their
delusions	and	doubtful	nature.	They	become	mistrustful	and	anxious	and	are
caught	in	their	own	internal	dialogues.	They	also	fall	prey	to	people	who	flatter
them.
People	with	psychic	number	2	are	intuitive.	When	the	Moon	is	well	placed	in
their	natal	chart,	they	are	conscious	of	the	intentions	of	those	who	flatter	them,
but	they	remain	silent	and	let	themselves	be	cheated	because	they	are	gentle	and
like	flattery.
They	are	masters	in	the	field	of	love	and	beauty.
When	in	a	group	of	people	with	harmonious	vibrations,	they	act	boldly	and
execute	their	ideas	with	unusually	firm	determination.	Because	they	are	hard
workers,	they	succeed	in	spite	of	their	delicate	bodies.
When	their	destiny	number	is	in	harmony	with	their	psychic	number,	they
become	firm	and	self-reliant.	If,	in	addition,	the	Moon	is	well	posited	in	their
natal	chart,	they	become	good	conversationalists	and	brilliant	speakers.	Their
mind	becomes	clear,	and	their	intellect	and	intuition	both	work	together.	If	there
is	disharmony	between	the	psychic	number	and	destiny	number,	or	if	the	Moon
is	weak	or	conjunct	with	a	malefic	planet,	psychic	number	2	people	become
argumentative,	doubtful,	and	nervous.
Psychic	number	2	people	generally	have	a	habit	of	accepting	the	viewpoints	or
proposals	of	others	and	cannot	say	no	to	people	who	create	problems	for	them.
They	are	attractive	and	know	the	art	of	attracting	and	infatuating	others.
They	are	easily	satisfied,	which	makes	them	work	less	and	gives	them	more
time	to	dwell	in	the	world	of	imagination.	This	makes	them	less	practical.
Psychic	number	2	men	are	lucky	in	matters	related	to	women—women	readily
trust	them.	They	are	also	able	to	influence	and	manipulate	women	and	easily
extract	their	secrets.
They	should	avoid	working	on	any	project	with	persons	who	have	a	destiny
number	of	5.
Special	Note
Psychic	or	destiny	number	2	people	have	to	do	everything	at	least	twice.	It	is
rare	that	they	do	something	in	one	attempt.	This	makes	them	spend	money	and
energy	with	less	gain.
Note	for	People	Born	on	the	Eleventh	of	Any	Month
Number	11	is	thought	to	be	a	special	number	and	is	called	the	mystic	number	in
many	occult	traditions.	In	their	story	of	creation,	the	Babylonians,	for	example,
mention	the	name	of	TIAMAT	with	its	eleven	supporting	chaos	demons.	In	the
Hindu	tradition,	there	are	eleven	forms	or	incarnations	of	Rudra,	the	Lord	of
Destruction.
In	the	first	book	of	Moses,	Joseph	dreamt	that	the	Sun	and	Moon	and	eleven
stars	were	bowing	in	front	of	him	(Genesis	37:9).	In	theological	scriptures,	11	is
a	number	of	negative	omens,	of	sinners,	and	of	penance.
In	the	Hindu	tradition,	however,	11	is	not	a	negative	number	or	a	number	of
sin,	but	rather	it	is	considered	auspicious	and	dynamic.	Because	in	it	the	number
1	is	repeated	twice,	numerologists	assign	it	an	obstinate,	revolutionary,	and
authoritative	character.	Psychic	number	2	people	with	this	day	of	birth	are	quick
to	respond,	optimistic,	and	capable	of	guiding	themselves	and	others	through
difficult	situations.	Given	good	guidance	and	suitable	feedback,	they	can	achieve
great	success	in	the	material	world.	Although	this	number	is	associated	with	the
Moon	and	psychic	2	people	born	on	the	eleventh	have	all	the	characteristics	of
2s—they	are	fickle-minded,	suffer	from	periodical	separation	from	their	life
partner,	and	go	through	emotional	highs	and	lows—however,	later	in	life	they
become	famous	and	respectable.
Just	as	in	numerology	this	number,	which	is	calculated	as	2	and	also	counted
as	an	11,	is	given	special	attention,	so	also	in	life	11s	attract	and	manage	to	get
special	attention.	Number	11	is	called	a	mystic	number	because	its	natives	have	a
special	sensitivity	for	feeling	vibrations	and	seeing	spirits	and	ghosts.	This	is
part	of	their	fantasizing	nature.	They	also	like	to	create	personalized	rituals	for
everything	they	do	to	generate	feelings	and	attract	attention.
Precautions	for	Psychic	Number	2	People
Psychic	number	2	natives	should	cultivate	self-confidence,	will,	and
determination.
They	should	not	lose	their	courage	or	fall	in	love	quickly.
They	should	become	independent.	They	should	not	postpone	their	work	for
the	sake	of	others,	nor	waste	energy	waiting	for	others	to	help	them	execute
a	job.
They	should	not	leave	jobs	unfinished	because	of	loss	of	interest.
They	should	stick	to	their	decisions.
They	should	avoid	swimming	or	boating	in	deep	waters.
They	should	avoid	doing	things	in	a	hurry,	and	they	should	practice
meditation	or	mind	control	to	overcome	their	restlessness.	In	addition	to
meditation,	the	use	of	pearl	powder	(mukta	pishthi)	is	helpful	if	taken	orally
with	honey	before	going	to	bed.	This	will	not	only	cure	their	nervousness
but	also	their	doubtful	nature,	because	doubt	originates	from	low	blood
sugar	and	improper	body	chemistry.
They	should	avoid	the	company	of	those	who	flatter	them.
They	should	avoid	foods	not	suitable	to	their	stomach	and	heart.	Being	too
sentimental	disturbs	the	stomach	and	brings	about	constipation.	This,	in
turn,	produces	gastritis	and	gas,	which	when	disturbed,	create	problems	for
the	heart.	Psychic	number	2	people	are	prone	to	stomach	and	heart
problems.	Avoiding	constipating	foods	is	key	to	their	physical	and	mental
well-being.
They	should	become	conscious	of	their	friendships	with	members	of
opposite	sex.	Having	too	many	friends	creates	problems,	because	each
friend	is	a	“	separate	world.”	Psychic	number	2s	are	emotional,	sensitive
people	who	tend	to	waste	energy	when	they	get	emotionally	involved.
They	should	also	keep	away	from	people	suffering	from	infectious	diseases
as	they	are	prone	to	infections	and	their	immune	system	is	weak.	Morning
walks	and	massages	strengthen	their	immune	systems.	They	should	try	to
acquire	more	physical	strength	because	their	systems	are	delicate.
They	should	learn	about	the	Moon	and	its	strong	and	weak	periods.
They	should	avoid	exposure	of	their	necks	and	chests	during	illnesses	of	the
throat	and	lungs.
They	should	avoid	anger,	which	burns	the	life-giving	body	fluids	since,
physically,	they	are	not	strong.	A	fit	of	anger	can	cause	hysteria	and	lead
them	into	an	unconscious	state.
They	should	not	make	important	decisions	when	(1)	the	Moon	is	full,	(2)
the	Moon’s	rising	time	is	close	to	the	rising	time	of	Sun	(the	last	three	days
of	the	descending	Moon	cycle),	or	(3)	they	are	near	large	bodies	of	water.
Decisions	are	best	made	midway	through	the	descending	cycle	or	the
ascending	cycle	of	the	Moon.	During	these	times	the	Moon	is	not	powerful.
Because	2s	are	ruled	by	the	Moon,	both	the	full	Moon	and	new	Moon
influence	their	temperament.
They	should	take	up	sports	and	hobbies	that	involve	them	in	outdoor
activities.	They	should	be	forced	to	exercise	to	keep	their	physique	in
proper	shape.
Destiny	Number	2
Generally	2	is	not	good	as	a	destiny	number.	When	two	is	the	destiny	number
and	psychic	number,	its	effect	is	very	powerful:	destiny	number	2	brings	mental
and	psychological	growth,	which	enables	natives	to	feel	more	confidence	and
make	a	mark	in	the	world.	Of	all	the	2	combinations	a	person	can	have,	this	one
(psychic	2	and	destiny	2)	is	the	best.
When	psychic	number,	name	number,	and	destiny	number	are	all	2,	the
influence	of	the	Moon	is	predominant,	which	can	create	mental	instability,	a	lack
of	determination,	and	an	increase	in	doubt.	However,	if	the	Moon	is	well	posited
and	supported	by	friendly	planets,	this	combination	can	become	very	strong.
Destiny	2	makes	its	natives	face	great	ups-and-downs;	opportunities	slip	from
their	hands	just	when	success	is	within	their	grasp.	Because	they	feel	victim	to
unpredictable	changes,	they	often	experience	helplessness.
Destiny	2	people	love	their	homes	and	families.	They	take	a	keen	interest	in
their	domestic	affairs	and	have	strong	family	ties.
Destiny	2	makes	them	insecure	and	less	than	ideally	successful	in	love	affairs,
if	they	are	men.	If	women,	they	get	blamed	in	love	affairs.
Destiny	2	males	study	a	lot	to	increase	their	knowledge	and	improve	their
understanding.
Destiny	2s	are	born	with	a	great	sense	of	self-respect,	which	makes	them
precise	and	well	mannered.	They	believe	in	the	axiom,	“Do	unto	others	as	you
would	like	others	to	unto	you.”	Favored	by	good	friends,	strong	followers,
positive	circumstances,	and	clarity	of	understanding,	they	act	with	great
confidence	and	do	not	doubt	themselves.	Under	such	conditions,	they	can
perform	miracles	in	any	field	they	are	deeply	involved	in.
Destiny	2	gives	people	a	love	of	rivers,	streams,	waterfalls,	springs,	lakes,	and
ponds.
Destiny	2s	like	to	live	in	groups	and	like	good	company.	They	can	delay
important	jobs,	appointments,	or	transactions,	or	leave	them,	for	the	sake	of	good
company.	Their	work	suffers	because	of	their	dependence	on	others	and	the	love
of	good	company,	harmonious	vibrations,	and	friendship.	Destiny	2	people	have
strong	intuitive	powers.	They	can	read	the	minds	of	others.	They	can	enter
deeply	into	the	personalities	of	others	and	measure	their	depth.
Destiny	2	men	are	fortunate	and	marry	educated	and	beautiful	women;	they
have	virtuous	mothers,	as	well	as	loving	sisters	and	sisters-in-law.	They	are
helped	by	elderly	women,	women	natives,	or	women	who	hold	key	positions	in
their	communities.	The	marriages	of	destiny	2	men	are	often	short.
Destiny	2	women	are	emotional	and	devoted	to	their	life	partners.	They	dress
smartly,	look	young,	and	are	attractive.
Destiny	2	people	are	interested	in	herbs	and	medicinal	plants;	they	love
gardening.	They	also	like	to	redecorate	their	homes	often.
They	can	also	become	good	psychologists,	creative	thinkers,	poets,	writers,
counselors,	therapists,	doctors,	actors,	or	dancers.
They	are	egoless;	they	do	not	wait	for	appreciation	after	performing	a	service.
They	can	work	well	as	counselors	to	couples	having	interpersonal	problems.
When	they	pass	thirty-five	years	of	age,	they	become	more	interested	in	occult
sciences,	philosophy,	and	spiritual	life.
Special	Note
Psychic	or	destiny	number	2	people	have	to	do	everything	at	least	twice.	It	is
rare	that	they	do	something	in	one	attempt.	This	makes	them	spend	money	and
energy	with	less	gain.
Name	Number	2
Number	2	as	a	name	number	brings	gentleness	and	youth.	The	calming	effect	of
this	number	makes	those	who	have	it	as	a	name	number	content	and	peaceful.	If
in	harmony	with	the	destiny	number,	a	name	number	is	very	helpful	in	bringing
fame.	Those	with	this	name	number	find	it	brings	changes	to	their	lives.	But	it
can	also	give	them	success	in	such	areas	as	the	import	and	export	business	and
herbal	remedy	business.	This	name	number	draws	help	from	elderly	women,	in
particular,	and	women,	in	general.
BALANCING	INTERNAL	AND	EXTERNAL
ENVIRONMENTS
By	observing	fasts,	using	the	proper	spices	and	gem	powders,	meditating	on	the
mantras,	and	using	the	yantras,	one	can	balance	the	internal	environment.
Balancing	the	external	environment	is	possible	by	choosing	the	right	time	for
activities	(in	the	ascending	cycle	or	descending	cycle),	selecting	good	friends
(finding	compatible	numbers),	and	starting	a	job	at	the	appropriate	time
(observing	weak	period	and	strong	periods).	Balance	is	achieved	by	working
with	the	energy	flow	that	is	already	available,	as	described	in	the	sections	that
follow.	The	information	that	follows	applies	to	people	with	psychic	number	2.
Weak	Periods
December,	January,	and	February	are	the	months	when	number	2s	face	many
physiological	and	psychological	problems.	They	should	prepare	themselves	to
face	hardships	during	these	months.
Strong	Periods
The	period	between	June	20	and	July	27,	called	the	“	House	of	the	Moon,”	is	the
most	beneficial	time	for	2s.	During	this	period	they	should	devote	their	energy	to
promoting	their	business.	This	is	also	a	suitable	time	for	all	sorts	of	auspicious
activities,	traveling,	and	planning	for	the	future.
Good	Dates
Days	2,	11,	20,	and	29	of	any	month	are	good;	days	1,	4,	7,	10,	13,	16,	19,	22,
and	25	of	any	month	are	also	beneficial.	If	they	fall	on	a	Monday,	the	second
group	of	dates	become	very	good.
Good	Days
Monday	is	the	best	day	of	the	week	for	number	2	people.	If	a	Monday	falls	on
day	1,	2,	4,	7,	10,	11,	13,	16,	19,	20,	22,	25,	or	29	of	any	month,	it	becomes	an
especially	good	day.	Any	Sunday	that	falls	on	one	of	the	above	dates	also	proves
to	be	good	for	number	2	people.
Favorable	Colors
White	is	the	best	color	for	2s,	because	it	is	the	color	of	the	Moon.	Number	2
people	are	advised	to	keep	a	white	handkerchief	with	them.	Whenever	they	don’t
feel	good	or	feel	a	lack	of	energy,	they	should	wipe	their	hands	and	face	with	this
white	handkerchief	to	change	their	mood.	White,	light	green,	blue,	cream,	or
grape	colors	are	also	helpful.	Light	green	is	good	for	their	mental	power,	and	the
grape	color	soothes	their	nervous	system.
Precious	Stones
Pearls	are	the	gemstone	of	the	Moon	and,	because	2s	are	ruled	by	the	Moon,	it	is
their	precious	stone.	They	can	also	use	crystal,	quartz,	moonstone,	greenish	or
white	agate,	or	jade.	The	minimum	weight	required	for	a	pearl	is	four	rattikas.
Pearls	are	not	measured	by	carats	but	by	chav.	So	the	weight	of	a	pearl	would	be
9	chav,	16	points.	(This	translates	as	31/2	carats.)
The	pearl,	or	substitute	gem,	should	be	bought	during	an	ascending	cycle	of
the	Moon	on	a	Monday	and	given	to	the	jeweler	on	the	same	day.	The	ring	or
pendant,	whatever	is	made,	should	also	be	obtained	from	the	jeweler	on	a
Monday	during	the	ascending	cycle,	and	worn	after	proper	rituals	have	been
performed.
Women	can	wear	pearls	in	a	necklace,	an	arm	band,	or	any	kind	of	setting	in
which	the	gemstone	touches	the	skin.
They	should	take	pearl	powder	to	help	heal	their	bodies	electrochemically.
Meditation
Number	2	people	are	supposed	to	meditate	on	Lord	Shiva.	If	they	have	no	way
of	meditating	on	Shiva,	they	can	start	the	day	with	meditation	on	a	pearl,	crystal,
moonstone,	or	quartz.
Deity
Their	deity	is	Shiva.	He	is	seated	on	a	tiger	skin	in	lotus	posture,	holding	a
trident	in	his	left	hand	and	conferring	blessings	with	his	right	hand.	A	stream	of
water	is	coming	out	from	his	matted	locks.	Shiva	is	smiling	and	looking	with
love	through	his	half-open	eyes.
Mantra
Japa3
(repetition)	of	the	mantra	of	any	planet	should	be	completed	within	the
ascending	cycle	of	the	moon	and	should	be	repeated	the	prescribed	number	of
times.
AUM	SOM	SOMAYE	NAMAH—AUM
AUM	SHRIM	KRIM	CHAM	CHANDRAYE	NAMAH—AUM
Either	of	the	above	two	mantras	can	be	recited.	The	prescribed	number	of
mantra	repetitions	is	eleven	thousand.
Yantra	of	the	Moon4
Health	and	Diseases
Because	number	2	people	are	often	not	strong	in	build	and	have	weak
constitutions,	they	are	prone	to	the	following	conditions:
Stress	and	strain.	This	can	trouble	their	nervous	system.
Heart	diseases.	They	are	emotional	and	sensitive	by	nature;	they	love
family	life	and	often	get	into	emotional	conflicts.	They	are	advised	to	avoid
these	conflicts.	They	should	use	pearl	powder,	wear	a	Rudraksha	bead	(a
seed	used	as	the	sacred	bead	of	Shiva),	drink	water	from	a	silver	glass,	and
meditate.	To	abstain	from	speech	and	sleep	or	abstain	from	just	sleep	on	a
full	moon	night	and	full	moon	day	is	also	very	helpful.
Weak	digestive	systems.	They	are	prone	to	indigestion,	constipation,	lack	of
appetite,	and	intestinal	and	gas	troubles.
Weak	immune	systems.	They	are	especially	susceptible	to	infections	and
infectious	diseases.
Seminal	diseases	(for	men)	and	uterine	infections	and	leukorrhea	(for
women).
Liver	disorders.	This	is	due	to	their	love	for	sweets	and	their	irregular
eating	habits.
Colds,	coughs,	and	lung	disorders.	These	illnesses	are	due	to	a	dominance
of	mucus	in	their	body.
Number	2	people	should	massage	their	body	regularly.	They	should	take
freshly	ground	black	pepper	and	honey	the	first	thing	in	the	morning.	Fenugreek
seeds	should	be	taken	with	soups	or	vegetables.	If	possible	they	should	use
almond	paste,	made	by	grinding	almonds	on	a	stone	tablet	or	in	a	blender.	The
almonds	should	be	soaked	overnight	and	peeled.	They	should	avoid	becoming
addicted	to	coffee	or	tobacco	and	constipating	foods.	Once	a	month	they	should
do	an	inner	purification,	drinking	only	water	with	lemon.	Taking	homemade
buttermilk	and	other	foods	that	clean	the	lower	abdominal	tract	is	good	for	their
health.
Fasting
On	Mondays	they	should	fast	and	after	sunset	they	should	avoid	salt,	spices,
grains,	pulses,	or	any	solid	foods.	If	necessary,	they	can	use	a	purifying	tea	made
from	herbs	(mint,	dandelion,	fenugreek)	or	drink	fresh	fruit	juices	(canned	or
bottled	juices	should	not	be	used).	They	can	also	fast	on	buttermilk	or	water	with
half	a	lemon	squeezed	into	each	glass.	Fasting	on	full	moon	days,	as	mentioned
above,	is	very	beneficial	for	their	psyche.
Friendship
Good	friends	of	number	2	are	men	and	women	born	on	day	2,	11,	20,	29,	or	day
4,	6,	8,	and	9	of	any	month.
Romance
Number	2s	are	normally	attracted	to	numbers	Is,	2s,	7s,	8s	or	9s.	Although	2s	are
not	too	good	for	romance,	1	s	and	9s	are	very	good.	Their	association	with	7s	or
8s	also	produce	fine	results,	but	these	numbers	are	beneficial	to	their
advancement	in	the	spiritual	field.	Their	association	with	4s	or	5s	brings
difficulties,	although	it	helps	their	growth.	Number	1,	2,	7,	or	9	people	born
between	June	20	and	July	27	make	ideal	romance	partners	for	number	2s.
Good	Years	in	Life
The	1st	year,	2nd,	4th,	7th,	10th,	11th,	13th,	16th,	19th,	20th,	22nd,	25th,	28th,
29th,	31st,	34th,	35th,	37th,	38th,	40th,	43rd,	44th,	46th,	47th,	52nd,	53rd,	55th,
56th,	58th,	61st,	62nd,	64th,	65th,	67th,	71st,	74th,	and	83rd	are	good.	Of	these,
the	11th,	20th,	29th,	38th,	47th,	56th,	65th,	74th,	and	83rd	years	are	especially
important	and	favorable.
NUMBER	2	PEOPLE	IN	RELATIONSHIP
The	information	given	below	is	based	upon	a	comparison	of	psychic	number	2s
to	other	psychic	numbers.	It	can	also	be	used	to	compare	destiny	2s	to	other
destiny	numbers,	and	name	2s	to	other	name	numbers.	(The	comparisons	are
based	upon	like	categories.)
Number	2	and	Number	1
Two	is	the	Moon,	and	1	the	Sun.	The	Moon	is	benefited	by	the	Sun	and	converts
the	solar	energy	into	lunar	energy.	Solar	energy	is	full	of	positive	ions,	which	are
not	healthy	for	life	on	Earth.	The	Moon	converts	these	into	negative,	life-giving
ions,	which	help	our	existence	on	Earth.	Just	as	the	Moon	brings	about	a	change
in	the	energy	of	the	Sun,	so	a	2	removes	the	bad	habits	of	a	1.	Number	2s	can
serve	as	good	company	and	as	good	therapists	to	1s	and	help	them	overcome
their	shortcomings.	Because	1s	are	too	dominating,	this	combination	does	not
make	for	an	ideal	marriage.	Should	they	marry,	1	would	be	benefited	by	the
union.	Number	1s	are	beneficial	friends	and	protectors	to	2s.	In	a	business
partnership	also,	1s	are	good,	but	the	2s	will	have	to	serve	as	yes-men.	Though
legally	they	have	equal	rights,	in	practice	the	2s	do	not	have	equal	rights	here.
Number	1s,	however,	never	cause	any	harm	to	2s	in	business.
Number	2	and	Number	2
Like	repels	like.	These	two	numbers	cannot	coexist	for	a	long	time.	They	are	of
the	same	wavelength,	they	are	friendly	to	each	other,	but	their	friendship	has	a
short	life.	They	both	change	their	minds	frequently,	and	so	their	partnership	in	a
business	venture	brings	failure.	Marriage	betreen	two	number	2s	is	also
unsuccessful,	and	they	will	be	compelled	to	divorce	each	other.	This
combination	is	good	for	work,	if	the	territories	of	both	are	well	marked—“your
liberty	ends	where	my	nose	begins.”
Number	2	and	Number	3
Three	is	ruled	by	Jupiter,	a	planet	personified	as	a	teacher	who	likes	discipline,
self-control,	pointedness,	total	attention,	and	concentration.	These	are	all
difficult	tasks	for	a	2.	Jupiter	is	a	friend	of	the	Moon	but	has	a	neutral	attitude.
Number	3s	can	give	good	advice	and	feel	sympathetic	toward	them,	but	cannot
make	them	good	husbands	or	business	partners.	This	is	because	2	is	a	number	of
change,	and	3s	like	to	follow	established	routines.	But	because	2s	are	suitable	for
spiritual	advancement	and	develop	interest	in	the	occult	sciences,	they	need	the
help	of	3s,	who	have	similar	interests.	In	such	cases,	2s	can	receive	help	from	3s
if	they	can	learn	patience.	Threes	are	also	good	for	teaching	2s	about	the
sciences,	and	the	latter	can	be	very	good	students.	However,	the	permanent	bond
of	Guru	and	disciple	is	difficult	between	them.
Number	2	and	Number	4
Four	is	ruled	by	Rahu,	an	enemy	of	both	the	Sun	and	the	Moon.	Rahu,	the	north
node	of	the	Moon,	is	also	called	the	magnetic	north	pole	of	the	Moon.	The	north
and	south	nodes	form	the	two	fixed	points	on	the	elliptical	path	of	the	Moon.
Number	2	people	are	naturally	attracted	to	numbers	4s,	who	grow	and	develop
from	this	relationship.	Twos	face	hardships	and	difficulties	in	association	with
destiny	number	4,	except	when	the	4	is	a	husband	or	business	partner.	Then	the
2s	are	benefited	by	the	relationship,	and	both	partners	experience	peace	and
prosperity.	Number	4s	are	a	good	number	for	2s.	Being	a	number	of	sudden
changes,	a	4	is	not	bothered	by	the	changing	nature	of	a	2.
When	the	2	is	a	man	and	the	4	a	woman,	they	do	have	difficulties	and
hardships	early	in	their	marital	relationship,	but	these	difficulties	produce	good
results.	They	progress	in	their	life	without	suffering	and,	although	they	might
neglect	their	domestic	and	family	matters	and	feel	irritated	toward	each	other,
their	family	and	business	life	goes	well.	If	2s	are	interested	in	politics,	teaching,
research,	philosophy,	or	occult	practices,	they	advance	in	these	fields	with	the
mutual	support	and	cooperation	of	4s.
If	number	2s	have	a	destiny	number	of	4,	their	marriage	can	be	delayed.	The
latter	part	of	their	life	is	good.
Number	2	and	Number	5
Five	is	ruled	by	Mercury.	Since	Mercury	is	not	a	friend	of	the	Moon,	these	two
numbers	are	not	in	perfect	harmony	with	each	other.	Psychic	number	2	natives
with	a	destiny	number	of	5	face	problems	in	their	life	related	to	family,	children,
and	parents.	They	are	also	self-critical.	Psychic	number	2	people	are	advised	to
avoid	emotional	bonds	with	destiny	5s.	If	they	marry,	the	marriage	will	not	last
for	more	than	four	or	five	years.	Their	relationship	as	life	or	business	partners
will	not	be	harmonious.
Number	2	and	Number	6
Six	is	ruled	by	Venus.	Venus,	although	a	universal	friend,	is	not	a	friend	to	the
Moon;	it	is	neutral	in	relationship	to	the	moon.	For	this	reason,	2s	and	6s	enjoy	a
good	friendship	but	do	not	make	ideal	life	or	business	partners.	Number	6s
receive	more	financial	benefit	from	this	relationship	than	2s;	they	also	get
popularity,	name,	and	fame.	Venus	is	a	beneficial	planet	that	brings	2s	good	luck
with	6s,	but	they	are	not	ideal	as	married	couples.	This	is	especially	true	if	the	2
is	a	man	and	the	6	a	woman.	Friendships	and	businesses	between	2s	and	6s	are
always	mutually	beneficial.
Number	2	and	Number	7
Seven	is	ruled	by	Ketu,	an	enemy	and	the	exact	opposite	of	the	number	2.	Since
the	Moon	(2)	always	must	pass	through	its	southpole	(7)	while	on	its	elliptical
path,	2s	benefit	from	7s.	However,	the	opposite	is	not	true.	Number	7s	guide	and
always	lead	2s	toward	the	right	path,	yet	they	are	not	ideal	couples.	Since	a	2	is
an	even,	static	number	and	a	7	is	an	odd,	dynamic	number,	their	friendship
brings	positive	results	for	2s.
Number	2	and	Number	8
Eight	is	ruled	by	Saturn,	which	is	neutral	in	relationship	to	the	Moon.	Since
these	numbers	are	both	even,	their	relationship	is	static.	Their	friendship	or
business	partnership	is	fair	but	not	very	beneficial.	Number	2	women	are	advised
not	to	enter	into	marriage	with	8	men,	but	8	women	can	do	no	harm	to	2	men.
Number	2s	do	not	help	8s,	but	can	use	the	services	of	8s,	a	number	of	services,
without	hesitation.
Number	2	and	Number	9
Nine	is	ruled	by	Mars,	a	friend	and	protector	of	the	Moon.	A	number	9	makes	an
ideal	friend,	business	partner,	or	spouse	for	a	2,	whether	male	or	female.	They
will	have	a	loving	and	affectionate	relationship.	They	provide	good	energy	to
each	other.	Number	2	people	are,	therefore,	advised	to	find	a	number	9	mate.


Jupiter	and	Number	3
Jupiter	is	the	ruling	planet	of	people	born	on	day	3,	12,	21,	or	30	of	any	month,
or	whose	destiny	or	name	number	ads	up	to	3.	The	qualities	of	Jupiter	described
below	are	most	clearly	visible	in	people	who	have	3	as	a	psychic	number.
Jupiter	is	a	giant,	self-illuminating	planet	that	radiates	more	energy	than	it
receives	from	the	Sun.	Because	of	its	enormous	size,	it	is	the	heaviest	of	all
planets	in	our	solar	system.	It	is	known	by	the	term	Guru,	which	means	both
“heavy”	and	“remover	of	darkness”	in	Sanskrit.	This	makes	Jupiter	a	teacher	of
the	assembly	of	Gods	(Deva-Guru),	a	teacher	of	righteousness,	justice,	and	self
illumination.	As	Gurus	mirror	the	life	of	their	students,	being	true	perceptors	and
helpers,	so	does	Jupiter	help	in	the	progress	and	expansion	of	consciousness	of
whatever	it	touches.
According	to	Hindu	scriptures,	Jupiter	is	a	planet	of	courage,	boldness,	power,
hard	work,	energy,	knowledge,	and	speech.	One	Sanskrit	name	for	Jupiter	is
Vachaspati:	vacha	comes	from	vak,	which	means	“spoken	words”	and	pati	which
means	“Lord.”)Thus,	Vachaspati	is	Lord	of	Speech.
Jupiter,	a	benefic	planet,	has	the	Sun,	Moon,	and	Mars	as	friends.	It	rules	over
the	zodiac	signs	Sagittarius	and	Pisces,	is	exalted	in	Cancer,	and	debilitated	in
Capricorn.	Gemini	and	Virgo	are	its	signs	of	detriment.	Jupiter	is	the	natural
Lord	of	the	ninth	house	and	the	twelfth	house.	Since	the	ninth	house	is	the	house
of	fate,	one	of	the	most	important	houses,	its	lordship	makes	the	placement	of
Jupiter	in	the	natal	chart	very	significant.
Jupiter	is	also	important	because	it	rules	over	progeny,	education,	and
marriage.	Its	placement	in	a	woman’s	natal	astrology	chart	determines	the
lifespan,	status,	character,	and	behavior	of	her	husband.	A	weak	Jupiter	delays
marriage.	When	Jupiter	is	conjunct	with	or	opposed	to	the	Sun,	Saturn,	Rahu,	or
Ketu,	the	marriage	of	those	with	Gemini	or	Virgo	ascendants	ends	in	a	divorce.
These	planetary	configurations	create	obstacles	to	marriage	in	general.
Jupiter	makes	its	natives	cooperative,	active,	ambitious,	disciplined,	and	pure
in	behavior.	They	believe	in	simple	living	and	high	thinking.
Jupiter	rules	over	the	liver,	and	the	region	from	the	waist	to	the	thighs.
Jupiter	is	the	Lord	of	those	born	on	day	3,	12,	21,	and	30	of	any	month,	or
those	whose	name	or	destiny	number	comes	to	3.	Those	born	on	the	twelfth	day
of	any	month	are	the	most	fortunate.
NUMBER	3
Psychic	Number	3
Three	is	the	psychic	number	of	those	born	on	day	3,	12,	21,	or	30	of	any	month.
As	a	member	of	the	family	of	odd	numbers,	3	is	a	dynamic	number.	It	makes
its	natives	independent,	bold,	active,	hard	working,	dependable,	popular,
disciplined,	self-confident,	and	initiators.
Psychic	number	3	people	are	very	ambitious.	They	like	to	get	ahead	in	the
world.	They	want	to	do	something	great	with	their	life	so	they	are	remembered
by	posterity.	In	this	way,	they	are	very	future-conscious	people.
At	the	beginning	of	their	career,	which	they	start	quite	early	in	life,	they	have
to	struggle	a	lot.	This	struggle,	however,	is	very	beneficial	for	their	growth	and
development	and	makes	them	shine.
They	do	not	like	to	be	subordinates,	nor	do	they	like	minor	jobs.	They	think
about	big	projects	and	try	to	create	jobs	for	themselves	in	which	they	are	their
own	boss.
They	are	scientists	of	life.	They	spend	their	energy	finding	practical	solutions
for	making	life	more	colorful,	more	joyful,	and	more	enjoyable.	They	are	very
conscious	of	their	responsibility	in	this	area.	With	their	keen	sense	of
observation	and	logic,	they	struggle	with	an	open	mind	and	acquire	a	good
understanding	about	life.	Because	they	are	well	versed	in	the	art	of	conversation
and	can	express	themselves	clearly,	they	are	good	advisors,	teachers,	orators,	and
writers.
They	are	flexible	in	their	ideas	and	freely	adopt	what	is	beneficial	from	all
religious	practices.	Although	they	do	not	commit	themselves	to	any	conventional
religion,	they	are	religious	at	heart.	They	believe	in	the	truth,	its	practical
application,	and	its	beautiful	expression	in	life.
They	love	success	and	wish	to	be	successful	in	everything	they	do.	They	also
like	to	be	appreciated	every	step	of	the	way.	Like	number	1	people,	they	need	a
lot	of	attention,	and	for	that	they	learn	many	tricks,	such	as	the	art	of
conversation,	expressing	themselves	through	gestures	and	postures,	and	making
jokes	and	puns.
They	are	hardworking	throughout	their	life	and	keep	themselves	busy	with
something	or	other	all	the	time.	Even	if	they	feel	compelled	to	rest,	they	are
restless	and	just	cannot	relax.	They	can	catnap	between	jobs;	that’s	why	they	can
work	on	many	projects	simultaneously.	When	one	task	becomes	tiresome,	they
switch	to	another.	In	this	way,	they	do	many	things	and	earn	through	many
sources.	They	are	extremely	conscious	in	carrying	out	their	duties	and	believe	in
performing	them	as	their	yoga.	They	believe	in	the	axiom,	“Devotion	to	duty	is
divine.”
They	are	successful	in	the	execution	of	any	job	they	undertake	and	usually
finish	what	they	start.	This	gives	them	self-confidence,	which	is	the	keyword	of
their	life.
They	are	true	to	their	word	and	honor	their	commitments.	This	makes	them
dependable.
They	love	order	and	discipline.	They	obey	the	orders	of	those	whom	they
respect	and	think	to	be	their	superiors.	They	wish	that	those	younger	and
subordinate	to	them	do	likewise.	This	sometimes	creates	problems,	because	they
become	dictatorial	and	tyrannical	at	home	with	their	dependents.
They	are	fortunate	in	that	they	receive	love,	affection,	help,	and	guidance	from
elderly	people,	relatives,	and	those	well-placed	in	society.
They	are	strongly	built,	healthy,	and	full	of	stamina.	They	make	friends	easily
and	have	a	wide	circle	of	acquaintances.
They	are	always	optimistic,	creative,	cheerful,	inspiring,	and	full	of	humor.
Sometimes	they	create	problems	for	themselves	by	making	fun	of	people	who	do
not	appreciate	their	humor.	These	people	easily	become	their	critics	and
enemies.	Their	short-tempered	and	outspoken	behavior	often	offends	people	and
slowly	they	develop	a	circle	of	critics	(much	smaller	than	their	circle	of	friends
and	admirers).	Nevertheless,	they	manage	to	keep	a	smile	and	not	concern
themselves	with	their	opponents.
They	are	always	surrounded	by	members	of	the	opposite	sex.	A	weakness	for
sex	is	one	of	their	problems.	However,	they	are	selective	and	engage	in	refined
relationships	that	are	beneficial	to	them.	They	may	have	physical	relationships
with	mates	having	psychic	numbers	of	1,	3,	6,	or	9,	even	if	they	do	not	bind
themselves	in	matrimonial	ties.	But	generally,	they	are	chaste	and	pure.	They
honor	their	marital	vows	and	are	loyal	to	their	partners,	even	though	they	do	not
respect	them	and	sometimes	misbehave	with	them.	They	love	their	kith	and	kin
and	are	strongly	attached	to	family;	they	bear	with	pleasure	the	hardships
required	of	them	to	meet	family	obligations.	They	are	loyal	and	devoted	to	their
parents.	They	sacrifice	their	personal	comforts	to	keep	an	atmosphere	of	love
and	harmony	in	their	family.	Even	if	there	are	deficiencies	in	their	partners,	they
stand	by	their	side	to	help	them.	Their	life	partners	are	usually	attractive,	chaste,
loyal,	and	give	them	their	full	support.
They	are	universal	helpers	and	help	all,	even	their	enemies,	but	only	when
asked.	They	are	devoted	to	all	good	causes	and	offer	their	help	immediately,
without	bargaining.
They	are	fond	of,	and	benefit	from,	traveling.	They	are	privileged	to	meet
celebrities	of	their	time	from	many	fields.	They	love	to	ride	horses.
Their	main	weaknesses	are	over-ambitiousness,	excessive	optimism,	and
extravagance;	they	exaggerate	the	truth	and	are	short-tempered,	uncontrollably
dictatorial,	jealous,	and	prideful.
Psychic	number	3	people	born	on	the	third	of	any	month	are	more	prone	to
struggle	in	life,	yet	their	struggles	are	beneficial	and	in	the	end	bring	success.
Those	born	on	the	twelfth	of	any	month	have	more	magnetism	and	charisma
than	other	psychic	number	3	people.	They	are	more	fortunate,	have	to	struggle
less.	They	get	help	and	cooperation	from	friends	and	those	in	authority,	and
become	successful	people	who	started	from	nothing.	Those	born	on	the	twenty
first	of	any	month	have	a	sadness	in	their	life.	They	are	not	as	successful	as	other
psychic	3s	because	of	the	influence	of	the	digit	2.	Those	born	on	the	thirtieth	are,
because	of	the	0,	the	most	unfortunate	of	psychic	3	people;	they	struggle	the
most.
Precautions	for	Psychic	Number	3	People
They	should	avoid	unnecessary	discussions.
They	should	avoid	the	company	of	low	people.
They	should	try	to	control	their	tempers	and	eat	and	drink	in	silver	pots.
They	should	spend	money	carefully.	Money	comes	to	them	easily	and	from
many	sources,	but	it	also	goes	out	easily	for	objects	of	decoration	and
comforts,	which	creates	a	financial	imbalance.
They	should	try	to	save	money	for	their	future.
They	should	avoid	overeating	and	the	use	of	fats	and	hot	spices.	Jupiter,	the
Lord	of	number	3	people,	rules	over	the	liver.	Since	they	work	with	the
energy	of	liver,	they	should	avoid	foods	that	are	hard	on	it.	Regular	use	of
fenugreek	seeds,	anise	seeds,	coconut	powder,	almonds,	black	pepper,	and
honey	with	a	pinch	of	saffron	can	be	helpful.
They	should	avoid	boasting	about	their	achievements.
They	should	control	their	anger.
They	should	control	their	passions	and	sensuality.
They	should	avoid	being	overly	optimistic	and	ambitious.
They	should	not	lose	heart	with	little	failures	and	be	patient.
They	should	control	their	dictatorial	attitudes	at	home	and	allow	other
members	of	the	family	their	freedom.
They	should	respect	their	life	partners.
They	are	susceptible	to	skin	diseases.	If	they	massage	themselves	regularly
with	oil,	they	prevent	skin	troubles.	They	should	also	avoid	acid	and	gas
producing	foods	and	avoid	eating	when	they	are	not	hungry.	(Often	they	do
so	to	oblige	others	and	keep	them	company.)
They	should	avoid	being	proud.
They	should	avoid	earning	money	by	improper	means.
They	should	undertake	journeys	when	they	feel	that	the	time	for	them	is	not
favorable	where	they	are.
They	should	learn	to	say	no	because	their	habit	of	saying	yes	to	everything
creates	problems.	Those	who	depend	on	them	start	expecting	things	and
because	yes	means	nothing	to	them,	this	causes	disappointment.
They	should	relax	and	avoid	taking	on	more	work	and	responsibilities	than
they	can	handle,	which	causes	them	stress.
Destiny	Number	3
Three	is	not	good	as	a	destiny	number.	It	makes	people	work	hard;	they	overload
themselves	and	develop	stresses	and	strains.	It	also	creates	disorder	in	their	life.
But	as	destiny	number	3	people	are	strongly	built	and	full	of	stamina,	they	can
bear	unbelievable	pressures.
A	weakness	for	sex	brings	them	opposition	from	family	members	and	their
actions	are	challenged.	However,	they	are	lucky	and	are	able	to	escape	this
opposition.
Their	outspoken	and	critical	nature	creates	problems	for	them.
Their	friends	betray	them.
They	are	not	benefited	by	their	brothers.
They	meet	failure	in	matters	of	love	and	sometimes	earn	a	bad	reputation.
Their	selfishness	hampers	their	growth	and	development.
Their	boasting	nature	makes	people	turn	away.
Their	pride	makes	them	miss	many	opportunities	to	excel	in	life.
Their	extravagance	creates	financial	crises.
On	the	other	hand,	they	are	fortunate	and	their	luck	saves	them	from	all
problems,	including	accidents.	They	get	money	whenever	they	need	it,	and	they
are	able	to	materialize	their	dreams.	They	are	born	leaders,	easily	rise	in	politics,
and	achieve	good	posts	in	the	government.
They	start	as	an	ordinary	person	and	rise	to	great	heights	in	their	careers	by
hard	work,	good	fortune,	a	well-developed	sense	of	responsibility,	and	conscious
planning.
They	avoid	entering	into	disputes	and	sometimes	have	to	spend	money	out	of
their	pocket	to	repay	agitated	friends	and	family	members,	victims	either	of	their
overly	enthusiastic	planning	or	their	change	of	plans	at	the	last	moment.
Destiny	number	3	people	are	blessed	by	a	good	family	life.	Their	life	partners
are	supportive	and	assume	domestic	responsibilities	giving	them	time	to	devote
to	a	good	and	pious	cause.	Their	life	partners	have	to	share	and	serve	their	many
friends	and	acquaintances,	many	of	whom	are	poor	people,	in	need	of	social	help
and	care.
They	are	warm-hearted,	generous,	fair,	trustworthy,	and	make	money	through
their	magnetic	personality	and	charming	behavior.
They	find	friends	and	helpers	everywhere.
They	love	to	act	like	priests	and	do	religious	work;	they	love	chanting.
They	are	lovers	of	ancient	history	and	politics.
They	earn	through	many	sources	and	sometimes	use	the	wrong	means	to	earn
money.	But	they	spend	it	freely	on	others	and	put	their	money	to	good	use,
buying	comforts	and	decorations.
They	are	blessed	with	creativity,	good	imagination,	good	intuition,	and	the
power	of	clear	expression,	both	written	and	oral.	However,	they	do	not	get	name,
fame,	and	money	in	the	early	part	of	their	life,	when	they	desire	it	the	most.	It
comes	to	them	later,	when	they	have	matured	to	a	ripe	age.
They	love	tasty	foods	and	like	to	have	comfortable	houses,	equipped	with	all
facilities.
They	enjoy	a	deep	sleep	and	do	not	sleep	for	a	very	long	period	of	time.
They	believe	in	peace	and	happiness	for	all.
They	are	best	suited	for	publishing,	business,	publicity,	higher	education,
research,	travel	and	tourism,	and	the	import-export	business.	They	can	also	work
as	jewelers	or	lawyers.	They	can	teach	philosophy	which	is	their	favorite	subject.
They	can	also	serve	religious	and	philanthropic	organizations.
Name	Number	3
Three	is	good	as	a	name	number.	The	name	number	is	important	for	social
relationships;	society	knows	and	remembers	a	person	by	his	or	her	name.	Three
as	a	name	number	brings	humor,	popularity,	and	a	willingness	to	help.	It	brings
good	fortune,	if	it	is	in	harmony	with	the	destiny	number.	If	it	is	in	harmony	with
the	psychic	number,	it	brings	fame	and	makes	one	memorable.	People	having	3
as	their	name	number	are	bold,	trustworthy,	self-disciplined,	and	tolerant;	they
make	good	storytellers	and	eloquent	speakers.	If	in	harmony	with	both	the
psychic	and	destiny	number,	name	number	of	3	gives	the	quality	of	leadership.
On	the	one	hand,	it	brings	name	number	3s	a	high	position	and,	on	the	other,	it
brings	situations	in	which	they	have	to	struggle	a	lot	for	the	existence	of	their
ideas	and	ideals.	They	become	jacks-of-all-trades	and	act	like	masters	of	all
trades.
BALANCING	INTERNAL	AND	EXTERNAL
ENVIRONMENTS
By	observing	fasts,	using	the	proper	spices	and	gem	powders,	meditatingon	the
mantras,	and	using	the	yantras,	one	can	balance	the	internal	environment.
Balancing	the	external	environment	is	possible	by	choosing	the	right	time	for
activities	(in	the	ascending	cycle	or	descending	cycle),	selecting	good	friends
(finding	compatible	numbers),	and	starting	a	job	at	the	appropriate	time
(observing	weak	period	and	strong	periods).	Balance	is	achieved	by	working
with	the	energy	flow	that	is	already	available,	as	described	in	the	sections	that
follow.	The	information	that	follows	applies	to	people	with	psychic	number	3.
Weak	Periods
The	months	of	October	and	November	are	not	favorable.	During	this	period,
they	should	avoid	starting	new	projects	or	undertaking	long	journeys.
Strong	Periods
The	periods	between	February	19	and	March	20	and	between	November	21	and
December	20	are	the	most	favorable.	All	new	projects	should	be	started	during
these	times.	Travel	during	these	periods	brings	long-lasting	benefits.
Good	Dates
Days	3,	12,	21,	and	30	of	any	month	are	good;	days	6,	9,	15,	18,	24,	and	27	of
any	month	are	also	favorable.
Good	Days
Thursday	is	the	best	day	for	number	3	people,	because	it	is	ruled	by	Jupiter.	It	is
a	day	of	good	news	and	gains.	In	addition	to	Thursday,	Monday	and	Wednesday
are	also	good	for	financial	gain.
Favorable	Colors
Yellow	is	the	most	favorable	color	for	number	3	people.	In	their	environments,
work	and	relaxation,	they	should	use	yellow	curtains,	pillow	covers,	and
bedsheets.	A	yellow	handkerchief	is	also	very	helpful	for	removing	stress.	They
can	also	use	pink,	blue,	or	light	purple.
Precious	Stones
Yellow	sapphire	and	yellow	topaz	are	their	gems.	These	gems	should	be	bought
and	given	to	the	jeweler	on	a	Thursday;	a	ring	or	pendant	with	an	open-back
setting	should	also	be	made	by	the	jeweler	on	a	Thursday.	The	ring	or	pendant
should	be	picked	up	from	the	jeweler	on	a	Thursday,	and	worn	after	the	proper
rituals	have	been	performed.	The	forefinger	of	the	right	hand,	the	Jupiter	finger,
is	best	suited	for	the	ring;	the	pendant	could	be	worn	around	the	neck	with	a
chain	or	yellow	string.	The	setting	for	the	ring	or	the	pendant	and	its	chain
should	be	made	of	gold.
They	should	take	yellow	sapphire	powder	to	help	their	bodies	heal
electrochemically.
Meditation
Number	3	people	should	meditate	on	Vishnu,	who	has	four	arms,	is	sky	blue	in
color,	and	sits	on	his	favorite	snake	shasha.	With	one	arm	he	blesses,	in	the	other
he	holds	a	chakra,	in	his	third	hand	is	a	lotus,	and	in	his	fourth	hand	he	holds	a
club.	His	face	has	a	calming	smile.
Deity
Number	3s	are	supposed	to	worship	the	preservation	aspect	of	the	Supreme
Lord,	known	as	Vishnu	in	the	Hindu	tradition.
Mantra
Japa1
(repetition)	of	the	mantra	of	any	planet	should	be	completed	within	the
ascending	cycle	of	the	moon	and	should	be	repeated	the	prescribed	number	of
times.
AUM	BRIM	BRAHASPATAYE	NAMAH—AUM
Number	3s	should	repeat	the	above	mantra	19,000	times	within	the	ascending
cycle	of	the	moon.
Yantra	for	Jupiter2
Health	and	Diseases
Number	3	people	are	susceptible	to	the	following	problems	related	to	wind	or	air
(vata	dosha)	in	the	Ayurvedic	system:
Frail	nerves.	According	to	Ayurveda,	the	nervous	system	is	related	to	the
humor	of	wind,	the	air	element.	Nerve	function	is	related	to	the	principle	of
activity	and	movement;	the	humor	of	wind	is	the	only	active	principle	out
of	the	three	body	humors	(bile	and	mucus	are	immobile).	A	massage	with
an	oil	containing	fenugreek	seeds	that	have	been	cooked	in	a	little	vinegar
can	be	very	helpful	for	this	condition.	Sesame	oil	produces	the	greatest
benefit.
Skin	problems.	As	a	result	of	disturbance	in	the	humor	of	wind	(vayu),	the
body	feels	dry.	This	dryness	creates	skin	problems	of	all	kind.	The	use	of
garlic,	ginger,	asafetida,	and	fenugreek	seeds	in	food,	and	the	avoidance	of
indigestion,	acidity,	and	constipation	can	help	calm	the	aggravated	humor
of	wind.	The	use	of	gram	flour	(chickpea	flour)	in	bread,	and	the	ingestion
of	carrots	or	carrot	juice,	can	help	cure	skin	diseases.	Massages	with	oil	are
also	very	helpful.	Excess	use	of	garlic,	ginger,	and	asafetida	can	cause
dryness.
Worrying	and	uneasiness	of	mind.	Meditation,	breathing	exercises,	deep
and	slow	breathing,	morning	and	evening	walks	along	the	side	of	a	flowing
river,	reading	scriptures,	chanting	the	mantra,	and	the	singing	hymns,
bhajans,	can	help.
Increase	in	sexual	urge,	lethargy	of	private	organ	(in	males).	By
maintaining	a	healthy	diet	(not	too	oily	or	greasy),	by	regular	use	of	date
milk	(a	mixture	of	milk	and	mashed	dates	that	has	been	boiled	and	topped
with	a	pinch	of	saffron),	and	by	oil	massage,	the	lethargy	of	the	male	organ
can	be	helped.	To	balance	the	sexual	urge,	one	has	to	divert	one’s	attention
to	some	other	interesting	subject.	This	subject	can	be	partially	related	to
sex,	but	it	should	bring	the	energy	into	the	higher	chakras.	Sexual	energy
can	be	diverted	and	channeled	in	other	directions	so	as	to	function	as	a
creative	force.
Arthritis.	This	is	another	disease	created	by	the	aggravated	humor	of	wind.
A	controlled,	gas-free	diet,	along	with	regular	massage	done	with
Mahanarayan	oil	or	Wintergreen	oil	(to	which	eucalyptus	oil	and	mint	oils
have	been	mixed	in	equal	proportions)	can	help.	Also,	swallowing	small,
round	balls	of	beeswax	(the	size	of	a	garbanzo	bean)	for	forty	consecutive
days	at	the	beginning	of	the	winter	season	is	very	beneficial.
Impurity	of	the	blood.	Fasting	on	herbal	teas	and	blood-purifying	fruit
juices	can	help	this	problem.	A	change	in	diet	to	vegetarianism,	use	of
alkaline	foods,	use	of	sprouts,	regular	morning	walks,	breathing	exercises,
and	meditation	can	also	cure	impurities	of	the	blood.
Heart	troubles.	Wearing	Rudraksha	beads	(seeds	from	a	tree	that	is	thought
to	be	holy)	in	the	form	of	a	necklace	or	armband	can	help	the	heart.	Also
eating	rose	petal	jam	(known	as	Gulkand),	injesting	powdered	pearls	mixed
with	cream	or	honey	(and	mixed	with	the	ring	finger),	and	avoiding	fats	and
hot	spicy	foods	can	help	the	heart.	Purification	of	the	abdominal	tract,
lungs,	and	chest	cavity	can	be	good;	breathing	exercises,	vegetarian	diets,
alkaline	foods,	meditation,	and	listening	to	relaxing	music	can	help	also.
Diabetes.	The	use	of	fenugreek	seeds	(both	as	tea	and	as	a	spice	in	all
foods),	breathing	exercises,	morning	walks,	gem	remedies,3
food	and	daily	life	habits	can	all	help	this	condition.
and	a	change	in
Poisoning,	Heat,	Eruptions,	Jaundice,	and	Paralysis	These	are	other
ailments	for	which	number	3s	should	take	precautions	after	they	pass	thirty
five.	Frequent	use	of	yellow	sapphire	powder	protects	them	from	many
diseases.	This	powder	should	be	mixed	in	a	teaspoon	of	honey	or	cream
with	the	ring	finger	of	the	right	hand	and	taken	orally	with	the	same	finger.
Fasting
katha4
Number	3	people	can	obtain	benefits	if	on	Thursdays	they	do	the	following:	fast;
offer	homage	to	Jupiter;	abstain	from	eating	bananas;	abstain	from	(1)	doing
laundry,	(2)	shaving,	(3)	using	cumin	seeds,	and	(4)	using	oil	for	massage	and	in
foods	(ghee	and	butter	can	be	used	in	foods).	Also,	if	on	the	full	moon	day	they
fast	and	observe	a	vow	of	silence,	and	at	night	rather	than	sleep	they	chant
mantras	and	meditate,	they	can	receive	great	help	during	these	24	hours.	Hindus
can	recite	Vishnu’s	mantra	and	the	Vishnu	Sahasranam	chant.	To	follow	these
practices	on	every	full	moon	brings	good	luck	and	the	satisfaction	of	all	desires.
Hindus	can	also	combine	this	with	worship	of	Satya	Narayan	and	listen	to	the
of	Shri	Satya	Narayan.
Friendship
Men	and	women	born	on	day	1,	3,	6,	9,	12,	15,	18,	21,	24,	or	27	of	any	month
make	suitable	friends	for	3s.	Numbers	5	and	7	are	also	friendly	toward	them.
Romance
Men	or	women	born	between	February	19	and	March	21	or	between	November
21	and	December	21,	with	a	psychic	number	of	3,	5,	or	9,	are	perfect	for
romance	and	marriage.	People	with	the	psychic	numbers	of	1,	2,	6,	and	7	who
are	born	during	these	periods	can	be	chosen	when	the	above	numbers	are	not
available.	However,	Is	or	7s	should	be	selected	by	women,	and	2s	or	6s	by	men.
Good	Years	in	Life
The	3rd	year,	the	12th,	21st,	30th,	33rd,	36th,	48th,	57th,	66th,	and	75th	are	good
years.	Any	other	year	divisible	by	three	can	also	be	beneficial.
NUMBER	3	PEOPLE	IN	RELATIONSHIP
The	information	given	below	is	based	upon	a	comparison	of	psychic	number	3s
to	other	psychic	numbers.	It	can	also	be	used	to	compare	destiny	3s	to	other
destiny	numbers,	and	name	3s	to	other	name	numbers.	(The	comparisons	are
based	upon	like	categories.)
Number	3	and	Number	1
Number	3	and	number	1	are	good	friends	(as	explained	on	page	35).	Threes	are
able	to	inspire	and	bring	out	all	the	good	qualities	in	1s.	Ruled	by	the	Sun,	1s
make	good	students	of	3s	and	are	supportive	of	them.	Ruled	by	Jupiter,	3s	are
good	advisers,	like	good	prime	ministers,	and	1s	listen	to	them.	Natives	with
both	numbers	are	ambitious	and	want	to	excel	in	life.	Both	can	express	their
ideas	forcefully	and	are	hard	workers,	having	extra	amounts	of	energy	and
stamina.	Both	are	authoritative	and	disciplinarians.	They	form	an	ideal	pair,	if
the	1	is	a	man	and	the	3	a	woman.	Threes	should	select	1s	for	any	kind	of
relationship.	Although	1s	have	to	work	for	3s,	the	relationship	is	mutually
beneficial.
Number	3	and	Number	2
The	number	2,	being	an	even	number,	is	static;	the	number	3,	being	an	odd
number,	dynamic.	The	combination	becomes	dynamic.	Number	3	people
understand	2s	very	well	and	can	help	them	under	all	circumstances.	Although	2
is	a	number	of	change,	number	3	people	are	adjustable	and	flexible.	Both	3s	and
2s	are	ruled	by	benefic	planets.
Threes	are	teachers	for	2s;	they	help	them	grow	and	develop	and	bring	success
into	their	life.	Their	relationship	is	mutually	beneficial,	and	3s	can	select	2s	for
marriage,	friendship,	or	business	partnership.	If	2s	select	3s,	all	projects	will	be
completed	and	desires	fulfilled.	Threes	will	have	to	work	for	2s,	as	2s	are
Queens	and	3s	Prime	Ministers.	While	hard	work	for	3s	is	necessary	and	natural,
2s	are	delicate	and	fragile.	So	3s	keep	busy	and	provide	energy	to	2s.
Number	3	and	Number	3
Unlike	any	other	combination,	two	3s	are	beneficial.	As	we	have	stated	earlier,
when	two	like	numbers	come	together,	they	relax	and	neutralize	each	other.	In
this	case,	it	does	not	happen.	They	both	work	hard	and	try	to	come	up	in	the
world.	Threes	are	universal	helpers,	who	help	all	numbers	when	asked.	In
business	partnership,	two	number	3s	do	not	make	big	money,	but	they	work
cooperatively.	In	the	end	they	are	successful	because	they	have	practical	natures
and	good	organizing	abilities.	So	3s	are	good	for	each	other	in	friendship,
marriage,	or	business	partnership.	Number	3s	act	like	boatmen,	taking	all
numbers	across	the	river	of	difficulties.
Number	3	and	Number	4
The	number	4,	ruled	by	Rahu	(the	north	node	of	Moon),	is	not	a	friend	to	the
number	3.	Although	number	3	people	are	not	benefited	by	4s,	the	reverse	is	true
because	3s	are	ruled	by	Jupiter.	If	they	enter	into	a	business	partnership,	3s	suffer
losses	but	4s	benefit.	As	friends,	3s	are	helpful	and	understanding	to	4s;	4s	gain
strength	by	following	the	advice	of	3s.	The	relationship	is	not	harmful	to	a	3,	if
the	3	is	a	man	and	the	4	a	woman.	But	if	reversed,	the	marriage	will	not	be	very
successful.	This	is	because	4s	are	characterized	by	sudden	changes	and	secrecy,
which	is	not	tolerated	by	number	3	women.
Number	3	and	Number	5
The	numbers	3	and	5	are	both	odd	and	dynamic.	Since	5s	are	ruled	by	Mercury,
both	numbers	are	ruled	by	benefic	planets.	Mercury	and	Jupiter	are	not	friends,
although	Jupiter,	being	a	neutral	universal	helper,	helps	5s.	Number	3s	are	good
advisers	and	friends.	Since	5s	are	princes	and	entertainers,	and	3s	are	also	happy
numbers,	they	make	good	company.	Neither	follow	a	traditional	religion;	they
are	free	thinkers.	So	they	help	each	other.	Because	of	their	restless	nature,	5s	are
not	ideal	business	or	marriage	partners	for	3s.	However,	since	5s	are	merchants,
3s	can	learn	about	business	from	them.	Marriage	between	a	5	and	a	3	can	be
beneficial	if	3	is	the	man	and	5	the	woman,	but	the	reverse	is	not	successful.
Number	3	and	Number	6
The	number	6	is	ruled	by	Venus,	“the	teacher	of	demons.”	(The	word	demons
here	means	our	pleasure-seeking	nature.)	Psychic	number	3	people	are
disciplinarians	and	6s	are	law	breakers—they	are	opposites.	But	as	numbers,
they	are	harmonious.	Number	3s	are	attracted	by	6s.	In	the	company	of	6s,	3s
can	explore	unexplored	parts	of	their	own	personality	and	enjoy	life.	Number	6
people,	being	slow,	are	beneficial	to	fast	number	3	people	and	make	them	relax
and	enjoy	life	and	its	luxuries.	In	friendship,	a	3	and	a	6	are	mutually	beneficial;
a	6	benefits	from	following	a	3s	advice.	Threes	develop	more	spiritual	awareness
in	the	company	of	6s,	who	guide	them	toward	secret	and	occult	sciences.	A	3
enjoys	a	good	married	life	with	a	6,	if	the	3	is	a	man	and	the	6	a	woman.
However,	the	reverse	combination	is	not	ideal.	In	business	partnerships,	3s	and
6s	are	mutually	beneficial.
Number	3	and	Number	7
Number	7	is	ruled	by	Ketu,	an	unfriendly	planet	to	Jupiter,	but	Jupiter	has	a
neutral	attitude	toward	Ketu.	They	are	both	odd	and	dynamic	numbers.	Since	a	7
is	also	a	kind	of	teacher,	one	who	teaches	practical	wisdom,	both	numbers	are
independent	thinkers.	However,	3s	help	7s	solve	their	problems.	Number	7s	are
friendly,	and	have	a	philosophical	outlook.	Threes	and	7s	do	not	think	the	same
way	or	always	agree	with	each	other;	but	when	they	undertake	a	project	of
common	interest,	they	work	together	very	well.	Both	have	the	gift	of	intuition,
both	are	interested	in	reforms,	both	are	writers.	As	friends	and	business	partners
they	can	be	very	helpful	to	each	other.	In	marriage,	if	a	3	is	the	man	and	a	7	the
woman,	the	relationship	will	work	very	well.	With	the	opposite	combination,	the
woman	will	face	difficulties	in	the	early	years,	but	later	on	the	marriage	will
work.
Number	3	and	Number	8
The	number	8	is	ruled	by	Saturn,	and	Jupiter	and	Saturn	have	a	neutral
relationship.	Eight	is	a	number	of	struggle;	it	works	for	everything	by	itself	and
does	not	seek	help.	So	3s	are	not	able	to	help	8s.	Although	8s	are	powerful	and
succeed	after	much	necessary	effort	and	struggle,	they	do	not	enjoy	the	benefits
of	marital	life	for	long	periods	of	time.	In	short,	3s	should	not	select	8s	for
marriage.	Threes	make	8s	fortunate	by	giving	them	advice	and	are	generally
beneficial	for	8s.	However,	8s	are	not	very	beneficial	for	3s,	either	in	business
partnership	or	as	a	life	partner.
Number	3	and	Number	9
Since	the	number	9	is	ruled	by	Mars,	a	friend	of	Jupiter,	the	numbers	3	and	9	are
friendly.	Number	three	is	lucky	for	9,	and	9	is	beneficial	to	3.	Nine	natives	have
extraordinary	organizational	abilities	and	are	also	hard	workers.	Both	numbers
make	a	good	team	and	work	hard	to	gain	success	in	life.	They	are	mutually
beneficial.	Number	3s	can,	without	any	problem,	choose	9s	for	friendship,
marriage,	or	business	partnership.	Threes	do	not	earn	much	money	in	the
business	partnership,	but	they	never	suffer	a	loss.	Number	9s	are	helped	by	the
good	advice	of	3s,	who	in	turn	benefit	because	the	9s	arrange	and	organize
everything	for	them.	Number	9s	promote	and	help	the	growth	and	success	of	3s.

Rahu	and	Number	4
Rahu	is	the	ruling	planet	of	people	born	on	day	4,	13,	22,	or	31	of	any	month,	or
whose	destiny	or	name	number	adds	up	to	4.	The	qualities	of	Rahu	described
below	are	most	clearly	visible	in	people	who	have	4	as	a	psychic	number.
Rahu	and	Ketu,	the	two	nodes	of	the	Moon,	reflect	the	basic	bipolar	nature	of
man.	They	do	not	exist	as	material	entities	like	the	other	seven	planets.	They
each	represent	a	point	where	the	plane	of	the	Moon’s	orbit	around	our	planet
intersects	with	the	plane	of	the	ecliptic	of	the	zodiac	constellations.	These	nodes
are	important	to	astrologers,	astronomers,	and	numerologists	because	they
belong	to	the	Moon,	whose	influence	on	human	emotions	is	universally
accepted.	It	is	only	at	the	nodes	that	the	path	of	the	Moon	intersects	the	path	of
other	planets.	These	nodal	points	are	not	fixed	points	in	outerspace,	but	are	more
“backwards”	that	is,	they	are	always	retrograde	and	never	direct.	Because	in
ancient	times,	with	the	help	of	these	nodes,	exact	dates	of	the	solar	and	lunar
eclipse	could	be	determined	by	astrologers	and	astronomers,	the	nodes	became
very	significant	and	were	each	given	the	status	of	“half-planet.”	Also,	as	they	are
not	real	entities,	their	influence	varies	with	their	location	in	every	native’s	chart.
Since	their	influence	creates	a	wide	range	of	emotional	behavior,	knowledge	of
them	becomes	necessary.
Rahu,	the	north	node	of	Moon,	is	an	active	and	disruptive	force	which	works
mainly	on	the	mental	level.	It	is	supposed	to	be	a	malefic	planet—dynamic	in
nature,	low	in	vibration,	hedonistic,	and	eternally	dissatisfied.	It	makes	its
natives	lazy	and	lethargic,	dull,	illogical,	and	pleasure-seeking.	They	become
revolutionaries,	conspirators,	spies,	and	detectives.	Rahu	brings	to	its	natives
confusion,	ignorance,	phobias,	enmity,	and	big	plans	that	need	a	long	time	to
accomplish.	It	makes	them	work	hard	and	perform	bad	karmas.
The	favorable	aspect	of	Rahu	gives	talents	for	painting,	writing,	and	editing.	It
brings	fame	and	success,	physical	attractiveness	and	beauty.	It	also	makes	its
natives	intelligent,	bold,	and	secretive.	If	they	are	interested	in	politics,	Rahu
makes	them	successful,	but	often	they	occupy	seats	in	the	opposition.	Rahu	gives
its	natives	an	angle	of	vision	through	which	they	also	see	the	unseen	side	of	all
truth	in	existence.	When	Rahu	is	conjunct	with	Jupiter	or	Venus,	it	gives	its
natives	access	to	secret	sciences,	Tantra,	etc.
Rahu	is	tamasic	(inert)	in	nature	and	influences	physical	strength,	bones,	fat,
tissues,	and	the	skin.
Rahu	makes	its	natives	travel	to	foreign	lands.	It	also	rules	over	sailors.
The	unfavorable	aspect	of	Rahu	destroys	one’s	power	of	discrimination	and
one’s	sensitivity.	It	makes	its	natives	egotistic,	selfish,	pessimistic,	dull,
aggressive,	and	causes	them	to	suffer	imprisonment	or	go	underground.	It	bring
difficulties,	opposition,	and	humiliation,	and	gives	sufferings,	which	cannot	be
diagnosed	or	cured.	It	also	gives	its	natives	suicidal	tendencies.
Rahu	rules	the	zodiac	sign	Virgo,	which	is	also	ruled	by	Mercury.	It	is	exalted
in	Taurus	(according	to	some,	in	Gemini);	Scorpio	(according	to	some,
Sagittarius)	is	its	sign	of	fall.	Friendly	zodiac	signs	of	Rahu	are	Gemini,	Virgo,
Sagittarius,	and	Pisces;	enemy	signs	are	Cancer	and	Leo.	It	brings	better	results
in	Taurus	and	Libra.	The	houses	good	for	Rahu	are	three,	six,	eight,	nine,	ten,
and	eleven.	Dark	or	smoky	blue	is	its	color,	and	the	wind	is	its	element.
Astrologers	compare	Rahu	with	smoke,	which	has	no	definite	nature	or	shape
of	its	own	but	when	present	can	obscure	every	other	thing.	People	under	its
influence	get	easily	irritated,	use	obscene	language,	lose	control	over	their
nerves,	and	become	disruptive.
Apart	from	all	of	its	good	and	bad	points,	Rahu	is	a	great	energy	force	that
gives	its	natives	a	distinctive	character.	It	also	gives	them	a	unique	perspective	of
the	world,	which	is	very	healthy	for	the	growth	of	human	consciousness	at	large.
Rahu	gives	courage,	patience,	and	intelligence,	which	number	4	people	use	to
help	the	downtrodden	to	raise	their	voices	against	the	privileged	few.
NUMBER	4
Psychic	Number	4
Fouris	the	psychic	number	of	those	born	on	day	4,	13,	22,	or	31	of	anymonth.	Of
these,	number	4s	born	on	the	thirty-first	are	the	most	fortunate.
The	number	4	is	ruled	by	Rahu,	which	is	always	changing—never	fixed,
always	retrograde,	never	direct.	The	influence	of	Rahu	introduces	sudden
changes	into	the	lives	of	psychic	number	4	people;	they	have	to	constantly	face
ups-and-downs.	Because	they	undergo	those	changes	so	suddenly,	they	develop
a	doubting	nature	and	cannot	trust	easily.	Because	of	their	uncertainty,	they	have
to	consult	and	act	on	the	advice	of	others	throughout	their	lives.	This	also
happens	because	Rahu	weakens	the	power	to	discriminate	between	right	and
wrong	and	the	power	of	right	judgment,	which	gives	one	a	decisive	nature.
Their	doubting	nature	makes	psychic	number	4s	stubborn	and	obstinate.
Because	Rahu	gives	them	boldness,	courage,	and	patience,	they	can	undergo
pain	and	suffering	without	anxiety.	They	take	sudden	changes,	ups-and-downs,
and	sufferings	easily	without	getting	impatient.	They	face	their	opposition
boldly.
Whether	in	an	ordinary	discussion	or	a	serious	debate,	they	always	support	the
underdog.	If	they	are	able	to	work	in	government,	they	do	not	sit	with	the	ruling
party	but	prefer	to	sit	on	the	opposition	benches.
Extremists,	they	are	either	on	the	top	or	bottom—they	do	not	like	to	be
mediocre	or	belong	to	the	middle	class.
They	have	to	struggle	for	their	growth	and	development	and	have	to	face
obstacles	constantly	in	any	job	they	do,	whether	small	or	great.
They	have	to	face	criticism	and	opposition	throughout	their	lifetime.
Because	their	viewpoint	always	differs	from	that	of	other	people,	and	they
favor	the	underdog	in	conversations,	they	create	problems	for	themselves	and
also	generate	secret	enemies.	Their	intentions,	however,	are	fair	and,	by	nature,
they	are	not	quarrelsome.
They	are	reliable,	patient	friends,	who	can	adjust	themselves	to	all	conditions.
However,	because	they	have	a	quickly	changing	nature—sometimes	they	are
sweet	and	gentle,	and	sometimes	rough	and	rustic—they	often	annoy	their	kith
and	kin.	If	their	friends	can	understand	them	and	forego	their	temperamental
behavior,	they	find	them	to	be	very	helpful,	large	hearted,	practical	people,
having	brilliant	ideas.	They	are	systematic	and	efficient,	especially	in	the
handling	of	big	ventures	and	plans.
They	are	helpful	to	society	and,	by	their	unconventional	and	free-thinking
manner,	they	are	able	to	introduce	great	reforms	into	society	that	benefit	the	poor
and	the	aggrieved.
They	are	interested	in	reforms	of	all	kinds—environmental,	social,	communal,
and	domestic.	This	interest	can	lead	them	into	politics	or	to	spiritual
organizations,	where	they	can	introduce	reforms	and	become	leaders	of	their
own	orders.
They	are	rebellious	by	nature	and	instinctively	rebel	against	rules	and
regulations.	They	do	not	feel	hesitation	in	breaking	the	law.	Whenever	they	rebel
against	constitutional	authorities,	they	become	popular	and	famous.	However,
they	are	seldom	successful	in	the	worldly	or	material	field,	even	though	they
have	a	pragmatic	approach.
They	love	conspiracy	and	sometimes	live	with	conspirators	during	their	youth.
Because	of	their	tendency	to	differ	with	existing	norms,	they	join	up	with
anarchists,	terrorists,	or	lawbreakers.	However,	they	also	fear	that	people	will
misunderstand	them	and	will	take	them	to	be	conspirators.	This	makes	them	feel
lonely	and	deserted.
They	are	not	attached	to	the	concept	of	accumulating	wealth.	Whenever	they
get	money,	they	spend	it	lavishly.	Their	way	of	living	luxuriously	and	spending
freely	gives	people	the	impression	that	they	are	rich.	Their	large	heartedness
makes	them	give	money	to	the	needy	and	poor,	which	makes	their	friends	and
relatives	think	that	they	are	very	rich	when,	in	fact,	they	are	not.
They	are	very	good	critics	of	art.	They	love	to	visit	art	exhibitions,	attend
concerts	or	theaters,	or	see	exhibits	of	ancient	relics.	They	enjoy	evaluating	these
events	critically	but	their	thoughts	are	not	very	clear.
They	have	no	clear	picture	of	life	in	their	mind,	and	so	they	remain—along
with	others	who	live	with	or	are	associated	with	them—in	darkness.	This	creates
problems	in	their	family	life	and	friendships.	This	habit	of	not	having	a	clear
picture	of	life	is	the	result	of	having	events	and	obstacles	come	into	their	paths
suddenly,	so	they	are	not	able	to	achieve	what	they	want.
They	love	to	create	balance	and	order	in	their	life	and	want	things	done	in	a
systematic	way.	If	they	are	supported	by	harmonious	numbers,	they	can	make
progress	by	leaps	and	bounds,	acquire	riches,	and	become	famous.	This	is
because	they	are	practical	planners,	hard	workers,	strong	willed,	and	are	not
afraid	of	facing	opposition	and	challenges.
Their	friendship	is	lifelong	although	they	have	very	few	real	friends	in	their
life.	They	always	feel	that	they	have	been	misunderstood	by	people.
They	are	self-made	people	and	extremely	secretive	by	nature.	They	do	not
disclose	their	secrets,	even	to	those	near	and	dear	to	them.	This	gives	them	heart
problems,	but	they	like	to	feel	lonely	and	bear	all	their	suffering	alone.
They	are	extremely	selfish	and	can	go	to	any	extreme	to	fulfill	their	selfish
motives,	even	if	it	means	harming	somebody.
They	make	false	promises	and	create	critics,	opponents,	and	enemies
throughout	the	course	of	their	life.
They	are	good	conversationalists	and	are	very	polite	and	gentle	in	dealing
with	members	of	opposite	sex.	They	are	very	sensual	and,	if	male,	have	an
excellent	sex	drive.	They	have	many	love	affairs	and	are	always	unsuccessful	in
matters	of	love.	The	devil	of	sudden	change	upsets	their	marriage	plans.
Although	the	doubt	and	uncertainty	of	their	character	plays	an	important	role	in
this,	it	is	the	element	of	sudden	change	that	leads	them	to	catastrophe.
A	psychic	number	4	woman	is	deeply	affectionate	in	her	dealings	with	her
husband,	friends	of	her	husband,	and	other	male	members	of	the	family.	She	is
romantic	and	gentle	by	nature.	She	acts	responsibly	and	takes	care	of	her
husband	and	his	friends,	her	parents,	and	her	inlaws.	She	is	painstaking,	prudent,
flexible,	and	reserved	by	nature.	She	likes	to	lead	an	independent	life	and	does
not	like	to	be	dictated	to	by	others.	She	is	advised	not	to	have	prolonged
relationships	of	any	kind	with	psychic	number	4s,	8s,	or	9s.	Psychic	number	1,	3,
5,	and	6	people	are	more	suitable,	sympathetic	and	harmonious.
Apart	from	all	the	opposition	and	criticism	they	receive	and	their	failures	and
sufferings,	psychic	number	4	people	achieve	rewards	and	recognition	in	the
latter	part	of	their	lives.	They	also	benefit	from	the	inheritance	of	property.
Precautions	for	Psychic	Number	4s
They	should	develop	an	uncritical	nature	and	be	more	trusting.	If	possible,
they	should	remember	the	famous	saying	of	Buddha:	“Doubt	everything—
and	then	doubt	the	doubt.”	They	should	not	take	their	doubts	for	granted
and	let	good	opportunities	slip	from	their	hands.
They	should	keep	cool.	Drinking	water	from	a	silver	goblet	and	eating	food
from	a	silver	plate	helps	to	reduce	their	anger,	which	is	their	greatest
enemy.
They	should	learn	to	appreciate	others.
They	should	reduce	their	selfishness	and	perform	selfless	service.
They	should	avoid	spending	money	unnecessarily	and	save	for	their	old	age
and	time	of	need.
They	should	cultivate	the	habit	of	deciding	things	quickly	and
independently.
They	should	restrain	from	censuring	others.
They	should	neither	give	others	false	hope	nor	make	false	promises.	They
should	become	straightforward	and	learn	to	say	no	when	they	cannot	do
something	for	others,	instead	of	saying	yes	and	then	not	acting.
They	should	not	trust	blindly.
They	should	speak	less	and	in	more	melodious	tones.
They	should	avoid	loneliness	and	isolation.
They	should	avoid	traveling	without	a	purpose.
They	should	meditate	and	do	exercises	to	still	their	mind,	otherwise	they
suffer	from	weakness	of	memory	in	old	age.
Number	4s	can	sometimes	have	a	Kundalini	experience.	They	should	not	be
disturbed	if	this	should	happen,	and	they	should	not	seek	medical	advice.	If	left
undisturbed,	they	will	regain	their	normal	state	of	consciousness	without	any
problems.
Those	number	4	people	whose	destiny	number	is	9	should	avoid	working	with
machines.
Note	About	People	Born	on	Day	13	or	22	of	any	Month
Number	13
Number	4	people	born	on	the	thirteenth	day	of	any	month	should	keep	in	mind
that	they	are	a	combination	of	1,	which	is	ruled	by	the	Sun,	and	3,	which	is	ruled
by	Jupiter.	In	13,	the	Sun	afflicts	Jupiter,	which	creates	an	easily	irritable	nature.
But	it	also	gives	the	qualities	found	in	number	1	people	(since	13	is	a	member	of
the	series	of	10,	which	is	influenced	by	1).	The	Sun’s	affliction	with	Jupiter
makes	things	happen	fast.	If	these	people	find	supporting	friends,	they	can	leave
their	sadness,	pessimism,	and	irritability	behind,	so	as	to	make	their	mark	in	life.
They	should	take	the	powder	of	hessonite	(gomed	pishthi)	frequently,	with
cream	or	honey.	They	should	also	eat	and	drink	from	silver	utensils.
Usually	in	the	West,	13	is	regarded	as	an	ominous	and	unlucky	number.
Although	the	root	of	this	belief	can	be	traced	to	an	early	European	myth,	it	was
not	until	much	later,	after	the	seventeenth	century,	that	this	number	became
considered	unlucky.
In	China	also,	13	was	regarded	as	a	number	of	difficulties.	In	the	ancient
religion	of	Mexico,	however,	it	was	a	most	auspicious	number—it	symbolized
the	Sun,	the	positive,	male	energy.
In	the	Cabala,	13	is	not	regarded	as	unlucky.	In	the	second	book	of	Moses,	one
can	read	of	the	13	attributes	of	God	(Exodus	34:6-7).	Thirteen	is	not	an	unlucky
number	in	India,	but	because	of	British	influence	some	people	speak	of	13	as	an
ominous	number.
In	numerology,	13	is	not	an	unlucky	or	ominous	number.	It	is	a	number	of
practical,	alert,	and	dependable	people.	Those	born	on	this	date	are	people	who
can	easily	go	to	the	depth	of	matters;	they	can	be	very	successful	in	scientific
research	or	occult	sciences	like	Tantra.	Their	interests	in	religion	and	philosophy
can	bring	them	great	successes	and	siddhis	(powers	that	are	thought	to	be
supernatural).
Number	22
Psychic	number	4s	born	on	day	22	of	any	month	are	more	strongly	influenced	by
the	number	2,	yet	they	carry	all	the	qualities	of	number	4.	They	become	very
obstinate	and	are	regarded	as	difficult	people	by	their	friends	and	relatives.
People	with	this	number	have	to	suffer	separation	from	their	families	and
sometimes,	in	the	case	of	men,	a	remarriage.
Number	22	is	believed	to	be	a	mystical	number	in	some	circles.	Number	22
people	are	specialists.	They	execute	their	jobs	efficiently.	They	are	practical	and
systematic.	They	have	to	struggle	hard,	because	they	do	not	get	much	support
from	their	colleagues,	partners,	relatives,	and	family	members.	People	with	this
number	become	very	successful	in	politics.	In	a	business,	they	can	only	excel
when	their	partners	are	supportive.	They	should	learn	techniques	to	relax	their
mind	and	use	the	powder	of	hessonite	(gomed	pishthi)	to	pacify	the	effect	of
Rahu.	With	the	exception	of	marital	problems,	they	are	able	to	overcome	their
difficulties	and	obstacles	and	achieve	success.
Destiny	Number	4
Number	4	is	not	very	good	as	a	destiny	number.	When	people	have	4	as	a
psychic	number,	it	is	possible	for	them	to	train	themselves	to	compromise	with
the	hardships	brought	on	by	the	sudden	changes	in	their	lives.	But	when	people
have	4	as	a	destiny	number,	these	sudden	changes	come	and	destroy	the
masterplan	of	their	lives—life	becomes	exhausting	and	disgusting.	Even	if	they
have	all	the	comforts	and	luxuries	of	life,	they	always	feel	that	something	is
missing.
They	often	get	chances	to	move	ahead,	but	their	doubting	nature	makes	them
suspicious	and	they	miss	out	on	these	chances.
They	are	burdened	by	heavy	responsibilities	and	duties	and	have	no	choice
other	than	to	carry	them	out.	They	have	enough	stamina	and	strength,	but	their
labor	is	not	rewarded.	Not	only	do	they	not	get	proper	appreciation	for	their
work,	but	they	have	to	face	opposition	and	criticism.	This	makes	them
suspicious	and	overly	cautious;	it	forces	them	to	isolate	themselves	and	feel	sad
and	lonely.
Rahu	gives	them	dissatisfaction.	Destiny	number	4	people	never	feel	satisfied
with	their	jobs	and	always	try	to	find	better	ones.	Thus	they	change	their
profession	very	frequently	and	become	like	rolling	stones.
Because	of	the	influence	of	Rahu,	they	are	always	disturbed	by	secret	and
unseen	enemies.	These	enemies	are	drawn	to	them	because	of	their
unconventional	nature,	positive	views,	critical	yet	unclear	minds,	and	because
they	do	not	follow	the	existing	customs	or	norms.
Because	of	the	backward	movement	of	Rahu,	they	become	restless	and
impatient.	They	cannot	bear	delays	in	their	work,	but	their	work	always	has
delays.	(Rahu,	like	Saturn,	creates	obstacles	and	delays.)	They	also	have	delays
in	their	good	luck.
Their	family	life	is	not	good.	Their	selfish,	doubting,	and	secretive	nature
destroys	it.	They	cannot	decide	things	quickly.
In	old	age,	their	memory	gets	weak.
If	destiny	number	4	people	are	born	on	a	Saturday	and	their	psychic	numbers
are	4	or	8,	all	of	the	characteristics	just	listed	become	more	prominent.
They	have	multiple	sources	for	earning	money,	but	it	is	easily	spent.	If	they	do
not	consciously	watch	out	for	extravagance,	they	have	to	work	hard	in	their	old
age	to	make	ends	meet.
Name	Number	4
Although	psychic	or	destiny	number	1	people	and	psychic	number	3	people	can
have	4	as	their	name	number,	generally	number	4	is	not	a	good	name	number.
Numbers	1	and	3	are	optimistic,	idealistic,	and	devoted	to	human	welfare.
Number	4	makes	them	cautious	and	suspicious.	It	does	not	create	a	wide	circle
of	trustworthy	friends.	In	matters	of	business,	it	also	does	not	bring	much
success.	If	possible,	natives	having	number	4	as	a	name	number	should	change	it
to	a	number	that	is	harmonious	with	their	psychic	number—such	as	1,	3,	or	6.
This	will	help	them	have	better	relationships	with	their	colleagues	and	protect
them	from	their	secret	enemies.
BALANCING	INTERNAL	AND	EXTERNAL
ENVIRONMENTS
By	observing	fasts,	using	the	proper	spices	and	gem	powders,	meditatingon	the
mantras,	and	using	the	yantras,	one	can	balance	the	internal	environment.
Balancing	the	external	environment	is	possible	by	choosing	the	right	time	for
activities	(in	the	ascending	cycle	or	descending	cycle),	selecting	good	friends
(finding	compatible	numbers),	and	starting	a	job	at	the	appropriate	time
(observing	weak	period	and	strong	periods).	Balance	is	achieved	by	working
with	the	energy	flow	that	is	already	available,	as	described	in	the	sections	that
follow.	The	information	that	follows	applies	to	people	with	psychic	number	4.
Weak	Periods
October,	November,	and	December	are	generally	not	favorable	months	for
number	4	people.	During	this	period	their	sadness	increases.	They	face	many
obstacles	in	their	work;	they	feel	physically	weak,	less	enthusiastic,	lazy;	they
have	losses	and	psychological	problems.
Strong	Periods
The	period	between	March	21	to	April	28	and	between	July	10	to	August	20	is
favorable	for	number	4	people.	They	should	make	good	use	of	these	times—start
new	jobs,	execute	new	plans,	finish	their	pending	jobs,	and	plan	for	the	future.
Good	Dates
Days	4,	13,	22,	and	31	are	generally	considered	good	dates.	If	they	fall	on	a
Monday,	days	1,	3,	5,	12,	14,	19,	or	21	are	also	favorable.
Good	Days
Saturday,	Sunday,	and	Monday	are	good	days	for	number	4	people.	If	those	days
fall	on	favorable	dates,	they	give	them	additional	strength.
Favorable	Colors
Blue,	grey,	khaki,	and	all	shining	colors	are	good	for	number	4	people.	If	they
keep	these	colors	around,	they	draw	good	energy	from	them.
Precious	Stones
Hessonite	is	the	stone	of	number	4	people.	It	should	be	used	in	a	ring	or	as	a
pendant,	set	in	a	mixture	of	five	metals.1
They	should	use	hessonite	powder	to	help	their	bodies	heal	electrochemically.
Meditation
They	should	meditate	on	Lord	Ganesha,	the	obstacle	remover,	and	chant	the
Ganesha	mantra:
GAJANANAM	BHUTGANADI	SEVITAM
KAPITHYA	JAMBO	PHALCHARU	BHAKSHANAM
UMA	SUTAM	SHOKVINASH	KARAKAM
NAMAMI	VIGHNESHWAR	PADPANKAJAM
Deity
Number	4s	are	supposed	to	worship	Ganesha,	who	is	seated	on	a	throne	of	gold.
He	has	four	arms	and	the	head	of	an	elephant.	With	one	hand	he	blesses,	with	the
other	he	holds	a	hatchet	to	control	the	elephant	of	desires.	In	his	third	hand	is	a
lasso,	and	in	his	fourth	hand	he	holds	his	favorite	sweet,	Laddu.
Mantra
Japa2
(repetition)	of	the	mantra	of	any	planet	should	be	completed	within	the
ascending	cycle	of	the	moon	and	should	be	repeated	the	prescribed	number	of
times.
Whenever	4s	experience	obstacles	and	monetary	problems,	they	should	do	the
Ganesha	mantra	(see	Meditation)	and	then	recite	the	mantra	of	Rahu	with	a	mala
(rosary)	of	108	beads,	going	around	twice:
AUM	RANG	RAHUVE	NAMAH	AUM
Yantra	for	Rahu3
Health	and	Diseases
Diseases	related	to	Rahu	include	colds	and	coughs	and	infectious	diseases	or
diseases	caused	by	infection.	A	shortage	of	blood,	heart	trouble,	high	or	low
blood	pressure	(mostly	high),	and	diseases	that	cannot	be	easily	diagnosed	or
cured	are	also	associated	with	Rahu.
Number	4	people	should	use	oregano	seeds	and	fenugreek	seeds	to	prevent
problems	created	by	low	gastric	fire	and	gas	troubles.	This	will	protect	them
from	heart	troubles	and	blood	pressure	difficulties.	Also,	fenugreek	seeds	are
good	for	the	immune	system	and	help	prevent	infections.	They	should	use	carrot
juice,	beet	juice,	and	fruit	juices	to	prevent	a	shortage	of	blood.	They	should	also
avoid	anger	because	anger	boils	the	blood	and	increases	blood	pressure.	The	use
of	hessonite	powder	can	save	them	from	problems	created	by	Rahu.	Regular	use
of	purifying	teas,	green	leafy	vegetables,	and	sprouts	(such	as	mungbeans,
wheatgrass,	and	fenugreek)	will	help	them	remain	strong	and	healthy.
Fasting
They	should	fast	every	Monday	and	on	the	fourth	day	of	each	ascending	and
descending	cycle	of	the	Moon.	That	day	they	should	drink	juices	and	if
necessary	eat	fruits	after	sunset.
Friendship
Numbers	1,	3,	4,	5,	6,	and	7	are	good	for	friendship.	If	the	persons	with	these
numbers	are	born	during	a	number	4s	strong	period,	they	will	make	more
suitable	friends.
Romance
Number	1	is	the	best.	After	that,	6,	and	then	4,	are	good	for	marriage	and
romance.
Good	Years	in	Life
The	4th	year,	the	13th,	22nd,	31st,	40th,	48th,	49th,	58th,	67th,	76th,	and	85th
are	good	for	them;	also	good	are	the	8th	year,	the	17th,	26th,	35th,	44th,	53rd,
62nd,	71st,	and	80th.
NUMBER	4	PEOPLE	IN	RELATIONSHIP
The	information	that	follows	is	based	upon	a	comparison	of	psychic	number	4s
to	other	psychic	numbers.	It	can	also	be	used	to	compare	destiny	4s	to	other
destiny	numbers,	and	name	4s	to	other	name	numbers.	(The	comparisons	are
based	upon	like	categories.)
Number	4	and	Number	1
Astrologically,	4	and	1	are	enemies—opposites	in	this	world	of	opposites.
Opposite	poles	attract	each	other	and	together	create	an	entirely	new	third	force.
Sols	are	very	good	for	4s.	Number	1	s	are	lucky,	with	a	wide	circle	of
acquaintances	and	friends,	while	number	4s	isolate	themselves.	Their	friendship
is	beneficial.	Both	are	practical,	hard	working,	and	interested	in	politics;	they
love	reforms	and	can	be	ideal	partners	in	politics.	Number	4s	are	not	fortunate	in
domestic	life,	but	1s	can	make	them	fortunate.	Since	1s	are	naturally	attracted	to
4s,	they	can	make	good	life	partners.	Since	4s	are	indecisive,	1s	can	be	of	help	to
them	in	this	area.	In	business	partnership,	1s	are	also	beneficial	for	4s.	Fours	are
therefore	advised	to	select	1s	for	any	kind	of	relationship,	for	a	job	interview
date,	or	for	a	residential	number.	Number	4s	look	at	things	from	the	side	of	the
underdog	and	are	unconventional.	This	fresh	perspective	gives	1s	an	added
dimension.	Fours	are	also	enriched	by	the	additional	dimension	acquired	from
1s.	Both	numbers	are	helpful	to	society,	and	together	they	become	great	helpers
of	mankind.
Number	4	and	Number	2
Number	4	and	number	2	are	both	even	numbers,	but	in	astrology	they	are
enemies,	since	they	are	ruled	by	Rahu	(4)	and	the	Moon	(2).	Number	4	people
produce	obstacles	in	the	paths	of	2s	and	are	detrimental	to	their	growth.	Number
2s	who	have	4	as	a	name	number	or	destiny	number	suffer	from	obstacles	and
difficulties.	Twos	are	too	moody	and	emotional,	and	4s	are	intolerant.	Both	are
numbers	of	constant	changes.	Changes	in	4s	are	sudden	and	unexpected,	which
creates	psychological	problems	for	2s.	Therefore	4s	should	not	select	2s	for
marriage	or	business	partnership.	Since	2s	are	not	harmful	for	4s,	they	can	select
2s	for	friends.	The	number	2	is	also	good	for	appointment	dates	or	residence
numbers.
Number	4	and	Number	3
Number	3s	are	neutral	toward	4s,	though	4s	are	enemies	of	3s.	Since	4s	are	static
and	3s	are	dynamic,	their	friendship	benefits	the	4s.	Number	3	people	are	good
advisers	to	4s,	and	if	this	advice	is	followed	4s	gain	strength.	This	friendship
helps	4s	grow	and	develop.	The	number	3	is	a	friendly	number	and	universal
helper,	so	4s	are	benefited	by	this	friendship,	business	partnerships,	etc.	Number
4	women	can	select	number	3	men	for	marriage,	but	the	reverse	is	not	true.
Number	3	women	can	understand	and	sympathize	with	the	problems	of	4s,	and
give	them	positive	energy	to	cure	their	doubting	nature.	Because	3s	inspire
people	and	have	a	wide	circle	of	friends,	they	can	also	save	4s	from	isolation	and
depression.
Number	4	and	Number	4
Similar	poles	repel	each	other	and	like	numbers	usually	do	not	make	an	ideal
combination.	Two	number	4s	are	thus	not	very	beneficial	to	each	other,	although
they	never	cause	each	other	harm.	Two	psychic	number	4	people	can	become
good	friends,	but	when	together	they	become	more	inert,	inactive,	and	static.
Although	they	cannot	make	ideal	life	partners,	friends,	or	business	partners,	they
can	still	survive	together.	But	the	doubting	nature	of	both	brings	more	difficulties
and	causes	problems	in	planning	for	future.	For	marriage,	4s	should	select	4s
born	on	a	Sunday	during	the	favorable	periods	(between	March	21	and	April	28
or	between	July	10	and	August	20).	The	destiny	number	and	name	number	of
these	two	4s	should	also	be	compatible	with	each	other.	Fours	can	select	4s	as
appointment	dates	or	residential	numbers.
Number	4	and	Number	5
Number	5	is	ruled	by	Mercury.	This	makes	number	5	people	unstable	by	nature
and	very	dependent.	The	friendships	are	not	very	fruitful	for	the	number	4
people.	This	is	because	5s	are	childlike	and	number	4s,	who	cannot	give	them
the	attention	they	need,	slowly	lose	interest	in	the	friendship.	Number	5	people
are	dynamic,	but	they	need	energy	from	others;	4s	do	not	provide	that	energy.
They	do	not	have	bad	feelings	toward	each	other	and	can	survive	together,	but
their	friendship	is	not	mutually	beneficial.	Number	4s	are,	therefore,	advised	to
select	5s	for	appointment	dates,	residential	numbers,	casual	friendships,	but	not
to	enter	into	a	marriage	or	business	partnership	with	them.
Number	4	and	Number	6
Numbers	4	and	6	are	harmonious.	Number	4s	are	easily	attracted	to	6s,	but	their
long-term	relationship	brings	the	4s	utter	dissatisfaction.	Sixes	do	not	provide
any	guidance	to	4s,	because	6s	are	ruled	by	Venus,	which	makes	them	slow	and
sometimes	lazy.	They	cannot	work	hard	like	4s.	Both	numbers	spend	money
freely	and	unnecessarily.	If	they	work	together	in	business,	they	cannot	earn
enough	to	meet	their	expenses.	Sixes	are	slow	and	lack	steadiness	and	patience,
while	number	4s	are	just	the	opposite—too	quick.	Number	4s	cannot	plan	their
future	because	of	the	sudden	and	unexpected	changes	that	quite	frequently	come
into	their	life.	Since	6s	like	to	plan	things	ahead	of	time,	this	creates	problems	in
a	business	partnership.	Both	4s	and	6s	have	to	live	alone	several	times	in	their
lives.	It	is	difficult	for	this	combination	to	work	together,	but,	as	mentioned
earlier,	4s	are	attracted	to	6s	and	can	enjoy	their	friendship.	Number	6	people	are
generally	uncommitted	and	have	sexual	relationships	outside	their	marriage;	this
is	a	little	difficult	for	4s	to	handle.	Also,	since	4s	are	not	blessed	with	good
domestic	lives,	their	selection	of	a	6	as	a	life	partner	may	not	be	very
harmonious.	However,	a	number	4	man	can	marry	a	number	6	woman,	if
necessary,	and	they	can	have	a	few	wonderful	years	of	marital	life.	A	number	4
can	select	a	6	as	an	appointment	date	or	residence	numbers.
Number	4	and	Number	7
Number	7	and	number	4	are	two	sides	of	the	same	energy.	Number	7	is	ruled	by
Ketu—the	dragon’s	tail	or	south	node	of	the	Moon.	Rahu,	which	rules	number	4,
is	known	as	the	dragon’s	head,	or	north	node	of	the	Moon.	They	are	180	degrees
apart	and	so	they	view	things	from	totally	different	perspectives.	Number	4s	are
aggressive,	7s	are	passive.	Astrologically,	they	are	friends.	As	the	body	works
for	the	head,	so	number	7	natives	work	for	4s	and	can	spend	energy	on	them
without	feeling	bad.	Number	7s	are	good	friends,	business	partners,	and	life
partners	for	4s.	The	relationship	is	even	more	enjoyable	when	the	7	is	a	woman
and	the	4	a	man.	In	a	business	partnership,	the	business	can	run	very	well	if	the	7
invests	the	money	and	the	4	carries	out	the	practical	work	of	the	business.	They
complement	each	other;	yet	the	head	rules	over	the	body.
Number	4	and	Number	8
Number	8	is	a	quiet,	calming,	and	peace-giving	number	for	number	4.	Both
numbers	are	even	and	thus	static.	However,	since	4	is	an	active	number,	its
combination	with	8	does	not	bring	inertness	or	passivity.	Both	numbers	are
lawbreakers,	unconventional,	and	rebellious.	Both	numbers	are	helpers	of	the
poor	and	suffering.	If	they	are	interested	in	politics,	they	form	a	strong
opposition	camp	and	fight	for	human	rights	and	freedom.	Number	8s	are	good
for	4s	in	friendship,	business	partnership,	and	marriage.	The	relationship	works
much	better	if	8	is	a	man	and	4	a	woman.	While	8	provides	the	basic	security,	the
4	can	develop	its	own	virtues.	Number	8	is	a	powerful	number	and	its	natives
gain	material	wealth	and	success	in	the	latter	half	of	their	lives.	Fours	are
successful	only	in	the	latter	part	of	their	lives.	In	the	beginning,	both	numbers
have	to	face	opposition,	difficulties,	delays,	and	hard	struggles,	but	the	last	half
of	their	life	becomes	good.	Number	4s	are	advised	to	select	8s	for	friendship,
business,	and	life	partnership.	They	should	avoid	the	number	8	for	a	name
number,	for	appointment	dates	related	to	an	important	job,	or	for	residential
numbers	to	avoid	difficulties	and	delays.
Number	4	and	Number	9
Number	9	is	ruled	by	Mars,	an	enemy	of	number	4.	Number	9	is	social	by
nature,	and	number	4	is	less	so.	Their	friendship	benefits	number	4.	Number	9
natives	are	honest	and	hard	working,	but	fighters	by	nature;	4s	are	enemies	of	9s
and	have	great	endurance.
Number	9s	are	strong	enough	not	to	feel	challenged	by	the	criticism	of	4s.
Number	4s	encourage	9s	to	engage	in	more	activity,	which	helps	9s	to	develop
their	creative	abilities.	On	the	other	hand,	9s	help	number	4s	to	develop	strong
willpower	and	to	remove	their	doubts	and	confusion.	Thus	these	numbers	are
beneficial	in	friendship	and	business	partnerships.	In	marriage,	4s	are	advised	to
avoid	marrying	9s,	especially	if	the	9	is	a	woman	and	the	4	a	man.	If	necessary,	a
number	4	woman	can	marry	a	number	9	man.

Mercury	and	Number	5
Mercury	is	the	ruling	planet	of	people	born	on	day	5,	14,	or	23	of	any	month,	or
whose	destiny	or	name	number	adds	up	to	5.	The	qualities	of	Mercury	described
below	are	most	clearly	visible	in	people	who	have	5	as	a	psychic	number.
Mercury,	the	smallest	planet	in	our	solar	system,	is	famous	for	being
associated	with	quick	response,	changeable	character,	ready	wit,	and
restlessness.	It	is	also	known	as	an	evergreen	planet—the	planet	that	is	always
young.	Its	Sanskrit	name,	Kumar	(youthful),	indicates	its	youthful	and	princely
nature.	It	is	also	called	Buddha	in	Sanskrit,	a	planet	of	buddhi,	which	literally
means	intellect	and	ready	wit	or	pratiuttapanna	mati.
It	is	related	to	the	respiratory	system,	the	nervous	system,	speech,	education,
and	intelligence.
It	is	neutral	in	gender	and	is	regarded	as	a	cold	and	moist	planet.	In	the	Hindu
system,	Earth	is	its	element	and	it	is	a	merchant	by	nature.	This	merchant-like
nature	of	Mercury	makes	it	take	risks	and	gamble—a	planet	of	extremes.	On	the
one	hand,	the	Mercury-dominated	natives	are	lovers	of	physical	comforts	and
money-minded	and,	on	the	other,	they	do	not	care	for	money	or	physical
comforts.
Although	Mercury	is	regarded	as	a	benefic	and	auspicious	planet,	it	makes	its
natives	suspicious,	serious,	cunning,	and	sometime	deceitful.	Mercury	natives
are	witty	and	lovers	of	humor	and	entertainment.	They	are	manipulative,	wise,
delicate,	attractive,	and	fond	of	travel	and	adventure.	They	are	born	orators,
although	they	are	scientific	in	their	approach.	They	are	also	lovers	of	the	fine
arts,	soft-spoken,	doubting,	fragile,	and	tenderhearted.	They	are	easily	attracted
to	the	study	of	astrology,	numerology,	palmistry,	physiognomy,	graphology,	and
psychology	because	they	want	to	know	about	themselves	and	others	as	clearly	as
possible.	They	are	materialistic,	rational,	analytical,	and	critical	by	nature;	and
they	love	modern	ideas.
Mercury,	a	planet	of	mixed	temperament,	has	a	dual	nature.	It	makes	its
natives	think	of	both	pros	and	cons	at	the	same	time.	Its	natives	are	learned	and
scholarly	people	and	enjoy	the	company	of	like	people.	Mercury	is	the	only
planet	that	is	exalted	in	its	own	sign.
Mercury	is	friendly	with	the	Sun,	Venus,	Rahu,	and	Ketu.	Saturn,	Mars,	and
Jupiter	are	neutral	toward	it	in	friendship.	Mercury	feels	enmity	toward	the
Moon,	but	this	feeling	is	not	mutual.
NUMBER	5
Psychic	Number	5
These	natives	have	gentle	and	fragile	characters	and	are	elevated	thinkers.	They
are	scholars	by	nature	and	are	trying	to	learn	every	minute.	Their	active	brains
are	always	engaged	in	thought.	They	love	amusement	and	try	to	become	jovial
and	create	a	happy	atmosphere	around	them.	This	sometimes	consumes	a	lot	of
their	energy,	since	nobody	can	make	everybody	happy.	But,	as	they	are
interested	in	winning	the	favor	of	others,	they	spend	all	their	energy	and	use	all
their	resources	to	make	others	happy.
They	are	quick	in	their	decisions	and	impulsive	in	their	behavior.	They	love
change	and	do	not	make	long-range	plans	(which	call	for	patience),	although
they	are	always	busy	planning	new	ways	to	make	money.	Because	they	are
endowed	with	a	facility	for	speculation	and	are	willing	to	run	risks,	they	invent
new	ways	to	make	money	quickly	and	avoid	long-term	plans.	Their	willingness
to	risk	makes	them	gamble;	and	if	they	really	do	so,	they	may	gain	wealth	in	this
way.
They	have	youthful	and	fertile	brains	with	mature	thoughts,	which	make	them
unique	and	attractive.	They	can	develop	friendships	very	easily	and	quickly	with
any	number,	but	because	they	are	unstable	by	nature,	the	friendships	do	not	last
very	long.	They	often	break	friendships	very	easily	during	their	weak	period;	at
such	times,	they	are	deceived	by	and	lose	faith	in	their	friends	and	feel	lonely.
Psychic	number	5s	are	very	intuitive	by	nature.	They	can	accurately
understand	the	intent	of	any	person	who	visits	them	and	can	easily	see	the
maneuvers	of	their	partners	and	colleagues.	They	give	answers	to	questions
before	the	person	asking	finishes.	Often	they	say,	“I	know	what	you	mean”
because	they	understand	intuitively	the	essence	of	what	is	being	said.
They	are	very	adaptable	and	can	bear	any	tragedy	and	calamity	with	a	smile
on	their	face.	However,	they	are	not	very	flexible	in	their	own	homes	and	do	not
like	people	to	touch	or	change	the	order	in	which	they	have	things	arranged.
With	children,	they	are	like	a	child;	with	young	persons,	a	revolutionary	and
progressive	youth;	and	with	wise	elderly	people,	wise.
They	are	brilliant	logicians—openness	and	eloquence	render	their	opponents
helpless.	They	can	befriend	their	opponents	and	convert	them	to	their	own	point
of	view.
They	are	able	to	impress	people	by	their	attractive	and	charming	personality,
progressive	ideas,	adaptability,	clarity	of	expression	and	logic,	positive	and
optimistic	attitude,	and	jovial,	youthful	nature.
They	are	spendthrifts	by	nature,	but	sometimes	they	become	extravagant.
Although	their	financial	condition	fluctuates,	they	are	able	to	save	money,	which
they	can	use	during	their	hard	times.	They	are	generally	lucky	in	getting	money
whenever	they	need	it.
They	do	not	earn	through	one	source	only.	They	cannot	sit	idle	and	love	to
invent	methods	to	make	money	quickly.	They	always	invest	money	in	business;
and,	because	of	their	speculative	nature	and	willingness	to	take	risks,	they
ultimately	become	successful	in	business.	They	are	reliable	partners.
They	are	time	conscious—they	value	their	own	time	and	are	always	in	a	hurry.
They	are	fond	of	fine	arts,	especially	poetry—they	can	and	do	express	their
ideas	in	a	very	poetic	way.
They	have	a	flexible	character	and	change	easily,	but	they	do	not	like	to
change	their	way	of	working,	which	is	very	distinctive.
They	are	travelers	by	nature	and	broaden	their	experience	and	knowledge
through	their	journeys,	both	in	their	own	country	and	in	distant	lands.	They	like
to	live	in	foreign	lands	away	from	their	families,	to	enjoy	life	and	learn.
Those	psychic	number	5	people	born	on	the	twenty-third	of	any	month	are
luckier	than	those	born	on	the	fifth.	Those	born	on	the	fourteenth	of	any	month,
however,	are	less	fortunate.	They	have	to	face	many	obstacles	and	difficulties
and	much	opposition	in	their	family	life,	although	they	are	able	to	achieve
success	in	the	material	world	rather	quickly.	Psychic	number	5	people	born	on
the	twenty-third	are	helped	by	their	relatives,	superiors,	government	officials,
politicians,	and	those	in	authority.	Those	born	on	the	fifth	of	any	month	are
obstinate,	hard	working,	independent,	reliable,	self-made,	and	lucky	in	love.
They	spend	their	old	age	in	peace	with	reasonable	comforts	of	life.	They	remain
youthful	and	attractive	into	their	old	age	and	always	have	helpers	around.
Although	they	believe	in	fate	and	destiny,	they	praise	the	law	of	karma	and
work	constantly.	However,	they	know	that	fate	is	more	important,	and	they	are
lucky	enough	in	their	life	to	get	whatever	they	want	by	chance.	If	they	gamble,
they	multiply	their	money	two	or	three	times;	and	they	do	not	regret	their	losses.
They	live	on	their	nerves	and	love	excitement.
They	are	not	influenced	by	any	kind	of	preaching.	They	appreciate	traditional
beliefs	but	do	not	become	mystical.	They	remain	independent	thinkers,	open	to
new	ideas.	They	love	the	company	of	learned	and	wise	people,	as	well	as	young,
progressive,	and	modern	people.
They	are	very	cautious	about	their	health	and	careful	in	selecting	foods	they
need.	They	are	quite	conscious	about	their	physical	appearance.	Although
fragile,	they	have	strong	builds	and	remain	healthy	and	active	into	their	old	age,
usually	living	long	lives.
As	Mercury	is	exalted	in	its	own	sign,	Virgo,	two	psychic	number	5	people	are
the	best	friends.
Psychic	number	of	5	women	are	more	attractive,	impressive,	gentle,	soft
spoken,	and	fragile	than	psychic	5	men.	They	are	career	conscious	and,	through
their	hard	labor	and	pleasing	manners,	build	magnificent	careers	for	themselves.
They	can	receive	benefit	by	marrying	young.	It	becomes	difficult	for	them	to
find	real	friends	and	true	mates	later	in	life.	They	can	easily	attract	people;	but,
because	they	are	very	cunning,	overly	selective,	and	diplomatic	but	superficial	in
handling	members	of	opposite	sex,	they	have	difficulty	choosing	a	good
husband.	Only	a	few	men	can	qualify	for	the	role	as	their	husband.	When	they
are	associated	in	business	or	otherwise	with	men,	they	make	financial	and	social
gains.	They	execute	their	duties	so	perfectly	that	they	get	proper	recognition	and
are	beyond	criticism.
Precautions	for	Psychic	Number	5
These	precautions	are	helpful	to	number	5	natives	during	their	weak	periods.
They	should	not,	in	any	case,	lose	their	natural	sense	of	humor	and	jovial
nature.
They	should	not	use	bitter,	pungent,	or	sharp	language	when	angry.
They	should	stop	being	overly	critical	at	all	occasions.
They	should	avoid	stress	and	strain	on	their	heart	and	nerves.
They	should	keep	the	company	of	children	and	not	stay	away	from
amusement.
They	should	stop	hurrying	all	the	time.
They	should	stop	straining	their	eyes	by	either	reading	at	night	or	watching
TV,	films,	and	other	performances.
They	should	avoid	misjudging	people	and	instead	create	faith	in	their
friends	and	well-wishers.
They	should	overcome	irritation	and	brooding.
They	should	do	exercises	to	develop	self-confidence,	tranquility	of	mind,
calmness,	and	strength	in	their	heart.
They	should	develop	more	patience	toward	their	family	members	and
friends.
They	should	avoid	being	fatalistic.
They	should	try	to	become	less	obstinate.
Number	5	natives	are	advised	to	avoid	the	following:
Excess	salt	if	they	have	problems	with	their	heart	or	blood	pressure.	(If	they
are	not	troubled	by	any	kind	of	heart	or	skin	ailments,	they	should	use	more
salt.	They	are	advised	to	use	more	salt	during	the	growth	periods	of
childhood	and	adolescence.)
Exposure	to	cold.
Forcing	their	ideas	on	others.
Giving	false	hope	and	making	false	promises	to	others.
Trusting	strangers	and	being	inattentive	while	traveling.
They	should:
Take	good,	long	morning	walks.
Drink	more	juices	and	be	conscious	about	the	purity	of	their	blood	since
they	are	easily	susceptible	to	skin	diseases	and	heart	troubles.
Make	small	trips,	stay	happy,	avoid	the	company	of	unsuccessful	and
pessimistic	people.
Listen	patiently	to	the	opinion	of	others.
Massage	their	bodies	with	almond	oil	at	least	once	or	twice	a	week	to
strengthen	their	nerves	and	enhance	circulation.
Do	manual	labor	or	gardening	to	relieve	their	overactive	brains.
Enter	into	business	partnerships	or	life	partnerships	with	numbers	5,	1,	3,	or
9.
Develop	contacts	with	prominent	people,	without	any	selfish	motive.
Learn	to	be	content,	to	honor	their	friends,	and	to	appreciate	others
Destiny	Number	5
Five	is	the	best	destiny	number	for	psychic	number	5	people;	they	become	very
strong,	obstinate,	independent	(but	dependable),	lucky,	wise,	attractive,	and
impressive.
A	psychic	number	of	6	is	also	very	suitable	for	destiny	number	5	people,	who
become	self-sufficient	in	the	early	part	of	their	life.	These	people	can	solve	their
own	problems,	make	good	businesses,	and	create	a	good	and	inspiring
atmosphere	among	their	colleagues	and	business	partners.	A	psychic	number	6	is
slow	in	making	decisions,	while	a	destiny	5	is	quick.	This	balance	of	speed	and
caution	makes	their	decisions	valuable	in	whatever	business	they	do.
Five	is	a	good	destiny	number	because:
It	brings	gentleness,	kindness,	wisdom,	intuition,	insight,	happiness,
alertness,	and	good	luck.
It	brings	wealth	through	the	lottery,	inheritance,	and	risks	taken	in	business.
It	makes	its	natives	logical,	rational,	and	systematic.
It	gives	them	the	power	to	speculate	and	progress	in	the	material	field;
sometimes	it	makes	them	pioneers—discoverers	and	inventors	in	their	field
of	work.
It	provides	them	with	favors	from	the	government,	people	in	authority,
political	leaders,	friends,	and	relatives.
It	brings	them	recognition	for	contributions	in	their	field	of	work.
It	makes	them	versatile,	impressive,	attractive,	and	naturally	optimistic.
It	brings	them	change	in	their	work	and	living	situations.
It	brings	them	good	luck	in	love	affairs.
It	makes	them	live	in	foreign	lands	for	long	periods	of	time.
Five	is	a	good	destiny	number	for	all	numbers	except	for	psychic	number	2s
and	7s.	It	is	most	suited	for	publishers,	writers,	lawyers,	critics,	politicians,
businessmen,	actors,	scholars,	orators,	storytellers,	entertainers,	sculptors,	and
astrologers.
Name	Number	5
Five	is	also	a	good	name	number.	It	makes	its	natives	progressive,	jovial,	and
alive;	it	gives	them	popularity	and	positive	vibrations.	This	name	number	is
especially	beneficial	when	the	destiny	number	is	5	also;	then	it	brings	its	natives
great	material	success	and	fame.	Their	name	continues	to	be	remembered	even
after	death.
Name	number	5	is	not	good	for	people	with	a	psychic	or	destiny	number	of	2
or	7,	or	those	with	a	destiny	number	of	4.	The	number	2	becomes	more	unstable
with	a	name	number	5.	Number	7	earns	a	bad	name.	And	number	4	faces	more
and	more	difficulties	because	5	is	a	number	of	communication	and	4	does	not
like	to	communicate.
Name	number	5	is	very	favorable	for	writers,	poets,	businessmen,	bankers,
sportsmen,	publishers,	journalists,	doctors,	actors,	politicians,	and	those	in	the
communications	business.
BALANCING	INTERNAL	AND	EXTERNAL
ENVIRONMENTS
By	observing	fasts,	using	the	proper	spices	and	gem	powders,	meditatingon	the
mantras,	and	using	the	yantras,	one	can	balance	the	internal	environment.
Balancing	the	external	environment	is	possible	by	choosing	the	right	time	for
activities	(in	the	ascending	cycle	or	descending	cycle),	selecting	good	friends
(finding	compatible	numbers),	and	starting	a	job	at	the	appropriate	time
(observing	weak	period	and	strong	periods).	Balance	is	achieved	by	working
with	the	energy	flow	that	is	already	available,	as	described	in	the	sections	that
follow.	The	information	that	follows	applies	to	people	with	psychic	number	5.
Weak	Periods
Number	5	people	often	feel	weak	and	sad,	because	their	ruling	planet	Mercury	is
frequently	retrograde.
They	can	feel	weakness	and	a	lack	of	interest;	sick;	a	lack	of	joy,	humor,	and
inspiration;	a	setback	in	their	health,	overly	sensitive,	and	overly	worried;	or
they	can	suffer	from	financial	Joss	and	debt	during	the	months	of	May,
September,	and	December.
During	these	months,	they	can	feel	deceived	by	their	friends	and	partners,
lonely,	withdrawn,	suspicious,	doubting,	and	obstinate.
Strong	Periods
Their	strong	periods	are	between	May	21	and	June	20	and	between	August	21
and	September	20.
These	periods	are	beneficial	for	undertaking	new	jobs,	making	new	contracts
or	promises,	finishing	jobs,	and	looking	for	better	housing	or	work.
Good	Dates
Days	5,	14,	and	23	of	any	month	are	good	dates,	especially	when	these	dates	fall
within	their	good	periods.
Good	Days
Wednesday	and	Friday	are	good	for	number	5	people.	If	these	days	fall	on	day	5,
14,	or	23	of	any	month,	they	become	more	beneficial.
Favorable	Colors
Number	5	natives	are	advised	to	use	all	shades	of	green,	turquoise,	light	shades
of	brown,	smoky	grey,	and	white.	They	should	use	these	colors	in	their	clothing,
pillows	and	cushion	covers,	curtains,	tablecloths,	bed	sheets,	etc.	They	should
also	keep	a	handkerchief	of	any	shade	of	green,	grey,	or	white;	these	colors	are
pleasing	to	their	eyes.	Whenever	they	feel	uneasy,	they	can	wash	their	hands,
face,	and	eyes,	and	dry	their	face	and	hands	with	it	for	refreshment	and	energy.
Precious	Stones
An	emerald	of	three	carats,	set	in	a	ring	with	open	back,	should	be	worn	on	the
little	finger.	The	emerald,	or	its	substitute	stone,	should	be	bought	on	a
Wednesday	and	given	to	the	jeweler	on	the	same	day.	It	should	be	picked	up
from	the	jeweler	on	a	Wednesday	and	worn	after	the	proper	rituals	have	been
performed.
They	should	take	emerald	powder	to	help	their	bodies	heal	electrochemically.
Meditation
They	should	meditate	on	Lakshmi,	the	goddess	of	wealth,	peace,	and	prosperity.
If	this	is	not	possible,	they	should	meditate	on	an	emerald,	or	the	substitute
gemstone.
Deity
Their	deity,	Mahalakshmi,	sits	on	a	pink	lotus	in	blue	water	in	the	lotus	posture.
She	has	four	arms.	With	one	right	hand,	she	is	blessing	her	devotees;	with	the
other,	she	holds	a	water	pot	containing	holy	water,	the	elixir.	With	one	left	hand,
she	holds	a	lotus	flower;	with	the	other,	she	pours	out	gold	coins,	giving	wealth.
Mantra
Japa1
(repetition)	of	the	mantra	of	any	planet	should	be	completed	within	the
ascending	cycle	of	the	moon	and	should	be	repeated	the	prescribed	number	of
times.
AUM	MAHALAKSHMAYE	VIDMAHE
VISHNU	PRIYAYE	DHI	MAHI
TANNO	LAKSHMI	PRACHODAYAT
Number	5s	should	recite	the	above	mantra	as	many	times	as	possible	at	the
time	of	their	meditations.	It	will	bring	them	all	kinds	of	material	and	spiritual
benefits	and	strengthen	their	willpower.
Yantra	for	Mercury2
Health	and	Diseases
Diseases	linked	with	Mercury	are	chronic	dysentery,	constipation,	gastric	pain,
gastritis,	indigestion	caused	by	weak	stomach	fire,	kidney	problems,	restlessness
of	mind,	and	fear	of	evil	spirits	and	ghosts.
Number	5	people	are	also	susceptible	to	the	flu,	colds	and	coughs,	skin
problems,	nervous	breakdowns,	headaches,	a	weak	memory,	blood	pressure
problems,	and	ailments	of	the	heart.
Fasting
They	are	advised	to	fast	on	full	moon	days.	If	they	are	born	on	a	Wednesday,
they	should	fast	on	Wednesdays	as	well.
Friendship
In	addition	to	number	5,	their	best	friend,	numbers	1,	3,	and	9	are	also	suitable
numbers	for	friendship.
Romance
For	marriage	and	romance,	they	should	select	men	or	women	born	between	May
21	and	June	21	or	between	August	21	and	September	20.	The	psychic	number	of
their	mates	should	be	either	1,	3,	5,	or	9;	psychic	number	1	natives	are	very
suitable.
Good	Years	in	Life
The	5th	year,	the	14th,	23rd,	32nd,	41st,	50th,	59th,	68th,	77th,	and	86th	are	the
best	of	their	lives;	also	all	years	that	add	up	to	the	number	1—the	1st,	10th,	19th,
28th,	37th,	46th,	55th,	64th,	73rd,	82nd,	and	91st—are	very	favorable.
NUMBER	5	PEOPLE	IN	RELATIONSHIP
The	information	given	below	is	based	upon	a	comparison	of	psychic	number	5s
to	other	psychic	numbers.	It	can	also	be	used	to	compare	destiny	5s	to	other
destiny	numbers,	and	name	5s	to	other	name	numbers.	(The	comparisons	are
based	upon	like	categories.)
Number	5	and	Number	1
Number	5	and	1	are	friendly	numbers.	Ones	bring	good	luck,	expensive	gifts,
and	social	status	to	5s,	but	5s	do	not	accept	their	influence.	Although	5s	are
always	helpful	and	good	friends	to	Is	in	time	of	need,	they	are	never	influenced
by	them.	Number	5s	help	Is	gain	social	status	and	achieve	financial	gain	because
of	their	speculative	skills	and	systematic	methods.	But,	since	both	are
independent	in	nature,	a	number	1	man	does	not	prove	to	be	a	good	husband	to	a
number	5	woman.	However,	a	number	1	woman	can	be	a	good	wife	to	a	number
5	man.	In	business,	number	1s	are	not	good	partners	for	5s,	but	5s	are	good
partners	for	any	number,	including	1s.	In	the	political	and	social	fields,	both
numbers	can	work	together	with	much	success.	These	numbers	make	a
beneficial	combination,	and	they	should	rely	on	each	other.
Number	5	and	Number	2
Numbers	5	and	2	have	a	strange	relationship.	Although	2s	are	neutral	toward	5,
5s	do	not	feel	a	rapport	with	them.	Both	numbers	are	unstable	and	therefore
create	problems	for	each	other.	They	can	enjoy	each	other	only	while	performing
silly,	foolish	tasks.	Twos	become	very	funny	and	suggest	foolish	ideas	to	5s.
Twos	should	not	select	a	5	for	an	appointment	date	or	residential	number,	bank
account,	telephone,	or	license	plate	number.	Fives	are	attracted	by	2s,	but	soon
friction	develops	and	the	relationships	end.	Number	5s,	therefore,	should	not
enter	into	business	or	marriage	with	2s.
Number	5	and	Number	3
The	number	3	is	ruled	by	Jupiter,	which	is	neutral	to	Mercury,	the	lord	of	5s.
Number	3	natives	have	a	positive	influence	on	5s;	together	they	create	an
atmosphere	of	humor	and	joy.	They	help	each	other	and	enjoy	being	together.
Number	3	men	can	be	good	life	partners	to	number	5	women.	In	business	5s
always	gain	financially	from	3s,	who	in	turn	learn	the	secrets	of	accounting	and
good	business	from	5s.
Number	5	and	Number	4
Although	5s	are	friends	of	4s,	they	do	not	become	ideal	friends.	The	unstable
nature	of	a	5	creates	problems	for	a	4.	They	are	unsuitable	for	friendship,
marriage,	or	business	partnership,	unless	the	4	has	5	as	a	destiny	number.
Number	5	and	Number	5
Two	number	5s	become	powerful	together.	The	company	of	two	same	numbers
is	normally	fruitless,	but	not	so	with	this	combination.	They	reach	unexpected
heights	in	politics,	art,	and	business.	People	with	5	as	both	a	psychic	and	destiny
number	are	very	impressive,	attractive,	wise,	and	cunning.	They	have	strong
personalities,	whether	men	or	women.	Fives	are	good	for	each	other	in	every
respect,	be	it	friendship,	business	partnership,	or	marriage.	Fives	should	also
select	this	number	for	appointment	dates	or	residential	numbers.
Number	5	and	Number	6
Numbers	5	and	6	are	mutual	friends.	Sixes	are	slow,	and	5s	are	quick.	Sixes	put
the	reins	on	the	speedy	minds	of	5s	and	help	them	overcome	their	restlessness.
Sixes	are	beneficial	for	5s	in	friendship,	business	partnership,	and	marriage.
Number	5	natives	serve	as	good	therapists	or	physicians	to	6s.	Five	should	select
the	number	6	for	appointment	dates	and	residential	numbers.
Number	5	and	Number	7
Although	number	5	and	7	are	friendly,	they	do	not	act	as	such	for	long.	They	are
easily	attracted	to	each	other.	Number	5	natives	inspire	7s	in	many	ways,	but
always	in	the	wrong	direction.	When	they	are	together,	they	can	have
mischievous	and	malicious	thoughts,	but	they	cannot	be	of	practical	help	to	each
other.	Sevens	do	not	provide	positive	energy	to	5s	and	are	not,	therefore,	good
for	friendship,	business	partnership,	or	marriage.	As	life	partners,	5s	always	find
fault	in	7s	and	blame	them	for	all	family	problems.
Number	5	and	Number	8
Number	8	is	ruled	by	Saturn,	a	planet	neutral	to	Mercury	in	friendship.	Fives,
however,	feel	friendly	toward	8s.	This	combination	does	not	have	many
difficulties	as	friends.	But	8s	tend	to	neglect	5s,	which	makes	5s	not	cooperate
with	them	wholeheartedly.	Therefore,	5s	should	avoid	8s	for	friendship,	business
partnership,	or	any	important	venture—especially	marriage.	Unless	the	psychic
number	5	person	has	a	destiny	number	of	8,	they	should	not	select	8s	for
appointment	dates	or	residential	numbers.
Number	5	and	Number	9
Number	9	is	ruled	by	Mars,	an	enemy	of	Mercury.	Although	Mercury,	like
Saturn,	is	neutral	in	friendship	to	Mars,	9s	help	5s	in	activities	related	to
business,	money,	or	making	a	living.	Together	they	create	good	vibrations.	This
is	because	9s	are	ruled	by	Mars,	which	is	fiery	and	hot,	and	5s	are	ruled	by
Mercury,	which	is	cold	and	moist.	This	pair	of	opposites	works	very	well
together.	Number	9	functions	as	a	patient	spouse	and	guardian.
Fives	should	select	9s	for	friendship,	projects	of	mutual	interest,	and	business
partnership.	In	the	absence	of	a	good	number	5	husband,	number	5	women
should	select	a	number	1	or	3	for	her	husband,	with	9	as	the	last	choice.	With
this	combination	marriage	is	possible,	and,	if	they	are	spiritually	inclined,	it	can
be	long-lasting.	Fives	should	also	select	a	number	9	for	appointment	dates	and
residential	numbers.

Venus	and	Number	6
Venus	is	the	ruling	planet	of	people	born	on	day	6,	15,	or	24	of	any	month,	or	of
those	whose	destiny	number	or	name	number	totals	6.	The	Venus	qualities
described	below	are	most	clearly	visible	in	people	whose	psychic	number	is	6.
Venus,	commonly	known	as	the	morning	star,	is	the	most	radiant	planet	in	the
eastern	sky	before	sunrise.	It	can	be	seen	with	the	naked	eye	twice—before
sunrise	and	after	sunset.	According	to	astrology,	Venus	is	considered	a	benefic
planet	with	a	feminine,	watery	nature.	In	mythology,	Venus	has	two	different
images.	One	is	of	a	fair-complexioned	youth	who	is	an	embodiment	of	love	and
sensuality.	He	has	curly	hair,	attractive	eyes,	and	a	radiant	body.	He	is	an
outgoing	hedonist	and	gentle	by	nature.	The	other	image	is	that	of	a	teacher
(acharya)	of	the	antigods	(asuras)	in	which	he	has	white	matted	hair	and	a	big
beard.
Known	by	the	name	Shukra	(which	in	Sanskrit	literally	means	semen),	Venus
is	the	presiding	deity	of	semen,	of	the	sensuous	side	of	human	nature.	Venus
governs	the	refined	attributes,	romance,	beauty,	passion,	sexual	pleasure,	and
fine	arts,	like	music,	poetry,	dance.	It	also	governs	the	eyes,	throat,	chin,	kidney,
and	the	reproductive	system.
Venus	is	rajastic	(active)	and	gives	its	natives	an	active,	artistic,	sensuous,	and
passionate	nature.	It	makes	them	beautiful	and	bestows	upon	them	proportionate
and	attractive	bodies	(especially	the	upper	torso	and	upper	arms)	and	lotus-like
eyes.	Venus-dominated	natives	are	fair	complexioned,	and	they	usually	have	a
happy,	graceful	personality.	They	are	lively,	emotional,	sensitive,	playful,	loving,
courteous,	frivolous,	and	polite.	They	are	creative,	inventive,	and	are	interested
in	medicine,	alchemy,	Tantra,	hypnotism,	mesmerism,	and	the	fine	arts.
Venus	governs	the	adolescent	stage	of	life.	Its	influence	on	women	is	slightly
different	than	on	men.
Venus	is	a	friend	of	Mercury	and	Saturn.	Jupiter	and	Mars	are	neutral	in	their
friendship	with	Venus	(although	Venus	regards	Jupiter	as	an	opponent).	The	Sun
and	Moon	are	enemies	to	Venus.
Number	6	is	regarded	as	the	most	fortunate	of	all	numbers	from	1	to	9.	Those
6s	born	on	the	twenty-fourth	of	any	month	are	the	most	fortunate.
NUMBER	6
Psychic	Number	6
Six	is	the	psychic	number	of	those	born	on	day	6,	15,	or	24	of	any	month.	These
natives	are	magnetic,	youthful,	gentle,	soft-spoken,	luxury-loving,	artistic,	and
possessors	of	refined	taste.	They	attract	members	of	the	opposite	sex	easily	and
are	usually	loved	and	respected	by	them.
They	spend	freely,	are	social,	and	have	opportunities	to	meet	beautiful	people.
They	love	travel	and	of	ten	journey	to	foreign	lands.	They	are	always	busy.
They	are	overly	conscious	about	their	physical	appearance	and	try	to	dress	so
as	to	always	be	presentable.
They	dislike	ugliness,	dirtiness,	mismanagement,	and	disorder.	They	like	to
keep	their	dwelling	places	clean	and	orderly.	They	love	to	decorate	their	homes,
rooms,	offices,	or	places	of	work.
They	love	their	life	partner,	or	person	with	whom	they	live,	under	all
circumstances	and	try	to	please	them.	Their	married	life	is	ordinary,	but	orderly.
They	do	not	like	to	be	in	a	disturbed	environment	and	do	not	initiate
arguments.	If	someone	starts	to	battle	with	them,	they	run	from	the	field	and	are
always	ready	for	a	compromise.
Psychic	number	6	people	are	clever	and	tactful	and	are	able	to	learn	about	the
deeply	guarded	secrets	of	others	without	deliberate	effort.	They	think	before	they
act,	which	gives	them	a	slow	tempo.	But	they	like	their	habit	of	being	slow	and
they	believe	that	“slow	and	steady	wins	the	race.”	They	are	usually	upset	when
they	are	expected	to	move	quickly	and	spoil	a	task	by	making	mistakes.	They
want	to	remain	peaceful	and	do	not	like	any	interference	once	they	have	started
their	work.	They	also	do	not	like	anyone	to	act	against	their	will.	Yet	they	are	not
commanding	or	demanding;	they	can	keep	their	feelings	inside	and	hide	their
anger	under	attractive	smiles.
They	are	secretive	by	nature	and	can	keep	the	secrets	of	others,	never
revealing	them	to	anyone	else.
They	are	universal	friends	and	make	good	family	members.	They	are
considerate	and	kind	to	their	families	and	understand	the	joys	and	sorrows	of
their	kith	and	kin.	They	maintain	relationships	with	their	parents,	even	after	they
leave	the	home.	They	are	easily	touched	by	the	sorrow	of	their	parents	and	try
their	best	to	help	them.	They	trust	their	friends	and	family	members.
Because	of	their	refined	taste,	sweet	manners,	and	considerate	and	gentle
nature,	they	are	popular	in	their	circle	of	friends	and	become	everybody’s
favorite.	They	are	extravagant.
They	are	lucky	enough	to	get	all	the	luxuries	and	facilities	of	modern	living—
such	as	a	house	with	a	garden,	vehicles—before	the	age	of	forty-five.
They	love	company	and	cannot	live	alone	for	long.	There	is	a	big	difference
between	number	6	men	and	number	6	women.
Psychic	Number	6	Men
Psychic	number	6	men	are	youthful,	attractive,	and	magnetic;	they	are	expert	in
the	art	of	lovemaking.	They	are	skilled	in	influencing	the	psyches	of	women	to
attract	and	seduce	them.	All	their	lives,	they	search	for	beautiful	and	attractive
women	and	like	to	remain	in	their	company.	They	have	many	relationships	and
do	not	remain	bound	to	the	women	they	marry.	They	are	hedonistic	and
materialistic	in	their	attitudes.	They	are	against	discipline	and	are	incapable	of
maintaining	any	kind	of	spiritual	practice;	sometimes	they	can	be	religious,	but
mostly	they	are	not	so.	They	are	susceptible	to	venereal	and	seminal	diseases.
Psychic	Number	6	Women
Psychic	number	6	women	are	physically	beautiful,	symmetrical,	and	have
refined	tastes.	Their	love	is	a	kind	of	motherly	love.	During	adolescence,	they
are	mischievous,	playful,	and	sensual.	At	that	time	they	are	easily	drawn	toward
sexuality	and	enjoy	sexual	games;	after	twenty-five	they	tire	of	these	fruitless
games.	Withdrawing	from	sexual	adventures,	they	become	more	interested	in
their	careers	and	learning	how	to	live	happier	and	more	contented	lives.	They	are
usually	slow	and	very	temperamental.	They	are	fond	of	dresses	and	jewelry.
They	design	their	gowns	and	live	comfortably.	They	are	easily	attracted	to
learned,	artistic,	and	spiritually	inclined	people.	They	serve	their	family
members	and	parents	and	love	justice	and	truth.	They	are	dependable	and	do	not
run	from	their	responsibilities.	They	seduce	holy	men.
Psychic	number	6	men	and	women	have	few	friends,	and	they	live	alone	many
times	in	their	lives.	They	love	their	homes.
They	are	uncommitted;	they	love	freedom,	simplicity,	and	serenity	and	are	not
selfish.
They	are	unsteady	and	cannot	concentrate	on	any	one	subject	for	a	long	period
of	time.
They	are	very	lucky	and	get	help	and	guidance	throughout	their	life	from
unknown	sources,	foreigners,	and	people	in	authority.
Precautions	for	Psychic	Number	6	People
Number	6	people	should	avoid	laziness.	They	should	not	become	easily	agitated.
If	they	use	the	Ayurvedic	preparations	mukta	pishti	(pearl	powder)	or	prawal
pishti	(coral	powder)	with	a	teaspoon	of	cream	or	honey	before	retiring,	they
overcome	their	nervousness.	They	should	learn	to	judge	people	thoroughly
before	trusting	them.	Women	especially	should	learn	to	judge	others	before
entering	into	physical	or	financial	relationships.
They	should	avoid	arguments	and	not	expend	their	energies	explaining	their
behavior	or	ideas.
They	are	at	their	best	when	they	work	slowly;	they	should	avoid	rushing
because	it	makes	them	spoil	the	project.
They	should	avoid	getting	emotional	and	giving	undue	importance	to
members	of	the	opposite	sex.
They	should	avoid	hard	physical	labor,	because	their	constitutions	are	not
suited	to	such	jobs.
They	should	forgive	people	who	wrong	them	and	not	waste	their	energy
entertaining	thoughts	of	revenge.	Bearing	grudges	and	brooding	over	unpleasant
events	of	the	past	harms	their	nervous	systems.
They	should	avoid	the	use	of	intoxicants,	because	they	are	susceptible	to
addictions.
They	should	avoid	intimate	relationships	outside	of	their	marriages.
They	should	avoid	sweet	dishes,	oils	and	fats,	and	spicy	foods.
They	should	practice	pranayama	(breath	control	techniques,	prescribed	and
taught	in	Hatha	Yoga),	take	regular	morning	walks,	and	massage	their	bodies
three	to	four	times	a	week.
They	should	arrange	their	lives,	organize	their	schedules,	and	not	spend	too
much	time	doing	watersports	in	places	of	amusement.
They	should	save	money	for	their	hard	times.
Destiny	Number	6
As	stated	earlier,	6	is	not	a	good	destiny	number.	This	is	true	for	women
especially.	Destiny	6	creates	many	sexual	problems,	for	which	individuals	are
not	really	responsible.	It	makes	them	enter	into	unwanted	sexual	relationships.
When	6	is	a	psychic	number,	the	natural	inclination	toward	the	opposite	sex	is	in
the	psyche	and	can	be	accepted.	But	when	such	things	happen	by	chance,	almost
without	personal	involvement,	the	physical	relationship	seems	to	be	forced,	as	if
by	destiny.
Destiny	number	6s	get	all	comforts	and	luxuries	by	means	of	luck.	They	have
all	they	want,	but	they	cannot	find	suitable	life	partners	if	they	do	not	marry	in
their	early	years.
They	take	care	of	their	friends	and	relations	without	a	second	thought	and
have	to	work	hard	all	their	life	doing	so.
They	become	very	independent,	yet	remain	social.
They	are	good	conversationalists	and	good	storytellers.	They	travel	a	lot	and
enjoy	their	lives;	they	love	good,	tasty	food.
Destiny	6	people	are	more	sentimental	than	logical	and	have	a	tendency	to
brood	over	their	past.
They	do	not	accept	bondage	and	are	uncommitted;	they	break	laws	and	do	not
follow	traditional	religions.	They	get	interested	in	secret	sciences,	such	as
alchemy,	Tantra	(especially	the	left-handed	Tantra),	witchcraft,	and	black	magic.
They	are	dependable,	peace-loving,	romantic,	methodical	in	their	work,	and
can	serve	as	good	diplomats.	They	protect	the	interests	of	their	own	class.
Money	slips	from	their	hands.	They	are	generous	and	spend	lavishly	to
entertain	their	relatives	and	friends.
They	become	fond	of	collecting	beautiful	dresses,	perfumes,	cosmetics,
jewelry,	and	precious	stones.
They	remain	attractive,	charming,	and	youthful	until	their	old	age.	Women
especially	retain	their	glamour	for	a	long	time.
They	suffer	from	overwork	and	overindulgence	in	sexual	pleasure;	they	are
prone	to	venereal	diseases.
Name	Number	6
As	a	name	number,	6	is	most	suitable	for	poets,	artists,	musicians,	and	dancers.	It
imparts	a	friendly	quality,	which	makes	6s	easily	acceptable	and	popular.
This	name	number	is	also	good	for	those	interested	in	the	occult	sciences;	they
can	gain	magical	powers.
Name	number	6	makes	people	cooperative,	kind,	sympathetic,	hospitable,
charitable,	emotional,	and	unstable.	It	makes	them	sociable	and	lovers	of	idle
gossip.	They	are	easily	attracted	by	internal	and	external	beauty,	both	in	human
form	and	in	nature.
BALANCING	INTERNAL	AND	EXTERNAL
ENVIRONMENTS
By	observing	fasts,	using	the	proper	spices	and	gem	powders,	meditating	on	the
mantras,	and	using	the	yantras,	one	can	balance	the	internal	environment.
Balancing	the	external	environment	is	possible	by	choosing	the	right	time	for
activities	(in	the	ascending	cycle	or	descending	cycle),	selecting	good	friends
(finding	compatible	numbers),	and	starting	a	job	at	the	appropriate	time
(observing	weak	period	and	strong	periods).	Balance	is	achieved	by	working
with	the	energy	flow	that	is	already	available,	as	described	in	the	sections	that
follow.	The	information	that	follows	applies	to	people	with	psychic	number	6.
Weak	Periods
April,	October,	and	November	are	the	weak	periods	for	number	6	people.	Also,
whenever	Venus	is	retrograde,	they	have	problems	with	their	health,	receive	bad
news,	and	can	experience	mental	problems	or	obstacles	in	their	work.	They	can
feel	a	lack	of	courage,	inspiration,	steadiness,	and	patience.	They	become	proud,
discourteous,	obstinate,	argumentative,	jealous,	and	indecisive.	They	lose	their
common	sense	and	trust	everybody;	when	they	are	deceived,	they	get
emotionally	upset.
Strong	Periods
The	period	between	April	20	and	May	18	and	between	September	21	and
October	19	are	strong	and	favorable	for	number	6	people.	They	should	undertake
new	jobs,	make	new	contracts,	look	for	new	homes	(if	needed),	and	finish
incomplete	jobs	during	these	dates.	The	periods	between	April	20	and	April	30
and	between	October	1	and	19	are	especially	strong;	they	should	utilize	these
times	to	perform	actions	that	help	their	future	jobs.
Good	Dates
Days	6,	15,	and	24	of	every	month	are	favorable	for	number	6	natives.	Also	days
3,	9,	12,	18,	21,	27,	and	30	are	beneficial.
Good	Days
Wednesdays	and	Fridays	are	their	good	days.	If	these	days	fall	on	any	of	the
above-mentioned	dates,	they	become	more	beneficial.
Favorable	Colors
White	is	the	best	color	for	number	6s,	because	it	is	the	color	of	their	ruling
planet,	Venus.	Light	blue,	pink,	and	chrome	yellow	are	also	good	for	them.
(Chrome	yellow	is	associated	with	Jupiter,	and	since	Venus	is	exalted	in	Pisces
—a	sign	ruled	by	Jupiter—yellow	enhances	the	good	qualities	of	6s	and	makes
them	more	radiant.	A	number	6	woman	should	use	a	lot	of	pink.	On	important
occasions,	a	number	6	woman	should	wear	a	white	dress	for	success.	For	interior
decorating,	6s—male	or	female—should	use	as	much	white	as	possible,	such	as
white	bed	sheets	and	pillow	covers.	As	well,	they	should	always	carry	a	white
handkerchief	to	wipe	their	hands	and	face	when	they	feel	tired	or	weak.
Precious	Stones
Diamonds	are	the	favored	stone	for	number	6	natives,	because	it	is	associated
with	Venus.	In	case	they	cannot	afford	a	diamond,	they	can	use	white	sapphire,
white	zircon,	or	white	tourmaline.	The	diamond	should	be	bought	on	a	Friday
between	sunrise	and	11	A.M.	It	should	be	given	to	the	jeweler	and	set	in	a	ring,
with	an	open	back,	on	a	Friday.	It	should	be	picked	up	from	the	jeweler	on	a
Friday	and	worn,	after	proper	cleansing	and	rituals,	on	a	Friday	between	sunrise
and	11	A.M.
Sixes	should	take	white	tourmaline	powder	to	help	their	bodies	heal
electrochemically.
Meditation
After	the	morning	cleansing,	they	should	meditate	on	their	diamond	or	substitute
stone.
Deity
The	deity	of	number	6	natives	is	Kartike,	the	elder	son	of	Shiva.	Also	known	as
Skandha	and	Subramaniyam,	he	has	six	heads,	four	arms,	and	rides	on	a
peacock.	He	is	the	God	of	war.
Mantra
Japa1
(repetition)	of	the	mantra	of	any	planet	should	be	completed	within	the
ascending	cycle	of	the	moon	and	should	be	repeated	the	prescribed	number	of
times.	Although	it	is	difficult	for	number	6	natives	to	follow	spiritual	disciplines,
they	can	benefit	by	reciting	the	following	mantra	eleven	times	a	day.
AUM—JUNG,	HANG,	SA,	BHUR,	BHUVAN,	SWA,	KARTIKE	NAMAH,	SWA,
BHUVAH	BHUR,	SA,	HANG,	JUNG—AUM.
Yantra	for	Venus2
Health	and	Diseases
As	discussed	earlier,	number	6s	are	mucus-dominated.	They	can	have	problems
in	their	lungs,	such	as	congestion.	They	are	emotional	and	can	suffer	from	weak
nerves.	They	are	extremely	sensual	and	can	suffer	from	exhaustion	due	to
overindulgences,	seminal	troubles,	or	venereal	diseases.	They	can	also	develop
kidney	and	urinary	problems.	They	are	susceptible	to	the	cold.	Because	they	are
fond	of	sweets	and	spicy	and	oily	foods,	they	can	suffer	from	constipation.
Fasting
Fasting	on	Fridays,	and	abstaining	from	grains,	pulses,	and	sour	foods	on
Fridays	after	sunset,	is	beneficial	for	6s.
Friendship
Number	6s	are	in	harmony	with	1s,	3s,	9s,	and	other	6s;	they	can	also	get	along
with	2s,	5s,	and	7s.	Fours	and	8s	are	not	harmonious	numbers	with	them.	Ones
and	3s	make	ideal	friends.
Romance
Number	6	people	can	have	the	best	time	with	psychic	1s	and	3s.	A	number	6
woman	should	choose	a	psychic	1,	3,	or	6	for	romance	and	a	psychic	3	or	6	for
marriage.
Good	Years	in	Life
The	6th	year,	15th,	24th,	33rd,	42nd,	51st,	63rd,	69th,	and	78th	are	good	for
them.
Special	Note
For	6s	the	age	of	thirty-five	is	of	great	importance.	They	start	working	for	a
bright	career	in	the	early	years	of	their	life,	and	by	the	time	they	reach	the	age	of
thirty-five,	they	are	able	to	establish	themselves	quite	well.	By	the	time	they
reach	forty-nine,	they	achieve	their	maximum	potential	in	the	material	world;
they	hold	positions	of	high	responsibility	at	this	age.
NUMBER	6	PEOPLE	IN	RELATIONSHIP
The	information	given	below	is	based	upon	a	comparison	of	psychic	number	6s
to	other	psychic	numbers.	It	can	also	be	used	to	compare	destiny	6s	to	other
destiny	numbers,	and	name	6s	to	other	name	numbers.	(The	comparisons	are
based	upon	like	categories.)
Number	6	and	Number	1
•	Number	6	men	and	number	1	men
Number	6	and	number	1	men	become	friends	easily,	and,	if	they	are	in	politics,
they	can	benefit	each	other.	Number	6	men,	who	enjoy	life,	cannot	appreciate	the
idealistic	number	1s,	and	their	friendship	will	not	last	long.	This	combination	is
not	ideal	for	business	partnerships,	but	it	is	not	harmful	either.
•	Number	6	women	and	number	1	men
Number	1	men	prove	beneficial	and	helpful	to	number	6	women.	They	are	not
ideal	as	life	partners	or	business	partners.	Number	6	women	are	ideal	secretaries
for	number	1	men.
•	Number	6	men	and	number	1	women
Number	6	men	are	promiscuous	in	their	marital	lives,	whereas	number	1	females
want	honesty	in	marriage;	they	are	lovers	of	truth	and	believe	in	true
relationships.	For	this	reason,	they	do	not	make	good	life	partners.	In	business
partnerships,	number	1	women	do	not	trust	number	6	men	to	utilize	their	money
properly.	These	women	prefer	to	have	the	upper	hand	in	management	of	the
business.
•	Number	6	women	and	number	1	women
This	combination	makes	for	very	good	friends	who	try	to	please	each	other.	The
slow	tempo	of	a	6	gives	the	overbusy	1	a	breath	of	relief.	The	number	1	woman
tries	to	keep	a	friendship	with	the	number	6	woman	and	gives	her	precious	gifts.
In	general,	6s	and	1s	are	friendly.	Sixes	have	a	good	influence	on	1s.	Although
6s	are	a	puzzle	to	1s,	6s	understand	1s	very	clearly	and	can	influence	and	help
them.	Sixes	can	serve	1s	and	be	their	business	partners,	but	this	relationship	will
not	last	for	long.	It	may	last	somewhat	longer	if	they	do	not	stay	together	all	the
time.	This	partnership	works	better	if	they	meet	briefly	on	occasion	to	work,
travel,	and	to	organize	parties,	festivals,	meetings,	and	seminars	together.	Sixes
should	be	prepared	to	accept	the	authority	of	1s.
Number	6	and	Number	2
Number	6	and	number	2	can	be	good	friends.	Number	6s	help	the	growth	and
development	of	2s;	they	provide	them	with	peaceful	vibrations	and	good	advice
but	not	with	inspiration	for	work.	In	friendship,	2s	are	not	as	helpful	to	6s	as	6s
are	to	2s.	Number	6	should,	therefore,	avoid	2s	for	any	important	jobs.	In
business,	2s	are	more	beneficial	to	6.	For	marriage,	2s	are	not	suitable	for
number	6	men	or	women.
Number	6	and	Number	3
Numbers	3	and	number	6	are	harmonious.	Selecting	3s	brings	favorable	results
for	6s,	whether	it	be	in	friendship,	business	partnership,	or	life	partnership.	They
help	each	other.	This	combination	does	not	work	so	well	in	the	married	life	of
number	6	men.	This	is	because	a	number	3	woman	cannot	tolerate	her	husband
having	a	relationship	outside	of	the	marriage.	So	number	6	men	should	avoid
marrying	number	3	women,	but	the	reverse	combination	is	excellent.	Sixes
should	select	the	number	3	for	appointment	dates	or	residential	numbers.
Number	6	and	Number	4
Although	numbers	6	and	4	are	harmonious,	they	do	not	work	too	well	together.
Fours	upset	and	create	difficulties	for	6s,	yet	they	are	also	easily	attracted	to
them.	Number	4s	resist	learning	and	being	taught	by	6s.	Sixes	(women
especially)	should	avoid	4s	for	marriage	and	business	partnership	as	well	as	for
appointment	dates	and	residential	numbers.
Number	6	and	Number	5
Numbers	6	and	5	are	mutual	friends.	Fives	help	6s	with	psychological	problems
and	can	be	good	therapists	or	physicians	for	them.	Number	5s	have	a	positive
influence	on	the	physical	and	mental	health	of	number	6s,	while	6s	help	5s
overcome	their	shortcomings—their	restless	and	everchanging	mind.	Their
friendship	takes	them	to	unreachable	heights	in	politics	and	the	communication
arts	(T.V.,	film,	journalism,	etc.).	Marriage	between	a	number	6	woman	and	a
number	5	man	is	not	ideal,	but	the	reverse	combination	is	very	good.	Number	6s
can	enter	into	business	partnerships	with	5s	and	select	number	5	for	important
business	appointments	or	for	residential	numbers.
Number	6	and	Number	6
Two	6s	are	friends;	but	because	both	are	on	the	same	frequency,	they	do	not
inspire	each	other.	They	do,	however,	feel	great	satisfaction	whenever	they	come
together.	They	understand	each	other	very	well,	but	they	need	a	number	1,	3,	5,
or	9	native	to	inspire	them.	In	businesses	having	to	do	with	cosmetics,	fashion
design,	interior	design,	or	jewelry,	two	number	6	natives	can	work	very	tastefully
together	and	become	good	partners.	Marriage	between	them	will	not	be	ideal
because	they	cannot	inspire	each	other;	yet	they	make	a	good	family	together.
Sixes	should	select	the	number	6	for	appointment	dates	and	residential	numbers.
Number	6	and	Number	7
Number	6s	always	help	and	inspire	number	7s	but	the	reverse	is	not	true.	Sixes
help	7s	develop	their	dreamy	nature—the	number	7	represents	fantasies	and
intuition	while	6	is	worldly.	Sevens	are	original	in	their	way	of	expressing
known	truths.	This	is	a	little	annoying	to	6	because	7s	are	not	clear	in	this
expression	and	6s	like	clarity.	Although	6s	can	enjoy	the	company	of	7s	during
leisure	hours,	during	serious	business	transactions	6s	have	to	stay	away	from	the
fantasies	of	7s.	Also	6s	should	avoid	the	number	7	for	appointment	dates	and
residential	numbers.	This	combination	does	not	make	a	good	couple.	Marriage,
however,	can	work	when	the	7	is	a	man	and	the	6	a	woman.
Number	6	and	Number	8
Number	6s	are	always	beneficial	to	number	8s.	Sixes	inspire	8s	and	make	them
more	social	and	lighter.	Eights	are	otherwise	heavy	and	silent.	The	playfulness	of
6s	give	8s	a	taste	of	life,	who	start	taking	interest	in	its	luxuries	and	comforts.
Eights	become	more	creative	and	expressive	through	6s.	If	both	natives	are	in
politics,	art,	or	film,	they	achieve	success.	In	business,	6s	are	advised	not	to
invest	money	in	any	venture	started	by	8s.	However,	8s	can	join	6s	in	business
and	gain	financially.	In	marriage,	8s	are	not	good	for	6s.	If	necessary,	however,	a
number	6	woman	could	marry	a	number	8	man	and	enjoy	a	few	good	years	of
marriage.	Sixes	should	avoid	the	number	8	for	appointment	dates	and	residential
numbers.
Number	6	and	Number	9
These	numbers	always	benefit	each	other.	Both	numbers	are	multiples	of	3	and
form	a	good	combination.	In	friendships	and	in	business	partnerships,	they	are
mutually	beneficial—6s	carefully	guard	the	interests	of	9s,	while	9s	do	all	the
hard	work	needed	for	the	joint	venture.	In	music	and	other	fine	arts,	6s	and	9s
create	a	very	good	combination.	In	politics,	a	number	6	can	be	an	admirer,	a
follower,	a	public	relations	person,	and	a	good	systematic	planner	for	a	9.	This
combination	of	numbers	makes	a	good	couple.	They	love	each	other.	The	couple
is	ideal	when	the	9	is	a	man	and	the	6	a	woman.	A	6	should	select	a	number	9	for
appointment	dates	and	residential	numbers.

Ketu	and	Number	7
Ketu	is	the	ruling	entity	presiding	over	people	born	on	day	7,	16,	or	25	of	any
month,	or	whose	destiny	or	name	number	totals	7.	The	qualities	of	Ketu
described	below	are	most	clearly	visible	in	people	who	have	7	as	a	psychic
number.
Rahu	and	Ketu	are	two	half-planets	placed	180	degrees	apart—exactly
opposite—from	each	other.	They	are	the	two	nodes	of	Moon,	also	known	as	the
dragon’s	head	and	the	dragon’s	tail.	Rahu,	the	head,	has	already	been	discussed
on	page	75.	Now	we	will	explore	the	dragon’s	tail,	Ketu,	which	is	depicted	as	a
headless	torso	with	the	body	of	a	fish.	Although	Ketu	is	considered	malefic,	it	is
much	less	so	than	Rahu.	This	is	mainly	because	Ketu	is	considered	to	be	a
moksha-karak	(cause	of	liberation).	It	bestows	non-attachment	to	worldly	desires
and	spiritual	tendencies.	It	gives	wisdom,	the	power	of	discrimination,	and
psychic	abilities	to	its	natives.	Under	its	influence,	natives	become	highly
sensitive	and	emotional;	they	feel	aversions	toward	material	successes	and
become	disinterested	in	the	psychodrama	of	life.	They	feel	that	they	have	no
ambitions,	no	motivations.	They	become	interested	in	Gyana,	the	knowledge	of
the	self,	and	try	to	achieve	enlightenment	through	the	“true	knowledge.”
Ketu	is	neutral	in	gender	(although	some	astrologers	consider	it	to	be
feminine),	tamasic	in	nature,	and	destructive	and	disruptive	in	character.	It
makes	its	natives	inert.	It	is	powerful	at	night	and	easily	irritable.	When	Ketu	is
not	in	an	astrologically	favorable	position,	it	makes	its	natives	cripple.	They	lose
their	power	of	discrimination	and	become	crazy,	in	the	worldly	sense.
Sometimes	they	seem	to	be	possessed	by	evil	spirits	and	ghosts.	On	the	other
hand,	when	Ketu	is	favorable,	natives	acquire	the	power	of	healing	those
possessed	by	evil	spirits	and	ghosts.	It	makes	them	interested	in	the	healing	arts,
such	as	natural	healing,	Tantric	or	psychic	healing,	healing	through	witchcraft
and	the	occult	sciences,	healing	through	herbs,	foods,	spices,	sound	vibrations,
and	so	on.
Natives	ruled	by	Ketu	are	talkative;	they	love	discussions	and	debates	and
have	their	own	type	of	logic.	They	live	in	fantasies,	are	intuitive,	imaginative,
and	love	to	exaggerate.	They	are	shabby	in	appearance,	not	caring	for	their	outer
image.	Sometimes	they	are	well	dressed,	sometimes	not.	Their	outlooks	are
cosmopolitan;	they	accept	truths	from	all	religions	and	create	religions	of	their
own.
Ketu	rules	over	old	age.	It	gives	its	natives	a	wind-dominated	body	chemistry,
which	makes	them	restless.
Mercury,	Venus,	Rahu,	and	Saturn	are	Ketu’s	friends.	Jupiter	is	neutral	in
friendship,	and	the	Sun,	Moon,	and	Mars	are	its	enemies.	According	to	many
astrological	sages	in	India,	Rahu,	Ketu,	and	Saturn	have	become	more	influential
and	active	during	our	time,	that	is,	in	Kaliyuga	(the	present	era	of	darkness).
Therefore	knowledge	of	Ketu	and	Rahu	is	essential	for	all	those	who	work	with
the	predictive	sciences.
NUMBER	7
Psychic	Number	7
This	is	the	psychic	number	of	those	born	on	day	7,	16,	or	25	of	any	month.
Those	who	are	born	on	the	twenty-fifth	are	the	most	fortunate	of	all	7s.
Because	of	the	malefic	influence	of	Ketu,	psychic	7s	become	indecisive,
disruptive,	destructive,	restless,	revolutionary,	and	moody.	They	have	to	meet	so
many	failures	in	life	that	they	are	considered	unfortunate;	it	is	a	number	of
upheaval	and	revolution.	But,	this	is	actually	not	a	true	statement.	Failure	is	a
key	to	success.	Many	psychic	7s	are	renowned	poets,	artists,	thinkers,	arbitrators,
numerologists,	reformers,	and	scientists,	although	it	is	true	that	all	psychic
number	7s	need	more	attention	than	the	other	eight	psychic	numbers	and	also
need	correct	guidance.	Well-guided	7s	can	make	their	mark	in	life.
Psychic	number	7	people	are	truly	spiritual	and	religious.	They	are	kind
hearted,	social,	romantic,	sentimental,	and	noble	souls.	They	are	original	in	their
expressions	and	independent	in	their	approaches	to	life.	With	their	philosophical
outlook,	they	create	an	individuality	all	their	own.	They	give	new	updated
interpretations	to	age-old	values	and	truths.
They	are	advocates	of	individual	freedom	and	personal	liberty	and	cannot
tolerate	injustice.
They	are	good	speakers	and	have	an	ability	to	mobilize	public	opinion	in
favor	of	their	arguments;	even	their	opponents	have	to	agree	with	their	points	of
view.
They	are	friendly	and	gain	popularity	easily,	because	they	do	not	discriminate
between	rich	and	poor,	king	and	beggar,	master	and	servant.	They	are	equally
friendly	and	supportive	to	all.	They	are	cordial	to	their	subordinates	and
students.
Their	personalities	have	many	faces—uncertainty	is	their	speciality.
Outwardly,	they	look	chaotic	and	like	anarchists,	but	inside	they	are	well
organized	and	have	regularity	in	their	lifestyles	by	which	they	maintain	their
physical	and	mental	health.	They	are	good	planners.
They	are	idealists	and	materialists	at	the	same	time.	On	the	one	hand,	they
donate	freely,	live	in	Utopia,	and	think	of	plans	for	the	universal	and	cosmic
good.	On	the	other	hand,	they	market	and	sell	their	ideas	for	material	gain	and
care	about	money.
They	are	restless	because	they	have	an	overbusy	mind	and	hyperactive	brain.
They	love	change	and	love	to	travel.	If	they	travel,	they	do	so	to	learn	and	earn
at	the	same	time.	Their	business	dealings	in	foreign	countries	flourish	because	of
their	brilliant	ideas.
They	love	mystery	and	keep	a	mysterious	environment	around	them.	They
learn	from	everybody	and	are	very	interested	in	occult	knowledge.	They	have
their	own	way	of	explaining	ideas	and	do	not	follow	any	one	conventional
religion.	They	create	an	ideology	of	their	own,	a	religion	of	their	own	that
appeals	to	their	imagination	and	is	based	on	mysterious	(not	clear	and	scientific)
foundations.
They	believe	in	peaceful	coexistence	and	can	adjust	to	any	and	every	foreign
environment.	They	impress	the	minds	of	people	they	meet	for	a	long	time.
Slowly	they	become	popular	in	the	towns	or	countries	they	visit.	They	are	highly
social	and	not	commanding.	They	bring	good	fortune	to	their	friends,	associates,
and	bosses;	when	they	somehow	break	their	friendships,	these	people	suffer
losses.	They	have	good	memories	and	are	flexible	in	nature.	Like	number	5s,
they	become	a	child	with	children,	a	youth	with	young	people,	and	wise	and
sober	with	wise	men.	They	discuss	many	subjects	and	advise	people	freely	who
come	to	them	for	guidance	or	advice.	Although	they	do	not	bind	people	with	any
particular	ideology	or	sect,	in	their	heart-of-hearts	they	like	people	who	accept
their	advice,	who	follow	their	instructions.
They	love	mountains	and	nature	and	travel	to	foreign	lands.
They	are	brave	and	take	risks	freely.
They	get	settled	in	their	lives	around	or	after	the	age	of	thirty-four.
They	are	good	writers,	painters,	and	poets	and	can	express	their	ideas	through
any	medium.	Whatever	means	of	expression	they	use,	they	are	original	and	their
subject	is	philosophy.	They	are	true	scientists	of	life.	They	want	to	bring
workable	doctrines	to	life.	If	they	are	spiritually	inclined,	they	progress	quickly
and	become	Gurus	or	yogis.	Whether	Guru	or	teacher,	whatever	they	like	to	call
themselves,	they	become	prominent	in	their	own	fields	of	work.	They	work	hard,
struggle,	and	face	hardships	in	the	early	part	of	their	lives.	Because	they	always
underestimate	their	talents,	they	become	successful	and	rich	later	in	life.	They
have	successful	married	lives	and	have	a	special	kind	of	sex	appeal	for	members
of	the	opposite	sex.
They	are	helped	by	their	friends	and	profit	from	these	relationships.	A	psychic
7	also	meets	one	person	early	in	life	with	whom	he	or	she	forms	a	beneficial,
lifelong	friendship.
A	psychic	number	7	woman	always	worries	about	her	future.	She	is	anxious,
sensitive,	emotional,	touchy,	and	attractive;	she	has	attractive,	watery	eyes.
Psychic	Number	7s	are	magnetic,	sweet,	and	charming.	They	cannot	be	easily
deceived	because	they	can	read	people’s	minds.	They	do	not,	however,	know
how	to	read	their	own	minds	and	sometimes	deceive	themselves	by	their
fantasies,	Utopias,	and	ideas.	They	get	easily	involved	in	the	affairs	of	the	land
and	people	they	visit.
Whatever	they	are,	they	are	utilitarians.	They	do	not	throw	things	in	the
garbage	easily;	they	make	the	best	use	of	useless	things.	Many	of	their	art	pieces
are	composed	from	things	that	people	discard.
Psychic	Number	7	natives	have	a	tendency	to	overlook	their	own
shortcomings	and	ignore	their	minor	mistakes.
They	often	are	attracted	to	drugs	and	are	sometimes	big	consumers	of	liquor.
Precautions	for	Psychic	Number	7
They	should	thoroughly	understand	the	nature	of	projects	before	undertaking
them.	They	should	carefully	judge	the	positive	and	negative	aspects	of	these
jobs,	evaluate	the	time	and	labor	they	have	to	put	into	them,	and	then	accept
them.
They	should	not	waste	their	energies	on	undertakings	that	are	beyond	their
capacity.
They	should	accept	changes	with	joy	and	not	just	stick	to	their	own	ways	of
thinking.	They	should	not	speak	disparagingly	about	the	cultures	from	which
they	come.
They	should	work	independently,	try	to	become	self-supporting,	and	not
depend	on	others.	They	should	not	underestimate	their	talents	and	should	bravely
start	their	own	projects.
They	should	remain	alert,	sincere,	and	devoted	to	their	jobs	and	not	flow	with
their	fantasies.	They	should	avoid	being	shy,	being	too	sentimental,	and	getting
emotionally	involved	in	the	affairs	of	others.
They	should	avoid	hurrying	and	making	quick	decisions.	(Number	7	women
should	also	avoid	worry.)
They	should	avoid	wasting	time	fantasizing	and	should	understand	the	value
of	their	time.	They	should	learn	to	be	punctual.
They	should	avoid	excessive	smoking,	drugs,	and	alcohol.
They	should	do	bodywork,	physical	and	manual	labor,	and	breathing
exercises,	because	they	overexert	their	minds.
They	should	keep	flowers	and	green	plants	around	them,	and,	before	leaving
bed	in	the	morning,	they	should	look	at	them	to	gain	inspiration	and	inner
strength.	They	should	practice	tratak	on	a	candle	flame,	a	yantra,	or	a	single
point.	(See	page	127	for	an	explanation	of	tratak.)
They	should	not	make	fun	of	their	religion	or,	in	fact,	of	any	religion.
They	should	respect	their	partners	and	behave	in	a	friendly	manner	toward
their	husbands	or	wives,	who	keep	them	away	from	domestic	problems	and	help
their	growth.
They	should	avoid	watersports,	and	avoid	deep	waters	and	journeys	on	ships
or	boats.
They	should	not	exhaust	themselves	by	overworking.
They	should	not	change	their	minds	quickly.
Destiny	Number	7
Seven	is	a	good	destiny	number	because	it	helps	people	enhance	qualities	that
are	inherent	in	their	psychic	or	name	number.	Ketu,	the	ruler	of	number	7,	is	a
half-planet	and	is	easily	influenced	by	the	vibrational	field	of	the	planet	in	whose
house	it	is	posited.	Ketu	accommodates	the	qualities	and	traits	of	the	planet	with
whom	it	works.	This	adjustability	and	nondiscriminating	trait	of	destiny	7s
makes	them	the	favorites	of	everyone	they	meet.	Their	circle	of	helpers	becomes
wide.
Their	habit	of	underestimating	their	talents	and	their	latent	potential	makes
them	humble,	sweet,	and	charming	and	gives	them	human	qualities.
Their	brilliant	and	practical	ideas	attract	people	like	magnets.
They	become	good	speakers	and	storytellers.
They	visit	foreign	lands	and	get	recognition	in	the	fields	of	art	or	literature	or
as	diplomats.	Depending	upon	their	inclinations,	which	are	strongly	guided	by
their	psychic	numbers,	they	can	also	be	recognized	as	arbitrators,	peacemakers,
or	spiritual	masters.
Destiny	7	people	are	witty,	lively,	prompt	in	making	decisions,	unpredictable,
everchanging,	and	always	youthful.	They	are	good	advisers—even	their	enemies
accept	their	advice	and	suggestions.	They	emit	peaceful	vibrations	and	can	calm
people	by	their	presence.	They	have	solutions	for	all	problems	and	are	good	in
solving	disputes.	Their	approach	is	rational,	practical,	friendly,	and	creative.
If	spiritual,	destiny	7	people	achieve	samadhi	and	experience	states	of	deep,
uninterrupted	meditation.	If	they	are	interested	in	Tantra,	they	acquire	siddhis
(powers),	such	as	clairvoyance,	personal	magnetism,	hypnotic	powers,	the	power
of	transferring	or	channelling	energy,	etc.	Between	thirty	and	forty-five	years	of
age	their	intuitive	powers	increase,	and	they	read	people’s	minds	as	clearly	as
someone	reads	a	book.
They	have	remarkable	dreams	and	learn	from	them.	Most	of	their	brilliant,
original	ideas	come	from	their	dreams	or	from	daydreams,	which	are	their
favorite	pastimes.	They	try	to	know	the	secrets	of	dreams	and	the	subconscious
mind	and	believe	in	that	mystical	power	that	can	transport	people	into	the	future
or	the	past.
Attractive	to	and	surrounded	by	members	of	the	opposite	sex,	they	flirt	with
them	in	special	ways.
A	destiny	7	woman	is	highly	sociable	and	sentimental	and	more	attractive	than
a	destiny	7	man.	She	is	clever,	assertive,	talkative	(sometimes	too	much	so),	and
career-minded.	She	becomes	strongly	attached	to	her	mother	and	other	female
relatives,	which	creates	problems	in	her	married	life.	She	also	has	a	worrying
nature	and	is	always	anxious	about	the	future.	This	causes	her	to	pay	less
attention	to	her	husband,	which	is	not	good	for	a	happily	married	life.
A	man	with	a	destiny	number	of	7	is	advised	to	not	enter	into	the	bonds	of
marriage	before	he	is	twenty-eight	years	of	age.
Both	men	and	women	with	this	destiny	number	have	one	or	more
relationships	outside	of	their	married	life.
Name	Number	7
The	number	7	in	conjunction	with	any	psychic	or	destiny	number,	except
number	1	or	number	5,	makes	a	good	name	number.	Having	the	psychic	number
the	same	as	the	name	number	enhances	the	quality	of	the	psychic	number	and
makes	its	natives	more	acceptable,	friendly,	scholarly,	sociable,	universal,	and
cosmopolitan.	If	the	name	number	is	the	same	as	the	destiny	number,	it	makes	its
people	pioneers—as	scholars,	writers,	artists,	social	scientists,	reformers,	or
mystics.	Their	names	continue	to	be	known	because	of	their	original	ways	of
thinking	and	their	philosophic	approaches.
When	all	the	three	numbers	total	7,	problems	arise.	Even	natives	whose
psychic	and	destiny	numbers	are	7	need	special	attention,	guidance,	and	care;
these	people	should	avoid	7	as	a	name	number.	However,	natives	whose	destiny
number	is	7	are	definitely	benefited	by	having	a	name	number	that	is	also	7.	As	a
general	rule,	the	name	number	influences	the	psychic	number.	But	when	the
name	number	is	in	harmony	with	the	psychic	number,	and	the	same	as	the
destiny	number,	it	brings	good	luck.
BALANCING	INTERNAL	AND	EXTERNAL
ENVIRONMENTS
By	observing	fasts,	using	the	proper	spices	and	gem	powders,	meditating	on	the
mantras,	and	using	the	yantras,	one	can	balance	the	internal	environment.
Balancing	the	external	environment	is	possible	by	choosing	the	right	time	for
activities	(in	the	ascending	cycle	or	descending	cycle),	selecting	good	friends
(finding	compatible	numbers),	and	starting	a	job	at	the	appropriate	time
(observing	weak	period	and	strong	periods).	Balance	is	achieved	by	working
with	the	energy	flow	that	is	already	available,	as	described	in	the	sections	that
follow.	The	information	that	follows	applies	to	people	with	psychic	number	7.
Weak	Periods
The	months	of	January	and	February	are	their	weak	periods.	During	these
months	they	can	lose	courage,	lose	opportunities,	or	spend	their	time	idle	or
engaged	in	useless	pursuits	and	amusements.	They	also	become	very	dependent
on	others,	very	shy,	and	are	often	misunderstood	by	their	friends	and
acquaintances.
They	become	proud	of	their	material	successes	and	literary	accomplishments.
They	become	dull,	careless,	and	disorganized,	which	brings	them	problems
and	financial	losses.
They	mock	other	religions	and	their	own	cultural	backgrounds.	They	become
disinterested	in	their	domestic	lives,	remain	outside	their	homes,	cheat	on	their
life	partners,	and	become	unfriendly.
They	meet	failures	and	become	restless.
They	become	unsuccessful	in	their	love	affairs.
They	work	beyond	their	capacities,	spoil	jobs	by	rushing,	invest	money	in	bad
ventures,	and	suffer	losses.
Strong	Periods
The	period	between	June	21	and	July	20	is	the	best	period	for	number	7	people,
although	the	entire	months	of	June	and	July	are	also	favorable.	They	should	start
new	jobs,	search	for	better	living	conditions,	sign	contracts,	and	use	their
resources	for	the	betterment	of	their	material	lives,	leaving	aside	their	shyness
and	wrong	estimations	of	their	talents.
Good	Dates
Days	7,	16,	and	25	of	any	month	are	good	for	them.	Also,	days	1,	10,	19,	and	28
are	favorable	because	of	the	friendly	behavior	of	1s	toward	7s.	Days	2,	11,	13,
20,	22,	29,	and	31	are	not	bad.	They	are	favorable	if	they	fall	on	the	good	days
(see	below).
Good	Days
Sunday,	Monday,	and	Wednesday	are	good	days	for	number	7	people.	If	these
days	fall	on	any	of	the	dates	mentioned	above,	they	bring	beneficial	results.
Favorable	Colors
Light	green,	light	blue,	and	white	are	the	three	most	favorable	colors	for	number
7	natives.	They	should	avoid	black	and	use	it	as	little	as	possible.	They	should
use	light	blues	for	curtains,	bed	and	pillow	covers	and	cushions,	and	when	they
want	a	change	they	can	use	light	green.	Because	green	is	soothing	to	their
nerves,	they	should	keep	plants	around	them	and	look	at	them	for	relaxation.
Precious	Stones
Their	stone	is	cat’s-eye	with	a	chatoyant	glowing	from	the	inside,	like	a	cat’s	eye
with	white	fibers.	The	brighter	the	fiber,	the	higher	the	quality	and	influence	of
the	gem.	Cat’s-eyes	are	found	in	four	shades:	yellow	(the	color	of	a	dry	leaf),
black,	green,	and	white	and	green.	Of	these	four	varieties,	the	white	and	green
stones	are	best	for	number	7	natives.	In	the	absence	of	these,	a	yellow	cat’s-eye
can	be	used.	It	should	be	bought	on	a	Wednesday	and	given	to	the	jeweler	on	the
same	day.	The	ring,	prepared	by	the	jeweler,	should	be	picked	up	on	a
Wednesday	and	should	be	worn	after	the	proper	rituals	have	been	performed.	It
should	be	set	in	a	special	mixture	of	five	metals—iron,	silver,	copper,	gold,	and
zinc—or	in	white	gold	and	worn	on	the	little	finger	of	the	left	hand.
They	should	take	pearl	powder	to	help	their	bodies	heal	electrochemically.
Meditation
Number	7	people	are	advised	to	worship	Nrisimha	(Narsingha),	the	Lion
incarnation	of	Vishnu.	They	also	can	meditate	on	a	white	background,	on	the
Cat’s-eye	gem,	or	on	a	flame	(preferably	lit	from	a	cotton	wick	soaked	in
clarified	butter	(ghee).	They	should	learn	to	do	tratak,	to	stare	at	a	flame	until
the	eyes	start	tearing.	After	tears	come,	their	eyes	should	close	and	they	should
meditate	on	the	afterimage	of	the	flame	between	the	eyebrows	(the	third	eye	or
Ajna	Chakra).	This	will	calm	their	restless	minds,	increase	their	intuitive	powers,
and	give	them	clairvoyant	powers.	They	should	wear	white	clothing	while
meditating.
Deity
Narsingha	(Nrisimha)—the	Lion	Incarnation	of	Vishnu.
Mantra
Japa1
(repetition)	of	the	mantra	of	any	planet	should	be	completed	within	the
ascending	cycle	of	the	moon	and	should	be	repeated	the	prescribed	number	of
times.
AUM—NRING	NRING	NRING	NARSINGHAYE	(NRISIMHAYE)	NAMAH—
AUM
Repeat	the	above	mantra	17,000	times	within	the	ascending	cycle	of	the
moon.
Yantra	of	Ketu2
Health	and	Diseases
They	are	susceptible	to
infections
indigestion,	constipation,	and	other	stomach	problems
diseases	in	the	private	parts	(genitals)
gout,	arthritis,	caused	by	aggravation	of	the	humor	of	the	wind	element
general	weakness	and	problems	with	the	blood
bad	memory	after	forty-five	years	of	age.
To	aid	these	problems,	they	should	take	Vitamin	D	and	E,	drink	fruit	juices,
develop	regular	eating	habits,	and	avoid	smoking	and	drugs.	They	should	eat	for
the	taste	and	benefit	from	foods,	rather	then	simply	using	foods	to	fill	their
stomachs	and	rush	off	to	be	busy	again.
They	should	take	out	time	for	walks	near	rivers,	ponds,	lakes,	springs,	and
waterfalls	to	relax	their	nerves,	digest	their	food,	and	get	away	from	stressful
situations.
Fasting
Fasting	on	Tuesday	is	favorable	for	number	7s.	They	should	use	sweet	potatoes
and	fruit	juices	once	a	day	and	avoid	grains,	salt,	and	spices.
Friendship
Those	born	on	day	7,	16,	or	25,	and	day	1,	10,	19,	or	28	of	any	month	are	good
friends	to	number	7	natives.	People	born	on	the	above	dates	during	January	or
February	(the	weak	period	for	number	7	natives)	are	more	suitable	for	them	and
become	more	intimate	friends.
Romance
People	born	on	day	25	or	28	of	any	month	are	the	most	favored	for	number	7s	in
romance.	Marriages	between	number	7	men	and	number	1	women	do	not	work
for	long	periods	of	time,	but	number	7	women	and	number	1	men	can	be	good
life	partners.
Good	Years	in	Life
The	21st	year,	28th,	35th,	42nd,	and	49th	are	of	great	importance	to	number	7
natives.	Decisions	made	during	these	years	have	an	effect	on	their	patterns	of
life.	Major	events	in	their	lives	take	place	during	these	years.	Otherwise	all	years
that	add	up	to	7	(the	7th,	16th,	25th,	34th,	43rd,	52nd,	61st,	and	70th)	are	good
for	them.	Also	the	10th	year,	the	19th,	28th,	37th,	46th,	55th,	64th,	73rd,	and
82nd	of	life	are	favorable	to	them.
NUMBER	7	PEOPLE	IN	RELATIONSHIP
The	information	given	below	is	based	upon	a	comparison	of	Psychic	number	7s
to	other	psychic	numbers.	It	can	also	be	used	to	compare	destiny	7s	to	other
destiny	numbers,	and	name	7s	to	other	name	numbers.	(The	comparisons	are
based	upon	like	categories.)
Number	7	and	Number	1
Number	7s	and	number	1s	are	ideal	friends	in	political,	cultural,	and	literary
fields.	Number	1s	are	regular,	punctual,	orderly,	and	disciplined,	while	7s	are
not.	So	their	friendship	brings	improvements	to	number	7	people.	In	business
partnership,	1s	are	beneficial	provided	they	handle	the	management.	Ones	are
easily	attracted	to	7s	and	give	them	positive	vibrations	and	help.	Sevens	can
select	1s	if	the	7s	are	ready	to	accept	their	authority,	follow	their	advice,	and
joyfully	surrender	changing	their	own	brilliant	but	Utopian	ideas.	In	marriage,
number	7	women	can	marry	number	1	men,	but	the	reverse	is	not	true	unless	7s
can	stop	their	flirting	habit.	For	appointment	dates	or	residential	numbers,	7s	can
select	Is.
Number	7	and	Number	2
Although	2s	are	not	beneficial	numbers	for	7s,	the	latter	are	beneficial	for	2s.
Number	7s	are	ruled	by	Ketu,	the	south	node	of	the	Moon.	Since	Ketu	(7)	guides
the	moon	(2)	on	its	path	in	the	ecliptic,	7s	guide	and	are	beneficial	to	2s.	Number
7s	are	good	teachers	for	2s;	given	that	2s,	however;	always	repeat	their	mistakes,
they	are	not	good	students.	Sevens	can	help	2s	and	enjoy	their	friendship	without
expecting	any	gains,	but	they	should	not	select	2s	as	business	or	life	partners.
Number	7s	can,	however,	select	2s	(and	all	numbers	that	add	up	to	two)	for
appointment	dates	and	for	residential	numbers.
Number	7	and	Number	3
Number	3s	are	helpful	to	number	7	natives	and	give	them	positive	vibrations.
They	are	mutually	beneficial	in	a	friendship	or	business	partnership.	They
become	friends	easily	and	their	friendship	lasts	for	a	long	time.	Since,	in	each
other’s	company,	3s	become	more	traditional	and	7s	become	more	revolutionary,
unconventional,	and	anarchistic,	they	disagree	for	a	long	time.	But	sooner	or
later	they	compromise;	it	is	a	habit	of	number	7s	to	make	compromises	and
adjust	to	all	kinds	of	beliefs.	In	friendship	and	marriage,	the	relationship	is	very
congenial	if	the	7s	are	younger,	and	if	the	3s	are	men	and	the	7s	women.	Sevens
can	select	3s	as	appointment	dates	or	residential	numbers.
Number	7	and	Number	4
Number	4s	are	beneficial	for	number	7s,	if	7s	accept	and	serve	4s	as	the	body
supports	the	head.	Conversely	7s	always	bring	peace,	prosperity,	and	happiness
to	4s.	However,	if	they	are	not	given	freedom	or	the	upper	hand	in	the
friendships	or	business	or	life	partnerships,	4s	create	obstacles	and	problems.
The	relationships	work	very	well	when	the	7s	are	women	and	the	4s	men—7s
are	boss,	4s	subordinates.	However,	a	4	as	a	boss	creates	difficulties	and
problems	for	a	number	7.	Sevens	should	avoid	the	number	4	for	residential
numbers.	If	necessary,	they	can	use	4	or	all	numbers	that	add	up	to	four	for
appointment	dates,	if	the	appointment	is	not	very	important.
Number	7	and	Number	5
Ketu	and	Mercury	are	friends,	but	number	7s	and	number	5s	are	not.	Although
they	are	easily	attracted	to	each	other,	they	do	not	provide	practical	help	to	each
other	in	the	long	run.	Fives	encourage	7s	to	perform	mischievous	acts	they	do
not	wish	to	perform.	These	two	numbers	become	indifferent	to	each	other.	Only
when	a	7	and	a	5	are	each	connected	to	a	group	that	is	involved	in	revolutionary
activities	or	terrorism	does	their	friendship	become	mutually	beneficial.
Number	7	and	Number	6
Though	number	7s	are	not	very	helpful	to	6s,	the	reverse	is	true.	Number	7
people	are	helped	in	their	growth	and	development	by	sixes.	They	bring	them
name,	fame,	and	a	rise	in	status.	Sixes	work	hard	for	7s	as	business	partners	and
help	7s	in	business.	Marriage	only	works	well	when	the	7	is	a	man	and	the	6	a
woman.	Number	7s	can	always	select	6s	for	friendship	or	business.	But	when
they	do	so,	they	should	also	provide	the	6s	with	good	feedback	on	their	hard
work,	help,	and	cooperation.
Number	7	and	Number	7
Number	7s	are	troublesome	to	7s.	Number	7	is	a	number	of	scholarly	people,
and	two	scholarly	persons	feel	uncomfortable	together.	They	cannot	coexist
without	arguments	and	discussions.	Number	7	people	are	also	proud,	and	two
proud	persons	cannot	communicate	harmoniously.	Two	psychic,	intuitive,
irresponsible,	and	sentimental	people	can	easily	hurt	and	irritate	each	other.
Their	discussions	annoy	each	other.	This	combination	is	therefore	advised	not	to
enter	into	business	partnership	or	life	partnership.	Those	with	a	psychic	number
of	7	should	not	select	a	7	as	an	appointment	date	or	residential	numbers.
However,	people	with	a	destiny	or	name	number	of	7	can	do	so.	All	7s	should
avoid	the	number	7	as	an	appointment	date	for	an	important	job.
Number	7	and	Number	8
Number	8s	are	always	prepared	to	help	7s,	but	7s,	being	proud,	do	not	ask	for
help.	Number	8s	like	and	feel	comfortable	and	quiet	in	the	presence	of	7s.	But	in
their	absence	7s,	led	by	egotism,	talk	badly	about	8s	and	put	them	down.	These
two	numbers	do	not	excite	each	other	emotionally.	Number	8s	can	provide
monetary	help	to	7s,	but	cannot	learn	from	them.	Eights	are	also	beneficial
business	partners,	who	work	hard	to	organize	the	businesses,	meet	challenges,
and	protect	7s	from	losses.	The	number	8	should,	therefore,	be	selected	by	7s	as
an	appointment	date	for	important	jobs,	for	residential	numbers,	but	not	as
friends	or	life	partners.	In	case	they	are	both	interested	in	the	occult	sciences,
they	can,	however,	manage	to	coexist	as	friends	and	life	partners.
Number	7	and	Number	9
Number	9s	and	number	7s	are	mutually	beneficial.	Nines	teach	7s	to	be
practical,	and	7s—dreamers—add	an	extra	dimension	to	the	personality	of	9s.
Number	9,	always	doubting,	is	inspired	by	a	7	and	emerges	from	the	darkness	of
doubt	into	the	open,	lit	field	of	hope.	This	makes	7s	and	9s	good	friends.
However,	since	7	is	a	number	of	exaggeration	when	7s	are	inspired,	they	present
9s	with	a	vast	panorama	of	false	hopes,	turning	them	off.	But	as	soon	as	they
confront	each	other,	9s	forget	the	shortcomings	of	7s	and	again	they	become
friends.	Nines	are	thus	good	for	7s	in	all	respects,	except	marriage.	Number	9
men	are	good	husbands	for	number	7	women,	but	the	reverse	is	not	true.	Number
7s	are	all	right	as	teachers	of	their	own	kind	of	spirituality,	which	is
cosmopolitan	and	embraces	the	good	points	of	all	religions.	Sevens	can	select	a
number	9	for	appointment	dates	or	for	residential	numbers.


Saturn	and	Number	8
Saturn	is	the	ruling	planet	of	people	born	on	day	8,	17,	or	26	of	any	month,	or
those	whose	destiny	or	name	number	totals	8.	The	Saturnian	qualities	described
below	are	most	clearly	visible	in	people	who	have	8	as	a	psychic	number.
Among	the	seven	most	important	planets	of	our	solar	system,	Saturn	is	the
farthest	planet	from	the	Earth.	That	it	is	slow	moving	is	indicated	by	its	Sanskrit
name,	Shanaishchara.	It	is	inert	(tamasic),	cold	and	dry	in	nature,	and	is
considered	to	be	the	most	malefic	of	the	malefic	planets.	Its	malefic	effects	can
be	experienced	when	it	passes	through	the	twelfth,	first,	and	second	houses	from
the	natal	Moon.	For	example,	if	the	Moon	is	in	Taurus	in	the	natal	chart,	then
whenever	Saturn	transits	in	Aries,	Taurus,	or	Gemini,	its	influence	can	be
experienced	the	most.
As	Saturn	completes	one	revolution	on	the	path	of	its	ecliptic	in	thirty	years,	it
remains	in	the	sidereal	zodiac	sign	for	two-and-a-half	years;	when	it	transits
through	the	three	above-mentioned	houses,	it	influences	the	native	for	a	period
of	seven-and-a-half	years.
If	Saturn	is	not	favorably	posited	in	a	natal	chart,	it	makes	the	natives	greedy,
morbid,	and	gloomy.	They	continuously	suffer	from	losses	and	psychosomatic
problems	caused	by	disturbance	in	their	body	chemistry.	This	is	due	to	the
aggravation	of	wind	element	humor	(a	disturbance	in	the	flow	of	gases	in	the
body).
Saturn,	a	planet	of	darkness,	rules	over	the	dark	side	of	human	nature,	such	as
the	conscience	(or	awareness	of	right	and	wrong).	The	sight	of	Saturn	is
inauspicious.	When	Saturn	is	well	posited	in	a	chart,	it	brings	wisdom,
awareness	of	right	and	wrong,	sincerity,	honesty,	love	of	justice,	non-attachment,
long-life,	fame,	authority,	leadership,	and	organizational	abilities.
Saturn	is	a	planet	of	confinement.	When	it	is	ill-posited	or	badly	aspected	in	a
chart,	it	brings	obstruction,	delay,	humiliation,	enmity,	bad	karmas,	lawsuits,	and
prison.	It	makes	people	lonely,	pessimistic,	afraid,	and	subject	to	premature
aging,	drug	addiction,	and	gives	them	suicidal	tendencies.
Saturnine	people	do	not	like	discipline;	they	are	rebellious	and	law	breakers.
They	behave	like	old	men	and	appear	older	than	their	chronological	ages.	This	is
because	Saturn	rules	over	old	age	and	is	often	described	as	an	elderly	planet.
Saturn	rules	over	the	nails,	hairs,	teeth,	bones,	skeleton,	skin,	and	nervous
system.
Mercury,	Venus,	Rahu,	and	Ketu	are	friends	of	Saturn;	the	Sun,	Moon,	and
Mars	are	enemies.	Jupiter	relationship	is	neutral.
NUMBER	8
Psychic	Number	8
Eight	is	the	psychic	number	of	those	born	on	days	8,	17,	and	26	of	any	month.
Number	8	is	a	number	of	confidence	and	determination.	It	is	also	a	number	of
mystery—its	natives	are	mostly	misunderstood,	even	by	their	closest	friends	and
relatives.	They	are	hardworking	and	accept	challenges	readily;	when	challenged,
they	make	the	impossible	possible.
They	are	introverted,	reserved,	patient,	reflective,	deep,	serious,	melancholic,
and	outwardly	calm	and	well-balanced.
They	are	very	sincere	with	the	social	organizations,	groups,	communities,	or
families	with	which	they	associate	themselves	and	devote	their	whole	lives	to
them.	They	are	not	helped	by	others	very	much,	primarily	because	they	like	to
do	everything	themselves	and	do	not	like	to	ask	for	help	or	be	helped.
They	have	a	strong	presence	that	can	sometimes	be	a	little	heavy,	but	they
have	distinctive	personalities.	Their	willpower	and	serious	nature	give	them	the
strength	to	handle	all	kinds	of	projects	successfully.	Although	along	the	way
they	meet	obstacles,	delays,	failures,	and	challenges,	their	strong	individuality,
persistence,	will,	and	patience	lead	them	to	the	completion	of	their	tasks,	and
thus	they	make	their	marks	on	history.	They	have	faith	in	life	and	are	generally
born	to	serve	a	cause	to	which	they	sacrifice	themselves	and	serve	as	tools.
Their	lives	are	full	of	struggles,	and	they	do	not	give	up	before	they	achieve
their	desired	goals.	Number	8	natives	are,	therefore,	good	fighters,	politicians,
and	scientists.	They	are	revolutionary	by	nature	and	can	be	associated	with
major	upheavals	that	sometimes	are	brought	on	by	destruction.	However,	their
motives	are	to	serve	silently	and	sacrifice	their	lives	for	the	benefit	of	the	poor
and	downtrodden.
Their	lives	are	unpredictable.	Unexpected	changes	keep	them	busy	adjusting
to	the	new	circumstances.	This	makes	it	hard	for	their	friends	and	relatives	to
understand	them,	and	that	is	why	they	are	mostly	misunderstood.
Because	of	their	solitary	nature,	graveness,	lack	of	humor,	inability	to
appreciate	humor,	and	their	intolerance	of	jokes,	they	feel	very	lonely	at	heart.
Their	lifestyle	makes	them	asocial;	they	do	have	a	few	real	friends	who	are	able
to	peep	into	the	innocent	and	tender	spaces	hidden	deep	inside	of	their
personalities.	Outwardly	they	are	stiff,	but	inside	they	are	very	caring,	devoted,
and	gentle	people	who	face	all	kinds	of	losses	and	hardships	to	protect	the
interests	of	their	friends.	They	shield	their	friends	and	save	them	under	all
circumstances,	but	they	also	make	the	worst	enemies.	When	they	become	angry,
they	disturb	the	whole	environment	and	can	make	even	the	strongest	person
shake.	They	do	not	rest	until	they	have	defeated	and	subdued	their	enemies.
They	keep	enmity	in	their	hearts	until	the	end	of	their	lives;	they	wait	patiently
and	attack	their	enemies	at	the	appropriate	time.	They	accept	defeat	with	joy	and
change	their	strategies,	but	are	not	pacified	until	they	have	taken	revenge.	They
are	extremists	and	go	to	extremes,	both	in	friendship	and	enmity.
They	are	not	satisfied	by	small	success;	they	aspire	for	great	success	and	full
honor.	They	believe	their	work	is	their	worship	and	aim	at	doing	big	things,	in
whatever	businesses	or	jobs	they	have.	They	hate	hypocrisy	and	deceit	and	are
themselves	honest,	practical,	and	clever.	They	become	wise	at	an	early	age	and
have	an	ability	for	judging	other	people.	They	feel	different	from	other	people
and	do	things	that	are	prohibited	by	law	and	society.	They	do	not	believe	in	the
existing	norms	and	come	into	conflict	with	social	and	moral	values.	They	are
materialists	and	financial	security	is	their	primary	object,	yet	they	do	not	run
after	money.	They	love	their	own	ideology	and	can	do	anything—take	any	job—
to	make	money.	They	then	can	spend	each	and	every	cent	of	it	on	others,	without
selfish	motive	or	expectation	of	return.	However,	they	are	incapable	of	spending
money	on	themselves	or	those	inside	their	family	circle.	Until	thirty-five	years	of
age,	they	cannot	save	any	money	and	go	through	several	financial	crises	in	their
lifetime.	But	after	passing	this	age,	they	are	able	to	have	bank	balances.	They
love	to	see	their	balances	grow	and	do	not	spend	money	easily.	After	they	have
earned	enough	money,	they	try	to	develop	their	mental	faculties.	They	try	to
overcome	the	ongoing	internal	dialogue	in	their	minds	and	try	to	learn	the	occult
sciences,	religion,	philosophy,	meditation,	etc.	Although	they	have	no	deep	and
real	interest	in	religion,	they	again	go	to	the	extreme	and	gain	the	deepest	states
of	meditation,	when	they	are	lucky	enough	to	have	good	guidance.
Precautions	for	Psychic	Number	8
Number	8s	should	not	accept	all	challenges.
They	should	trust	their	friends	and	subordinates.
They	should	not	undertake	jobs	that	are	beyond	their	capacities,	only	for	the
sake	of	making	money.
They	should	not	indulge	in	arguments,	and	they	should	learn	to	express	their
ideas	clearly	and	to	stop	talking	when	necessary.
They	should	widen	their	circle	of	friends	and	acquaintances.
They	should	not	depend	on	others	for	help,	because	they	receive	very	little
back	from	the	friends,	relatives,	and	other	persons	they	help.
They	should	drop	the	habit	of	being	revengeful.
They	should	remove	the	mask	of	gloominess,	seriousness,	and	sobriety	and
should	learn	to	smile	and	try	to	remain	happy.
They	should	remain	active	and	avoid	lethargy,	passivity,	and	isolation.
They	should	cultivate	more	tolerance,	be	more	friendly	and	considerate,	and
not	get	easily	irritated.
They	should	avoid	drugs	and	other	intoxicants.
They	should	avoid	canned	food,	old	food,	and	fast	food;	eat	more	coarse
grains	and	coconut	powder;	drink	more	fresh	juices	to	avoid	constipation	and
other	troubles	created	by	the	aggravation	of	the	wind	element,	such	as
rheumatism,	arthritis,	and	skin	irritations.
They	should	follow	the	advice	of	people	more	experienced,	learned,	and
evolved	than	they	are.
They	should	avoid	the	habit	of	brooding	over	the	past	and	overcome	their
imaginary	fears.
They	should	respect	both	their	life	partners	and	business	partners.
They	should	avoid	getting	involved	in	love	affairs.
They	should	travel	occasionally.
They	should	not	spread	rumors.
They	should	search	for	good	friends,	philosophers,	or	guides	and	devote	some
energy	toward	their	own	spiritual	growth.
Destiny	Number	8
Eight	is	not	good	as	a	destiny	number	because	it	brings	delays,	obstacles,
failures,	and	humiliation	from	an	unknown	source,	and	it	makes	life
unpredictable.	Those	with	a	psychic	number	of	8	create	conditions	for	their	own
failure	and	are	not	surprised	by	them.	However,	when	these	life	failures	come
from	destiny,	number	8s	lose	faith	in	the	virtuous	life	and	act	destructively.
This	destiny	number	brings	unwanted	opposition	and	enmity	without	cause.	It
brings	financial	losses	by	theft	and	other	means.
Destiny	8	makes	people	perform	bad	karmas,	have	accidents,	face	lawsuits,
and	suffer	premature	aging.	It	also	provides	wisdom	through	sad	experiences,
failures,	and	opposition.	Destiny	8s	excel	under	most	unfavorable	conditions;	the
more	difficulties	they	have,	the	more	they	shine.	They	achieve	fame	and
organizational	abilities,	hold	high	posts,	and	become	rich	in	the	latter	part	of
their	lives.	If	interested	in	politics,	they	attain	the	highest	posts;	if	interested	in
the	spiritual	and	occult	sciences,	they	become	leaders	of	their	groups.	However,
they	never	get	away	from	problems	(both	real	and	imaginary),	opposition,	and
casual	humiliations.	They	love	solitude,	but	suffer	from	loneliness.
Destiny	8s	are	also	susceptible	to	drug	addiction	and	fond	of	being
intoxicated.
They	are	not	successful	in	matters	of	love	and	earn	a	bad	name	because	of	sex
scandals.	They	do	not	lead	married	lives	for	long	periods	of	time.	They	are
always	threatened	by	the	fear	of	rejection,	separation,	or	divorce.	This
sometimes	proves	good	for	their	political	careers	or	spiritual	lives.	Because	they
have	philosophical	ideas,	they	can	get	away	from	their	pleasure-seeking	nature
and	direct	their	energies	to	fight	the	suffering	of	their	fellow	men.
They	are	destined	to	make	a	mark	on	history—either	as	innovators	in
scientific	research,	as	social	reformers,	or	by	bad	karmas	and	subversive
activities	(because	they	become	leaders	of	opposition	groups	or	antisocial	groups
and	launch	revolutions	and	meet	a	tragic	end).
Destiny	8	people	have	more	endurance	than	any	other	number	from	1	to	9.
They	do	not	easily	suffer	from	stresses	or	strains;	they	are	very	flexible	and
adjust	to	shocks	quickly.
They	stay	very	busy	striving	to	attain	the	highest	positions	in	their	work	and
find	no	time	for	amusements.
Destiny	8	women	inherit	property	and	save	money,	mostly	for	their	hard	times
and	old	age.	They	prefer	to	live	alone	because	of	many	sad	experiences	in	their
earlier	married	lives.	They	have	difficulties	in	finding	suitable	life	partners,
although	they	are	devoted	to	their	families.	If	they	have	patience,	spiritual
inclinations,	and	true	faith,	they	can	overcome	the	problems	in	their	domestic
lives	and	marital	relationships.	Destiny	8	men	do	not	respect	their	life	partners.
Destiny	8	people	are	good	planners	and	are	fond	of	success	on	a	grand	scale.
If	they	meet	people	with	favorable	numbers,	they	can	reach	to	great	heights	in
their	careers.
Enmity	with	destiny	8s	is	dangerous.
Destiny	8s	doubt	other	people,	fear	their	opponents,	and	suffer	from
stagnation,	isolation,	and	the	lack	of	a	friendly	environment.
Destiny	8	people	have	to	go	through	a	law	suit	at	least	once	in	their	life.
Name	Number	8
Eight	is	only	good	as	a	name	number	when	the	psychic	or	destiny	numbers	are	1,
3,	or	6.	Otherwise,	it	creates	difficulties,	delays,	and	obstacles,	as	described
earlier.	It	makes	people	lonely	and	unliked	by	their	friends	and	relatives.	But
when	the	destiny	or	psychic	numbers	are	1,	3,	or	6,	they	are	popular,	friendly,
and	are	generally	liked	by	their	friends,	relatives,	and	colleagues.	A	little
isolation	helps	them	to	get	away	from	the	crowds	of	people	that	always	surround
them.	It	brings	success,	name,	and	fame,	although	they	do	have	to	face
hardships.	But	as	the	numbers	1	and	6	are	lucky	numbers,	the	hardships	do	not
remain	so	hard	for	them,	and	their	destiny	or	psychic	numbers	are	able	to
conquer	the	bad	aspects	of	the	Saturnine	influence.	An	individual	having	8	as	a
psychic,	destiny,	and	name	number	all	at	the	same	time	has	true	hard	times	and
suffers	suicidal	tendencies.	In	these	cases,	it	is	better	to	change	the	name	to
either	a	number	1,	3,	or	a	6.
BALANCING	INTERNAL	AND	EXTERNAL
ENVIRONMENTS
By	observing	fasts,	using	the	proper	spices	and	gem	powders,	meditating	on	the
mantras,	and	using	the	yantras,	one	can	balance	the	internal	environment.
Balancing	the	external	environment	is	possible	by	choosing	the	right	time	for
activities	(in	the	ascending	cycle	or	descending	cycle),	selecting	good	friends
(finding	compatible	numbers),	and	starting	a	job	at	the	appropriate	time
(observing	weak	period	and	strong	periods).	Balance	is	achieved	by	working
with	the	energy	flow	that	is	already	available,	as	described	in	the	sections	that
follow.	The	information	that	follows	applies	to	people	with	psychic	number	8.
Weak	Periods
Whenever	Saturn	is	retrograde	or	eclipsed,	number	8s	have	a	weak	period.
Additional	weak	periods	include	the	first	twenty	days	of	January,	the	last	week
of	February,	and	the	months	of	December,	March,	and	April.	During	these	times
they	suffer	losses,	get	blamed	and	humiliated,	and	suffer	separations	from	dear
ones.	They	also	experience	mental	problems	and	become	stubborn	and	cynical.
They	use	intoxicants	and	drugs.	They	feel	unwanted,	neglected,	and	rejected	and
become	greedy.	They	hesitate	in	taking	the	initiative,	feel	stuck,	and	lose
confidence.	They	should	avoid	new	undertakings,	signing	legal	papers,
litigation,	argumentation,	etc.,	during	these	periods.	They	should	not	change
their	apartments	or	rent	new	apartments	during	this	phase.
Strong	Periods
Although	number	8s	are	always	strong,	they	are	especially	strong	between
September	20	and	October	25	and	between	January	20	and	February	20.	These
are	the	best	times	to	start	new	ventures,	complete	all	pending	jobs	and	projects
for	travel	and	business.	During	these	periods	they	should	plan	for	their	future
and,	if	necessary,	look	for	a	better	place	to	live.
Good	Dates
Days	8,	17,	and	26	of	any	month	are	good	for	them.	Those	dates	that	add	up	to
either	1,	3,	or	6	are	also	favorable.	If	these	dates	fall	between	December	21	and
31,	January	20	and	27,	or	between	February	19	and	26,	they	become	more
favorable.	Any	job	started	during	these	periods,	on	the	above-mentioned	dates,
brings	beneficial	results.
Good	Days
Saturday	is	the	best	day	of	the	week	for	number	8s.	If	the	Saturday	falls	on	a
good	date	within	a	good	period,	it	becomes	really	special.
Favorable	Colors
Black,	dark	blue,	grey,	and	purple	are	good	colors	for	number	8	people.	They
should	dress	themselves	in	these	colors	and	have	these	colors	around	them.	They
should	use	curtains,	pillow	covers,	bed	sheets,	and	cushions	of	these	colors.
Black	handkerchiefs	always	bring	them	refreshing	vibrations.
Precious	Stones
Blue	sapphire,	substitutes	for	blue	sapphire,	amethyst,	black	pearl,	and	lapis
lazuli	are	good	stones	for	number	8s.	The	gem	should	be	bought	on	a	Saturday
and	given	to	the	jeweler	the	same	day.	The	jeweler	should	make	a	ring	with	a
mixture	of	five	metals—one	part	gold,	two	parts	silver,	three	parts	lead,	one	part
copper	and	five	parts	iron,	in	an	open	back	setting.	He	can	also	make	it	with
white	gold—one	part	gold	and	ten	parts	silver.	The	gem	should	be	set	in	the	ring
on	a	Saturday,	and	it	should	be	picked	up	from	the	jeweler	on	a	Saturday.	After
performing	the	proper	rituals,	it	should	be	worn	on	the	Saturn	finger	(middle
finger)	after	sunset	or	late	in	the	evening.
They	should	take	blue	sapphire	powder	to	help	their	bodies	heal
electrochemically.
Meditation
Number	8s	should	meditate	on	an	idol	of	Saturn	made	of	the	five	metal	mixture
stated	above	or	on	a	blue	sapphire.1
Before	meditation,	they	should	do	their
morning	cleansing	rituals	and	bathe	if	possible.	(Meditation	is	not	allowed
before	cleansing	the	bowels	in	the	morning.)
Deity
Seated	on	a	vulture,	dark-colored	Saturn	has	a	strong	presence,	round	face,	big
powerful	eyes,	and	a	double	chin.	His	moustache	makes	him	look	more	malefic.
He	has	four	arms.	In	one	hand	he	holds	a	sword,	in	the	other	a	trident.	In	his
third	hand	he	holds	a	club	and	in	his	fourth	hand	he	holds	the	reins	of	the
vulture.	Well-armed	with	weapons,	Saturn	should	be	meditated	on	as	smiling	and
granting	fearlessness.
Mantra
Japa2
(repetition)	of	the	mantra	of	any	planet	should	be	completed	within	the
ascending	cycle	of	the	moon	and	should	be	repeated	the	prescribed	number	of
times.
Number	8s	should	recite	the	mantra	of	Saturn	108	times	daily.	They	can
choose	to	recite	either	the	Vedic	mantra,
AUM	SHANNO	DEVI	RABHISHTHAYE
APO	BHAVANTU	PITAYE
SHAN	YO	RABHISRA	VANTU	NAH:	AUM
or	the	Tantric	mantra,
AUM	AING	HRING	SHRING	SHUNG
SHANAISHCHARAYE	NAMAH:	AUM
Yantra	for	Saturn3
Health	and	Diseases
Saturnine	people	are	susceptible	to	paralysis,	rheumatism,	gout,	deafness,
muteness,	depression,	anxiety,	colic	pains,	ear	troubles,	insanity,	and	asthma.
Their	main	problems	are	with	the	aggravation	of	the	humor	of	wind—gas	in
the	intestines,	constipation,	and	blood	pressure	and	heart	troubles.	They	also
suffer	from	anemia,	impurities	of	the	blood,	weakness	or	numbness	of	the	limbs,
leprosy,	fever,	weakness	of	urinary	bladder,	bleeding,	pain	in	nose	and	ears,	and
baldness.
They	should	massage	their	bodies	regularly	with	sesame	oil	or,	if	possible,
with	mustard	oil.	They	should	use	spices	that	are	also	diuretics,	such	as	cumin,
and	take	morning	walks	in	an	open	area.	Saturn	is	cold	and	dry,	and	they	are
susceptible	to	catching	colds	and	having	dry	skin.	They	would	definitely	be
benefited	by	neelmani	pishthi,	an	ayurvedic	remedy	made	from	blue	sapphire
powder,	which	can	be	taken	orally	with	honey	or	cream	before	going	to	bed.
Number	8	natives	should	increase	their	vitamin	A,	D,	E,	calcium,	and	iron
intake.
Fasting
Number	8	people	should	fast	on	Saturday.	In	the	evening,	following	their	sunset
meditation,	they	should	eat	khichari—a	dish	prepared	from	a	mixture	of	split
urad	beans	(split	black	beans	with	peels)	and	rice.4
They	can	also	eat	candies	made	of	black	sesame	seeds	and	jaggery	(raw	cane
sugar)	instead	of	khichari,	or	use	both.
Friendship
Those	born	on	days	8,	17,	and	26,	or	days	2,	4,	6,	12,	15,	20,	and	24	of	any
month	can	be	good	friends	to	number	8	people.
Romance
Number	8s	should	select	1s,	3s,	5s,	and	6s	for	romance	and	avoid	4s,	8s,	and	9s.
An	eight	can	be	a	friend,	associate,	and	colleague	with	a	person	whose	psychic
number	is	4,	8,	or	9,	unless	the	relationship	is	long-term.	Eights	do	not	help	8s	in
any	way.	Romance	between	two	number	8s	does	not	last	for	a	long	time.
Number	8	has	a	natural	liking	for	people	born	on	days	1,	2,	4,	5,	and	7.
Good	Years	in	Life
The	8th	year,	17th,	26th,	35th,	44th,	53rd,	62nd,	71st,	80th,	and	89th	are	good
for	number	8	natives.	All	years	that	can	be	divided	by	4	are	also	good.
NUMBER	8	PEOPLE	IN	RELATIONSHIP
The	information	given	below	is	based	upon	a	comparison	of	psychic	number	8s
to	other	psychic	numbers.	It	can	also	be	used	to	compare	destiny	8s	to	other
destiny	numbers,	and	name	8s	to	other	name	numbers.	(The	comparisons	are
based	upon	like	categories.)
Number	8	and	Number	1
Number	Is	are	naturally	attracted	to	number	8s	and	provide	them	with	great
incentive	and	energy.	Number	8s	are	melancholic	while	1s	are	happy	and
inspired—they	are	exact	opposites.	Eights	need	1s	for	happiness	and	inspiration.
The	number	1	is	light,	and	number	8	is	darkness;	darkness	needs	light.	But	1s
also	serve	as	enemies	by	imposing	disciplines	and	laws	on	8s,	who	do	not	obey
these	laws	and	follow	no	disciplines.	This	creates	problems	for	8s.	But	as	1	is	a
lucky	number,	it	brings	much-needed	good	luck	to	8s.	Number	8s	are
materialists,	and	1s	idealists.	They	do	not	work	very	well	together	for	a	long
time	and	8s	finally	break	off	the	relationships.	But	1s	are	still	good	numbers	for
friendships	and	romance,	if	not	for	business	partnerships	or	life	partnerships.
Eights	should	select	1	s	for	any	relationship.	Number	8	women	can	marry
number	1	men	and	feel	lucky	for	some	time;	their	marriage	is	never	a	permanent
affair	with	any	number.	Also	eights	can	select	the	number	1	for	residential
numbers.
Number	8	and	Number	2
Number	8	is	ruled	by	Saturn,	and	number	2	is	ruled	by	the	Moon.	Saturn	is
neutral	to	the	Moon,	but	the	Moon	is	an	enemy	of	Saturn.	They	are	attracted	to
each	other.	Number	8s	are	always	helpful	to	2s	and	they	can	remain	good
friends,	but	2s	do	not	help	8s	in	a	practical	way;	they	only	provide	verbal
support.	Twos	are	not	good	for	business	partnerships	and	life	partnerships,
although	they	help	8s	to	make	money,	and	make	money	themselves.	Twos	get
easily	nervous,	and	8s	have	strong	powers	of	endurance,	which	helps	2s.	These
two	numbers	can	work	together	on	a	project	in	which	the	number	8	person	has
the	authority.	Eights	should	select	the	number	2	for	appointment	dates	or
residential	numbers.
Number	8	and	Number	3
Number	8s	and	number	3s	have	a	neutral	relationship	like	Saturn	and	Jupiter.
Jupiter	is	a	believer	in	dharma	(natural	laws),	and	Saturn	does	not	believe	in
laws.	Saturn	does,	however,	respect	Jupiter,	who	happens	to	be	a	teacher	of	his
father—the	Sun	God.	Thus	8s	and	3s	neither	harm	nor	benefit	each	other.	Eights
are	self-sufficient	and	do	not	ask	for	help;	3s	are	teachers	who	do	not	advise	or
help,	unless	asked.	So	3s	are	never	really	involved	with	8s,	but	they	remain	good
friends.	Number	3s	can	bring	joy	and	happiness	into	the	dry	lives	of	8s.	If	8s	can
ask	for	and	listen	to	the	advice	of	3s,	they	can	achieve	both	material	and	spiritual
success.	Number	8s	should,	therefore,	be	ready	for	hard	work	and	select	3s	for
friendship	and	business.	If	8s	are	in	politics,	3s	can	be	very	helpful.	Together
they	can	do	marvellous	things	for	humanity	at	large,	such	as	bring	social
reforms.	Number	3s	are	not	suitable	for	8s	in	marriage,	but	for	romance	they	are
good.
Number	8	and	Number	4
Number	8s	and	number	4s	are	friends.	Rahu,	ruler	of	number	4,	is	described	as
similar	to	Saturn	in	nature.	People	with	both	numbers	are	revolutionary,	lovers	of
justice,	and	successful	only	in	the	latter	part	of	their	lives.	Number	4s	do	not	care
for	money	and	spend	freely,	while	8s	like	to	save	and	are	incapable	of	spending
it.	Fours	can	learn	from	8s	the	secrets	of	saving	money	for	hard	times.	These
numbers	are	very	similar:	both	are	misunderstood;	both	face	obstacles,	hardships
and	opposition;	both	are	unpredictable	and	changing—their	friendship	is
mutually	beneficial.	Their	friendship	provides	the	number	8	person	with	a	sense
of	fulfillment	and	helps	him	or	her	grow	and	develop.	A	number	4	is	quieting
and	calming	to	a	number	8;	a	number	4	makes	an	8	fortunate.	Number	8s	should
select	4s	for	friends,	business	or	life	partnerships,	appointment	dates,	or
residence	numbers.	Some	Western	numerologists	suggest	that	4s	are	not	good	for
number	8s.	This	may	be	because	they	associate	the	number	4	with	the	negative
side	of	1,	the	Sun,	or	because	they	connect	it	with	Uranus	and	with	sudden
outbursts	of	anger.	Then	Saturn	becomes	the	total	opposite	of	4.	But	as	we	have
seen	great	similarity	between	4s	and	8s,	it	is	clear	that	a	4	is	the	only	hope	for	an
8—being	a	true	sympathizer,	helper,	and	friend.	Nobody	understands	8s;	4s	do
and	they	provide	them	with	positive	vibrations.	Number	8s	should	not	be	guided
by	the	numerologists	who	claim	that	4s	are	not	good	for	them:	they	should	select
4s.	Specifically,	number	8	men	can	select	number	4	women	for	marriage,
friendships,	romance,	and	business	partnerships.
Number	8	and	Number	5
Number	8s	and	number	5s	have	a	strange	relationship.	Saturn	is	neutral	in
friendship	to	Mercury,	and	Mercury	is	friendly	with	Saturn,	but	Saturn	is	malefic
and	Mercury	benefic.	They	are	poles	apart—5	is	fast,	8	is	slow.	Number	5s	are
jovial	and	love	humor	and	jokes;	number	8s	are	serious	and	do	not	appreciate
humor	or	jokes.	This	creates	problems.
Eights	neglect	5s	and	do	not	support	5s	wholeheartedly;	5s	also	withdraw	and
become	self-conscious.	Friendship	between	the	two	is	only	possible	in	the
political	field	and	in	organizations	or	institutions	working	for	human	welfare.
There	they	can	benefit	each	other,	but	otherwise	they	do	not	make	good
company.	Eights	should	not	select	5s	for	friendships,	or	business	or	life
partnerships.	Number	8s	should	not	start	important	projects	on	day	5,	14,	or	23
of	any	month.	Nor	should	they	start	a	journey	of	those	dates.	Number	8s	should
avoid	5s	for	residential	numbers.
Number	8	and	Number	6
Number	8s	and	number	6s	are	very	good	friends.	Sixes	are	always	helpful,
inspiring,	attractive,	well	mannered,	gentle,	and	playful.	Number	8s	are	easily
attracted	to	6s	and	become	social	and	tolerant	in	their	company.	In	fields	such	as
art,	politics,	and	film,	8s	and	6s	make	good	combinations;	they	are	also	good	in
friendships,	business	partnerships	(providing	6s	have	the	upper	hand),	and	life
partnerships.	Eights	can	select	the	number	6	for	appointment	dates	or	residential
numbers.	Number	6	women	are	lucky	for	number	8	men,	and	make	good	home
makers.	With	them	8s	can	have	clean,	nicely	arranged	homes	with	some	warmth,
love,	and	peace.	Although	this	relationship	does	not	last	permanently,	it	can	be
prolonged	if	the	8	makes	frequent	journeys	to	foreign	lands	and	the	6	gets	time
to	be	alone	and	independent.	This	practice	could	help	the	8	extend	his	marital
life	with	any	suitable	number,	such	as	1,	3,	4,	5,	or	6.
Number	8	and	Number	7
Number	8s	and	7s	have	a	relationship	of	their	own.	Eights	are	beneficial	to	7s,
but	7s	dislike	8s	for	personal	reasons	and	do	not	communicate	freely	with	them.
Eights	feel	comfortable	with	7s;	the	reverse	is	not	true.	This	creates	difficulties
in	lifelong	partnerships	and	friendships,	and	therefore	8s	and	7s	are	not	ideal	for
marriage.	In	friendships,	8s	have	to	work	hard	and	serve	7s;	otherwise,	7s	turn
away.	In	financial	matters	they	can	cooperate,	but	8s	have	to	have	the	upper	hand
in	management.	In	the	field	of	life	and	love,	8s	can	learn	from	7s	and	thus	enrich
their	own	lives.	A	number	7	person	has	an	unusual	personality	and	an	8	is
uncommon	also.	They	can	work	together	when	the	7	is	elderly	and	the	8	is
young,	when	the	7	is	a	teacher	and	the	8	a	student,	or	when	the	7	is	the	head	of	a
community	or	organization	and	the	8	handles	the	management.	Eights	can	also
select	a	house	number	that	totals	7,	but	the	house	will	become	a	meeting	place
for	occult	practices,	and	many	spiritual	teachers	will	visit	that	house.	Eights	can
select	7s	for	appointment	dates	or	residential	numbers.
Number	8	and	Number	8
Two	number	8s	become	strong	in	combination.	When	they	come	together,	they
dissolve	into	each	other	and	try	to	please	each	other.	And	when	two	number	8s
become	opponents,	they	give	each	other	a	good	fight.	As	friends,	they	inspire
each	other	and	are	good	companions	when	both	are	interested	in	material	success
or	success	in	religion	or	occult	sciences.	Although	8s	are	not	teachers	or	good
students	of	8s,	as	coworkers	they	cooperate	very	well	and	gain	the	desired
success.	The	combination	is	good	for	business	partnerships	or	life	partnerships.
If	both	husband	and	wife	are	interested	in	a	human	welfare	organization,	they
remain	together	and	help	the	organization.	Eights	can	select	number	8	for
appointment	dates	or	residential	numbers.
Number	8	and	Number	9
Number	9s	are	enemies	of	number	8s,	but	good	enemies.	Number	9s	inspire	8s
to	think	and	contemplate;	they	are	good	teachers	for	8s	and	help	them	grow	and
develop.	Eights	have	to	spend	energy	on	9s	and	help	them	financially.	The
number	8	is	a	lucky	number	for	9,	but	the	reverse	is	not	true.	In	business
partnerships,	number	8s	are	benefited	if	the	businesses	are	in	their	own	name,
and	vice	versa.	Number	8s	can	select	9s	for	friendship	and	marriage.	Number	9
women	and	number	8	men	can	make	a	good	combination	for	some	time.	A
number	8	woman	will	face	financial	problems	with	a	number	9	man.	Eights
should	select	9s	for	residential	numbers,	but	9s	may	not	be	ideal	appointment
dates	for	important	jobs.	If	eights	select	9	for	a	house	number,	they	will	have	to
spend	a	lot	of	money	to	maintain	the	house.


Mars	and	Number	9
Mars	is	the	ruling	planet	of	people	born	on	day	9,	18,	or	27	in	any	month,	or
those	whose	destiny	or	name	number	totals	9.	The	Mars	qualities	described
below	are	most	clearly	visible	in	people	who	have	9	as	a	psychic	number.
Mars	is	the	commander	in	chief	of	the	assembly	of	the	Gods.	It	is	respected	by
the	nine	luminaries,	the	nine	planets	which	are	facets	of	the	same	divinity.	Mars
is	personified	as	a	strong	masculine	figure,	dressed	as	a	warrior	and	riding	a	ram
(an	animal	famous	for	its	combative	nature).	The	word	martial	most	probably
has	its	origin	from	the	planet	Mars	and	its	qualities:	a	strong	sense	of	purpose,
duty,	order,	and	discipline.	Mars	is	famous	for	such	qualities	as	courage,	bravery,
patience,	and	self-confidence.	One	of	the	Sanskrit	terms	for	Mars,	Lohitang,
describes	its	shiny	red	color,	which	can	be	seen	with	the	naked	eye	in	the	night
sky.
Mars	is	considered	a	malefic	planet	by	astrologers,	because	the	natives	ruled
by	Mars	are	egotists	who	put	their	own	desires	above	those	of	others.	Its
influence	makes	them	short-tempered,	argumentative,	lovers	of	destructive
weapons,	restless,	unstable,	cruel,	and	violent.	They	are	capable	of	harming	any
or	all	of	their	associations.	Mars	is	also	thought	to	be	malefic	because	it	creates
difficulties	in	the	marital	life	of	its	natives	when	it	is	placed	in	the	first,	fourth,
seventh,	or	tenth	house	of	their	natal	chart.
Mars	is	related	to	the	blood,	as	its	other	Sanskrit	names,	Kujar	and	Rudhir,
suggest.	It	is	also	related	to	the	muscular	system,	and	to	the	bone	marrow,	which
strengthens	the	immune	system	by	manufacturing	white	blood	corpuscles	to
fight	off	viruses	and	bacteria.	In	this	way,	Mars	helps	the	body’s	defense
mechanisms.	It	rules	over	courage,	which	is	directly	related	to	blood	sugar
levels.	Thus	Mars	provides	strength	and	is	related	to	well-being.	However,	the
instability	and	restlessness	given	by	Mars	makes	its	natives	always	unsure,
doubting,	and	impulsive	by	nature.	These	qualities	create	a	kind	of	insensitivity,
which	makes	Mars	malefic	and	makes	its	natives	prone	to	illegal	ventures	and
illicit	love	affairs.
Natives	ruled	by	Mars	are	lovers	of	the	martial	arts,	hunting,	sports,	debates,
contests,	public	speaking,	and	politics.
Mars	gives	its	natives	a	sportsmanlike	spirit,	which	makes	them	accept	defeat
or	victory	equally	well.	It	gives	its	natives	a	dynamic	energy	that	makes	them	do
daring	things,	such	as	walk	on	fire	or	fight	with	a	tiger	or	elephant.	Its	natives
love	to	surprise	people	by	their	unusual	courage.	They	achieve	the	peak	of	their
power	from	twenty-seven	to	forty	years	of	age.
The	Sun,	Moon,	and	Jupiter	are	friends	to	Mars.	Saturn,	Venus,	Rahu,	and
Ketu	are	neutral	in	friendship;	Mercury	is	its	only	enemy.
Those	natives	born	on	the	twenty-seventh	are	the	most	gentle	and	doubting;
those	born	on	the	ninth	are	rougher	and	tougher,	but	also	more	fortunate	and
powerful.	Natives	born	on	the	eighteenth	suffer	from	inner	conflicts	and	become
progressively	less	clear,	more	selfish,	and	quarrelsome	With	time.
NUMBER	9
Psychic	Number	9
Nine	is	the	psychic	number	of	those	born	on	day	9,	18,	or	27	of	any	month.	All
qualities	of	Mars	stated	above	are	clearly	visible	in	natives	born	on	the	ninth	day
of	any	month.
A	planet	of	fire	and	heat,	Mars	creates	an	intense	energy	that	is	not	easy	to
handle.	It	makes	psychic	number	9	natives	restless;	they	are	constantly	engaged
in	activities.	They	cannot	rest	until	they	have	succeeded	in	achieving	their
desired	goals.	They	are	fighters	and	fight	their	way	toward	the	top	in	any	field,
with	a	competitive	but	sportsmanlike	spirit.	They	are	courageous	and	love
adventure.	They	are	ambitious	and,	due	to	their	strong	will	and	determination,
they	progress	rapidly	on	their	chosen	path.	They	react	quickly	to	situations	and
become	alert	at	the	first	unfavorable	signal.	Their	inner	defense	mechanisms	are
strong	and	they	are	always	ready	to	receive	opposition.	Often	they	create
enemies	by	their	over-alertness.	They	like	to	finish	a	dispute	the	minute	it	starts
and	do	not	brood	or	ponder	over	their	problems	or	exhaust	their	energies	slowly.
They	are	outspoken.	The	influence	of	Mars	gives	number	9	natives	a	volatile
nature;	they	are	easily	provoked	and	explode	more	quickly	than	dynamite.	They
do	not	believe	in	wasting	time	waiting	for	an	opportune	moment.	Optimistic	and
independent	in	nature	with	an	inexhaustible	supply	of	energy,	they	do	not	like	to
live	on	charity	or	be	at	the	mercy	of	others.	They	are	free,	frank,	fearless,
impulsive,	and	tyrannical.	They	are	extremists	and	believe	in	startling	and
surprising	the	world	with	their	daring	acts,	which	sometimes	leads	them	toward
a	tragic	end.	They	meet	even	a	tragic	end	with	courage	and	are	not	frightened	by
death	or	disaster.	Hard	workers	who	love	hardships,	number	9	natives	are	full	of
enthusiasm	and	inspiration	and	are	always	in	a	hurry	to	achieve	their	desired
object.	They	do	not	appreciate	interference	in	their	work	and	hate	criticism.	They
have	a	great	sense	of	responsibility.	Whatever	they	are	doing	is	guided	by	their
sincerity	and	true	understanding	of	the	situation,	which	requires	them	to	act	the
way	they	do.	They	have	good	opinions	about	themselves	and	like	to	be
recognized	and	acknowledged	for	that.	Their	dominating	natures	bring	them
resentment	and	criticism	from	every	walk	of	life.	In	youth,	they	have	to	face
difficulties	and	opposition	and	bear	hardships	to	achieve	respectable	places	in
societies,	homes,	jobs,	or	fields	of	work.	But,	because	of	their	strong	will	and
determination,	they	become	successful	after	they	reach	forty.
They	are	like	a	coconut—hard	on	the	outside	and	full	of	sweet	pulp	inside.
Outwardly,	they	are	hard,	disciplined,	and	unshakable;	inside	they	are	soft	and
compassionate.	They	take	good	care	of	their	subordinates.
Psychic	9	natives	are	good	organizers	and	able	administrators.	If	given	full
authority	and	control,	their	resources,	hard	work,	optimistic	attitudes,	and
practical	knowledge	can	be	of	help	to	organizations.	Without	authority	and
complete	control,	they	become	disinterested	and	slowly	inactive.	They	love
honor	and	prestige	and	can	do	anything	and	bear	any	kind	of	physical,	mental,	or
financial	losses	for	the	sake	of	their	honor	and	prestige.	They	spend	energy	to	get
affection	and	sympathy.
Although	they	are	especially	devoted	to	their	families	and	take	good	care	of
their	parents,	they	are	somewhat	unlucky	in	their	domestic	lives	and	quarrel
frequently	with	their	life	partners.
A	psychic	number	9	man	is	motivated	by	sexual	impulse.	But	often,	because
he	dominates	his	partner	and	is	possessive,	he	meets	failure	and	becomes
desperate.	His	behavior	toward	his	life	partner	over	time	becomes	erratic.	If	he
finds	a	good	life	partner	in	his	early	years,	he	leads	a	successful	married	life.	He
wants	complete	union,	deep	romantic	involvement,	and	physical	pleasure	from
his	wife.	If	he	gets	complete	attention,	he	experiences	spectacular	progress	in
life.
While	a	psychic	number	9	man	does	not	show	much	respect	and	love	for	his
wife,	he	is	very	kind,	jovial,	and	friendly	with	other	women.	He	loses	his	temper
and	mental	balance,	quarrels,	and	isolates	himself	from	his	wife,	and	suffers.	He
is	misjudged	by	his	life	partners,	friends,	and	relatives,	although	his	marriage
brings	financial	good	fortune	and	worldly	success.	While	fond	of	pomp	and
show,	he	mostly	lives	a	simple	life.
A	psychic	number	9	woman	is	generally	very	caring,	hospitable,	and	friendly,
although	selective	and	secretive	in	her	involvements.	She	can	make	an	excellent
housewife,	devoted	and	loyal	to	her	husband,	full	of	glamor	and	charming,	but
she	has	less	chance	for	a	wholesome	married	life	than	does	a	number	9	man.	She
expects	total	loyalty	from	her	husband	and	cannot	tolerate	any	kind	of	flirtation.
Her	life	partner	becomes	sick,	and	she	has	to	spend	large	amounts	of	energy	on
him.
Both	male	and	female	psychic	number	9	natives	say	no	before	they	say	yes.
They	spend	a	lot	of	time	and	energy	keeping	their	houses	and	workplaces
immaculately	clean	and	in	order,	but	they	cannot	create	order	and	peace	in	their
domestic	lives.
They	are	susceptible	to	accidents	and	injury	from	fire,	explosives,	and
electricity;	they	have	to	go	through	a	surgical	operation	and	a	law	suit	in	their
life.	They	are	often	wounded	or	injured	and	meet	their	death	through	wounds	or
injuries	that	become	infected	or	through	surgical	operations.
When	emotionally	hurt,	they	become	revengeful,	aggressive,	and	cruel.
They	are	born	with	the	abilities	of	leadership	and	can	control	very	obstinate
and	stubborn	people	with	their	compassion	and	human	qualities.
When	the	destiny	number	and	name	number	are	in	harmony,	a	psychic
number	9	person	rises	to	become	head	of	a	large	organization.	A	psychic	9
possesses	a	powerful	and	dominating	personality,	has	high	ideals,	is	broad
minded	and	creative.	Marriage	between	a	psychic	9	and	someone	who	has	a
harmonious	number	makes	for	a	good	family—open	to	all,	helpful,	serving,	and
exemplary.	If	born	into	a	family	in	which	the	numbers	of	their	parents	and
siblings	are	harmonious,	a	psychic	9	enjoys	life,	rises	in	status,	becomes	famous,
and	achieves	greatness.
Psychic	9	natives	are	born	to	be	successful	and	have	all	the	necessary	qualities
to	be	so.	They	awe	people	by	performing	daring	acts	in	their	middle	age.	They
are	thought	to	be	fortunate	by	people	who	are	not	their	life	partners	and	close
friends.
Precautions	for	Psychic	Number	9
All	number	9s	are	prone	to	accidents	caused	by	fire,	explosives,	storms,	flood,
and	traffic.	They	should	be	alert	while	handling	firearms;	avoid	going	through
hurricanes,	storms,	and	floods;	and	be	careful	while	driving.
They	should	avoid	any	kind	of	provocation	and	thoughts	of	revenge.
They	should	get	rid	of	false	pride	and	hypocrisy	because	it	brings	jealousy	and
criticism.
They	should	not	become	emotional	quickly	and	lose	courage.
They	should	avoid	taking	risks	and	doing	daring	acts	unnecessarily	or	only	to
prove	their	courage,	endurance,	and	determination.
They	should	avoid	negative	talk,	complaining,	and	judging	their	colleagues,
partners,	and	life	partners.	They	should	love	their	life	partners,	create	peace	in
their	domestic	lives,	and	remember	the	axiom	“To	err	is	human,	and	to	forgive	is
divine.”
They	should	avoid	surgical	operations,	whenever	possible.
They	should	not	hurry	and	should	overcome	their	restlessness.
They	should	avoid	appearing	stern	and	learn	to	keep	smiles	on	their	faces.
They	should	respect	their	superiors	and	not	enter	into	unnecessary	arguments
or	discussions	with	them,	because	9s	are	easily	provoked	and	lose	their	tempers.
They	should	avoid	all	quarrelsome	situations	and	try	not	to	be	negative,
offensive,	loud,	or	violent.
They	should	follow	disciplines	that	create	order	in	their	lives.
They	should	be	careful	in	signing	legal	papers	and	should	study	them	properly
before	doing	so.	If	necessary,	they	should	consult	lawyers	or	experts	before
signing.
They	should	not	be	overconfident	about	their	powers,	energies,	and	robust
personalities,	and	they	should	avoid	being	extremists.	They	should	be	careful
with	their	own	power	because	it	could	destroy	them,	too.
They	should	avoid	three	of	their	main	shortcomings:
anger
arrogance
aggressiveness.
They	should	not	isolate	themselves	but	rather	should	widen	their	circles	of
friends	and	acquaintances.
They	should	not	lose	touch	with	humor	at	any	cost—it	will	bring	them	good
luck.
They	should	keep	track	of	the	movement	of	Mars	through	different	signs	of
the	Zodiac	and	avoid	starting	new	ventures,	performing	daring	tasks,	or	leading
movements	when	Mars	is	debilitated,	exiled,	or	retrograde.
They	should	avoid	intoxicants	and	drugs,	because	they	are	prone	to	addiction.
Destiny	Number	9
The	number	9	is	better	as	a	destiny	number	than	a	psychic	number.	Psychic	9
people	are	short-tempered,	angry,	and	quarrelsome.	Those	with	9	as	a	destiny
number	are	governed	by	their	psychic	number.	If	the	latter	is	harmonious,	they
get	over	their	anger	and	shortcomings	easily	and	repent	for	their	impulsive,
quarrelsome	behavior.	In	the	absence	of	a	harmonious	psychic	number,	a	destiny
9	person	should	choose	a	harmonious	name	number	because	it	has	a	great
influence	on	the	psyche.	The	practice	of	some	kind	of	religious	discipline	can
also	help	overcome	these	shortcomings.
They	develop	spiritually	and	mentally	through	the	hardships	of	life;	they
understand	the	meaning	of	cosmic	love	and	can	appreciate	true	wisdom.	If	they
set	the	goal	of	achieving	perfection	in	spiritual	life,	they	succeed	in	it	and
achieve	the	knowledge	of	both	mind	and	matter.	They	prove	to	be	excellent
teachers.	They	do	not	believe	blindly	in	what	they	learn	from	the	scriptures	and
their	spiritual	teachers,	but	add	the	dimension	of	practical	experience,	which
enables	their	students	to	be	truly	spiritual.
Destiny	9	and	psychic	9	people	are	both	lovers	of	fine	art	and	beauty.	The
difference	between	them	is	psychic	9	natives	have	to	learn	and	struggle	to	make
their	way	in	the	world	of	fine	art.	Destiny	9	people,	on	the	other	hand,	easily
become	successful	and	famous	in	that	field	and	are	surrounded	by	beauty	of	all
kinds.	They	become	the	favorites	of	beautiful,	famous,	and	successful	artists,
eminent	writers,	and	spiritual	masters.
Although	destiny	9	people	have	to	face	difficulties	and	conflicts	with	their
parents	and	siblings	in	childhood,	later	on	they	are	loved	by	them,	and	their
noble	qualities	become	fairly	well	recognized	and	appreciated.
It	is	their	destiny	to	be	always	busy.	They	become	restless	when	they	rest	or
are	asked	to	rest.
Interested	in	everything	that	makes	life	enjoyable,	they	love	adventure	and
romance	and	believe	that	life	is	meant	for	enjoyment	and	the	sharing	of
inspiration.	They	become	interested	in	higher	and	more	refined	ways	of	living.
They	follow	their	own	inner	guidance	in	seeking	truth.	They	are	able	to
recognize	truth	because	their	intuitions	are	good	and	they	try	to	adopt	the	right
means	to	reach	it.	They	follow	hard	disciplines,	which	they	either	invent	or
impose	on	themselves	to	go	deeper	into	the	truth.	Destiny	9s	are	not	snobbish;
they	feel	a	oneness	with	all	living	beings	and	see	the	spark	of	the	divine	in
everything.	They	are	the	protectors	of	humanity	at	large	and	of	all	living	forms.
They	become	interested	in	the	healing	arts	and	ecology,	in	addition	to	their
interests	in	music,	chanting,	and	the	fine	arts.
The	last	in	the	series	of	primary	whole	numbers,	9	is	a	number	of	completion
of	the	soul	(consciousness)	and	is	also	considered	mystical.	To	have	a	destiny
number	of	9	means	to	be	at	the	end	of	the	cycle	of	life	and	death	(birth	and
rebirth).	If	these	people	become	conscious	of	this	early	in	their	lives	(the	destiny
number	normally	becomes	powerful	only	after	thirty-five),	they	can	accomplish
their	goals.	They	do	this	by	working	out	their	past	life	karmas	and	by	avoiding
new	karmas,	which	are	created	by	desires	for	sensual	gratification.	They	can
become	enlightened	and	go	ahead	on	the	path	of	no	return.
Destiny	9	makes	people	spiritually	inclined,	soft,	and	humble.	Their	violent
nature	finds	a	way	out	through	debates,	public	speaking,	and	following	hard,
self-imposed	disciplines.	It	gives	them	single-mindedness	and	the	dedication	of	a
saint;	it	gives	them	endurance	and	the	spirit	of	a	sportsman.	Those	who	are	not
spiritually	inclined	express	their	violence	in	politics	or	at	work	through	more
civilized	forms	of	quarrel	and	combat.
Destiny	9s	have	to	struggle	a	lot	because	of	their	doubting	nature,	their
negative	ways	of	thinking,	and	their	imaginary	problems.
Name	Number	9
While	the	name	number	influences	the	psychic	number,	it	does	not	affect	the
destiny	number,	because	destiny	is	created	by	past	life	karmas.	When	the	psychic
number	is	not	in	harmony	with	the	destiny	number,	then	the	name	number	can
generate	harmony	in	life—this	is	why	people	sometimes	change	names	or	adopt
pen	names.	Nine	is	definitely	not	good	as	a	name	number	for	those	with	a
psychic	or	destiny	number	of	9:	it	will	make	the	influence	of	Mars	more
powerful	and	create	problems	in	their	marital	life.	But	9	is	a	very	good	name
number	for	those	who	have	2,	3,	or	7	as	their	psychic	or	destiny	numbers.	For
number	6	people	it	is	neither	bad	nor	good,	but	neutral.	To	number	2s	it	brings
strength;	to	number	3s,	good	luck;	and	to	number	7s	it	brings	help	from
everywhere.
A	name	number	9	makes	people	frank,	expressive,	creative,	and	independent.
It	gives	them	strong	wills	and	determination	and	the	strength	and	endurance	to
bear	the	hardships	and	oppositions	of	life.	For	politicians	it	is	a	good	name
number.	It	is	also	good	for	sportsmen,	wrestlers,	military	people,	artists,	poets,
musicians,	composers,	and	saints.	It	brings	them	fame,	honor,	prestige,	and
recognition.	Name	number	9	also	makes	people	work	hard,	and	leaves	them	no
time	for	amusement	and	rest.	It	generates	restlessness	but	also	makes	them
creative.	They	use	their	restlessness	to	express	the	restlessness	present	in	the
world	outside.	They	work	to	create	better	living	conditions	in	which	they	and
their	world	can	rest	and	enjoy.	Name	number	9	also	gives	an	adventurous	and
romantic	nature.	It	makes	males	more	masculine	and	gives	attraction	and	glamor
to	females.	For	the	spiritually	inclined	this	name	number	is	of	great	help.	It
makes	them	meet	renowned	spiritual	masters,	clairvoyants,	and	psychiatrists.
Sometimes	they	themselves	become	one	of	these	and	achieve	fame	for	their
intuitive	power	and	surprising	feats.	All	number	9	natives	should	engage	in	some
kind	of	regular	religious	practice	that	involves	chanting	and	physical	exercises.
Nine	is	not	a	good	name	number	for	psychic	or	destiny	4s	or	8s.
BALANCING	INTERNAL	AND	EXTERNAL
ENVIRONMENTS
By	observing	fasts,	using	the	proper	spices	and	gem	powders,	meditating	on	the
mantras,	and	using	the	yantras,	one	can	balance	the	internal	environment.
Balancing	the	external	environment	is	possible	by	choosing	the	right	time	for
activities	(in	the	ascending	cycle	or	descending	cycle),	selecting	good	friends
(finding	compatible	numbers),	and	starting	a	job	at	the	appropriate	time
(observing	weak	period	and	strong	periods).	Balance	is	achieved	by	working
with	the	energy	flow	that	is	already	available,	as	described	in	the	sections	that
follow.	The	information	that	follows	applies	to	people	with	psychic	number	9.
Weak	Periods
The	beginning	of	the	months	of	March,	May,	and	June,	as	well	as	from	October
1	to	21,	and	from	November	27	to	December	27	are	their	weak	periods.	During
these	times	they	can	experience	defeats,	failures	in	love	affairs,
misunderstandings,	setbacks	in	health,	less	interest	in	work,	restlessness,
conspiracies,	lawsuits,	doubts,	unnecessary	worries,	criticism,	and	an	increase	in
enmity.
Strong	Periods
The	periods	from	March	21	to	April	26,	and	from	October	21	to	November	27
are	favorable	and	strong	for	number	9	people.	During	these	times	they	should
start	new	ventures,	do	daring	tasks,	complete	old	projects,	search	for	new	homes,
start	new	communes,	and	travel	abroad.
Good	Dates
Days	9,	18,	and	27	of	any	month	are	good	for	number	9s.	Days	3,	6,	15,	21,	24,
and	30	are	also	favorable.	If	these	dates	fall	during	their	strong	periods,	they
become	more	favorable.
Good	Days
Tuesday	and	Friday	are	good	for	9s.	If	these	days	fall	during	the	strong	periods
on	favorable	dates,	they	become	more	beneficial.
Favorable	Colors
All	shades	of	red	and	pink	are	suitable	for	9s	because	red	is	the	color	of	Mars.
They	should	use	this	color	in	any	way	that	suits	them.	Pink	bed	sheets,	pillow
covers,	cushion	covers,	and	living	room	curtains	bring	good	vibrations;	looking
at	handkerchiefs	of	any	shade	of	red	refreshes	them	if	they	feel	a	lack	of	energy.
Precious	Stones
Coral	is	the	most	favorable	stone	for	number	9	people.	Those	9s	who	are	very
arrogant	and	angry	are	advised	to	wear	white	coral	in	the	prime	of	their	youth,
and	after	forty	years	of	age	they	can	use	red	coral	(Italian),	vermilion	coral
(Tibetan),	or	a	light	coral.	They	can	also	use	carnelian	and	jasper	(red),	red	agate,
or	sange	moose	(a	red	stone).
The	stone	should	be	bought	on	a	Tuesday	only,	before	11	A.M.	It	should	be
given	to	the	jeweler	on	a	Tuesday	and	the	ring	or	pendent,	whatever	is	made,
should	be	picked	up	from	the	jeweler	on	a	Tuesday.	It	should	be	set	in	a	mixture
of	copper	and	gold	and	worn	before	11	A.M.	after	performing	the	rituals
prescribed	for	Mars.
They	should	take	coral	powder	to	help	their	bodies	heal	electrochemically.
Meditation
Number	9s	should	meditate	on	a	picture	or	idol	of	Hanuman,	the	monkey	God,
or	on	a	piece	of	coral.	Meditation	should	take	place	in	the	early	hours	of	the
morning,	a	half	hour	before	or	after	sunrise	(worship	of	Hanuman	is	prohibited
before	the	first	hour	of	sunrise).	They	can	also	use	a	Mars	yantra	engraved	on	a
copper	plate	for	meditation.
Deity
Their	deity	is	Hanuman,	the	monkey	God.	Hanuman	is	a	symbol	of	selfless
service.	He	is	devoid	of	ego,	as	he	considers	himself	a	humble	servant	of	Ram
(an	incarnation	of	Lord	Vishnu,	the	preserver)	and	does	not	claim	to	have	any
power	of	his	own.	His	strength	to	perform	superhuman	feats	comes	from	Lord
Ram.	Nines	should	understand	this	clearly	and	not	feel	proud	of	their	powers.
They	should	learn	the	lesson	of	total	surrender	from	Hanuman	and	practice	it	in
their	own	lives.
Mantra
Japa1
(repetition)	of	the	mantra	of	any	planet	should	be	completed	within	the
ascending	cycle	of	the	moon	and	should	be	repeated	the	prescribed	number	of
times.
Number	9s	should	repeat	this	mantra	108	times	a	day:
AUM	NAMO	HANUMATE	HUNG—AUM
They	can	recite	the	Hanuman	Gayatri	mantra	below	eleven	times	a	day,	for
protection	from	storms,	fire,	or	an	auto	accident.
AUM—ANJANEYAYE	VIDMAHE
MAHABALAYE	DHI-MAHI
TANNO	HANUMAN	PRACHODAYAT—AUM
Yantra	for	Mars2
Health	and	Diseases
Number	9	people	are	prone	to	all	kinds	of	fevers,	because	they	are	bile
dominated	and	aggravation	of	the	bile	brings	on	fever.	They	are	also	susceptible
to	infections,	cuts,	and	wounds	that	produce	infectious	fevers,	chicken	pox,
measles,	and	skin	diseases	like	eczema	and	rashes.	They	can	also	have	disorders
of	the	blood,	poisoning,	ulcers,	excessive	thirst,	tuberculosis,	diseases	of	the
stomach,	liver,	lungs,	nose,	and	ears.
They	can	also	have	psychic	disturbances	and	bone	disorders.	Although	they
have	strong	builds	and	they	do	not	get	sick	easily,	during	their	weak	period	they
can	have	the	problems	mentioned	above.
Overindulgence	in	sexual	activities	without	proper	attention	to	food	and	rest
can	exhaust	them,	weaken	their	immune	systems,	and	make	them	suffer	from
infections	and	infectious	diseases.	They	should	take	proper	care	of	their	wounds.
They	should	avoid	oily	and	greasy	foods,	pickles,	hot	spices,	and	excessive	use
of	intoxicants	and	drugs.	Number	9	men	should	use	dates	cooked	in	milk.	They
can	make	a	drink	by	mashing	cooked	dates	in	milk,	straining	the	dates,	and
adding	a	pinch	of	well-ground	saffron	to	the	date	milk.	Massaging	the	body	with
oil	every	day	or	at	least	three	times	a	week	protects	them	from	skin	rashes	and
other	problems	caused	by	dry	skin.	A	morning	walk	will	help	their	lungs.	Jala
neti	(drinking	water	through	the	nose)	will	prevent	nose	problems;	putting	one	or
two	drops	of	oil	occasionally	in	the	ears	will	protect	them	from	ear	problems.
Years	9,	18,	27,	36,	45,	54,	and	63	are	important	for	their	health;	most	health
changes—good	and	bad—occur	during	these	years.
Fasting
Fasting	once	a	week	on	Tuesday	is	very	helpful	for	number	9	people.	The	food
recommended	for	the	evening	fast	is	devoid	of	salt	and	grains.	One	can	drink
juices	during	the	day	when	thirsty.	In	the	evening	after	meditation,	one	can	eat	a
sweet	bread	or	pancake	made	from	chickpea	flour,	anise	seeds,	and	jaggery
(unrefined	cane	sugar).	For	preparing	the	sweet	bread	dough	or	pancake	paste,
water	or	milk	should	be	added	according	to	the	recipe.	Ghee	or	butter	should	be
used	instead	of	oil	to	fry	the	breads	or	pancakes.
Friendship
Number	9s	should	be	careful	in	friendship,	because	frequently	their	best	friends
become	their	opponents.	Those	born	on	day	3,	6,	9,	12,	15,	18,	21,	24,	27,	or	30
of	any	month	can	be	their	friends.	They	can	also	have	good	friendships	with
psychic	number	5s	or	7s.	Their	friendships	with	those	psychic	natives	born	on
the	ninth,	or	on	the	same	date	they	themselves	were	born,	can	be	intimate	but	not
very	productive.	Friendships	with	psychic	number	3s	bring	them	the	best	results.
Romance
Number	6	women	are	ideal	for	number	9	men,	and	number	3	men	are	ideal	for
romance	with	number	9	women.	Number	9s	marry	1s,	3s,	6s,	and	9s	born	during
their	weak	periods.	Although	they	have	a	natural	liking	for	7s,	number	9	women
and	7	men	never	have	very	successful	marriages.	This	is	because	the	women
expect	total	loyalty	and	are	very	possessive,	and	the	men	cannot	resist	light
flirtations.
Good	Years	in	Life
The	9th	year,	the	18th,	27th,	36th,	45th,	54th,	63rd,	72nd,	81st,	90th,	and	99th
are	favorable.	The	years	between	the	27th	and	36th,	and	the	45th	year,	are	very
important.
NUMBER	9	PEOPLE	IN	RELATIONSHIP
The	information	that	follows	is	based	upon	a	comparison	of	psychic	number	9s
to	other	psychic	numbers.	It	can	also	be	used	to	compare	destiny	9s	to	other
destiny	numbers,	and	name	9s	to	other	name	numbers.	(The	comparisons	are
based	upon	like	categories.)
Number	9	and	Number	1
Number	1s	are	helpful	and	good	for	9s.	A	number	9	is	restless	and	doubting;	a	1
is	assertive	and	makes	the	right	decisions	at	the	appropriate	time.	Number	1s	can
help	9s	to	make	good	decisions	and	to	get	away	from	doubt.	Both	numbers	are
powerful,	energetic,	and	hardworking.	They	make	very	good	company.	A	9	has	a
manner	of	complaining	and	finding	faults	in	others,	and	a	1	is	beyond	envy,
malice,	and	grudge.	Nines	have	a	lot	of	enemies,	while	Is	are	friendly	to
everyone.	When	they	are	together,	1s	work	hard	for	9s	and	save	them	from	all
kinds	of	weaknesses.	For	this	reason	their	friendships,	partnerships,	and
collaborations	in	politics	are	beneficial	to	9s.	Number	Is	also	make	9s	fortunate,
and	9	women	are	advised	to	select	1	men	for	marriages,	friendships,	romances,
or	business	partnerships.	Number	9	men,	however,	do	not	make	ideal	husbands
for	number	1	women.	Although	9s	make	good	teachers	for	Is	and	help	them
grow	and	develop,	1s	also	sometimes	teach	9s.	Nines	are	not	advised	to	select
the	number	1	as	appointment	dates	for	important	jobs.	They	should	also	avoid	a
1	for	permanent	residential	numbers.	For	short	stays,	a	1	can	be	very	pleasant
and	memorable.
Number	9	and	Number	2
Number	9s	and	number	2s	are	mutual	friends.	Nines	are	masculine	and	2s
feminine—they	go	very	well	together.	Mars	is	hot,	the	Moon	is	cold.	Number	9
natives	feel	very	complete	in	the	company	of	number	2	natives,	especially	when
9	is	a	man	and	2	a	woman.	A	number	2	also	feels	strong	and	inspired	in	the
company	of	a	9.	Both	are	suitable	for	each	other	in	friendship,	romance,
marriage,	and	business	partnership.	However,	a	9	has	to	work	hard	for	a	2,	since
2s	are	somewhat	dependent	and	shy.	Nines	can	select	the	number	2	for
temporary	residential	numbers.
Number	9	and	Number	3
The	number	3	is	one	of	the	best	numbers	for	9s.	Nine—a	multiple	of	3—is	a
number	that	gives	extraordinary	managerial	and	organizational	abilities.	This	is
beneficial	for	3s.	Number	3s	accept	the	authority	of	9s.	The	presence	of	3s
provide	9s	with	psychological	help	and	inner	strength.	In	turn,	number	9s	help	3s
grow	and	develop.	In	business	partnerships,	3s	never	suffer	losses	with	9s,	but
do	not	earn	much	money.	Nines	are	always	benefited	by	3s	who	bring	them
inspiration	and	joy	and	in	whose	company	they	feel	light,	more	centered,	and
less	doubting.	Number	9s	are	therefore	advised	to	select	3s	for	any	kind	of
relationship,	be	it	friendship,	romance,	marriage,	business	partnership,	or	for
appointment	dates	and	residential	numbers.
Number	9	and	Number	4
Number	9s	and	number	4s	are	mutual	enemies.	But	as	opposites,	they	also	attract
each	other.	Both	are	hard	workers;	and	when	they	approach	each	other,	large
amounts	of	energy	are	generated.	A	number	4	gets	a	chance	to	expand,	and	the
creative	abilities	of	a	9	become	more	enhanced.	A	4	is	benefited	by	a	9’s	creative
power.	Nines	are	always	involved	in	social	situations,	while	4s	are	by	nature	less
social;	9s	make	4s	social.	Fours	provoke	9s	into	being	more	active,	and	9s	help
4s	to	develop	strong	willpower.	They	are	mutually	beneficial	when	they
cooperate	for	something	that	is	connected	to	the	welfare	of	humanity	at	large.
Fours	habitually	oppose;	9s	are	familiar	with	opposition,	and	this	opposition
proves	healthy	for	9s.	Number	9s	love	to	fantasize	and	4s	live	in	hard	reality;
they	do	not	go	together	for	long.	Nines	are	advised	to	avoid	long-term
friendships,	business	partnerships,	or	marriages	with	4s	although	they	can	have
secret	affairs	with	them.	Number	9s	should	also	avoid	4s	for	appointment	dates
or	residential	numbers.
Number	9	and	Number	5
A	number	9	and	a	number	5	have	a	strange	relationship.	Number	9	is	an	enemy
of	a	5,	but	a	5	is	neutral	toward	9.	When	they	approach	each	other,	they	generate
good	energy.	Fives	are	always	helpful	to	9s,	but	the	latter	do	not	leave	lasting
impressions	on	5s.	Because	5s	are	as	quick	and	restless	as	mercury,	they	do	not
make	good	life	partners	for	9s.	In	business	5s	do	not	make	good	partners	for	9s,
although	9s	prove	beneficial	to	5s.	Number	9s	have	to	work	harder	and	get	less
financial	gain.	In	friendship,	5s	prove	to	be	favorable	to	9s	and	are	their	well
wishers.	When	mutually	interested	in	a	particular	project,	the	two	make	a	good
combination.	In	the	field	of	art	and	music,	they	can	work	as	good	companions
and	help	each	other.	However,	in	real	friendships,	5s	are	somewhat	cool	to	9s.
Nines	are	therefore	advised	not	to	select	5s	for	appointment	dates	or	residential
numbers.
Number	9	and	Number	6
Mars	and	Venus	are	neutral	to	each	other,	but	a	number	6	and	a	9	make	excellent
friends	and	have	a	mutual	attraction.	Mars	is	purely	male	and	Venus	is	feminine
in	nature.	The	two	numbers	complete	each	other.	Their	relationship	is	long
lasting,	and	they	can	work	together	in	practically	all	fields.	In	music	and	the	fine
arts	they	work	very	well	together	because	both	are	good	critics	of	fine	art.	In
politics,	a	6	is	supportive	of	a	9.	Both	numbers	are	interested	in	material
prosperity	and	accomplishment.	Both	are	honest	in	financial	matters	and	in	their
dealings	with	each	other.	As	a	business	partner,	a	6	guards	the	interest	of	a	9,
while	a	9	helps	a	6	with	his	or	her	work	and	practical	and	creative	ideas.	Number
9s	can	select	6s	for	any	kind	of	relationship—marriage,	friendship,	romance,	and
business	partnerships.	In	marriages	it	would	be	good	if	9	is	the	man	and	6	the
woman.	Nines	also	can	select	the	number	6	for	appointment	dates	or	for
residential	numbers.
Number	9	and	Number	7
Both	malefic	planets,	Mars	and	Ketu	are	enemies.	Mars	is	the	more	powerful	of
the	two.	When	they	come	close	to	each	other,	a	7	produces	a	tremendous	force
and	draws	strength	from	a	9.	Number	7	people	lose	their	identity	in	the	presence
of	9s;	they	act	as	very	good	helpers	and	friends.	Number	9	people	are	also
attracted	to	7s	and,	with	their	practical	wisdom,	help	the	dreamy	7s.	Since	a
number	7	is	a	teacher	of	mysticism	and	a	9	is	interested	in	mystic	and	occult
knowledge,	they	are	mutually	beneficial.	The	number	7	makes	other	numbers
that	associate	with	it	fortunate;	the	social	status	of	a	number	9	person	gets
elevated	in	collaboration	with	a	7.	A	number	7	is	not	a	good	business	partner.	In
marriage,	number	7	men	are	not	good	mates	for	number	9	women,	although	7
women	make	good	and	devoted	wives	to	number	9	men.	For	romance,	number	9
men	and	women	can	have	good	relationships	with	number	7s.	Number	9s	should
not	use	7s	for	appointment	dates	or	permanent	residential	numbers.	If	9s	live	in	a
number	7	house,	they	lose	their	privacy;	the	house	is	active	and	frequently
visited	by	spiritual	seekers,	saints,	artists,	mystics,	and	famous	people.
Number	9	and	Number	8
Saturn	is	neutral	to	Mars	in	friendship,	whereas	Mars	is	an	enemy	of	Saturn.
Number	8	people,	influenced	by	Saturn,	are	lawbreakers;	9s,	influenced	by
Mars,	are	protectors	of	the	law.	Their	relationship	as	friends	is	not	long	lasting,
although	an	8	proves	lucky	and	financially	helpful	to	a	9.	Number	9s	should
avoid	joint	ventures	with	8s,	if	the	projects	are	to	last	a	long	time.	In	short-term
business	situations,	9s	are	benefited	by	8s.	Nines	are	generally	advised	not	to
enter	into	marital	relationships	with	8s;	if	necessary,	9	women	can	marry	8	men,
but	the	reverse	is	never	good.	An	8	can	be	a	good	student	of	a	9,	and	only	in	this
relationship	is	9	really	benefited	by	8.	Nines	are	advised	not	to	select	8s	for
important	jobs,	appointment	dates,	or	residential	numbers.
Number	9	and	Number	9
Same	numbers	are	usually	not	ideal	for	friendship,	marriage,	and	romance;	yet
they	can	have	a	long	lasting	relationship	interrupted	only	by	casual	isolation	and
arguments.	Number	9	added	to	9	remains	9—no	loss,	no	gain—but	9	is	still	a
good	number	for	business	partnerships	for	9	natives	even	though	they	do	not
inspire	each	other	much.	When	two	natives	that	have	9	as	their	psychic	number
join	hands	for	a	common	cause,	they	can	bring	about	a	revolution.	If	they	are
friends,	their	friendship	remains	for	a	long	time;	but	they	will	always	argue	with
each	other.	Two	9s	can	have	a	romantic	relationship	with	each	other.	Number	9
can	also	select	9	as	an	appointment	date	or	residential	number.

Summary	of	Interaction	Between	Numbers
To	determine	the	relationship	and	interaction	between	numbers,	find	your	own
psychic	number	on	the	far	left	vertical	column,	then	the	psychic	number	of	the
person	with	whom	you	wish	to	relate	at	the	top	horizontal	column.	The	box
where	these	two	columns	intersect	will	summarize	the	characteristics	of	that
other	person	and	how	that	person	will	interact	with	you.
The	Compound	Numbers
Now	that	we	understand	the	characteristics	of	single	whole	numbers,	we	need	to
know	a	little	bit	more	about	compound	numbers,	to	determine	the	character	of
those	born	after	the	ninth	day	of	any	month.	All	compound	numbers	discussed
here	apply	to	the	psychic	numbers	of	those	who	were	born	on	that	date.	Number
11,	13,	and	22	have	already	been	discussed	in	detail	under	number	2	and	4
respectively,	since	they	are	special	numbers	deserving	a	separate	description.	We
have	also	mentioned	in	passing	that	people	born	on	dates	from	10	to	31	are
slightly	different	from	people	who	have	the	same	psychic	number	but	were	born
on	a	single	digit	date.	Now	we	will	give	a	brief	description	of	those	additional
qualities	found	in	people	with	compound	numbers	not	present	in	those	born	from
the	first	to	the	ninth	day	of	any	month.	This	occurs	because	two	planetary
energies	in	combination	respond	to	situations	differently.	The	process	is	very
similar	to	the	conjunction	of	planets,	and	the	effect	is	similar.
NUMBER	10	
Number	10	is	a	combination	of	1	and	0.	One	is	consciousness,	the	Sun;	0	is
infinity	(Anant	Tattva).	The	characteristics	of	1	dominate	number	10	because	it
belongs	to	the	series	of	1,	which	bestows	honor,	faith,	self-confidence,	and	name
and	fame	(good	or	bad)	that	fluctuates	according	to	karmic	law.	One	is	fortunate,
0	is	unfortunate.	The	unfortunate	0	brings	struggle,	which	gives	self-confidence
and	right	understanding	to	these	psychic	natives	and	makes	them	shine.	Zero
creates	hidden	enemies,	but	1	gives	the	alertness	to	recognize	them.	Thus	10	is	a
number	of	success	achieved	after	hard	struggle.	To	remain	introspective	and
awake	is	the	only	solution	to	the	obstacles	mentioned.	Dependence	on	others
will	cause	problems.
(Number	11	has	been	discussed	in	detail	under	the	description	of	number	2.	See
page	45.)
NUMBER	12	
This	is	a	combination	of	the	Sun	(1)	and	Moon	(2),	the	pair	of	opposites.	As	we
have	discussed	earlier,	a	1	and	a	2	do	not	make	an	ideal	couple;	people	with
these	numbers	always	differ	with	each	other.	This	differing	relationship	between
1	and	2	creates	anxiety	in	the	minds	of	those	born	on	the	twelfth	of	any	month.
Although	psychic	number	3	natives	are	fortunate	in	getting	help,	cooperation,
and	success	in	life,	this	anxiety	never	leaves	those	born	on	the	twelfth.	Psychic
threes	are	famous	for	saying	yes	to	everything	and	everybody,	but	they	do	only
what	is	within	their	means	to	do.	Thus	they	are	famous	for	disappointing	their
friends	and	relatives.	People	born	on	the	twelfth	suffer	from	this	problem	the
most.	They	are	torn	by	the	two	opposites—the	stable	and	determined	nature	of	Is
and	the	changing	of	opinion	of	2s.	Their	saying	yes	brings	them	problems,
because	they	themselves	are	not	sure	if	they	really	mean	yes	when	they	say	it;
the	influence	of	the	number	2	may,	after	a	few	moments,	change	their	opinion.
People	born	on	the	twelfth	usually	decide	things	at	the	last	moment	and,	even
then,	nothing	is	sure	about	them.	They	may	change	their	minds	even	after
starting	a	job	and	never	complete	it.	They	achieve	success	in	the	latter	part	of
their	lives,	but	they	leave	an	uncountable	number	of	jobs	and	projects,	which
they	started	with	full	enthusiasm,	unfinished.	They	change	their	plans	quickly
and	often,	so	that	their	friends	and	relatives	are	never	sure	of	their	whereabouts.
These	people	enjoy	their	personal	lives	and	are	happy,	healthy,	and	prosperous.
They	take	care	of	themselves,	take	an	interest	in	cooking,	love	to	make	feasts,
have	good	taste,	and	are	philosophic	and	religious.	They	have	the	strength	of	Is
and	the	gentleness	of	2s.	They	believe	in	synthesizing	and	are	unconventional,
ready	to	adopt	themselves	to	all	kinds	of	circumstances.
(Number	13	has	been	discussed	under	the	description	of	number	4.	See	page	80.)
NUMBER	14	
A	combination	of	two	opposites	that	are	attracted	to	each	other,	this	is	a	number
of	risks,	fear,	underestimation,	and	wrong	assessment	of	the	future.	One	is	the
Sun,	4	is	Rahu—the	north	node	of	the	Moon.	Rahu	is	an	enemy	of	the	Sun,	but
by	itself	is	only	a	half-planet.	As	such	it	has	to	act	according	to	the	nature	of	the
planet	with	which	it	associates.	In	association	with	the	Sun,	its	natural	enemy
and	opposite,	it	tries	to	cause	affliction.	It	causes	the	Sun	to	be	partially	eclipsed
and	presents	obstacles.	Those	people	born	on	the	fourteenth	of	any	month	suffer
from	inner	conflict.	Changes	come	in	their	life	more	frequently	than	in	the	lives
of	other	psychic	number	5s.	Rahu	is	willing	to	take	risks	and	the	Sun	is	not
afraid	of	taking	risks	either,	so	those	born	on	the	fourteenth	sometimes	risk	more
than	other	5	natives.	And	as	5s	are	generally	gamblers,	natives	born	on	the
fourteenth	take	more	risks	by	gambling	or	other	means	that	might	bring	them
financial	loss	and	other	problems.	A	number	1	is	gifted	with	being	able	to
correctly	assess	the	future,	but	in	association	with	a	4,	in	number	14	it	creates
problem.	People	born	on	the	fourteenth	have	to	suffer	many	times	in	their	lives
with	incorrect	assessments	of	the	future.	They	are	advised	to	remain	cautious
with	their	associates	and	colleagues	and	remain	calm	to	achieve	their	desired
goal.	The	influence	of	Mercury,	which	dominates	their	lives	as	psychic	number	5
natives,	makes	them	fluid	and	mercurial;	they	personally	enjoy	living	the	way
they	do.	They	are	helpful,	wise,	quick	to	respond,	restless	but	jovial	(though	less
jovial	than	those	born	on	the	twenty-third),	and	benefit	from	gambling	and
taking	risks.	Because	of	the	influence	of	Rahu,	they	are	advised	to	be	cautious	if
caught	in	a	thunderstorm,	hurricane,	or	any	kind	of	natural	calamity.
NUMBER	15	
Number	15	is	a	combination	of	the	Sun	(1)	and	Mercury	(5).	Both	of	these
planets	are	connected	with	intellect	and	ready	wit.	Both	love	modernism,
material	success,	and	popularity;	both	are	friendly.	People	born	on	the	fifteenth
of	any	month	definitely	like	luxuries	and	material	prosperity.	They	are	also
interested	in	literature,	fine	arts,	and	music.	Since	15	is	a	psychic	number	6,	it	is
ruled	by	Venus.	The	love	of	a	luxurious,	free,	uncommitted	life,	and	the	love	of
sensual	pleasures,	dominates	a	15’s	point	of	view.	The	Sun	brings	them
popularity.	Mercury	makes	them	move	around	and	travel.	Venus	brings	them	to
cozy,	expensive,	and	luxurious	places.	Because	of	the	Sun	they	obtain
cooperation	and	help.	Because	of	Mercury,	they	are	surrounded	by	recreation
and	have	more	festive	occasions	in	their	lives	than	other	psychic	6	natives.
Mercury	is	fragile,	sentimental,	and	evergreen.	Those	born	on	the	fifteenth	are
tender,	emotional,	attractive,	and	stay	younger	looking	than	other	people	their
age.	Men	with	this	number	become	interested	in	Tantra,	magic,	and	witchcraft	in
order	to	gain	the	power	to	enjoy	and	explore	their	sensual	nature.	Women
become	interested	in	Tantra,	magic,	and	witchcraft	to	get	over	their	sensual
nature.	People	born	on	the	fifteenth	get	more	cooperation	and	help	from
members	of	the	opposite	sex.	They	enjoy	their	lives,	love	flowers	and
fragrances,	care	for	jewelry,	and	have	a	keen	sense	of	dress.	They	have	pleasant
personalities	and	charming	manners.
NUMBER	16	
Number	16	is	a	combination	of	two	opposites—the	Sun	and	Venus.	Although
Venus	is	a	benefic	planet,	it	is	also	a	teacher	of	demons,	the	malefics.	The	Sun
itself	is	a	malefic	planet,	but	it	belongs	to	the	group	of	Jupiter,	a	teacher	of	the
Gods.	In	this	way,	the	Sun	and	Venus	belong	to	opposite	camps	(they	are	natural
enemies).	This	combination	creates	problems	in	the	lives	of	those	born	on	the
sixteenth	of	any	month.	Number	7	is	ruled	by	Ketu.	And	as	Ketu	is	a	malefic
half-planet	that	blinds	the	power	of	discrimination,	people	born	on	the	sixteenth
day	of	the	month	have	difficulty	discriminating,	which	causes	them	to	suffer
uncertainties	and	anxieties.	The	Sun	gives	them	idealism;	Venus	makes	them
hedonistic.	The	combination	of	the	two	makes	those	born	on	the	sixteenth
idealistic	outwardly	and	lovers	of	enjoyment	inwardly.	They	become	dreamers
and	live	in	their	own	dream	worlds.	The	influence	of	Ketu	makes	them
disinterested	in	worldly	desires	and	ambitions.	If	spiritually	inclined,	they	gain
the	knowledge	of	the	Self,	psychic	abilities,	and	they	become	ascetics.	But	the
influence	of	Venus	leads	them	toward	the	healing	arts	and	occultism.	If	not
spiritually	inclined,	they	may	join	conspirator	groups.	Although	they	are	always
anxious	and	afraid	of	losing	their	present	status,	they	rise	and	fall	many	times.
They	suffer	from	their	defeats,	but	they	continue	on	their	own	way.	They	should
watch	against	accidents	and	mishaps	in	their	lives.
NUMBER	17	
This	is	a	combination	of	the	Sun	(1),	and	the	half-plant	Ketu	(7).	Since	17	is	a
psychic	number	8,	it	is	ruled	by	Saturn.	Thus	17	is	a	number	of	struggle,
obstacles,	and	difficulties.	In	addition,	the	Sun	and	Ketu	are	enemies,	which
gives	17s	inner	conflict.	However,	this	inner	conflict	brings	them	real
understanding	and	makes	them	more	aware,	considerate,	loving,	and	spiritual.
They	develop	resistance	and	overcome	obstacles	and	difficulties	without	losing
heart.	They	become	peaceful	and	give	peace	to	those	around	them.	Although
number	8	is	ruled	by	the	malicious	Saturn,	17	natives	become	benefic	and	do
something	for	the	suffering	humanity	that	brings	them	name	and	fame	after
death.	Saturnine	difficulties	and	delays	do	not	leave	them,	but	they	are	not
affected	by	them	and	create	their	own	distinctive	mark	on	history.	Saturn	makes
17s	successful	in	the	latter	part	of	their	lives,	and	people	consider	them
fortunate.	Although	they	suffer	in	their	personal	and	family	lives,	they	acquire
wealth	and	prosperity	and	are	respected	by	others.	If	they	somehow	develop
faith	in	God	and	adopt	spiritual	disciplines,	they	are	helped	by	providence	and
their	problems	miraculously	disappear.	They	are	advised	to	be	careful	in
selecting	friends	and	in	seeking	the	help	of	their	friends,	relatives,	and
colleagues.	They	have	courage	and	are	bold.
NUMBER	18	
This	number	is	a	combination	of	the	Sun	(1)	and	Saturn	(8)	and	is	ruled	by	Mars
(9).	People	born	on	the	eighteenth	face	strong	opposition,	inner	conflict,	and
obstacles	in	their	lives.	But	since	the	number	9	is	ruled	by	Mars,	they	are	tough
fighters	and	survive	difficult	circumstances.	They	become	used	to	meeting
challenges	and	facing	adverse	situations	caused	by	the	grudges	and	enmity	of
their	family	members	and	relatives.	They	are	devoid	of	peace	in	their	personal
lives	and	in	their	family	circles.	Because	of	their	martial	nature,	they	create	bad
feelings	with	their	kith	and	kin	and	do	not	enjoy	good	marital	relationships.	They
earn	money	through	unfair	means	and	do	not	care	for	the	ethical	norms	of
society.	They	are	financially	benefited	by	wars,	revolutions,	and	social
upheavals.	They	suffer	from	tensions,	instability,	and	restlessness.	They	become
vicious,	move	in	bad	company,	and	enjoy	being	rough	and	sometimes	cruel.	If
these	persons	are	somehow	made	to	follow	disciplined	lives,	they	prosper	and
rise	to	high	positions.	If	they	learn	the	lesson	of	ahimsa	(non-violence),	they	can
make	their	marks	on	history.	They	are	advised	to	avoid	disputes	with	family
members	and	friends.	They	are	materialists	and	acquire	special	skills	to	earn
money.	They	become	financially	well	off	after	forty	years	of	age	and	are
rewarded	for	their	efforts	in	the	latter	part	of	lives.
NUMBER	19	
This	is	a	combination	of	the	Sun	(1)	and	Mars	(9)	that	is	ruled	by	the	Sun	(1).
People	born	on	the	nineteenth	are	lucky	psychic	number	1	people.	The	Sun	and
Mars	are	friends,	and	the	Sun	is	also	exalted	in	Aries,	a	zodiac	sign	ruled	by
Mars.	These	people	are	full	of	enthusiasm,	happiness,	and	inspiration	and
achieve	success	in	every	field	of	life.	They	are	full	of	life	force	and	are	honored
by	their	friends	and	colleagues.	Because	of	the	Sun’s	influence,	they	are	wise;
because	of	Mars,	they	are	able	to	confront	odd	situations	and	meet	challenges.
Their	hard	work	and	persistence	make	them	successful.	But	this	combination,
and	the	influence	of	Mars,	makes	them	obstinate	and	short-tempered,	which
creates	problems	in	their	married	lives.	They	have	all	the	qualities	of	number	1
people	and	are	more	fortunate	than	those	born	on	the	tenth	of	any	month,	yet
they	are	less	fortunate	than	those	born	on	the	twenty-eighth	of	any	month.	In
general	people	born	on	the	nineteenth	enjoy	high	status,	honor,	success,	and
material	prosperity.	They	are	helpful,	cooperative,	and	generous.
NUMBER	20	
Two	combined	with	0	makes	20,	a	number	of	impatience.	Number	2	people	are
generally	impatient,	nervous,	dependent,	and	quick-changing.	Zero	adds
responsibilities,	which	will	tire	these	2s.	They	are	tender	and	emotional,	like
other	2s,	but	they	are	more	cooperative,	loving,	and	caring.	They	do	not	get
properly	rewarded,	however,	for	their	efforts	and	loving	care.	They	experience
unnecessary	delays	with	their	projects	and	suffer	from	anxieties	and	disgust.
Their	married	lives	are	not	very	successful,	and	they	neglect	their	family
members	and	relatives.	For	peace	of	mind	and	to	become	successful,	they	are
advised	to	develop	interests	in	the	spiritual	field.
NUMBER	21	
Although	those	born	with	the	number	21	are	psychic	number	3s,	they	differ	from
other	psychic	number	3s.	The	combination	of	2	with	1	here	is	different	than	in
12.	Twenty-one	belongs	to	the	series	of	20	and	therefore	is	more	influenced	by
the	number	2,	even	though	21	is	ruled	by	Jupiter.	The	2	provides	gentleness,	and
the	1	provides	the	potential	to	become	successful	in	life.	More	social	than	other
psychic	number	3	natives,	they	become	popular	in	all	circles	and	with	members
of	the	opposite	sex.	They	mix	more	freely	than	other	3s	and	are	able	to	overcome
their	difficulties	and	establish	themselves	in	service	or	business	successfully.
With	the	number	2,	they	can	work	as	arbitrators	and	diplomats;	with	the	number
1,	they	are	able	to	succeed	and	rise.	In	this	combination,	the	1	helps	the	2.	If
these	people	develop	a	little	patience,	they	can	become	fortunate	and	make
steady	progress.
(Number	22	has	been	discussed	under	the	description	of	number	4.	See	page	81.)
NUMBER	23	
This	combination	of	the	Moon	(2)	and	Jupiter	(3)	is	supposed	to	be	a	number	of
success.	People	born	on	the	twenty-third	of	any	month	are	number	5s	and	are
thus	ruled	by	Mercury,	which	makes	them	intelligent,	hardworking,	well
informed,	and	generally	interested	in	learning	about	everything.	They	have	good
chances	of	success	in	their	professions	and	become	popular.	They	are	benefited
by	members	of	the	opposite	sex	and	helped	by	officers	and	other	people	in
positions	of	authority.	Although	they	are	a	little	moody,	short-tempered,	and	love
to	take	risks,	they	are	liked	by	people	and	achieve	success	in	their	lives.	They
live	in	prosperity	and	promote	new	ideas.	They	achieve	name	and	fame,	rise	in
their	communities,	and	are	known	for	their	jovial	nature.
NUMBER	24	
A	combination	of	two	opposites,	the	Moon	(2)	and	Rahu	(4),	24	is	considered	to
be	a	lucky	number	because	2	and	4	make	6,	and	6	is	a	lucky	number.	Venus	rules
number	6,	and	when	6	is	derived	from	a	2	and	4	combination	the	person	has	the
influence	of	2	and	4	and	the	behavior	of	a	6.	This	particular	number	6	is	also
lucky	because	the	2	and	4	are	in	a	harmonious	relationship.	Although	24s	have
all	the	qualities	of	psychic	number	6	natives	and	are	considered	6s,	they	differ
from	those	born	on	the	fifteenth	or	sixth	of	any	month.	Four	is	a	number	of
difficulty	and	change,	and	2	is	a	number	of	change.	So	the	lives	of	those	born	on
the	twenty-fourth	undergo	change	very	often.	The	influence	of	the	2	makes	them
helping	and	sincere;	the	influences	of	the	4	makes	them	strong	and	persistent.
They	are	secretive	and	can	keep	the	secrets	of	others.	They	are	benefited	by
members	of	the	opposite	sex,	yet	they	also	suffer	from	failures	brought	to	them
by	betrayal.	They	are	gentle	and	helpful.	If	their	destiny	numbers	and	name
numbers	are	in	harmony	with	their	psychic	numbers,	they	can	enjoy	ordinary
family	lives.
NUMBER	25	
Twos	and	5s	are	not	a	good	combination;	the	relationship	between	the	Moon	(2)
and	Mercury	(5)	is	a	strange	one.	The	Moon	is	neutral	toward	Mercury,	but
Mercury	has	enmity	with	the	Moon.	This	strange	relationship	creates	a	self
condemning	nature.	Twenty-five,	which	is	a	7,	is	ruled	by	Ketu.	Although	it	is	a
number	that	brings	luck	to	others,	psychic	number	7	natives	suffer	a	lot	in	the
early	years	of	their	lives.	The	numbers	2	and	5	give	them	a	fluctuating	nature.
This	situation	is	compounded	by	the	influence	of	Ketu,	a	planet	of	ambiguity.
People	born	on	the	twenty-fifth	of	any	month	are	more	dreamy,	imaginative,
artistic,	moody,	and	philosophic	than	other	number	7s.	They	try	to	understand
the	mysteries	of	nature.	They	develop	methodologies	of	their	own	and	become
founders	of	religious	institutions.	They	gain	experience	and	understanding
through	their	failures	and	ultimately	settle	down.	Slowly	and	gradually	they
obtain	secure	positions	with	the	help	of	their	friends,	relatives,	and	colleagues.
Those	born	on	this	date	have	philosophic	outlooks.	They	are	generally	proud	of
their	artistic	talents	and	successes,	which	are	achieved	after	great	struggle.	They
are	not	lucky	in	love	affairs,	but	obtain	financial	gains	through	marriage.	They
are	advised	to	avoid	risky	ventures.
NUMBER	26	
This	combination	of	2	and	6,	the	Moon	(2)	and	Venus	(6),	gives	these	individuals
a	tendency	to	depend	on	members	of	the	opposite	sex.	Two	is	a	number	that	is
dependent	on	others	and	so	is	number	6.	People	born	on	the	twenty-sixth	of	any
month	are	psychic	number	8s.	They	are	ruled	by	Saturn	and	are	considered	to	be
materialists	and	fatalists.	They	have	to	face	many	difficulties	and	much
opposition	in	their	lives,	especially	during	their	early	years.	Numbers	2	and	6
both	give	attraction	to	members	of	the	opposite	sex.	This	attraction	is	the	main
cause	of	problems	and	misfortunes	in	the	lives	of	these	8s.	A	number	26	is
advised	to	be	careful	in	selecting	a	life	partner.	Marriage	to	a	number	8	born	on
the	seventeenth	or	eighth	of	any	month	is	better	than	marriage	to	other	numbers.
Although	they	are	hedonists,	after	marriage	they	settle	down,	become	very
sincere,	and	give	up	their	earlier	relationships.	If	26s	marry	any	numbers	except
1s,	3s,	6s,	and	8s,	they	suffer	and	eventually	turn	off	to	their	family	lives.	If	they
select	1s,	3s,	and	6s,	they	can	achieve	good	fortune	and	happy	marital	lives.
Those	born	on	the	twenty-sixth	excel	and	acquire	top	positions	in	the	latter	part
of	their	lives.	They	are	hard	working	and	stubborn.	The	men	are	revengeful	and
cruel	when	they	have	enmity	toward	other	numbers.
NUMBER	27	
Number	27	is	a	combination	of	two	strong	opposites,	2	and	7,	the	Moon	and
Ketu.	This	provides	27s	with	initiative	and	an	inexhaustible	energy.	The	numbers
2	and	7	are	both	very	dependent	on	other	numbers.	If	those	born	on	the	twenty
seventh	can	somehow	become	independent—that	is,	develop	free	will	and	an
independent	nature—they	can	perform	all	jobs	successfully,	because	both
numbers	are	good	for	making	plans.	They	can	make	good	plans	that	can	benefit
them	in	their	businesses	and	in	family	matters.	Since	2	and	7	total	9,	27	is	ruled
by	the	planet	Mars,	which	makes	27s	powerful,	commanding,	and	authoritative.
They	carry	out	each	and	every	project	in	a	well-planned	way	and	achieve
success.
They	are	loving	people,	devoted	to	their	families	or	the	organizations	to	which
they	belong.	Both	2	and	7	are	emotional	and	intuitive	numbers.	If	these	people
develop	stability,	they	can	become	very	successful	in	the	material	field.
NUMBER	28	
A	combination	of	Moon	(2)	and	Saturn	(8)	energies,	28	is	a	number	of	struggle.
People	born	on	this	date	have	to	face	many	obstacles	and	much	opposition.	But
since	the	combination	of	2	and	8	totals	1,	then	the	number	28	is	ruled	by	the	Sun,
a	lucky	number	that	brings	success.	This	success	comes	to	these	28s	once	they
have	faced	struggles	and	conquered	opposition.	Those	people	born	on	the
twenty-eighth	gain	more	experience	and	are	gentler	and	less	authoritative,
commanding,	and	demanding	than	other	number	1s.	They	are	more	able	to	serve,
and	they	gain	more	cooperation	and	help	than	other	1s.	This	widens	their	circle
of	friends	and	acquaintances.	Psychic	numbers	2	and	8	natives	are	both	servants,
are	both	obstinate,	and	are	good	and	tough	fighters.	The	combination	of	2	and	8
in	28	makes	these	people	more	vulnerable	and	successful	fighters.	They	lead	the
battle	that	advocates	justice	for	the	downtrodden	and	become	good	politicians
and	political	heroes.	They	leave	their	marks	on	history.	The	influence	of	the
number	2	makes	them	philosophical,	while	the	influence	of	8	makes	them
interested	in	material	progress	and	modernization.	They	develop	unique	ways	of
combining	both	material	and	spiritual	progress	and	are	wholistic	in	their
attitudes.
NUMBER	29	
A	combination	of	the	energies	of	the	Moon	(2)	and	Mars	(9),	29	is	supposed	to
be	a	number	that	brings	basic	insecurity	and	uncertainty	in	life.	Since	29	is	the
combination	of	2	and	9,	which	totals	to	2,	29	is	a	2	and	is	therefore	influenced
more	strongly	by	the	Moon.	On	the	material	plane,	those	born	on	the	twenty
ninth	of	any	month	achieve	success	and	rise	to	high	positions.	However,	their
personal	lives,	especially	their	marital	lives,	are	not	satisfactory.	The	changing
nature	the	number	2	brings,	and	the	sentimentality	the	number	9	brings,	are
dominant	in	their	lives.	With	a	good	destiny	number	and	a	harmonious	name
number,	a	29	is	able	to	select	the	right	partners	in	business	and	life.	With	their
help	and	cooperation,	this	individual	is	able	to	make	progress.	But	if	the	destiny
number	or	name	number	is	not	in	harmony,	the	person	gets	involved	in	the
wrong	things	and	does	not	lead	an	ethical	or	moral	life.	Although	29s	achieve	a
high	position	in	their	field	of	work,	they	feel	insecure	and	lonely.	The	influence
of	Mars	makes	them	restless	and	doubting.	Men	born	on	this	date	should	be	very
conscious	in	selecting	their	life	partners,	because	women	are	the	main	cause	of
problems	and	sorrows	in	their	lives.	Women	born	on	this	date	should	fast	on
Mondays	or	Thursdays	if	they	are	interested	in	meeting	a	nice	and	harmonious
husband.	They	should	try	to	understand	the	feelings	of	their	life	partners	and	not
think	only	about	their	own	emotional	highs	and	lows.	In	general,	all	psychic
natives	born	on	the	twenty-ninth	are	loving	and	warm-hearted.	They	are	able	to
attract	men	and	women	with	high	aesthetic	sensibilities	and	are	favored	by
people	of	authority.	They	are	advised	to	avoid	irritation	and	short-temperedness;
they	should	follow	some	spiritual	discipline	and	develop	true	faith	in	God.	They
should	try	to	create	a	family	environment	for	themselves.	Men	belonging	to	this
number	should	become	friendlier	and	more	tolerant	with	their	family	members
and	relations	because	they	need	their	help	and	cooperation.	They	should	not
postpone	their	marriage	plans	and	should	marry	early	in	their	lives;	late	marriage
brings	them	unhappiness	and	mental	problems.
NUMBER	30	
Psychic	number	3	natives	born	on	this	day	are	somewhat	less	fortunate	than
other	psychic	number	3	natives	because	of	the	association	with	the	zero.	We
cannot	call	them	unlucky,	yet	zero	slows	down	their	progress	and	reduces	the
number	of	their	friends.	But	because	3s	are	hardworking,	number	30s	are	able	to
live	comfortably	and	make	enough	money	without	much	hard	work.	Like	other
number	3s,	they	are	social	and	universal	helpers,	but	their	lives	are	more
influenced	by	members	of	the	opposite	sex.	They	are	constantly	engaged	in	work
and	do	not	earn	money	through	one	source	alone.	Sometimes	they	start	so	many
projects	at	the	same	time	that	they	must	leave	many	jobs	incomplete.	The
influence	of	0	makes	them	waste	energy	and	leave	jobs	undone.	As	they	are
ruled	by	Jupiter	(3),	those	born	on	the	thirtieth	are	thinkers;	they	use	more
mental	energy	than	other	3s.	Since	they	have	to	struggle	a	lot	during	their	early
years,	they	develop	special	ways	of	looking	at	things	and	formulate	philosophies
of	their	own.	They	are	not	bound	by	the	religions	into	which	they	are	born	and
over	time	become	more	friendly	to	other	religions	and	philosophies.	Since	they
are	critical	by	nature,	they	make	fun	of	all	religions	including	their	own,	and
they	advocate	universal	love	and	brotherhood.	But	in	their	personal	lives	they
follow	their	own	ways	and	methods,	which	are	rooted	in	the	traditions	into
which	they	were	born.	If	their	destiny	numbers	and	name	numbers	are
harmonious,	they	get	help	and	cooperation	and	excel.	They	are	benefited	by
social	institutions	and	organizations	that	can	use	their	creative	energies	and
talents.	They	are	advised	to	not	be	selfish	and	to	join	institutions	or	organizations
that	work	for	the	welfare	of	mankind.
NUMBER	31	
Thirty-one	is	a	combination	of	the	numbers	3	(Jupiter)	and	1	(Sun).	Number	3	is
a	good	number,	and	1	itself	also	is	a	good	number.	However,	the	combination	of
the	two	is	not	very	beneficial	for	those	born	on	the	thirty-first	of	any	month
because	this	combination	adds	up	to	the	number	4,	which	is	ruled	by	Rahu,	a
malefic	half-planet.	Famous	for	creating	troubles,	Rahu	makes	4s	different	from
other	individuals;	it	creates	uncertainty	in	their	lives	and	brings	sudden,
unexpected	changes.	These	changes	are	both	good	and	bad.	This	makes	people
born	on	the	thirty-first	of	any	month	feel	uncertain	and	lonely.	They	are
misunderstood	by	their	friends	and	colleagues.	Because	they	lack	friendly	and
inspiring	environments,	they	isolate	themselves,	become	less	social,	less	popular,
and	sometimes	join	revolutionary	groups	that	use	violence.	They	become
obstinate,	secretive,	and	commanding.	They	impose	their	ideas	on	others.	The
presence	of	the	number	3	makes	them	a	little	selfish,	and	the	presence	of	1
makes	them	authoritative.	Number	1	also	gives	them	qualities	of	leadership.
Although	psychic	number	3	and	psychic	number	1	natives	are	hardworking,
social,	and	extroverts,	those	born	on	the	thirty-first	are	shy	and	less	social,	yet
hard	workers.	They	have	to	struggle	a	lot	before	they	become	known	in	society.
They	love	modern	ideas	and	rebel	against	old	values.	They	are	lovers	of	justice
but	do	not	use	just	means	to	achieve	it.	They	love	to	oppose	popular	ideas	and
love	to	argue	in	favor	of	unpopular	ones.	If	they	become	interested	in	politics,
they	join	the	opposition.
SUMMARY
By	understanding	the	significance	of	the	compound	numbers	from	11	to	31,	the
numerologist	can	see	more	vividly	the	character	of	psychic	natives	born	on	any
date	of	any	month.
The	purpose	of	numerology	is	to	provide	general	information	about	human
beings,	who,	although	alike	in	physical	makeup,	differ	in	their	way	of	seeing	the
world.	Their	complicated	behaviors	can	be	seen	in	light	of	their	astrological
configurations	and	the	relationships	between	their	psychic,	destiny,	and	name
numbers.	Numerology	aims	to	educate	people	about	their	good	and	bad	points;	it
gives	them	advice	on	avoiding	habits	that	create	problems	in	their	lives.	It	guides
them	from	the	darkness,	which	comes	from	an	ignorance	about	the	effects	of	the
planets	on	their	lives.	It	provides	them	with	a	method	of	working	with	these
influences	by	using	colors	and	gemstones.	It	also	provides	them	with	advice
about	their	general	mental	and	physical	health,	the	types	of	ailments	from	which
they	can	suffer,	and	gives	them	a	way	to	avoid	those	diseases.
Projecting	Into	the	Future
Numerology	can	also	be	helpful	in	learning	about	events	over	the	coming	years.
Although	astrology	does	have	a	better	method	of	projecting	into	the	future,	a
general	understanding	about	future	events	can	be	obtained	from	numerology.
As	stated	in	the	introduction,	numerology	is	not	a	complete	science:	a	good
numerologist	should	also	learn	such	arts	as	astrology,	palmistry,	graphology,	and
physiognomy	to	achieve	more	insight	into	human	behavior	patterns.
What	follows	is	one	method	for	projecting	yearly	calculations.	Note	down	on
paper	the	following	information:
month	of	birth
date	of	birth
last	two	digits	of	the	year	in	question
number	of	the	day	of	the	week	on	which	the	birthdate	falls	in	that	year.
For	example,	I	want	to	make	a	yearly	calculation	for	an	individual	born	on
May	12,	1934.	The	year	I	want	to	examine	is	1991.	This	is	done	by	adding	the
following	numbers:
month	of	birth	=	5
date	of	birth	=	12
the	year	for	which	the	chart	is	to	be	made	=	91
In	1991	May	12	falls	on	a	Sunday,	which	is	a	1.1
5	+	12	+	91	+	1	=	109	=	10	=	1
The	number	that	results	from	this	addition,	1,	becomes	the	number	of	the
projected	year.	To	find	out	the	significance	of	having	1	as	a	year	number,	consult
the	pages	that	follow.	This	summary	is	very	general	and	cannot	be	taken	to
represent	the	total	projected	year,	but	it	can	give	an	overall	idea	of	what	is	to
come.
With	the	single	digit	number	you	obtained	from	this	calculation,	one	may	use
the	information	that	follows	to	examine	what	the	year	in	question	holds.
Year	Number	1	(ruled	by	the	Sun)
Since	number	1	is	an	important	number,	a	year	with	this	number	is	also
important.	During	this	period,	difficulties	and	problems	that	have	existed	for
many	years	will	be	lessened.	One	will	feel	lucky	and	receive	help	from	many
people,	especially	from	people	in	authority	and	government	officers.
During	this	year,	one	will
Feel	healthier	mentally	and	physically	and	will	move	on	the	path	of
progress.
Achieve	success	in	job	and	business,	if	one	gets	organized	and	plans	ahead.
Have	an	important	change	in	life;	all	changes	will	be	for	the	betterment	of
the	present	living	situation.
Meet	new	people	who	will	prove	helpful	in	the	future.
Remain	free	from	fear	and	anxieties.
Work	hard	with	less	stress.
Attain	name	and	fame.
This	year	is	also	good	for	reading,	writing,	appearing	in	competitions,	starting
a	new	financial	venture,	buying	a	machine.	If	one	is	a	writer,	musician,	or
painter,	the	year	will	prove	very	significant	for	new	compositions.
Year	Number	2	(ruled	by	the	Moon)	will	bring
An	increase	in	personal	magnetism.
New	friends,	who	will	be	helpful	in	future.
Less	worry	and	stress.
Emotionality	but	also	more	practicality.
Benefit	from	real	estate.
A	new	house	or	apartment.
Changes	in	the	way	one	thinks.
Improved	living	situations,	through	patience	and	good	planning.
During	this	year,	one	should	avoid	unnecessary	worry	and	hurry.
Year	Number	3	(ruled	by	Jupiter)	will	bring
More	knowledge	and	practical	wisdom.
Time	to	complete	old	projects.
New	friends	and	acquaintances.
This	year	will	also	be
Auspicious;	it	brings	financial	gain,	name,	and	honor.	It	makes	one	express
oneself	more	clearly.	It	is	especially	meaningful	for	writers,	speakers,	and
orators.	These	people	should	be	careful	in	their	writings	or	public	speaking.
The	influence	of	Jupiter	can	give	them	a	frankness	and	fearlessness	that
may	bring	them	trouble	in	the	future.
Not	good	for	the	signing	papers	or	contracts	by	businessmen	and	those
involved	in	any	kind	of	law	suit.
Good	for	business	or	starting	a	new	venture.
Good	for	planning	and	completing	jobs.
A	year	for	getting	a	job	promotion.
A	time	to	test	friends	before	trusting	them.
Year	Number	4	(ruled	by	Rahu)	will	bring
Success,	with	difficulties.
Strength,	undisturbed	by	unforeseen	troubles	and	obstacles.
Alertness,	hard	work,	and	calm.
Financial	gains,	increased	sources	of	income,	and	financial	stability.
New	ventures,	such	as	a	new	house	or	apartment.
This	year	will	also	be
Auspicious.	One	gets	married.	If	one	does	not	want	to	marry	officially,	one
gets	a	life	partner.	Married	people	with	no	children	get	a	child.
Good	for	relationships	with	friends	and	life	partners.
Not	successful	for	love	affairs	and	romance.
Good	for	relations	with	government	officials	and	men	of	authority.
Good	for	traveling.
Good	for	spiritual	pursuits	and	religious	activities.
Year	Number	5	(ruled	by	Mercury)	will	be
A	year	of	success	and	financial	stability;	it	brings	an	increase	in	one’s	circle
of	friends.
Good	for	business	and	businessmen.
Good	for	traveling	and	for	going	abroad	on	business	or	for	enjoyment.
Good	for	partnership	in	business.
A	time	to	be	conscious	while	talking.
A	time	to	be	conscious	while	signing	a	deal	or	a	contract.
Good	for	those	employed	in	the	media	and	communications	business:
writers,	poets,	actors,	entertainers,	radio	artists,	and	journalists.
Good	for	appearing	in	competitions	and	taking	risks.
Memorable.
Year	Number	6	(ruled	by	Venus)	will	be
Good	for	family	relationship;	free	from	the	problems	of	household	affairs.
Good	for	romance	and	conceiving	a	child.
Good	for	interior	decorators,	actors,	musicians,	poets,	and	painters	as	well
as	for	film	makers,	theatre	people,	and	those	involved	in	showbusiness.
Good	for	jewelers	and	people	involved	in	the	perfume	business.
Good	for	spending	on	decoration,	entertainment,	and	enjoyment.
A	time	to	get	employment,	for	those	unemployed.
A	time	to	deal	with	items	of	beauty,	sensual	enjoyment,	worldly	pleasure,
and	gifts.
This	year	also	brings	the	chance	of	getting	unexpected	wealth	and	a	raise	in
salary.
Year	Number	7	(ruled	by	Ketu)	will	be
Misunderstandings	and	difficulties.
Difficulties	in	business.	More	work,	less	profit.
Success	in	such	things	as	court	cases,	law	suits.
It	will	also	be	a	year	to
Test	friends	and	helpers.
Avoid	unnecessary	discussion.
Devote	energy	to	the	healing	arts,	astrology,	practice	of	Tantra,	magic,	and
hypnosis.
Take	fewer	risks.
Be	conscious	in	love	affairs	and	romance;	there	are	chances	of	getting	a	bad
name.
Remain	optimistic	and	undisturbed	if	one	desires	success	in	jobs
undertaken.	A	patient	and	optimistic	attitude	will	solve	problems	and
remove	obstacles.	The	difficulties	are	only	a	test.
This	will	also	be	a	good	year	for	healers,	astrologers,	and	those	involved	in
occult	sciences.
Year	Number	8	(ruled	by	Saturn)	will	be
Good	for	politicians,	social	workers,	and	people	involved	in	the	iron	and
steel	industry.	It	brings	the	opportunity	to	start	a	new	venture.
Poor	in	the	area	of	health.	Precautions	are	needed.	Avoid	stress,	excitement,
and	anxiety.	Use	more	juices	and	spices,	which	clean	the	blood	and
strengthen	the	heart.	Use	pearl	powder	(mukta	pishti)	and	powdered	blue
sapphire	(neelam	pishti).
A	time	to	gain	success	in	worldly	matters;	one	should	use	one’s	energy	to
become	more	creative.	The	right	use	of	energy	will	bring	good	luck.
Good	for	gaining	victory	over	enemies,	and	in	law	suits.
A	time	to	become	independent,	to	rely	on	one’s	own	resources	and
judgement.
Good	for	social	work.
Year	Number	9	(ruled	by	Mars)	will	bring
A	year	of	completion,	success,	and	good	fortune.
A	time	for	fulfillment	of	desires.
A	time	for	organizing	oneself.
A	year	of	gaining	favors	from	men	of	authority	and	government	officials.
It	will	also	bring
Slight	disagreements;	a	harmful	exchange	of	harsh	words	with	an	officer	is
possible.
Success	in	combat	and	competitions.
Honor	by	society.
The	chance	of	unexpected	financial	gains,	through	a	lottery,	inheritance,	or
other	source.
During	this	year,	one	should	also	avoid	doubting	and	perfectionism.	By
devoting	more	energy	to	spiritual	pursuits,	the	year	will	bring	good	results.
Relationships	and	Characteristics	of	Numbers
This	summation	of	characteristics	and	relationships	applies	to	the	psychic
numbers	listed	in	the	top	horizontal	column.





Footnotes
Introduction
1
.	For	a	further	explanation	of	the	role	of	zero,	see	Tools	for	Tantra	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1986),	p.	50.
2
.	There	is	a	basic	problem	in	determining	the	psychic	number.	According	to	the	ancient	Indian
(Hindu)	system,	the	date	changes	1	hour	before	dawn—1-1/2	to	2	hours	before	the	actual	sunrise.	However,
in	today’s	world	all	countries	have	agreed	to	correspond	with	Greenwich	standard	time	and	to	change	the
date	at	12:00	A.M.	(midnight).	So	when	ascertaining	the	date	of	birth,	one	should	also	see	what	time	of	day
or	night	the	person	in	question	is	born.	For	example,	under	the	present	system	a	person	born	at	2	A.M.	the
night	of	the	twelfth	is	counted	as	a	person	born	on	the	thirteenth	and	is	considered	a	number	4.	However,
under	the	Hindu	system,	because	the	birth	was	several	hours	before	sunrise,	this	person	would	be	counted	as
born	on	the	night	of	the	twelfth	and	thus	considered	a	number	3.	In	such	a	case,	one	should	watch	carefully
to	see	if	the	tendencies	of	the	person	concerned	are	more	like	those	of	a	number	3	or	number	4	person.
An	additional	concern:	in	summer,	the	sun	rises	in	the	northwestern	hemisphere	much	earlier	than	in
winter.	So	it	should	be	ascertained	whether	the	birth	is	in	the	late	hours	of	the	summer	night	or	the	winter
night.	If	it	is	earlier	than	two	hours	before	the	sunrise	time,	the	date	which	is	officially	associated	with	the
next	day	should	be	discarded.	For	example,	for	a	person	born	at	3:30	A.M.	on	June	3	(during	summer),	the
date	which	changed	after	midnight	would	be	correct.
However,	a	person	born	at	3:30	A.M.	on	December	3	would	be	judged	by	the	date	of	the	previous	day,
December	2.	This	is	because	in	December,	3:30	A.M.	is	about	4	hours	before	the	sunrise.	The	day	and	date
should	change	at	the	same	time.	Thus,	many	people	who	say	they	were	born	on	a	specific	date	really
weren’t	and	actually	belong	to	a	different	numerological	group.
3
.	Nakshatra	is	known	as	Lunar	Mansion	in	English.	It	is	also	known	as	Lunar	Constellations.	For
more	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,	Rochester,	VT,
1988),	pp.	20-24	.
The	Vedic	Square
1
.	Keith	Critchlow,	Islamic	Patterns:	An	Analytical	and	Cosmological	Approach	(London:	Thames	&
Hudson,	1984).
2
.	The	Moon	and	Ketu	are	opposites	in	Indian	astrology.
The	Sun	and	Number	1
1
.	For	further	information	on	gems	and	rituals,	see	The	Healing	Power	of	Gemstones	by	Harish
Johari	(Destiny	Books,	Rochester,	VT,	1988).
2
.	For	a	more	detailed	explanation	of	japa,	see	Tools	for	Tantra	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1986),	p.	30.
3
.	The	numerical	yantras	are	mystical	diagrams	of	planetary	energy.	They	are	famous	as	magic
squares.	For	further	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	Pestiny	Books,
Rochester,	VT,	1988).
4
.	For	more	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
The	Moon	and	Number	2
1
.	For	a	description	of	the	Soma	Chakra,	see	Chakras	by	Harish	Johari	(Destiny	Books,	Rochester,
VT,	1987).
2
.	Moon	natives	are	those	with	a	psychic	number	2,	those	whose	rising	sign	or	ascendant	is	in
Cancer,	or	those	whose	sun	sign	is	in	Cancer.
3
.	For	a	more	detailed	explanation	of	japa,	see	Tools	for	Tantra	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1986),	p.	30.
4
.	The	numerical	yantras	are	mystical	diagrams	of	planetary	energy.	They	are	famous	as	magic
squares.	For	further	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
Jupiter	and	Number	3
1
.	For	a	more	detailed	explanation	of	japa,	see	Tools	for	Tantra	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1986),	p.	30.
2
.	The	numerical	yantras	are	mystical	diagrams	of	planetary	energy.	They	are	famous	as	magic
squares.	For	further	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
3
.	See	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,	Rochester,	VT,	1988)	for
further	information	about	gem	remedies.
4
.	This	is	a	collection	of	five	stories	from	Skandha	Purana	that	emphasizes	the	value	of	adherence	to
truth	under	all	circumstances.
Rahu	and	Number	4
1
.	For	further	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
2
.	For	a	more	detailed	explanation	of	japa,	see	Tools	for	Tantra	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1986),	p.	30.
3
.	The	numerical	yantras	are	mystical	diagrams	of	planetary	energy.	They	are	famous	as	magic
squares.	For	further	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
Mercury	and	Number	5
1
.	For	a	more	detailed	explanation	of	japa,	see	Tools	for	Tantra	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1986),	p.	30.
2
.	The	numerical	yantras	are	mystical	diagrams	of	planetary	energy.	They	are	famous	as	magic
squares.	For	further	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
Venus	and	Number	Six
1
.	For	a	more	detailed	explanation	of	japa,	see	Tools	for	Tantra	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1986),	p.	30
2
.	The	numerical	yantras	are	mystical	diagrams	of	planetary	energy.	They	are	famous	as	magic
squares.	For	further	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
Ketu	and	Number	7
1
.	For	further	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
2
.	For	a	more	detailed	explanation	of	japa,	see	Tools	for	Tantra	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1986),	p.	30.
Saturn	and	Number	8
1
.	For	further	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
2
.	For	a	more	detailed	explanation	of	japa,	see	Tools	for	Tantra	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1986),	p.	30.
3
.	The	numerical	yantras	are	mystical	diagrams	of	planetary	energy.	They	are	famous	as	magic
squares.	For	further	information	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
4
.	This	is	a	recipe	for	one	person.	Clean	a	1/2	cup	of	split	urad	beans,	remove	stones	and	other
foreign	material,	and	mix	it	with	a	1/2	cup	of	cleaned	white	rice.	Rinse	the	mixture	until	clean	water	comes
out.	Add	1-1/2	cups	of	clean	water	and	1/4	teaspoon	of	rocksalt	(not	regular	table	salt).	Heat	the	mixture
and	let	it	boil	for	1	minute.	Then	reduce	the	heat,	stir,	and	cover	tightly.	Let	it	cook	until	the	beans	and	rice
become	soft.	Urad	beans	take	a	little	longer	than	other	beans	to	soften.	Serve	with	butter.
Mars	and	Number	9
1
.	For	a	more	detailed	explanation	of	japa,	see	Tools	for	Tantra	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1986),	p.	30.
2
.	The	numerical	yantras	are	mystical	diagrams	of	planetary	energy.	They	are	famous	as	magic
squares.	For	further	information,	see	The	Healing	Power	of	Gemstones	by	Harish	Johari	(Destiny	Books,
Rochester,	VT,	1988).
Projecting	Into	the	Future
1
.	The	numbers	assigned	to	the	days	of	the	week	are	the	numbers	of	the	ruling	planets	of	that	day:
Sunday	=	1	(Sun)
Monday	=	2	(Moon)
Tuesday	=	9	(Mars)
Wednesday	=	5	(Mercury)
Thursday	=	3	(Jupiter)
Friday	=	6	(Venus)
Saturday	=	8	(Saturn).
Sources	of	Supply
1)		Gem	powders	can	be	obtained	from:
Bazaar	of	India	Imports
1810	University	Avenue
Berkeley,	CA	94703
(800)	261-7662
2)		Gem	talismans,	gem	powders,	and	nine-gem	pendulums	can	be	ordered	from:
Mr.	Dinesh	Johari
368,	Govindpuri.	Pincode:	249403.
Haridwar,	U.P.
India
Note:	Because	these	are	not	readily	available,	one	must	wait	after	placing	the	order.	When	ordering,	please
give	your	complete	address;	the	day	of	the	week,	date,	time,	and	place	of	birth.	For	information,	please
write	with	prepaid	postage.
3)		Nine-gem	pendulums	can	also	be	ordered	in	the	United	States	from:
Harmat	Enterprises	Ltd.
50	West	34th	Street
Suite	23	C10
New	York,	NY	10001
About	the	Author
Harish	Johari	(1934-1999)	was	a	distinguished	North	Indian	author,	Tantric
scholar,	poet,	musician,	composer,	artist,	and	gemologist	who	held	degrees	in
philosophy	and	literature	and	made	it	his	life’s	work	to	introduce	the	culture	of
his	homeland	to	the	West.
About	Inner	Traditions	•	Bear	&	Company
Founded	in	1975,	Inner	Traditions	is	a	leading	publisher	of	books	on	indigenous
cultures,	perennial	philosophy,	visionary	art,	spiritual	traditions	of	the	East	and
West,	sexuality,	holistic	health	and	healing,	self-development,	as	well	as
recordings	of	ethnic	music	and	accompaniments	for	meditation.
In	July	2000,	Bear	&	Company	joined	with	Inner	Traditions	and	moved	from
Santa	Fe,	New	Mexico,	where	it	was	founded	in	1980,	to	Rochester,	Vermont.
Together	Inner	Traditions	•	Bear	&	Company	have	eleven	imprints:	Inner
Traditions,	Bear	&	Company,	Healing	Arts	Press,	Destiny	Books,	Park	Street
Press,	Bindu	Books,	Bear	Cub	Books,	Destiny	Recordings,	Destiny	Audio
Editions,	Inner	Traditions	en	Español,	and	Inner	Traditions	India.
For	more	information	or	to	browse	through	our	more	than	one	thousand	titles
in	print	and	ebook	formats,	visit	www.InnerTraditions.com
.
Become	a	part	of	the	Inner	Traditions	community	to	receive	special	offers	and
members-only	discounts.
BOOKS	OF	RELATED	INTEREST
THE	HEALING	POWER	OF	GEMSTONES
In	Tantra,	Ayurveda,	and	Astrology
by	Harish	Johari
THE	YOGA	OF	SNAKES	AND	ARROWS
The	Leela	of	Serf-Knowledge
by	Harish	Johari
CHAKRAS
Energy	Centers	of	Transformation
by	Harish	Johari
TOOLS	FOR	TANTRA
by	Harish	Johari
BREATH,	MIND,	AND	CONSCIOUSNESS
by	Harish	Johari
DESTINY	IN	THE	PALM	OF	YOUR	HAND
Creating	Your	Future	through	Vedic	Palmistry
by	Ghanshyam	Singh	Birla
LOVE	IN	THE	PALM	OF	YOUR	HAND
How	to	Use	Palmistry	for	Successful	Relationships
by	Ghanshyam	Singh	Birla
THE	NUMEROLOGY	OF	THE	I	CHING
A	Sourcebook	of	Symbols,	Structures,	and	Traditional	Wisdom
by	Taoist	Master	Alfred	Huang
Inner	Traditions	•	Bear	&	Company
P.O.	Box	388
Rochester,	VT	05767
1-800-246-8648
www.InnerTraditions.com
Or	contact	your	local	bookseller
Destiny	Books
One	Park	Street
Rochester,	Vermont	05767
www.InnerTraditions.com
Destiny	Books	is	a	division	of	Inner	Traditions	International
Copyright	©	1990	by	Harish	Johari
All	rights	reserved.	No	part	of	this	book	may	be	reproduced	or	utilized	in	any	form	or	by	any	means,
electronic	or	mechanical,	including	photocopying,	recording,	or	by	any	information	storage	and	retrieval
system,	without	permission	in	writing	from	the	publisher.
Library	of	Congress	Cataloging-in-Publication	Data
Johari,	Harish,	1934
Numerology—with	Tantra,	Ayurveda,	and	astrology/Harish	Johari.
p.		cm.
ebook	ISBN	978-1-62055-076-2
print	ISBN	0-89281-258-3
1.	Symbolism	of	numbers.	2.	Tantrism—Miscellanea.	3.	Medicine,	Ayurvedic—Miscellanea.	4.
Astrology,	Hindu.	I.	Title.
BF1623.P9J55	1990
133.3′35—dc20 89-17218
CIP
`;
let projectFiles = []; // { id: num, name: '', content: '', path: '' }
let activeFileId = null;
let aiProposedChange = null; 
let musicList = [];
let selectedTracks = new Set();
let currentTrackIndex = 0;
let audioPlayer = new Audio();
let isMusicPlaying = false;
let isCCEnabled = false;
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

// --- GLOBAL KEYBOARD SHORTCUTS & ENTER KEY ---
document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTyping = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;

    // Enter Key Logic (allowed while typing)
    if (e.key === 'Enter' && !e.shiftKey) {
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
        if (active.id === 'codeChatInput') {
            e.preventDefault();
            askCodeAI();
            return;
        }
        if (active.id === 'seekInput') {
            e.preventDefault();
            askSoulSeekAI();
            return;
        }
        if (active.id === 'solveAIInput') {
            e.preventDefault();
            askSolveAI();
            return;
        }
        if (active.id === 'authPass' || active.id === 'authEmail') handleAuth();
        if (active.id === 'donAmount' || active.id === 'donRemark') payNow();
    }

    // Navigation Shortcuts (Alt + Key) - Disabled if typing
    if (e.altKey && !isTyping) {
        const key = e.key.toLowerCase();
        if (key === 'n') {
            e.preventDefault();
            showPage('notes');
        } else if (key === 'a') {
            e.preventDefault();
            showPage('ai');
        } else if (key === 'p') {
            e.preventDefault();
            showPage('play');
        }
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

// Update the "Smart Bullets" event listener to ensure autoResize triggers correctly
document.addEventListener('input', (e) => {
    if (e.target.id === 'noteInput' || e.target.id === 'editNoteText') {
        const el = e.target;
        
        // Fix for Smart Bullets logic breaking auto-resize
        const val = el.value;
        if (val.endsWith('\n')) {
            const lines = val.split('\n');
            const prevLine = lines[lines.length - 2];
            const trimmedPrev = prevLine.trim();
            
            if ((trimmedPrev.startsWith('- [ ] ') && trimmedPrev.length > 6) || 
                (trimmedPrev.startsWith('- [x] ') && trimmedPrev.length > 6)) {
                el.value += '- [ ] ';
            } 
            else if (trimmedPrev.startsWith('- ') && trimmedPrev.length > 2) {
                el.value += '- ';
            }
            else if (trimmedPrev.match(/^\d+\. /)) {
                const num = parseInt(trimmedPrev.match(/^\d+/)[0]);
                if (trimmedPrev.length > (num.toString().length + 2)) {
                    el.value += `${num + 1}. `;
                }
            }
        }
        
        autoResize(el); // Ensure height updates after content/bullet changes
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
const pageCache = new Map();

function showPage(pageId, pushState = true) {
    const validPages = ['home', 'notes', 'code', 'ai', 'play', 'random', 'cricket', 'snake', 'focus', 'fun', 'support', 'dashboard', 'who', 'manage', 'login', 'legal', 'forgotPass', 'quiz', 'seek', 'solve'];
    if (!validPages.includes(pageId)) pageId = 'home';

    // Optimization: Don't re-render/re-toggle if already active
    const currentPage = document.querySelector('.page.active');
    if (currentPage && currentPage.id === pageId) return;

    if (currentPage) currentPage.classList.remove('active');
    
    const page = document.getElementById(pageId);
    if(page) {
        page.classList.add('active');
        // Smooth entry for better perceived performance
        if (pageId !== 'home') window.scrollTo({ top: 0, behavior: 'auto' });
    }
    
    // History & URL Management
    if (pushState) {
        const path = pageId === 'home' ? '/' : `/${pageId}`;
        if (window.location.pathname !== path) {
            history.pushState({ pageId }, "", path);
        }
    }

    // Update Document Meta
    const pageMeta = {
        home: { title: 'sOuLViSiON | Digital Sanctuary', desc: 'The ultimate multi-tool productivity platform.' },
        notes: { title: 'sOuLNOTES | Secure Markdown Workspace', desc: 'Your private encrypted note-taking vault.' },
        ai: { title: 'sOuLAI | Intelligence Core', desc: 'Advanced multi-model AI workspace.' },
        play: { title: 'sOuLPLAY | Immersive Music Player', desc: 'Stream YouTube or play local files with vinyl aesthetics.' },
        random: { title: 'sOuLRANDOM | Omni-Randomizer', desc: 'Generate numbers, lists, colors, and more.' },
        cricket: { title: 'sOuLCRICKET | Hand Cricket', desc: 'Strategic hand cricket simulator.' },
        snake: { title: 'sOuLSNAKE | Retro Arena', desc: 'High-performance retro snake with global leaderboards.' },
        focus: { title: 'sOuLFOCUS | Deep Work Timer', desc: 'Pomodoro timer, journaling, and life metrics.' },
        quiz: { title: 'sOuLQUIZ | Knowledge Challenge', desc: 'AI-generated trivia and spiritual challenges.' },
        fun: { title: 'sOuLFUN | Casual Play', desc: 'Simple joys and clicker tests.' },
        support: { title: 'sOuLSUPPORT | Fuel the Vision', desc: 'Support development and join the wall of gratitude.' },
        who: { title: 'sOuLWHO? | Mission & Architect', desc: 'The story behind sOuLViSiON.' },
        dashboard: { title: 'sOuLViSiON | Dashboard', desc: 'Manage your account and preferences.' },
        seek: { title: 'sOuLSEEK | AI Numerologist', desc: 'Discover your life path through Vedic numerology.' },
        login: { title: 'sOuLViSiON | Authentication', desc: 'Securely sign in to your sanctuary.' },
        legal: { title: 'sOuLViSiON | Privacy & Terms', desc: 'Legal documentation and policies.' },
        manage: { title: 'sOuLMANAGE | Admin Control', desc: 'System management and health.' },
        forgotPass: { title: 'sOuLViSiON | Reset Password', desc: 'Recover access to your account.' }
    };

    const meta = pageMeta[pageId] || pageMeta.home;
    document.title = meta.title;
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', meta.desc);

    // UI State Sync
    requestAnimationFrame(() => {
        // Active Nav Highlighting
        const allNavBtns = document.querySelectorAll('nav button[onclick*="showPage"], aside nav button[onclick*="showPage"]');
        allNavBtns.forEach(btn => {
            const onclickAttr = btn.getAttribute('onclick');
            if (onclickAttr && onclickAttr.includes(`'${pageId}'`)) {
                btn.classList.add('text-cyan-400', 'bg-white/10');
            } else {
                btn.classList.remove('text-cyan-400', 'bg-white/10');
            }
        });

        const widget = document.getElementById('aiWidget');
        const mini = document.getElementById('miniChat');
        if (pageId === 'ai' || pageId === 'code') {
            widget?.classList.add('hidden');
            mini?.classList.remove('show');
        } else {
            widget?.classList.remove('hidden');
        }

        // Lazy Initializations
        if (pageId === 'snake') {
            initSnake();
            syncSnakeLeaderboard();
        } else {
            quitSnake();
        }

        if (pageId === 'quiz') {
            resetQuiz();
            syncQuizLeaderboard();
        } else {
            quizState.active = false;
            if (quizState.timer) clearInterval(quizState.timer);
        }
        
        if (pageId === 'dashboard') loadDashboard();

        if (pageId === 'focus') {
            initFocusPage();
        }
        if (pageId === 'seek') {
            syncSeekHistory();
        }

        if (pageId === 'solve') {
            initSolveInterface();
            syncSolveHistory();
        }

        // Trigger auto-resize for primary textareas on page entry
        ['chatInput', 'noteInput', 'editNoteText', 'miniChatInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) autoResize(el);
        });
        
        if (pageId === 'manage' && currentUser?.isAdmin) {
            loadConfig();
            loadAdminUsers();
            // Delay map loading slightly to ensure container is fully rendered and has dimensions
            setTimeout(loadVisitorMap, 300);
        }
        
        if (pageId === 'support') loadFeedbacks();
        if (pageId === 'fun') initParticleVoid();
        
        // Close sidebar on navigation (mobile)
        const sidebar = document.getElementById('mobileSidebar');
        if (sidebar && sidebar.classList.contains('translate-x-0')) toggleSidebar();
    });
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
        showBetterError(e.message);
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
        if (mode === 'register') {
            // Extended delay to ensure page elements are fully painted
            setTimeout(() => {
                if (document.getElementById('home').classList.contains('active')) {
                    startWelcomeTour();
                }
            }, 2500);
        }
    } catch (err) {
        showBetterError(err.message);
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
            syncMusicPlaylist(),
            syncFocusData(),
            syncQuizLeaderboard(),
            syncSolveHistory()
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

function exportPlaylist() {
    // Only export non-blob tracks (YouTube or external URLs)
    const exportableTracks = musicList.filter(t => t.type === 'youtube' || (t.url && !t.url.startsWith('blob:')));
    
    if (exportableTracks.length === 0) {
        return showToast("No online tracks found to export.", "warning");
    }

    const playlistData = {
        version: "1.0",
        exportedBy: currentUser ? currentUser.name : "Guest",
        exportedAt: new Date().toISOString(),
        tracks: exportableTracks
    };

    const blob = new Blob([JSON.stringify(playlistData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sOuLViSiON_Playlist_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Playlist exported as JSON.", "success");
}

function importPlaylist(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const json = JSON.parse(event.target.result);
            const incomingTracks = Array.isArray(json) ? json : json.tracks;
            
            if (!incomingTracks || !Array.isArray(incomingTracks)) {
                throw new Error("Invalid playlist format.");
            }

            let addedCount = 0;
            incomingTracks.forEach(track => {
                // Prevent duplicates based on URL or YouTube ID
                const isDuplicate = musicList.some(t => 
                    (track.type === 'youtube' && t.id === track.id) || 
                    (track.url && t.url === track.url)
                );

                if (!isDuplicate) {
                    musicList.push(track);
                    if (isShuffle) shuffledIndices.push(musicList.length - 1);
                    addedCount++;
                }
            });

            if (addedCount > 0) {
                renderPlaylist();
                saveMusicPlaylist();
                showToast(`Imported ${addedCount} new tracks!`, "success");
                if (!isMusicPlaying && musicList.length === addedCount) playTrack(0);
            } else {
                showToast("All tracks already exist in library.", "info");
            }
        } catch (err) {
            console.error("Import Error:", err);
            showToast("Import failed: Invalid file.", "error");
        } finally {
            e.target.value = '';
        }
    };
    reader.readAsText(file);
}

function updateAuthUI() {
    if (currentUser && currentUser.theme) {
        setTheme(currentUser.theme);
    }
    const adminBtn = document.getElementById('adminBtn');
    const adminBtnSide = document.getElementById('adminBtnSide');
    const dashBtn = document.getElementById('dashboardBtn');
    const dashBtnSide = document.getElementById('dashboardBtnSide');
    const authBtn = document.getElementById('authBtn');
    const authBtnSide = document.getElementById('authBtnSide');
    
    if (currentUser) {
        document.getElementById('userNameDisplay').innerText = `Hey, ${currentUser.name}`;
        
        // Header Nav
        authBtn.innerHTML = '<i class="fas fa-power-off md:hidden"></i><span class="hidden md:inline">Logout</span>';
        authBtn.onclick = logout;

        // Sidebar
        if (authBtnSide) {
            authBtnSide.innerHTML = '<i class="fas fa-power-off w-8"></i> Logout';
            authBtnSide.onclick = logout;
        }

        dashBtn?.classList.remove('hidden');
        dashBtnSide?.classList.remove('hidden');
        if(currentUser.isAdmin) {
            adminBtn?.classList.remove('hidden');
            adminBtnSide?.classList.remove('hidden');
        }
    } else {
        dashBtn?.classList.add('hidden');
        dashBtnSide?.classList.add('hidden');
        adminBtn?.classList.add('hidden');
        adminBtnSide?.classList.add('hidden');
        document.getElementById('userNameDisplay').innerText = '';
        
        // Header Nav
        authBtn.innerHTML = '<i class="fas fa-sign-in-alt md:hidden"></i><span class="hidden md:inline">Login</span>';
        authBtn.onclick = () => showPage('login');

        // Sidebar
        if (authBtnSide) {
            authBtnSide.innerHTML = '<i class="fas fa-sign-in-alt w-8"></i> Login';
            authBtnSide.onclick = () => showPage('login');
        }
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
    
    sessionStorage.removeItem('soul_note_draft');
    document.getElementById('restoreDraftBtn').classList.add('hidden');
    
    // Reset fields
    input.value = '';
    titleInput.value = '';
    document.getElementById('noteDeadline').value = '';
    if (noteType === 'todo') input.value = "- [ ] ";
    
    // Force shrink back to base
    autoResize(input);
    
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

    const currentTheme = document.documentElement.getAttribute('data-theme');
    const isMinimalist = currentTheme === 'minimalist';
    
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
            <div onclick="openNote('${n.id}')" ondblclick="openNote('${n.id}')" class="glass p-5 rounded-2xl border ${isPinned ? 'border-yellow-500 shadow-lg shadow-yellow-500/10' : (isTodo ? 'border-purple-500/20' : 'border-white/5')} flex flex-col h-full cursor-pointer hover:border-cyan-500/30 transition-all group relative overflow-hidden">
                <div class="absolute top-0 right-0 p-3 flex gap-2 z-10">
                    ${deadlineBadge}
                    ${isPinned ? '<i class="fas fa-thumbtack text-yellow-500 pinned-icon transform rotate-45"></i>' : ''}
                </div>
                <div class="mb-3">
                    <span class="text-[9px] font-black uppercase tracking-widest ${isTodo ? 'text-purple-400' : 'text-cyan-400'}">${isTodo ? 'Task List' : 'Note'}</span>
                    <h3 class="text-sm font-bold truncate pr-16 ${isMinimalist ? 'text-slate-900' : 'text-white'}">${displayTitle}</h3>
                </div>
                <div class="prose ${isMinimalist ? '' : 'prose-invert'} prose-sm max-h-48 overflow-hidden mb-6 flex-grow">
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

let isSyncScrolling = false;
function handleEditorScroll(e) {
    if (isSyncScrolling) return;
    isSyncScrolling = true;
    const editor = e.target;
    const preview = document.getElementById('notePreview');
    const scrollRange = editor.scrollHeight - editor.clientHeight;
    if (preview && scrollRange > 0) {
        const scrollPercentage = editor.scrollTop / scrollRange;
        preview.scrollTop = scrollPercentage * (preview.scrollHeight - preview.clientHeight);
    }
    requestAnimationFrame(() => { isSyncScrolling = false; });
}

function handlePreviewScroll(e) {
    if (isSyncScrolling) return;
    isSyncScrolling = true;
    const preview = e.target;
    const editor = document.getElementById('editNoteText');
    const scrollRange = preview.scrollHeight - preview.clientHeight;
    if (editor && scrollRange > 0) {
        const scrollPercentage = preview.scrollTop / scrollRange;
        editor.scrollTop = scrollPercentage * (editor.scrollHeight - editor.clientHeight);
    }
    requestAnimationFrame(() => { isSyncScrolling = false; });
}

// --- sOuLCODE Diff Scroll Sync ---
let isDiffSyncScrolling = false;

function handleDiffOriginalScroll(e) {
    if (isDiffSyncScrolling) return;
    isDiffSyncScrolling = true;
    const origin = e.target;
    const target = document.getElementById('diffProposed');
    const scrollRange = origin.scrollHeight - origin.clientHeight;
    if (target && scrollRange > 0) {
        const scrollPercentage = origin.scrollTop / scrollRange;
        target.scrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight);
    }
    requestAnimationFrame(() => { isDiffSyncScrolling = false; });
}

function handleDiffProposedScroll(e) {
    if (isDiffSyncScrolling) return;
    isDiffSyncScrolling = true;
    const origin = e.target;
    const target = document.getElementById('diffOriginal');
    const scrollRange = origin.scrollHeight - origin.clientHeight;
    if (target && scrollRange > 0) {
        const scrollPercentage = origin.scrollTop / scrollRange;
        target.scrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight);
    }
    requestAnimationFrame(() => { isDiffSyncScrolling = false; });
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
    const editor = document.getElementById('editNoteText');
    editor.value = note.text;
    document.getElementById('editNoteDeadline').value = note.deadline || '';
    document.getElementById('editNoteMeta').innerText = `CREATED: ${new Date(id).toLocaleString()}`;
    document.getElementById('wordGoal').value = note.wordGoal || 0;
    
    updateEditorStats(editor);
    autoResize(editor);
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
    const list = document.getElementById('notesList');
    if (list) {
        list.innerHTML = Array(3).fill('<div class="skeleton-card"></div>').join('');
    }
    const res = await fetch(`/api/main?route=notes&userId=${encodeURIComponent(currentUser.email)}&trash=${showTrash}`);
    const data = await res.json();
    if(Array.isArray(data)) {
        notes = data;
        renderNotes();
    }
}

async function saveNotesToDB(note) {
    if(!currentUser) return false;
    const statusEl = document.getElementById('syncStatus');
    if (statusEl) {
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Saving...';
        statusEl.classList.replace('text-gray-500', 'text-cyan-400');
    }
    try {
        const res = await fetch('/api/main?route=notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(note)
        });
        if (res.ok && statusEl) {
            statusEl.innerHTML = '<i class="fas fa-check-circle mr-1 text-green-500"></i> Synced';
            statusEl.classList.replace('text-cyan-400', 'text-green-500');
            setTimeout(() => {
                statusEl.innerHTML = '';
                statusEl.classList.replace('text-green-500', 'text-gray-500');
            }, 3000);
        }
        return res.ok;
    } catch (e) {
        console.error("Failed to save note", e);
        if (statusEl) {
            statusEl.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i> Sync Failed';
            statusEl.classList.replace('text-cyan-400', 'text-red-500');
        }
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
        const coin = document.getElementById('coin');
        const result = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
        
        coin.classList.remove('flipping-heads', 'flipping-tails');
        void coin.offsetWidth; // reflow
        coin.classList.add(`flipping-${result.toLowerCase()}`);
        
        if (window.navigator.vibrate) window.navigator.vibrate(20);

        setTimeout(() => {
            resText.innerText = result;
            resMeta.innerText = "Aureum Coin Result";
            addOmniHistory(result, true);
            saveRandomHistory('dice', result);
        }, 1200);
    } else {
        const res = Math.floor(Math.random() * sides) + 1;
        resText.innerText = res;
        resMeta.innerText = `D${sides} Dice Roll`;
        addOmniHistory(resText.innerText, true);
        saveRandomHistory('dice', resText.innerText);
    }
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

function toggleMusicSection(sectionId) {
    const container = document.getElementById(sectionId);
    const chevron = sectionId === 'ytResultsContainer' ? document.getElementById('ytResultsChevron') : document.getElementById('localPlaylistChevron');
    
    const isCollapsed = container.classList.toggle('collapsed-music-section');
    if (chevron) {
        chevron.style.transform = isCollapsed ? 'rotate(-180deg)' : 'rotate(0deg)';
    }
}

function setPlayMode(mode) {
    playMode = mode;
    const onlineBtn = document.getElementById('modeOnline');
    const offlineBtn = document.getElementById('modeOffline');
    const searchBox = document.getElementById('ytResultsContainer');
    const libraryBox = document.getElementById('localPlaylistContainer');
    const addBtn = document.getElementById('addLocalBtn');

    if (mode === 'online') {
        onlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all bg-cyan-600 text-white";
        offlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all text-gray-400";
        searchBox.classList.remove('hidden');
        searchBox.classList.add('flex');
        addBtn.classList.add('hidden');
    } else {
        offlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all bg-cyan-600 text-white";
        onlineBtn.className = "px-6 py-2 rounded-full text-xs font-bold transition-all text-gray-400";
        searchBox.classList.add('hidden');
        searchBox.classList.remove('flex');
        addBtn.classList.remove('hidden');
        addBtn.classList.add('flex');
        addBtn.classList.replace('text-[10px]', 'text-[9px]');
        // Ensure library is expanded if it was collapsed when switching to offline mode
        if (libraryBox.classList.contains('collapsed-music-section')) {
            toggleMusicSection('localPlaylistContainer');
        }
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

function addYTTrack(id, title, artist, instant = false) {
    const track = { type: 'youtube', id, name: title, artist: artist };
    const existingIdx = musicList.findIndex(t => t.id === id);
    
    let playIdx;
    if (existingIdx === -1) {
        musicList.push(track);
        playIdx = musicList.length - 1;
        if (isShuffle) shuffledIndices.push(playIdx);
    } else {
        playIdx = existingIdx;
    }

    renderPlaylist();
    
    if (instant || musicList.length === 1) {
        playTrack(playIdx);
        if (instant) closeYTExplorer();
    }
    
    showToast(`${title} ${existingIdx === -1 ? 'added to' : 'playing from'} Library`, "success");
    saveMusicPlaylist();
}

// --- YOUTUBE EXPLORER LOGIC ---
let explorerResults = [];
let explorerCurrentPage = 1;
const explorerPageSize = 10;
let suggestionTimeout = null;

async function openYTExplorer() {
    document.getElementById('ytExplorerModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    loadYTDiscovery('trending music');
}

function closeYTExplorer() {
    document.getElementById('ytExplorerModal').classList.add('hidden');
    document.body.style.overflow = '';
    hideYTSuggestions();
}

async function handleYTSuggestions(input, isMobile = false) {
    const query = input.value.trim();
    const listId = isMobile ? 'ytSuggestionsMobile' : 'ytSuggestions';
    const list = document.getElementById(listId);

    if (query.length < 2) {
        list.classList.add('hidden');
        return;
    }

    clearTimeout(suggestionTimeout);
    suggestionTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`/api/main?route=yt_suggest&q=${encodeURIComponent(query)}`);
            const suggestions = await res.json();
            
            if (suggestions.length > 0) {
                list.innerHTML = suggestions.map(s => `
                    <div onclick="selectYTSuggestion('${s.replace(/'/g, "\\'")}', ${isMobile})" class="px-4 py-2 hover:bg-white/5 cursor-pointer text-xs font-medium text-gray-300 border-b border-white/5 last:border-0">${s}</div>
                `).join('');
                list.classList.remove('hidden');
            } else {
                list.classList.add('hidden');
            }
        } catch (e) {
            list.classList.add('hidden');
        }
    }, 300);
}

function selectYTSuggestion(val, isMobile) {
    const inputId = isMobile ? 'ytExplorerInputMobile' : 'ytExplorerInput';
    document.getElementById(inputId).value = val;
    hideYTSuggestions();
    searchYTExplorer(isMobile);
}

function hideYTSuggestions() {
    document.getElementById('ytSuggestions').classList.add('hidden');
    document.getElementById('ytSuggestionsMobile').classList.add('hidden');
}

async function loadYTDiscovery(category) {
    await searchYTExplorer(false, category);
}

async function searchYTExplorer(isMobile = false, category = null) {
    const query = category || document.getElementById(isMobile ? 'ytExplorerInputMobile' : 'ytExplorerInput').value;
    if (!query) return;
    
    hideYTSuggestions();
    const resultsGrid = document.getElementById('ytExplorerResults');
    const pagination = document.getElementById('ytExplorerPagination');
    resultsGrid.innerHTML = Array(10).fill('<div class="skeleton h-64"></div>').join('');
    pagination.classList.add('hidden');

    try {
        const res = await fetch(`/api/main?route=yt_search&explorer=true&q=${encodeURIComponent(query)}`);
        explorerResults = await res.json();
        explorerCurrentPage = 1;
        renderExplorerPage();
    } catch (e) {
        resultsGrid.innerHTML = '<p class="col-span-full text-center text-red-500">Search Failed.</p>';
    }
}

function renderExplorerPage() {
    const resultsGrid = document.getElementById('ytExplorerResults');
    const pagination = document.getElementById('ytExplorerPagination');
    const pageNumEl = document.getElementById('explorerPageNum');
    const prevBtn = document.getElementById('prevExplorerPage');
    const nextBtn = document.getElementById('nextExplorerPage');

    if (!explorerResults || explorerResults.length === 0) {
        resultsGrid.innerHTML = '<p class="col-span-full text-center text-gray-500">No results found.</p>';
        pagination.classList.add('hidden');
        return;
    }

    const start = (explorerCurrentPage - 1) * explorerPageSize;
    const end = start + explorerPageSize;
    const pageData = explorerResults.slice(start, end);
    const totalPages = Math.ceil(explorerResults.length / explorerPageSize);

    resultsGrid.innerHTML = pageData.map(v => `
        <div class="bg-white/5 rounded-2xl overflow-hidden border border-white/5 group hover:border-red-500/50 transition-all duration-300 flex flex-col h-full">
            <div class="relative aspect-video overflow-hidden">
                <img src="${v.thumbnail}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500">
                <div class="absolute bottom-2 right-2 bg-black/80 px-2 py-0.5 rounded text-[10px] font-bold text-white">${v.duration.timestamp}</div>
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                    <button onclick="addYTTrack('${v.videoId}', '${v.title.replace(/'/g, "\\'")}', '${v.author.name.replace(/'/g, "\\'")}', true)" class="w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center text-xl hover:scale-110 transition active:scale-95 shadow-xl shadow-red-600/40">
                        <i class="fas fa-play ml-1"></i>
                    </button>
                </div>
            </div>
            <div class="p-4 flex flex-col flex-grow">
                <h4 class="text-sm font-bold text-white line-clamp-2 mb-2 group-hover:text-red-400 transition-colors">${v.title}</h4>
                <p class="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-auto mb-3">${v.author.name}</p>
                <div class="flex gap-2">
                    <button onclick="addYTTrack('${v.videoId}', '${v.title.replace(/'/g, "\\'")}', '${v.author.name.replace(/'/g, "\\'")}')" class="flex-grow bg-white/5 hover:bg-white/10 text-[9px] font-black uppercase py-2 rounded-lg border border-white/10 transition">Add to Queue</button>
                </div>
            </div>
        </div>
    `).join('');

    pagination.classList.remove('hidden');
    pageNumEl.innerText = `Page ${explorerCurrentPage} of ${totalPages}`;
    prevBtn.disabled = explorerCurrentPage === 1;
    nextBtn.disabled = explorerCurrentPage === totalPages;
    
    const container = resultsGrid.parentElement;
    container.scrollTop = 0;
}

function changeExplorerPage(delta) {
    const totalPages = Math.ceil(explorerResults.length / explorerPageSize);
    const newPage = explorerCurrentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        explorerCurrentPage = newPage;
        renderExplorerPage();
    }
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

    // Media Session API Integration for OS Lock Screen Controls
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: track.artist || "sOuLPLAY Library",
            album: "sOuLViSiON",
            artwork: [{ src: 'logo.svg', sizes: '512x512', type: 'image/svg+xml' }]
        });

        const actions = [
            ['play', () => toggleMusic()],
            ['pause', () => toggleMusic()],
            ['previoustrack', () => musicPrev()],
            ['nexttrack', () => musicNext()],
            ['seekbackward', (details) => musicSkip(-(details.seekOffset || 10))],
            ['seekforward', (details) => musicSkip(details.seekOffset || 10)],
            ['stop', () => { if(isMusicPlaying) toggleMusic(); }]
        ];

        for (const [action, handler] of actions) {
            try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) {}
        }
    }

    if (track.type === 'youtube') {
        if (ytPlayer && ytPlayer.loadVideoById) {
            ytPlayer.loadVideoById(track.id);
            if (isCCEnabled) ytPlayer.loadModule('captions');
            else ytPlayer.unloadModule('captions');
            ytPlayer.playVideo();
            isMusicPlaying = true;
            // Background play hint for mobile
            if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
                showToast("Note: Standard mobile browsers may pause YouTube in background.", "info", 5000);
            }
        }
    } else {
        initAudioContext();
        if (audioContext.state === 'suspended') audioContext.resume();
        audioPlayer.src = track.url;
        audioPlayer.play().catch(e => console.log("Playback blocked"));
        isMusicPlaying = true;
    }

    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isMusicPlaying ? "playing" : "paused";
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

function toggleSubtitles() {
    const track = musicList[currentTrackIndex];
    if (track && track.type === 'youtube' && ytPlayer) {
        isCCEnabled = !isCCEnabled;
        if (isCCEnabled) {
            ytPlayer.loadModule('captions');
        } else {
            ytPlayer.unloadModule('captions');
        }
        const btn = document.getElementById('ccBtn');
        if (btn) btn.classList.toggle('control-active', isCCEnabled);
        showToast(isCCEnabled ? "Captions Enabled" : "Captions Disabled", "info");
    } else {
        showToast("Subtitles available only for sOuLPLAY Cloud tracks.", "warning");
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

function shuffleAndPlay() {
    if (musicList.length === 0) return showToast("Add some music first!", "warning");
    
    // Enable and force a fresh shuffle
    isShuffle = true;
    shuffledIndices = musicList.map((_, i) => i);
    for (let i = shuffledIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
    }
    
    const shuffleBtn = document.getElementById('shuffleBtn');
    if (shuffleBtn) shuffleBtn.classList.add('control-active');
    
    renderPlaylist();
    
    // Play the first song in the newly shuffled sequence
    playTrack(shuffledIndices[0]);
    showToast("Shuffle & Play sequence initiated.", "info");
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
        aiConfig.razorpayKey = data.razorpayKey;
        updateAIUI();
        if (document.getElementById('statKeys')) document.getElementById('statKeys').innerText = aiConfig.keys.length;
        if (document.getElementById('apiKeys')) document.getElementById('apiKeys').value = aiConfig.keys.join(', ');
        if (document.getElementById('modelList')) document.getElementById('modelList').value = JSON.stringify(aiConfig.models);
    }
}

function updateAIUI() {
    const options = aiConfig.models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

    const modelSelects = [
        document.getElementById('modelSelect'),
        document.getElementById('codeModelSelect'),
        document.getElementById('focusModelSelect'),
        document.getElementById('seekModelSelect'),
        document.getElementById('quizModelSelect'),
        document.getElementById('miniModelSelect'),
        document.getElementById('solveModelSelect')
    ];

    modelSelects.forEach(select => {
        if (select) {
            const currentSelected = select.value; // Preserve current selection if possible
            select.innerHTML = options;
            if (currentSelected && select.querySelector(`option[value="${currentSelected}"]`)) {
                select.value = currentSelected;
            } else if (aiConfig.models.length > 0) {
                select.value = aiConfig.models[0].id; // Default to first available model
            }
        }
    });
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
    // Force ID to number and update interaction timestamp
    conversation.id = Number(conversation.id);
    conversation.lastUpdated = Date.now();

    const idx = aiConversations.findIndex(c => Number(c.id) === conversation.id);
    if (idx > -1) {
        aiConversations[idx] = conversation;
    } else {
        aiConversations.unshift(conversation);
    }

    renderAIHistory();

    if (!currentUser) return;

    // Background sync
    try {
        await fetch(`/api/main?route=ai_conversations&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(conversation)
        });
    } catch (e) {
        console.warn("Could not sync AI history to cloud", e);
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
    const conv = aiConversations.find(c => Number(c.id) === id);
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
    
    // Robust sort by lastUpdated (or ID fallback) descending
    displayData.sort((a, b) => {
        const timeA = Number(a.lastUpdated || a.id);
        const timeB = Number(b.lastUpdated || b.id);
        return timeB - timeA;
    });

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
        const cid = Number(c.id);
        const isSelected = selectedConversations.has(cid);
        const isActive = cid === Number(currentChatId);
        return `
            <div onclick="loadConversation('${cid}')" class="group relative flex items-center rounded-xl transition-all duration-200 cursor-pointer overflow-hidden mb-1 ${isActive ? 'bg-purple-600/20 border border-purple-500/50 shadow-lg shadow-purple-900/20' : 'bg-white/5 border border-transparent hover:bg-white/10 hover:border-white/10'}">
                <div class="flex items-center justify-center w-8 pl-2">
                    <input type="checkbox" class="accent-purple-500 w-3.5 h-3.5 rounded cursor-pointer" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleConvSelection(${cid})">
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

    // Robust selection: Only reuse the last message if it's an active stream and role matches
    const lastMsg = box.lastElementChild;
    if (lastMsg && lastMsg.classList.contains('streaming-msg') && role === 'ai') {
        msgDiv = lastMsg;
    }

    if (!msgDiv) {
        msgDiv = document.createElement('div');
        msgDiv.className = `message ${role === 'user' ? 'user-msg' : 'ai-msg'} relative group ${isStreaming ? 'streaming-msg' : ''}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = "markdown-body";
        msgDiv.appendChild(contentDiv);
        box.appendChild(msgDiv);
    }

    // Sync streaming state class
    if (isStreaming) {
        msgDiv.classList.add('streaming-msg');
    } else {
        msgDiv.classList.remove('streaming-msg');
    }

    const contentDiv = msgDiv.querySelector('.markdown-body');
    
    // Check scroll position before content update for accurate auto-scroll intent
    // We stick to bottom only if the user is already there (or very close)
    const threshold = 150;
    const isAtBottom = (box.scrollHeight - box.scrollTop) <= (box.clientHeight + threshold);

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
            copyGroup.className = "msg-copy-group sticky top-0 float-right flex gap-1 z-20 ml-4 mb-2 -mr-1 md:-mr-2";
            // Prepend so it doesn't get pushed down by markdown content
            msgDiv.insertBefore(copyGroup, msgDiv.firstChild);
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

    if (isAtBottom || !isStreaming) {
        box.scrollTop = box.scrollHeight;
    }
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
let sttFinalTranscript = '';

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
    sttFinalTranscript = input.value;
    input.focus();
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        btn.innerHTML = `<i class="fas fa-stop-circle text-red-500 animate-pulse ${isMini ? 'text-[10px]' : ''}"></i>`;
        btn.classList.add('bg-purple-600/20', 'border-purple-500/50', 'text-purple-400');
        recognition.active = true;
        showToast("Listening...", "info");
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let currentFinal = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                currentFinal += transcript;
            } else {
                interimTranscript += transcript;
            }
        }
        
        if (currentFinal) {
            sttFinalTranscript = (sttFinalTranscript.trim() + " " + currentFinal.trim()).trim();
        }

        // Real-time typing: Update input with final accumulated text + current interim
        input.value = (sttFinalTranscript + " " + interimTranscript).trim();
        
        input.scrollTop = input.scrollHeight;
        if (!isMini && input.id === 'chatInput') autoResize(input);
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            sttForceStop = true;
            showToast("Microphone access denied or service unavailable.", "error");
        }
        console.warn("STT Error:", event.error);
    };

    recognition.onend = () => {
        if (!sttForceStop) {
            try { 
                recognition.start(); 
            } catch(e) { 
                console.warn("STT restart failed:", e); 
                setTimeout(() => { if(!sttForceStop) recognition.start(); }, 500);
            }
        } else {
            btn.innerHTML = `<i class="fas fa-microphone ${isMini ? 'text-xs' : ''}"></i>`;
            btn.classList.remove('bg-purple-600/20', 'border-purple-500/50', 'text-purple-400');
            recognition.active = false;
            showToast("Microphone OFF", "warning");
        }
    };

    recognition.start();
}

let editingAttachmentIdx = -1;

// Updated Auto-Resize Logic
function autoResize(textarea) {
    if (!textarea) return;

    // Force style reset to calculate correct scrollHeight
    textarea.style.height = 'auto'; 
    
    const isLargeEditor = textarea.id === 'noteInput' || textarea.id === 'editNoteText';
    const baseHeight = isLargeEditor ? 120 : 44; 
    
    // Use scrollHeight but ensure it's at least the base height
    let newHeight = textarea.scrollHeight;
    if (newHeight < baseHeight) newHeight = baseHeight;
    
    const maxHeight = window.innerHeight * 0.6;
    
    if (newHeight > maxHeight) {
        textarea.style.height = maxHeight + 'px';
        textarea.style.overflowY = 'auto';
    } else {
        textarea.style.height = newHeight + 'px';
        textarea.style.overflowY = 'hidden';
    }
}

// Add a window resize listener to keep textareas responsive
window.addEventListener('resize', () => {
    ['chatInput', 'noteInput', 'editNoteText', 'miniChatInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) autoResize(el);
    });
});

function prefillAIPrompt(text) {
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = text;
        input.focus();
        autoResize(input);
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
    const codePreview = document.getElementById('codeAttachmentPreview');
    const solvePreview = document.getElementById('solveAttachmentPreview');
    [preview, miniPreview, codePreview, solvePreview].forEach(p => { if(p) p.innerHTML = ''; });

    pendingFiles.forEach((file, idx) => {
        const chip = document.createElement('div');
        chip.className = "bg-purple-600/20 text-purple-400 text-[10px] px-2 py-1 rounded flex items-center gap-2 border border-purple-500/30 group animate-fadeIn";
        
        let icon = '<i class="fas fa-file-alt"></i>';
        let editBtn = '';
        
        if (file.mime_type.startsWith('image/')) {
            icon = `<img src="data:${file.mime_type};base64,${file.data}" class="w-4 h-4 rounded object-cover">`;
        } else if (file.raw !== undefined) {
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
        
        let target = miniPreview;
        if (document.getElementById('ai').classList.contains('active')) target = preview;
        else if (document.getElementById('code').classList.contains('active')) target = codePreview;
        else if (document.getElementById('solve').classList.contains('active')) target = solvePreview;
        
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
    const titleEl = document.getElementById('largeEditorTitle');
    const filenameContainer = document.getElementById('largeEditorFilenameContainer');
    const filenameInput = document.getElementById('largeEditorFilename');
    const isOpening = modal.classList.contains('hidden');
    
    if (isOpening) {
        editingAttachmentIdx = attachmentIdx;
        if (attachmentIdx !== -1) {
            // Editing an attached file
            const file = pendingFiles[attachmentIdx];
            editor.value = file.raw || '';
            filenameInput.value = file.name;
            titleEl.innerText = `Editing: ${file.name}`;
            filenameContainer.classList.remove('hidden'); // Show filename input
        } else {
            // Using as a general large text input for chat
            editor.value = content || document.getElementById('chatInput').value;
            titleEl.innerText = 'sOuLAI Advanced Editor';
            filenameInput.value = ''; // Clear filename
            filenameContainer.classList.add('hidden'); // Hide filename input
        }
        modal.classList.remove('hidden');
        editor.focus();
        autoResize(editor); // Ensure editor resizes correctly on open
    } else {
        modal.classList.add('hidden');
        editingAttachmentIdx = -1;
        // Clean up title/filename when closing
        titleEl.innerText = 'sOuLAI Advanced Editor';
        filenameInput.value = '';
        filenameContainer.classList.add('hidden');
    }
}

function saveLargeEditor() {
    const content = document.getElementById('largeEditorText').value;
    const newFileName = document.getElementById('largeEditorFilename').value.trim();

    if (editingAttachmentIdx !== -1) {
        // Saving changes to an existing attached file
        const fileToUpdate = pendingFiles[editingAttachmentIdx];
        fileToUpdate.raw = content;
        // Re-encode content to base64
        fileToUpdate.data = btoa(new TextEncoder().encode(content).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        
        if (newFileName && newFileName !== fileToUpdate.name) {
            fileToUpdate.name = newFileName;
        }

        renderAttachmentChips(); // Re-render chips to show updated name/content
        showToast(`File "${fileToUpdate.name}" updated.`, "success");

    } else {
        // Original logic: content from chatInput or new large text to attach
        if (content.length > 3000) {
            addTextAsAttachment(content);
            document.getElementById('chatInput').value = '';
            showToast("Large text attached as a file.", "success");
        } else {
            const input = document.getElementById('chatInput');
            input.value = content;
            autoResize(input);
            showToast("Content applied to chat input.", "info");
        }
    }
    toggleLargeEditor(); // Close the modal
}

async function exportData(type, id, format, providedData = null) {
    if (!id && !providedData) {
        alert("Selection required for export.");
        return;
    }
    let payload = providedData;
    
    if (!payload) {
        if (type === 'chat') {
            payload = aiConversations.find(c => c.id === Number(id));
        } else if (type === 'note') {
            payload = notes.find(n => n.id === Number(id));
        }
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
    const clipboardData = e.clipboardData || e.originalEvent.clipboardData;
    const textData = clipboardData.getData('text/plain');
    const files = [];

    // Check for large text paste
    if (textData.length > 3000) { // Threshold for large text: 3000 characters
        e.preventDefault();
        addTextAsAttachment(textData);
        e.target.value = '';
        autoResize(e.target);
        return;
    }

    // Check for file paste
    const items = clipboardData.items;
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

// Add paste listener for miniChatInput
document.getElementById('miniChatInput').addEventListener('paste', (e) => {
    const clipboardData = e.clipboardData || e.originalEvent.clipboardData;
    const textData = clipboardData.getData('text/plain');
    const files = [];

    // Check for large text paste
    if (textData.length > 3000) { // Threshold for large text: 3000 characters
        e.preventDefault();
        addTextAsAttachment(textData);
        e.target.value = '';
        autoResize(e.target);
        return;
    }

    // Check for file paste
    const items = clipboardData.items;
    for (let item of items) {
        if (item.kind === 'file') {
            files.push(item.getAsFile());
        }
    }
    if (files.length > 0) {
        e.preventDefault();
        handleAIFile(files, true); // Pass true for mini chat
    }
});

['codeChatInput', 'solveAIInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('paste', (e) => {
            const clipboardData = e.clipboardData || e.originalEvent.clipboardData;
            const textData = clipboardData.getData('text/plain');
            const files = [];
            if (textData.length > 3000) {
                e.preventDefault();
                addTextAsAttachment(textData);
                e.target.value = '';
                if (typeof autoResize === 'function') autoResize(e.target);
                return;
            }
            const items = clipboardData.items;
            for (let item of items) {
                if (item.kind === 'file') files.push(item.getAsFile());
            }
            if (files.length > 0) {
                e.preventDefault();
                handleAIFile(files);
            }
        });
    }
});

async function askAI() {
    stopAllSTT();
    if (isAICooldownActive) {
        showAICooldownOverlay();
        return;
    }
    const inputEl = document.getElementById('chatInput');
    const persona = document.getElementById('personaSelect').value;
    const model = document.getElementById('modelSelect').value; // Get model from main chat dropdown
    let input = inputEl.value;
    if(!input.trim() && pendingFiles.length === 0) return;
    
    if(!currentChatId) newConversation();
    const conv = aiConversations.find(c => c.id === currentChatId);
    
    const userMsg = input + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userMsg, 'chatBox');
    inputEl.value = '';
    autoResize(inputEl);
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
    
    await callGeminiAPI(input, 'chatBox', conv ? conv.messages : [], attachmentsForApi, model); // Pass selected model
}

async function askMiniAI() {
    stopAllSTT();
    if (isAICooldownActive) {
        showAICooldownOverlay();
        return;
    }
    const inputEl = document.getElementById('miniChatInput');
    const box = document.getElementById('miniChatBox');
    const txt = inputEl.value;
    const model = document.getElementById('miniModelSelect').value; // Get model from mini chat dropdown
    if(!txt.trim() && pendingFiles.length === 0) return;
    
    const userDisplayMsg = txt + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userDisplayMsg, 'miniChatBox');
    
    inputEl.value = '';
    autoResize(inputEl);
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });

    const parts = [{ text: txt || " " }];
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    
    miniChatHistory.push({ role: 'user', content: userDisplayMsg, parts });

    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];
    
    await callGeminiAPI(txt, 'miniChatBox', miniChatHistory, attachmentsForApi, model); // Pass selected model
}

async function callGeminiAPI(text, targetBoxId = 'chatBox', history = [], attachments = [], model = null) {
    document.title = '● AI is thinking...';
    
    if (!model) {
        if (aiConfig.models.length > 0) {
            model = aiConfig.models[0].id;
        } else {
            return alert("No AI models configured. Please ask admin to set them up.");
        }
    }
    
    if(!aiConfig.keys.length) return alert("Please configure API Keys in Admin panel.");

    let type = 'main';
    if (targetBoxId === 'miniChatBox') type = 'mini';
    else if (targetBoxId === 'codeChatBox') type = 'code';
    else if (targetBoxId === 'solveAIChat') type = 'solve';

    const statusEl = document.getElementById(type === 'mini' ? 'miniAiStatus' : (type === 'code' ? 'codeAIStatus' : (type === 'solve' ? 'solveAIStatus' : 'aiStatus')));
    
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

    if(statusEl) { 
        toggleSendButton(type, true);
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
    } else {
        toggleSendButton(type, true);
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
            let lastUIUpdate = 0;
            const UI_UPDATE_INTERVAL = 32; // ~30fps throttled UI updates for peak performance

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // decoder.decode with {stream: true} correctly handles multi-byte characters split across chunks
                buffer += decoder.decode(value, { stream: true });
                
                let startIdx;
                // Improved JSON Stream Buffer: Accumulates fragments until valid objects are resolved
                while ((startIdx = buffer.indexOf('{')) !== -1) {
                    let braceCount = 0;
                    let endIdx = -1;
                    for (let i = startIdx; i < buffer.length; i++) {
                        if (buffer[i] === '{') braceCount++;
                        else if (buffer[i] === '}') braceCount--;
                        
                        if (braceCount === 0) {
                            endIdx = i;
                            break;
                        }
                    }

                    if (endIdx !== -1) {
                        const chunkStr = buffer.substring(startIdx, endIdx + 1);
                        try {
                            const chunk = JSON.parse(chunkStr);
                            const textPart = chunk.candidates?.[0]?.content?.parts?.[0]?.text || "";
                            if (textPart) {
                                fullContent += textPart;
                                
                                // Throttled UI Update logic (Max ~30fps)
                                const now = Date.now();
                                if (now - lastUIUpdate > UI_UPDATE_INTERVAL) {
                                    let displayContent = fullContent;
                                    
                                    // Markdown fragment protection: close open tags for stable preview
                                    const codeBlockCount = (displayContent.match(/```/g) || []).length;
                                    if (codeBlockCount % 2 !== 0) displayContent += "\n```";
                                    const boldCount = (displayContent.match(/\*\*/g) || []).length;
                                    if (boldCount % 2 !== 0) displayContent += "**";
                                    
                                    appendAIMessage('ai', displayContent, targetBoxId, true);
                                    lastUIUpdate = now;
                                }
                            }
                            buffer = buffer.substring(endIdx + 1);
                        } catch (e) {
                            // If parsing fails despite matched braces, consume opening char to recover
                            buffer = buffer.substring(startIdx + 1);
                        }
                    } else {
                        break; // Incomplete object in buffer, wait for next stream chunk
                    }
                }
            }
            // Final render pass to ensure any remaining buffered content is displayed
            appendAIMessage('ai', fullContent, targetBoxId, true);
        } else {
            const data = await response.json();
            fullContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        }

        if (loadingInterval) clearInterval(loadingInterval);
        
        if (type === 'code' && fullContent.includes('CODE_START') && fullContent.includes('CODE_END')) {
             const commentary = fullContent.split('CODE_START')[0].replace('COMMENTARY:', '').trim();
             const newContent = fullContent.split('CODE_START')[1].split('CODE_END')[0].trim();
             appendAIMessage('ai', commentary + "\n\n**Proposed changes are ready for review.**", targetBoxId, false);
             
             let activeFile = projectFiles.find(f => f.id === activeFileId);
             if (activeFile) {
                 aiProposedChange = {
                     fileId: activeFile.id,
                     originalContent: activeFile.content,
                     newContent: newContent
                 };
                 showDiffOverlay();
             }
        } else {
            appendAIMessage('ai', fullContent, targetBoxId, false);
        }
        
        toggleSendButton(type, false);
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
        document.title = 'sOuLViSiON | Digital Sanctuary';
    } catch (err) {
        if (loadingInterval) clearInterval(loadingInterval);
        toggleSendButton(isMini, false);
        
        if (err.name === 'AbortError') {
            currentAbortController = null;
            if (statusEl) statusEl.classList.add('hidden');
            document.title = 'sOuLViSiON | Digital Sanctuary';
            return;
        }
        
        console.warn(`Key ${currentKeyIndex} error: ${err.message}.`);
        if (aiConfig.keys.length > 1) {
            currentKeyIndex = (currentKeyIndex + 1) % aiConfig.keys.length;
            return await callGeminiAPI(text, targetBoxId, history, attachments, model); // Pass model for retry
        }
        
        // Error handling: Increment failure count
        consecutiveApiFailures++;
        if (consecutiveApiFailures >= 3 && !isAICooldownActive) { // Threshold for cooldown (e.g., 3 failures)
            isAICooldownActive = true;
            showAICooldownOverlay();
            // Start a timer to automatically clear cooldown after some time (e.g., 5 minutes)
            aiCooldownTimer = setTimeout(() => {
                isAICooldownActive = false;
                consecutiveApiFailures = 0;
                hideAICooldownOverlay();
                showToast("AI Cooldown lifted! Try again.", "info");
            }, 5 * 60 * 1000); // 5 minutes
            showToast("AI is on cooldown. Please wait or support.", "warning");
            document.title = 'sOuLViSiON | Digital Sanctuary';
            return; // Don't retry more if cooldown is active
        }

        if(statusEl) statusEl.classList.add('hidden');
        
        if (err.message.includes("quota") || err.message.includes("API key")) {
            showBetterError("The Intelligence Core is exhausted or misconfigured. Admin attention required.");
        } else {
            appendAIMessage('ai', `**System Failure:** ${err.message}`, targetBoxId);
        }
        document.title = 'sOuLViSiON | Digital Sanctuary';
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

function copyChatAsMarkdown(chatId) {
    if (!chatId) return showToast("No active chat selected.", "warning");
    const conv = aiConversations.find(c => c.id === Number(chatId));
    if (!conv || !conv.messages || conv.messages.length === 0) {
        return showToast("Nothing to copy!", "warning");
    }

    const md = conv.messages.map(m => `**${m.role === 'user' ? 'User' : 'AI'}:** ${m.content}`).join('\n\n');
    navigator.clipboard.writeText(md).then(() => {
        showToast("Chat copied to clipboard as Markdown!", "success");
    }).catch(err => {
        showToast("Failed to copy chat.", "error");
    });
}

function copyMiniChatAsMarkdown() {
    const box = document.getElementById('miniChatBox');
    const messages = [];
    box.querySelectorAll('.message').forEach(msg => {
        const role = msg.classList.contains('user-msg') ? 'User' : 'AI';
        const content = msg.querySelector('.markdown-body').innerText;
        messages.push(`**${role}:** ${content}`);
    });

    if (messages.length === 0) return showToast("Nothing to copy!", "warning");

    const md = messages.join('\n\n');
    navigator.clipboard.writeText(md).then(() => {
        showToast("Chat copied to clipboard as Markdown!", "success");
    }).catch(err => {
        showToast("Failed to copy chat.", "error");
    });
}

function toggleAIHistory() {
    const sidebar = document.getElementById('aiSidebar');
    sidebar.classList.toggle('hidden');
}
function toggleMiniChat() { document.getElementById('miniChat').classList.toggle('show'); }

function stopAllSTT() {
    if (recognition && recognition.active) {
        sttForceStop = true;
        recognition.stop();
    }
}

// --- sOuLSEEK LOGIC ---
async function syncSeekHistory() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=soulseek_history&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            seekHistory = data[0].messages || [];
            const box = document.getElementById('seekChatBox');
            box.innerHTML = '';
            seekHistory.forEach(m => appendAIMessage(m.role, m.content, 'seekChatBox'));
        }
    } catch (e) { console.warn("Seek history sync failed", e); }
}

async function askSoulSeekAI() {
    stopAllSTT();
    if (isAICooldownActive) {
        showAICooldownOverlay();
        return;
    }
    const inputEl = document.getElementById('seekInput');
    const text = inputEl.value.trim();
    if (!text) return;

    appendAIMessage('user', text, 'seekChatBox');
    inputEl.value = '';
    autoResize(inputEl);

    const systemPrompt = `You are the sOuLSEEK Oracle, an expert Vedic Numerologist. 
    Your brain is built on Harish Johari's "Numerology With Tantra, Ayurveda, and Astrology".
    
    GUIDELINES:
    1. Always be mystical, insightful, and supportive.
    2. Your goal is to help the user understand their Psychic, Destiny, and Name numbers.
    3. You MUST ask relevant questions to understand their situation. Do not just answer; engage.
    4. Use the specific traits of numbers (1-9) and their related planets/humors from Harish Johari's teachings.
    5. If they haven't provided it, ask for their full name and birth date.
    6. Analyze the interaction to prepare for a "Final Report".
    
    KNOWLEDGE BASE SNIPPET:
    ${HARISH_JOHARI_KNOWLEDGE.substring(0, 5000)}... [Instruction: Use full Vedic Numerology principles for calculation and interpretation]`;

    seekHistory.push({ role: 'user', content: text });
    
    const messages = [{ role: 'user', parts: [{ text: systemPrompt + "\n\nUser Message: " + text }] }];
    // Prepend history for context
    seekHistory.slice(-10).forEach(h => messages.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] }));

    const statusEl = document.getElementById('seekAiStatus');
    statusEl.classList.remove('hidden');
    
    const model = document.getElementById('seekModelSelect').value; // Get model from seek dropdown
    const key = aiConfig.keys[currentKeyIndex];

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: messages })
        });
        const data = await res.json();
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "The numbers are clouded. Try again.";
        
        appendAIMessage('ai', aiResponse, 'seekChatBox');
        seekHistory.push({ role: 'ai', content: aiResponse });

        if (currentUser) {
            await fetch(`/api/main?route=soulseek_history&userId=${encodeURIComponent(currentUser.email)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: 'current_session', messages: seekHistory })
            });
        }
    } catch (e) {
        showToast("Oracle connection failed.", "error");
    } finally {
        statusEl.classList.add('hidden');
    }
}

async function generateSoulSeekReport() {
    if (seekHistory.length < 4) return showToast("We need more interaction to formulate a report.", "warning");
    
    setLoading(true, "Compiling Numerological Blueprint");
    // Ensure we use the selected model from the UI
    const model = document.getElementById('seekModelSelect')?.value || aiConfig.models[0]?.id || "gemini-1.5-flash";
    const key = aiConfig.keys[currentKeyIndex];

    const prompt = `Based on our conversation history, generate a COMPREHENSIVE Numerological Report. 
    Include:
    - Calculation of Psychic, Destiny, and Name Numbers.
    - Detailed personality breakdown based on Harish Johari's teachings.
    - Life Path advice and planetary influences.
    - Specific advice for their current situation discussed.
    Format the output in professional Markdown.
    
    CONVERSATION HISTORY:
    ${JSON.stringify(seekHistory)}`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const aiSummary = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        
        const reportData = {
            id: Date.now(),
            title: currentUser?.name || 'Seeker',
            summary: aiSummary,
            history: seekHistory
        };

        // Call export with dedicated seek_report type to include conversation history automatically in backend
        await exportData('seek_report', reportData.id, 'pdf', reportData);
        showToast("Report Transferred to your device.", "success");
    } catch (e) {
        showToast("Failed to compile report.", "error");
        console.error("Seek Report Error:", e);
    } finally {
        setLoading(false);
    }
}

function clearSeekChat() {
    if (confirm("Reset Oracle session?")) {
        document.getElementById('seekChatBox').innerHTML = '<div class="ai-msg message"><div class="markdown-body text-sm italic">The cycle begins anew. Please tell me your Full Name and Date of Birth.</div></div>';
        seekHistory = [];
        if (currentUser) {
            fetch(`/api/main?route=soulseek_history&userId=${encodeURIComponent(currentUser.email)}`, { method: 'DELETE' });
        }
    }
}

// --- sOuLFUN ENHANCEMENTS ---
let clickCount = 0;
let clickTime = 10;
let clickActive = false;
let clickLastTime = 0;

function startClicker() {
    const counter = document.getElementById('clickCounter');
    const combo = document.getElementById('clickCombo');
    const now = Date.now();

    if (window.navigator.vibrate) window.navigator.vibrate(5);

    if (clickActive) {
        clickCount++;
        counter.innerText = clickCount;
        
        // Combo Logic
        if (now - clickLastTime < 250) {
            const multiplier = Math.min(Math.floor(clickCount / 10) + 1, 10);
            combo.innerText = `x${multiplier}`;
            combo.style.opacity = '1';
            combo.style.transform = 'translateY(-10px) scale(1.2)';
        } else {
            combo.style.opacity = '0';
        }
        clickLastTime = now;
        return;
    }

    clickActive = true;
    clickCount = 1;
    clickTime = 10;
    clickLastTime = now;
    counter.innerText = "1";
    
    const interval = setInterval(async () => {
        clickTime--;
        document.getElementById('clickTimer').innerText = clickTime + "s REMAINING";
        if (clickTime <= 0) {
            clearInterval(interval);
            clickActive = false;
            const cps = clickCount / 10;
            combo.style.opacity = '0';
            showToast(`SESSIONS ENDED | CPS: ${cps}`, "info");
            
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

// Neural Flow Enhancement
function toggleZenBreath(btn) {
    const circle = document.getElementById('breathCircle');
    const text = document.getElementById('breathText');
    const ring = document.getElementById('zenRing');
    
    if (zenInterval) {
        clearInterval(zenInterval);
        zenInterval = null;
        circle.style.transform = 'scale(1)';
        ring.style.opacity = '0';
        text.innerText = 'IDLE';
        btn.innerText = 'BEGIN CYCLE';
        btn.classList.replace('bg-red-600', 'bg-teal-600');
        return;
    }

    btn.innerText = 'END CYCLE';
    btn.classList.replace('bg-teal-600', 'bg-red-600');
    ring.style.opacity = '1';
    
    let stage = 0;
    const animate = () => {
        if (stage === 0) { // Inhale
            circle.style.transform = 'scale(1.8)';
            circle.style.backgroundColor = 'rgba(20, 184, 166, 0.4)';
            text.innerText = 'INHALE';
            if (breathingState.soundEnabled) playBreathingPulse(440, 1);
            stage = 1;
        } else { // Exhale
            circle.style.transform = 'scale(1)';
            circle.style.backgroundColor = 'rgba(20, 184, 166, 0.1)';
            text.innerText = 'EXHALE';
            if (breathingState.soundEnabled) playBreathingPulse(330, 1);
            stage = 0;
        }
    };
    
    animate();
    zenInterval = setInterval(animate, 4000);
}

// Emoji Alchemy Implementation
const alchemyEmojis = ['🔥', '💧', '🌱', '💨', '⚡', '❄️', '🌑', '✨', '💎', '🍄'];
const alchemyRecipes = {
    '🔥💧': '☁️', '🔥🌱': '🍂', '💧🌱': '🌸', '💨⚡': '🌩️', '❄️🔥': '💧',
    '🌑✨': '🔮', '🌱🌱': '🌳', '🔥🔥': '🌋', '💧💧': '🌊', '💨💨': '🌪️',
    '💎✨': '👑', '🍄🌑': '🧚', '⚡💧': '🔋', '❄️🌱': '🧊'
};
let alchemySlots = [null, null];

function pickAlchemyEmoji(slotNum) {
    const randomEmoji = alchemyEmojis[Math.floor(Math.random() * alchemyEmojis.length)];
    alchemySlots[slotNum - 1] = randomEmoji;
    const slotEl = document.getElementById(`alchemySlot${slotNum}`);
    slotEl.innerText = randomEmoji;
    slotEl.classList.remove('emoji-pop');
    void slotEl.offsetWidth;
    slotEl.classList.add('emoji-pop');
}

function transmuteEmojis() {
    if (!alchemySlots[0] || !alchemySlots[1]) return showToast("Pick two elements first!", "warning");
    
    const combo1 = alchemySlots[0] + alchemySlots[1];
    const combo2 = alchemySlots[1] + alchemySlots[0];
    const result = alchemyRecipes[combo1] || alchemyRecipes[combo2] || '💥';
    
    const slot1 = document.getElementById('alchemySlot1');
    const slot2 = document.getElementById('alchemySlot2');
    
    slot1.innerText = '✨';
    slot2.innerText = '✨';
    
    setTimeout(() => {
        slot1.innerText = result;
        slot2.innerText = result;
        if (result === '💥') showToast("Transmutation Failed! Unstable bond.", "error");
        else showToast(`Success! You created ${result}`, "success");
        
        alchemySlots = [null, null];
    }, 600);
}

// Particle Void Implementation
let particles = [];
let funCanvas, funCtx;

function initParticleVoid() {
    funCanvas = document.getElementById('funCanvas');
    if (!funCanvas) return;
    funCtx = funCanvas.getContext('2d');
    resizeFunCanvas();
    window.addEventListener('resize', resizeFunCanvas);
    
    funCanvas.addEventListener('mousedown', (e) => spawnParticles(e.offsetX, e.offsetY));
    funCanvas.addEventListener('mousemove', (e) => { if(e.buttons) spawnParticles(e.offsetX, e.offsetY); });
    
    funCanvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const rect = funCanvas.getBoundingClientRect();
        spawnParticles(e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top);
    }, { passive: false });

    animateParticles();
}

function resizeFunCanvas() {
    if (!funCanvas) return;
    funCanvas.width = funCanvas.parentElement.offsetWidth;
    funCanvas.height = funCanvas.parentElement.offsetHeight;
}

function spawnParticles(x, y) {
    for (let i = 0; i < 15; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 5,
            vy: (Math.random() - 0.5) * 5,
            size: Math.random() * 3 + 1,
            color: `hsla(${Math.random() * 360}, 70%, 60%, 0.8)`,
            life: 1
        });
    }
}

function animateParticles() {
    if (!funCtx) return;
    requestAnimationFrame(animateParticles);
    funCtx.clearRect(0, 0, funCanvas.width, funCanvas.height);
    
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        funCtx.fillStyle = p.color;
        funCtx.globalAlpha = p.life;
        funCtx.beginPath();
        funCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        funCtx.fill();
    });
}

function clearParticleVoid() {
    particles = [];
}

async function syncFunStats() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
        // We can use this data for local stats visualization if needed later
    } catch(e) {}
}

// --- sOuLQUIZ LOGIC ---
async function startQuiz(category) {
    if (!currentUser) return showPage('login');
    
    quizState = {
        active: true,
        questions: [],
        currentIndex: 0,
        score: 0,
        timer: null,
        category: category,
        results: []
    };

    document.getElementById('quizIntro').classList.add('hidden');
    document.getElementById('quizSummary').classList.add('hidden');
    document.getElementById('quizQuestionBox').classList.add('hidden');
    document.getElementById('quizLoading').classList.remove('hidden');
    document.getElementById('quizScoreDisplay').innerText = '000';
    
    try {
        const prompt = `Generate 10 multiple-choice questions for the category: "${category}". 
        Return ONLY a JSON array of objects with keys: "q" (the question), "o" (array of 4 options), "a" (index of correct option 0-3). 
        Do not include markdown blocks or any text other than the JSON. Ensure questions are challenging and diverse.`;
        
        const model = document.getElementById('quizModelSelect').value; // Get model from quiz dropdown
        quizState.model = model; // Store model in quizState
        const key = aiConfig.keys[currentKeyIndex];
        
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const data = await res.json();
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        // Clean markdown if AI insisted
        text = text.replace(/```json/g, "").replace(/```/g, "").trim();
        
        quizState.questions = JSON.parse(text);
        if (!Array.isArray(quizState.questions)) throw new Error("Invalid Format");

        document.getElementById('quizLoading').classList.add('hidden');
        document.getElementById('quizQuestionBox').classList.remove('hidden');
        renderQuizQuestion();
    } catch (e) {
        console.error(e);
        showToast("The Oracle failed to generate questions. Try another category.", "error");
        resetQuiz();
    }
}

function renderQuizQuestion() {
    const q = quizState.questions[quizState.currentIndex];
    const total = quizState.questions.length;
    const current = quizState.currentIndex + 1;
    
    document.getElementById('quizProgressText').innerText = `Question ${current.toString().padStart(2, '0')} / ${total}`;
    document.getElementById('quizCategoryLabel').innerText = quizState.category.toUpperCase();
    document.getElementById('quizQuestionText').innerText = q.q;
    
    // Render Visual Progress Dots
    const progressEl = document.getElementById('quizVisualProgress');
    progressEl.innerHTML = Array(total).fill(0).map((_, i) => {
        const state = i < quizState.currentIndex ? 'bg-indigo-500' : (i === quizState.currentIndex ? 'bg-indigo-500 animate-pulse' : 'bg-white/10');
        return `<div class="w-3 h-1 rounded-full ${state}"></div>`;
    }).join('');

    const optionsBox = document.getElementById('quizOptions');
    optionsBox.innerHTML = q.o.map((opt, idx) => `
        <button onclick="handleQuizAnswer(${idx})" class="quiz-opt-btn group/opt" id="opt-${idx}">
            <div class="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-[11px] font-black group-hover/opt:bg-indigo-600 group-hover/opt:text-white group-hover/opt:border-indigo-400 transition-all shadow-inner">
                ${String.fromCharCode(65 + idx)}
            </div>
            <span class="flex-grow text-left text-sm font-medium text-gray-300 group-hover/opt:text-white transition-colors">${opt}</span>
            <i class="fas fa-chevron-right text-[8px] opacity-0 group-hover/opt:opacity-100 group-hover/opt:translate-x-1 transition-all text-indigo-400"></i>
        </button>
    `).join('');

    startQuizTimer();
}

function startQuizTimer() {
    if (quizState.timer) clearInterval(quizState.timer);
    quizState.timeLeft = 100;
    document.getElementById('quizTimerBox').classList.remove('hidden');
    
    quizState.timer = setInterval(() => {
        quizState.timeLeft -= 0.5;
        document.getElementById('quizTimerBar').style.width = quizState.timeLeft + '%';
        if (quizState.timeLeft <= 0) {
            clearInterval(quizState.timer);
            handleQuizAnswer(-1); // Timeout
        }
    }, 50);
}

async function handleQuizAnswer(idx) {
    clearInterval(quizState.timer);
    const correctIdx = quizState.questions[quizState.currentIndex].a;
    const isCorrect = idx === correctIdx;
    
    // UI feedback
    const btns = document.querySelectorAll('.quiz-opt-btn');
    btns.forEach(b => b.disabled = true);
    
    if (idx !== -1) {
        document.getElementById(`opt-${idx}`).classList.add(isCorrect ? 'quiz-correct' : 'quiz-wrong');
    }
    document.getElementById(`opt-${correctIdx}`).classList.add('quiz-correct');

    if (isCorrect) {
        const bonus = Math.round(quizState.timeLeft / 10);
        quizState.score += (10 + bonus);
        document.getElementById('quizScoreDisplay').innerText = quizState.score.toString().padStart(3, '0');
        if (window.navigator.vibrate) window.navigator.vibrate(20);
    } else {
        if (window.navigator.vibrate) window.navigator.vibrate([30, 30, 30]);
    }

    quizState.results.push({ q: quizState.questions[quizState.currentIndex].q, correct: isCorrect });

    setTimeout(() => {
        if (quizState.currentIndex < quizState.questions.length - 1) {
            quizState.currentIndex++;
            renderQuizQuestion();
        } else {
            finishQuiz();
        }
    }, 1200);
}

async function finishQuiz() {
    quizState.active = false;
    document.getElementById('quizQuestionBox').classList.add('hidden');
    document.getElementById('quizTimerBox').classList.add('hidden');
    document.getElementById('quizLoading').classList.remove('hidden');

    const totalScore = quizState.score;
    const correctCount = quizState.results.filter(r => r.correct).length;
    
    try {
        // Get AI Evaluation
        const prompt = `The user completed a "${quizState.category}" quiz. Score: ${totalScore}/200. Correct: ${correctCount}/${quizState.questions.length}. 
        Give a single, concise, and mystical/intellectual one-sentence evaluation of their performance.`;
        
        const model = document.getElementById('focusModelSelect').value; // Get model from focus dropdown
        const key = aiConfig.keys[currentKeyIndex];
        
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const insight = data.candidates?.[0]?.content?.parts?.[0]?.text || "Your journey through the lattice of knowledge continues.";

        document.getElementById('quizLoading').classList.add('hidden');
        document.getElementById('quizSummary').classList.remove('hidden');
        document.getElementById('summaryFinalScore').innerText = totalScore;
        document.getElementById('summaryInsight').innerText = insight;

        if (currentUser) {
            await fetch(`/api/main?route=quiz_score&userId=${encodeURIComponent(currentUser.email)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    category: quizState.category, 
                    score: totalScore, 
                    correct: correctCount, 
                    total: quizState.questions.length 
                })
            });
            syncQuizLeaderboard();
        }
    } catch (e) {
        console.error(e);
        document.getElementById('quizLoading').classList.add('hidden');
        document.getElementById('quizSummary').classList.remove('hidden');
    }
}

async function syncQuizLeaderboard() {
    const list = document.getElementById('quizLeaderboardList');
    if (!list) return;
    try {
        const res = await fetch('/api/main?route=quiz_leaderboard');
        const data = await res.json();
        if (!data || data.length === 0) {
            list.innerHTML = '<p class="text-[10px] text-gray-500 italic p-4 text-center">No legends yet.</p>';
            return;
        }
        list.innerHTML = data.map((u, i) => `
            <div class="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-indigo-500/20 transition-all">
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-black ${i < 3 ? 'text-yellow-500' : 'text-gray-600'}">#${(i+1).toString().padStart(2, '0')}</span>
                    <span class="text-xs font-bold text-gray-200 truncate max-w-[120px]">${u.name}</span>
                </div>
                <span class="text-xs font-black text-indigo-400 font-mono">${u.totalSoulScore}</span>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

function resetQuiz() {
    if (quizState.timer) clearInterval(quizState.timer);
    quizState.active = false;
    document.getElementById('quizIntro').classList.remove('hidden');
    document.getElementById('quizLoading').classList.add('hidden');
    document.getElementById('quizQuestionBox').classList.add('hidden');
    document.getElementById('quizSummary').classList.add('hidden');
    document.getElementById('quizScoreDisplay').innerText = '000';
    document.getElementById('quizTimerBox').classList.add('hidden');
}

// --- sOuLSNAKE ENGINE (REBUILT FOR PERFORMANCE) ---
let snake, food, dx, dy, score, snakeInterval, snakeCanvas, snakeCtx;
let snakeGridSize = 20;
let nextDx, nextDy; 
let touchStartX = 0;
let touchStartY = 0;

function handleSnakeSwipe() {
    const canvas = document.getElementById('snakeCanvas');
    if (!canvas) return;

    canvas.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    canvas.addEventListener('touchend', e => {
        const touchEndX = e.changedTouches[0].screenX;
        const touchEndY = e.changedTouches[0].screenY;
        
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;
        const threshold = 30;

        if (Math.abs(diffX) > Math.abs(diffY)) {
            if (Math.abs(diffX) > threshold) {
                if (diffX > 0) handleManualSnakeMove('right');
                else handleManualSnakeMove('left');
            }
        } else {
            if (Math.abs(diffY) > threshold) {
                if (diffY > 0) handleManualSnakeMove('down');
                else handleManualSnakeMove('up');
            }
        }
    }, { passive: true });
}

function initSnake() {
    handleSnakeSwipe();
    snakeCanvas = document.getElementById('snakeCanvas');
    if (!snakeCanvas) return;
    
    snakeCanvas.width = 400;
    snakeCanvas.height = 400;
    snakeCtx = snakeCanvas.getContext('2d');
    
    snake = [
        {x: 200, y: 200}, 
        {x: 180, y: 200}, 
        {x: 160, y: 200}
    ];
    dx = snakeGridSize; dy = 0;
    nextDx = dx; nextDy = dy;
    score = 0;
    createFood();
    clearSnakeCanvas();
    drawSnakeBody();
    drawSnakeFood();
}

function startSnake() {
    if (snakeInterval) clearInterval(snakeInterval);
    initSnake();
    document.getElementById('snakeMenu').classList.add('hidden');
    document.getElementById('quitSnakeBtn').classList.remove('hidden');
    // Lock scroll and focus
    document.body.style.overflow = 'hidden';
    // Prevent default touch actions on canvas to stop scrolling while playing
    document.getElementById('snakeCanvas').style.touchAction = 'none';
    const container = document.getElementById('snakeGameContainer');
    if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    snakeInterval = setInterval(mainSnake, 100);
    updateSnakeUI();
}

function quitSnake() {
    clearInterval(snakeInterval);
    snakeInterval = null;
    // Unlock scroll
    document.body.style.overflow = '';
    const canvas = document.getElementById('snakeCanvas');
    if (canvas) canvas.style.touchAction = 'auto';
    const menu = document.getElementById('snakeMenu');
    const btn = document.getElementById('quitSnakeBtn');
    if (menu) menu.classList.remove('hidden');
    if (btn) btn.classList.add('hidden');
}

function mainSnake() {
    dx = nextDx; dy = nextDy; // Apply queued direction
    if (didSnakeGameEnd()) {
        handleSnakeGameOver();
        return;
    }
    clearSnakeCanvas();
    drawSnakeFood();
    advanceSnakeBody();
    drawSnakeBody();
}

async function handleSnakeGameOver() {
    clearInterval(snakeInterval);
    snakeInterval = null;
    showToast(`GAME OVER | SCORE: ${score}`, "error");
    if (currentUser) {
        await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'snake', score: score })
        });
        syncSnakeLeaderboard();
    }
    setTimeout(initSnake, 1000);
    document.getElementById('snakeMenu').classList.remove('hidden');
}

function clearSnakeCanvas() {
    snakeCtx.fillStyle = "#000";
    snakeCtx.fillRect(0, 0, snakeCanvas.width, snakeCanvas.height);
    snakeCtx.strokeStyle = "rgba(255,255,255,0.02)";
    for(let i=0; i<snakeCanvas.width; i+=snakeGridSize) {
        snakeCtx.beginPath(); snakeCtx.moveTo(i,0); snakeCtx.lineTo(i,400); snakeCtx.stroke();
        snakeCtx.beginPath(); snakeCtx.moveTo(0,i); snakeCtx.lineTo(400,i); snakeCtx.stroke();
    }
}

function drawSnakeBody() {
    snake.forEach((part, i) => {
        const isHead = i === 0;
        snakeCtx.fillStyle = isHead ? "#22c55e" : "#065f46";
        const r = isHead ? 6 : 4;
        const x = part.x + 1, y = part.y + 1, w = snakeGridSize - 2, h = snakeGridSize - 2;
        
        snakeCtx.beginPath();
        snakeCtx.roundRect(x, y, w, h, r);
        snakeCtx.fill();

        if (isHead) {
            snakeCtx.fillStyle = "#fff";
            if (dx > 0) { snakeCtx.fillRect(x+12, y+4, 3, 3); snakeCtx.fillRect(x+12, y+11, 3, 3); }
            else if (dx < 0) { snakeCtx.fillRect(x+3, y+4, 3, 3); snakeCtx.fillRect(x+3, y+11, 3, 3); }
            else if (dy < 0) { snakeCtx.fillRect(x+4, y+3, 3, 3); snakeCtx.fillRect(x+11, y+3, 3, 3); }
            else { snakeCtx.fillRect(x+4, y+12, 3, 3); snakeCtx.fillRect(x+11, y+12, 3, 3); }
        }
    });
}

function advanceSnakeBody() {
    const head = {x: snake[0].x + dx, y: snake[0].y + dy};
    snake.unshift(head);
    if (snake[0].x === food.x && snake[0].y === food.y) {
        score += 10;
        updateSnakeUI();
        createFood();
        if (window.navigator.vibrate) window.navigator.vibrate(15);
    } else {
        snake.pop();
    }
}

function didSnakeGameEnd() {
    const head = snake[0];
    for (let i = 4; i < snake.length; i++) {
        if (snake[i].x === head.x && snake[i].y === head.y) return true;
    }
    return head.x < 0 || head.x >= 400 || head.y < 0 || head.y >= 400;
}

function createFood() {
    food = {
        x: Math.floor(Math.random() * 20) * snakeGridSize,
        y: Math.floor(Math.random() * 20) * snakeGridSize
    };
    if (snake.some(p => p.x === food.x && p.y === food.y)) createFood();
}

function drawSnakeFood() {
    snakeCtx.fillStyle = "#ef4444";
    snakeCtx.shadowBlur = 10;
    snakeCtx.shadowColor = "#ef4444";
    snakeCtx.beginPath();
    snakeCtx.arc(food.x + 10, food.y + 10, 7, 0, Math.PI * 2);
    snakeCtx.fill();
    snakeCtx.shadowBlur = 0;
}

function updateSnakeUI() {
    const el = document.getElementById('snakeScore');
    if (el) el.innerText = score.toString().padStart(3, '0');
}

function handleManualSnakeMove(dir) {
    if (dir === 'left' && dx === 0) { nextDx = -snakeGridSize; nextDy = 0; }
    if (dir === 'up' && dy === 0) { nextDx = 0; nextDy = -snakeGridSize; }
    if (dir === 'right' && dx === 0) { nextDx = snakeGridSize; nextDy = 0; }
    if (dir === 'down' && dy === 0) { nextDx = 0; nextDy = snakeGridSize; }
}

document.addEventListener("keydown", (e) => {
    if (!snakeInterval) return;
    const key = e.key.toLowerCase();
    // Prevent scrolling with arrows or space while game is active
    if (["arrowleft", "a", "arrowup", "w", "arrowright", "d", "arrowdown", "s", " "].includes(key)) {
        e.preventDefault();
        if (["arrowleft", "a"].includes(key)) handleManualSnakeMove('left');
        if (["arrowup", "w"].includes(key)) handleManualSnakeMove('up');
        if (["arrowright", "d"].includes(key)) handleManualSnakeMove('right');
        if (["arrowdown", "s"].includes(key)) handleManualSnakeMove('down');
    }
});

async function syncSnakeLeaderboard() {
    const list = document.getElementById('snakeLeaderboardList');
    if (!list) return;
    try {
        const res = await fetch('/api/main?route=snake_leaderboard');
        const data = await res.json();
        if (!data || data.length === 0) {
            list.innerHTML = '<p class="text-[10px] text-gray-500 italic p-4 text-center">No data.</p>';
            return;
        }
        list.innerHTML = data.map((u, i) => `
            <div class="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-green-500/20 transition-all">
                <div class="flex items-center gap-3">
                    <span class="text-[10px] font-black ${i < 3 ? 'text-yellow-500' : 'text-gray-600'}">#${(i+1).toString().padStart(2, '0')}</span>
                    <span class="text-xs font-bold text-gray-200 truncate max-w-[120px]">${u.name}</span>
                </div>
                <span class="text-xs font-black text-green-400 font-mono">${u.highScore}</span>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

function shakeBall() {
    const core = document.getElementById('sphereCore');
    const response = document.getElementById('ballResponse');
    
    core.style.animation = 'none';
    void core.offsetWidth;
    core.style.animation = 'shake 0.5s cubic-bezier(.36,.07,.19,.97) both';
    
    response.style.opacity = '0';
    
    const answers = [
        "IT IS CERTAIN", "WITHOUT A DOUBT", "DECRYPTING... YES", 
        "VOID SAYS NO", "SYSTEM UNCERTAIN", "QUERY LATER",
        "SOURCE CODE REVEALS YES", "LOGIC ERROR: NO", "UNLIKELY",
        "CONCENTRATE ON SOUL", "THE PATH IS CLEAR"
    ];
    
    setTimeout(() => {
        response.innerText = answers[Math.floor(Math.random() * answers.length)];
        response.style.opacity = '1';
    }, 500);
}

// --- NEW FUN FEATURES ---
let zenInterval = null;
let breathingState = {
    active: false,
    interval: null,
    phase: 0, // 0: Inhale, 1: Hold, 2: Exhale, 3: Hold
    sessionSeconds: 0,
    soundEnabled: false,
    audioCtx: null,
    oscillator: null
};

function toggleBreathingSound() {
    breathingState.soundEnabled = !breathingState.soundEnabled;
    const btn = document.getElementById('breathSoundBtn');
    btn.innerHTML = breathingState.soundEnabled ? '<i class="fas fa-volume-up text-teal-400"></i>' : '<i class="fas fa-volume-mute"></i>';
    if (!breathingState.soundEnabled && breathingState.audioCtx) {
        breathingState.audioCtx.suspend();
    } else if (breathingState.soundEnabled && breathingState.audioCtx) {
        breathingState.audioCtx.resume();
    }
}

function playBreathingPulse(frequency, duration) {
    if (!breathingState.soundEnabled) return;
    try {
        if (!breathingState.audioCtx) breathingState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (breathingState.audioCtx.state === 'suspended') breathingState.audioCtx.resume();

        const osc = breathingState.audioCtx.createOscillator();
        const gain = breathingState.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, breathingState.audioCtx.currentTime);
        
        gain.gain.setValueAtTime(0, breathingState.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, breathingState.audioCtx.currentTime + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.0001, breathingState.audioCtx.currentTime + duration);

        osc.connect(gain);
        gain.connect(breathingState.audioCtx.destination);

        osc.start();
        osc.stop(breathingState.audioCtx.currentTime + duration);
    } catch (e) { console.warn("Audio Error:", e); }
}

async function toggleBreathingSession() {
    const circle = document.getElementById('breathAssistCircle');
    const text = document.getElementById('breathAssistText');
    const bar = document.getElementById('breathPhaseBar');
    const btn = document.getElementById('breathStartBtn');
    const syncTimer = document.getElementById('syncFocusTimer')?.checked;

    if (breathingState.active) {
        // End Session
        clearInterval(breathingState.interval);
        breathingState.active = false;
        breathingState.phase = 0;
        
        if (syncTimer) pauseFocusAction();

        // Save practice time and automate journal
        if (breathingState.sessionSeconds > 5) {
            const minutes = Math.round(breathingState.sessionSeconds / 60 * 10) / 10;
            const logMsg = `Completed ${minutes}m of Box Breathing meditation.`;
            
            const journalInput = document.getElementById('journalInput');
            if (journalInput) {
                journalInput.value = (journalInput.value ? journalInput.value + '\n' : '') + logMsg;
            }

            if (currentUser) {
                await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        type: 'breathing_practice', 
                        duration: breathingState.sessionSeconds, 
                        minutes: minutes,
                        timestamp: Date.now() 
                    })
                });
                syncFocusData();
            }
            showToast(logMsg, "info");
        }

        circle.style.transform = 'scale(1)';
        circle.style.borderColor = 'rgba(20, 184, 166, 0.2)';
        text.innerText = 'Ready';
        bar.style.width = '0%';
        btn.innerText = 'Start Box Breathing';
        btn.classList.replace('bg-red-600', 'bg-teal-600');
        return;
    }

    // Start Session
    breathingState.active = true;
    breathingState.sessionSeconds = 0;
    btn.innerText = 'End Session';
    btn.classList.replace('bg-teal-600', 'bg-red-600');

    if (syncTimer) {
        toggleFocusMode('stopwatch');
        startFocusAction();
    }

    const phases = [
        { text: 'Inhale', scale: 1.5, color: '#14b8a6', freq: 440 },
        { text: 'Hold', scale: 1.5, color: '#0d9488', freq: 554 },
        { text: 'Exhale', scale: 1, color: '#0f766e', freq: 330 },
        { text: 'Hold', scale: 1, color: '#134e4a', freq: 220 }
    ];

    const runPhase = () => {
        const p = phases[breathingState.phase];
        text.innerText = p.text;
        circle.style.transform = `scale(${p.scale})`;
        circle.style.borderColor = p.color;
        
        // Handle Progress Bar
        bar.style.transitionDuration = '0s';
        bar.style.width = '0%';
        setTimeout(() => {
            bar.style.transitionDuration = '4000ms';
            bar.style.width = '100%';
        }, 50);

        // Play sound pulse at start of each phase
        playBreathingPulse(p.freq, 1.5);
        
        breathingState.sessionSeconds += 4;
        breathingState.phase = (breathingState.phase + 1) % 4;
    };

    runPhase();
    breathingState.interval = setInterval(runPhase, 4000);
}

function toggleZenBreath(btn) {
    // Legacy fun page version, updated to use sound if enabled
    const circle = document.getElementById('breathCircle');
    const text = document.getElementById('breathText');
    
    if (zenInterval) {
        clearInterval(zenInterval);
        zenInterval = null;
        circle.style.transform = 'scale(1)';
        text.innerText = 'INHALE';
        btn.innerText = 'START SESSION';
        btn.classList.replace('bg-red-600', 'bg-teal-600');
        return;
    }

    btn.innerText = 'END SESSION';
    btn.classList.replace('bg-teal-600', 'bg-red-600');
    
    let stage = 0;
    const animate = () => {
        if (stage === 0) { // Inhale
            circle.style.transform = 'scale(1.5)';
            text.innerText = 'INHALE';
            if (breathingState.soundEnabled) playBreathingPulse(440, 1);
            stage = 1;
        } else { // Exhale
            circle.style.transform = 'scale(1)';
            text.innerText = 'EXHALE';
            if (breathingState.soundEnabled) playBreathingPulse(330, 1);
            stage = 0;
        }
    };
    
    animate();
    zenInterval = setInterval(animate, 4000);
}

let reactionTimer = null;
let reactionStart = 0;
function startReactionTest() {
    const area = document.getElementById('reactionArea');
    const pulse = document.getElementById('reactionPulse');
    const text = document.getElementById('reactionText');
    const result = document.getElementById('reactionResult');
    const btn = document.getElementById('reactionBtn');

    btn.disabled = true;
    btn.classList.add('opacity-50');
    result.classList.add('hidden');
    pulse.style.backgroundColor = 'transparent';
    text.innerText = 'WAIT FOR SIGNAL...';
    text.className = "relative z-10 text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]";
    
    const delay = Math.random() * 4000 + 1500;
    
    reactionTimer = setTimeout(() => {
        pulse.style.backgroundColor = '#10b981';
        text.innerText = 'STRIKE!';
        text.classList.add('text-white');
        reactionStart = Date.now();
        
        area.onclick = () => {
            const diff = Date.now() - reactionStart;
            let rank = "Human";
            if (diff < 150) rank = "AI Core";
            else if (diff < 220) rank = "Ninja";
            else if (diff > 400) rank = "Sloth";

            text.innerText = `RANK: ${rank}`;
            result.innerText = `${diff}ms`;
            result.classList.remove('hidden');
            pulse.style.backgroundColor = 'transparent';
            area.onclick = null;
            btn.disabled = false;
            btn.classList.remove('opacity-50');
            
            if (currentUser) {
                fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'reaction', score: diff, rank: rank })
                });
            }
        };
    }, delay);

    area.onclick = () => {
        clearTimeout(reactionTimer);
        text.innerText = 'FALSE START';
        text.classList.add('text-red-500');
        pulse.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
        area.onclick = null;
        btn.disabled = false;
        btn.classList.remove('opacity-50');
    };
}


// --- sOuLFOCUS LOGIC ---
let focusInterval = null;
let focusMode = 'timer'; // timer or stopwatch
let focusTimeRemaining = 25 * 60; // seconds
let focusStopwatchTime = 0; // seconds
let focusChime = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

function initFocusPage() {
    document.getElementById('journalDate').innerText = new Date().toDateString().toUpperCase();
    updateFocusDisplay();
}

function toggleFocusMode(mode) {
    focusMode = mode;
    resetFocusAction();
    const btnT = document.getElementById('btnFocusTimer');
    const btnS = document.getElementById('btnFocusStopwatch');
    const dispT = document.getElementById('focusTimerDisplay');
    const dispS = document.getElementById('focusStopwatchDisplay');
    const config = document.getElementById('timerConfig');

    if (mode === 'timer') {
        btnT.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-red-600 text-white";
        btnS.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase text-gray-400";
        dispT.classList.remove('hidden');
        dispS.classList.add('hidden');
        config.classList.remove('hidden');
    } else {
        btnS.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-red-600 text-white";
        btnT.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase text-gray-400";
        dispS.classList.remove('hidden');
        dispT.classList.add('hidden');
        config.classList.add('hidden');
    }
}

function updateTimerDuration(mins) {
    focusTimeRemaining = mins * 60;
    updateFocusDisplay();
}

function updateFocusDisplay() {
    const format = (s) => {
        const hrs = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        const secs = s % 60;
        if (hrs > 0) return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    if (focusMode === 'timer') {
        document.getElementById('focusTimerDisplay').innerText = format(focusTimeRemaining);
    } else {
        document.getElementById('focusStopwatchDisplay').innerText = format(focusStopwatchTime);
    }
}

function startFocusAction() {
    if (focusInterval) return;
    
    document.getElementById('focusStartBtn').classList.add('hidden');
    document.getElementById('focusPauseBtn').classList.remove('hidden');

    focusInterval = setInterval(async () => {
        if (focusMode === 'timer') {
            if (focusTimeRemaining <= 0) {
                clearInterval(focusInterval);
                focusInterval = null;
                focusChime.play();
                
                const mins = document.getElementById('focusTimerRange').value;
                const logMsg = `Completed ${mins}m focus session.`;
                const journalInput = document.getElementById('journalInput');
                if (journalInput) journalInput.value = (journalInput.value ? journalInput.value + '\n' : '') + logMsg;
                
                if (currentUser) {
                    await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            type: 'focus_session', 
                            duration: mins * 60, 
                            minutes: parseInt(mins), 
                            timestamp: Date.now() 
                        })
                    });
                    syncFocusData();
                }

                showToast("Focus session complete!", "success");
                resetFocusAction();
                return;
            }
            focusTimeRemaining--;
        } else {
            focusStopwatchTime++;
        }
        updateFocusDisplay();
    }, 1000);
}

function pauseFocusAction() {
    clearInterval(focusInterval);
    focusInterval = null;
    document.getElementById('focusStartBtn').classList.remove('hidden');
    document.getElementById('focusPauseBtn').classList.add('hidden');
}

function resetFocusAction() {
    pauseFocusAction();
    if (focusMode === 'timer') {
        const mins = document.getElementById('focusTimerRange').value;
        focusTimeRemaining = mins * 60;
    } else {
        focusStopwatchTime = 0;
    }
    updateFocusDisplay();
}

async function saveJournalEntry() {
    const input = document.getElementById('journalInput');
    const content = input.value.trim();
    if (!content) return;
    if (!currentUser) return alert("Login to save journal entries.");

    setLoading(true, "Journaling...");
    try {
        const entry = {
            id: Date.now(),
            content,
            date: new Date().toISOString()
        };
        await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'journal', ...entry })
        });
        input.value = '';
        showToast("Soul Logged.", "success");
        await syncFocusData();
    } finally {
        setLoading(false);
    }
}

function updateMetric(type, delta) {
    const el = document.getElementById(`metric${type.charAt(0).toUpperCase() + type.slice(1)}`);
    let val = parseInt(el.innerText) + delta;
    if (val < 0) val = 0;
    el.innerText = val;
    
    if (currentUser) {
        fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: `metric_${type}`, value: val })
        });
    }
}

async function getSpiritualAdvice() {
    if (!currentUser) return showToast("Login to access the Soul Oracle.", "warning");
    
    const adviceEl = document.getElementById('soulAdviceContent');
    adviceEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Querying the Oracle...';
    
    try {
        const res = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
        const stats = await res.json();
        const journals = stats.filter(d => d.type === 'journal').slice(0, 5).map(j => j.content).join('\n');
        const health = document.getElementById('metricHealth').innerText;
        const wealth = document.getElementById('metricWealth').innerText;

        const prompt = `Based on these recent soul journals: "${journals}" and my metrics (Health: ${health}, Wealth: ${wealth}), give me one sentence of deep spiritual wisdom and one specific actionable advice for my day. Be concise.`;
        
        const model = aiConfig.unifiedModel || "gemini-1.5-flash";
        const key = aiConfig.keys[currentKeyIndex];
        
        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const data = await aiRes.json();
        const advice = data.candidates?.[0]?.content?.parts?.[0]?.text || "The Oracle is silent. Try again later.";
        adviceEl.innerText = advice;
    } catch (e) {
        adviceEl.innerText = "Connection to the Oracle lost.";
    }
}

let reportSteps = {
    current: 0,
    questions: [],
    answers: []
};

async function startReportQuestionnaire() {
    if (!currentUser) return showToast("Login to generate reports.", "warning");
    
    reportSteps = { current: 0, questions: [], answers: [] };
    document.getElementById('reportModal').classList.remove('hidden');
    document.getElementById('reportQuestContainer').classList.remove('hidden');
    document.getElementById('reportGenerating').classList.add('hidden');
    document.getElementById('reportAnswer').value = '';
    
    const questionEl = document.getElementById('reportQuestion');
    questionEl.innerText = "Generating reflection path...";

    try {
        const prompt = "Act as a spiritual guide. Generate 3 deep, philosophical questions for a self-actualization report. Return them as a simple numbered list. Do not include any other text.";
        const model = document.getElementById('focusModelSelect').value; // Get model from focus dropdown
        const key = aiConfig.keys[currentKeyIndex];
        
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        reportSteps.questions = text.split('\n').filter(q => q.trim()).map(q => q.replace(/^\d+\.\s+/, ''));
        
        if (reportSteps.questions.length < 3) throw new Error("Oracle failed to speak.");
        
        renderReportQuestion();
    } catch (e) {
        questionEl.innerText = "The path is blocked. Check your connection.";
    }
}

function renderReportQuestion() {
    const q = reportSteps.questions[reportSteps.current];
    document.getElementById('reportQuestion').innerText = q;
    document.getElementById('reportProgress').innerText = `Reflection ${reportSteps.current + 1} / ${reportSteps.questions.length}`;
    document.getElementById('reportAnswer').value = '';
    document.getElementById('reportNextBtn').innerText = reportSteps.current === reportSteps.questions.length - 1 ? "FINALIZE REPORT" : "NEXT REFLECTION";
}

async function nextReportQuestion() {
    const ans = document.getElementById('reportAnswer').value.trim();
    if (!ans) return showToast("Please share your reflection.", "warning");
    
    reportSteps.answers.push({
        question: reportSteps.questions[reportSteps.current],
        answer: ans
    });

    if (reportSteps.current < reportSteps.questions.length - 1) {
        reportSteps.current++;
        renderReportQuestion();
    } else {
        await finishReport();
    }
}

async function finishReport() {
    document.getElementById('reportQuestContainer').classList.add('hidden');
    document.getElementById('reportGenerating').classList.remove('hidden');

    try {
        // AI Analysis Generation
        const model = document.getElementById('focusModelSelect')?.value || aiConfig.models[0]?.id || "gemini-1.5-flash";
        const key = aiConfig.keys[currentKeyIndex];
        const analysisPrompt = `Act as a high-level psychological and spiritual analyst. 
        Based on the following reflections and metrics, provide a deep, insightful, and constructive analysis of the user's current state of soul and productivity. 
        METRICS: Health=${document.getElementById('metricHealth').innerText}, Wealth=${document.getElementById('metricWealth').innerText}
        REFLECTIONS:
        ${reportSteps.answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}
        
        Provide the analysis in structured Markdown with sections for "Core Strengths", "Mental Blocks", and "Path Forward".`;

        const analysisRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: analysisPrompt }] }] })
        });
        const analysisData = await analysisRes.json();
        const aiAnalysis = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || "The Oracle remains silent on this path.";

        // Save answers to persistence
        await fetch(`/api/main?route=user_reports&userId=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                timestamp: Date.now(),
                qna: reportSteps.answers,
                analysis: aiAnalysis,
                metrics: {
                    health: document.getElementById('metricHealth').innerText,
                    wealth: document.getElementById('metricWealth').innerText
                }
            })
        });

        // Trigger Export PDF
        const resStats = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
        const stats = await resStats.json();
        const journals = stats.filter(d => d.type === 'journal').slice(0, 10);
        
        const reportData = {
            id: Date.now(),
            name: `${currentUser.name}'s Soul Report`,
            journals: journals,
            qna: reportSteps.answers,
            analysis: aiAnalysis,
            metrics: {
                health: document.getElementById('metricHealth').innerText,
                wealth: document.getElementById('metricWealth').innerText
            },
            advice: document.getElementById('soulAdviceContent').innerText
        };

        await exportData('report', reportData.id, 'pdf', reportData);
        showToast("Soul Report Transferred Successfully.", "success");
        closeReportModal();
    } catch (e) {
        showToast("Report construction failed.", "error");
        console.error(e);
    }
}

function closeReportModal() {
    document.getElementById('reportModal').classList.add('hidden');
}

async function syncFocusData() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=fun_stats&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            // Update Breathing Total
            const breathingLogs = data.filter(d => d.type === 'breathing_practice');
            const totalSeconds = breathingLogs.reduce((acc, curr) => acc + (curr.duration || 0), 0);
            const totalMinutes = Math.floor(totalSeconds / 60);
            const displayTime = totalMinutes > 60 ? `${(totalMinutes/60).toFixed(1)}h` : `${totalMinutes}m`;
            const breathStatEl = document.getElementById('breathTotalTime');
            if (breathStatEl) breathStatEl.innerText = `Practice: ${displayTime}`;

            const journals = data.filter(d => d.type === 'journal').sort((a,b) => b.id - a.id);
            const hist = document.getElementById('journalHistory');
            if (journals.length > 0) {
                hist.innerHTML = journals.map(j => `
                    <div class="p-2 bg-white/5 rounded-lg border border-white/5">
                        <p class="text-[10px] font-bold text-purple-400 mb-1">${new Date(j.id).toLocaleDateString()}</p>
                        <p class="text-[10px] text-gray-300 italic truncate">${j.content}</p>
                    </div>
                `).join('');
            } else {
                hist.innerHTML = '<p class="text-[10px] text-gray-500 italic">No entries yet.</p>';
            }

            const latestHealth = data.filter(d => d.type === 'metric_health').sort((a,b) => b.timestamp - a.timestamp)[0];
            const latestWealth = data.filter(d => d.type === 'metric_wealth').sort((a,b) => b.timestamp - a.timestamp)[0];
            
            if (latestHealth) document.getElementById('metricHealth').innerText = latestHealth.value;
            if (latestWealth) document.getElementById('metricWealth').innerText = latestWealth.value;
        }
        getSpiritualAdvice(); // Auto-load advice on sync
    } catch (e) { console.warn("Focus sync failed", e); }
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
        showBetterError(e.message);
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
let contactFiles = [];

function handleContactFiles(input) {
    const files = Array.from(input.files);
    files.forEach(file => {
        // Size Check: Vercel serverless has a body limit. Let's suggest staying under 4MB total.
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result.split(',')[1];
            contactFiles.push({
                name: file.name,
                type: file.type,
                content: base64
            });
            renderContactFilePreview();
        };
        reader.readAsDataURL(file);
    });
    input.value = '';
}

function removeContactFile(idx) {
    contactFiles.splice(idx, 1);
    renderContactFilePreview();
}

function renderContactFilePreview() {
    const container = document.getElementById('contactFilePreview');
    const countEl = document.getElementById('contactFileCount');
    container.innerHTML = '';
    
    if (contactFiles.length === 0) {
        countEl.innerText = "No files selected";
        return;
    }

    countEl.innerText = `${contactFiles.length} file${contactFiles.length > 1 ? 's' : ''} prepared`;

    contactFiles.forEach((file, idx) => {
        const chip = document.createElement('div');
        chip.className = "bg-white/5 border border-white/10 px-2 py-1 rounded-lg flex items-center gap-2 text-[10px] text-gray-300 animate-fadeIn";
        chip.innerHTML = `
            <i class="fas fa-file-alt text-cyan-400"></i>
            <span class="truncate max-w-[80px]">${file.name}</span>
            <button type="button" onclick="removeContactFile(${idx})" class="hover:text-red-500 transition"><i class="fas fa-times"></i></button>
        `;
        container.appendChild(chip);
    });
}

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
            body: JSON.stringify({ 
                name, 
                email, 
                message, 
                attachments: contactFiles,
                timestamp: Date.now() 
            })
        });

        if (res.ok) {
            status.innerText = "Message sent successfully! We'll get back to you soon.";
            status.className = "mt-4 text-center text-xs text-green-400 block";
            document.getElementById('contactForm').reset();
            contactFiles = [];
            renderContactFilePreview();
        } else {
            const errData = await res.json();
            throw new Error(errData.error || "Failed to send message");
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
    // Re-render components that rely on theme-conditional classes
    if (document.getElementById('notes').classList.contains('active')) renderNotes();
}

async function saveAdminConfig() {
    const keys = document.getElementById('apiKeys').value.split(',').map(k => k.trim());
    const models = JSON.parse(document.getElementById('modelList').value);
    const adminEmail = currentUser ? currentUser.email : '';
    
    setLoading(true, "Applying Admin Settings");
    try {
        const res = await fetch(`/api/main?route=admin_config&adminEmail=${encodeURIComponent(adminEmail)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'ai_settings', keys, models }) // Removed unifiedModel
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
        list.innerHTML = '<p class="text-xs text-gray-500 text-center py-10 italic">No members found in the sOuLViSiON family core.</p>';
        return;
    }
    list.innerHTML = users.map(user => {
        let joinedDate = "Legacy Member";
        if (user.joinedAt) {
            joinedDate = new Date(user.joinedAt).toLocaleDateString();
        } else if (user._id && typeof user._id === 'string' && user._id.length === 24) {
            joinedDate = new Date(parseInt(user._id.substring(0, 8), 16) * 1000).toLocaleDateString();
        }

        const isSelf = user.email === currentUser.email;

        return `
            <div class="bg-white/5 p-3 md:p-4 rounded-xl flex justify-between items-center border border-white/5 group hover:bg-white/10 hover:border-red-500/20 transition-all duration-300">
                <div class="overflow-hidden flex items-center gap-3 md:gap-4">
                    <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center text-red-500 font-black text-sm shrink-0 border border-white/5 shadow-inner">
                        ${user.name.charAt(0).toUpperCase()}
                    </div>
                    <div class="overflow-hidden">
                        <p class="text-[13px] font-black text-white truncate flex items-center gap-2">
                            ${user.name}
                            ${isSelf ? '<span class="text-[8px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/20">YOU</span>' : ''}
                        </p>
                        <p class="text-[10px] text-gray-500 truncate font-mono">${user.email}</p>
                        <div class="flex flex-wrap items-center gap-2 mt-1.5">
                            <span class="text-[8px] text-gray-600 font-black uppercase tracking-tighter">EST: ${joinedDate}</span>
                            ${user.isAdmin ? '<span class="text-[7px] font-black bg-red-600/10 text-red-500 px-1.5 py-0.5 rounded border border-red-500/20 uppercase">Core Admin</span>' : ''}
                            ${user.authSource === 'google' ? '<i class="fab fa-google text-[9px] text-gray-500" title="Google Auth"></i>' : ''}
                        </div>
                    </div>
                </div>
                <div class="flex items-center">
                    ${!isSelf ? `
                        <button onclick="adminDeleteUser('${user.email}')" 
                                class="w-10 h-10 flex items-center justify-center rounded-xl bg-red-600/5 text-gray-600 hover:bg-red-600 hover:text-white hover:scale-110 active:scale-95 transition-all duration-300 border border-transparent hover:border-red-500 group/term" 
                                title="Terminate Member Access">
                            <i class="fas fa-user-xmark text-sm group-hover/term:animate-pulse"></i>
                        </button>
                    ` : `
                        <div class="w-10 h-10 flex items-center justify-center text-gray-700 opacity-20">
                            <i class="fas fa-shield-halved text-sm"></i>
                        </div>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

function filterAdminUsers(query) {
    const q = query.toLowerCase();
    const filtered = adminUsersCache.filter(u => 
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
    renderAdminUsers(filtered);
}

let visitorMap = null;
let heatmapLayer = null;

async function loadVisitorMap() {
    if (!currentUser || !currentUser.isAdmin) return;
    
    const mapEl = document.getElementById('visitorMap');
    if (!mapEl) return;

    if (!visitorMap) {
        visitorMap = L.map('visitorMap', {
            zoomControl: false,
            attributionControl: false
        }).setView([20, 0], 2);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(visitorMap);
    }

    // Fix for hidden containers in SPAs
    setTimeout(() => {
        if (visitorMap) visitorMap.invalidateSize();
    }, 400);

    try {
        const res = await fetch(`/api/main?route=users&adminEmail=${encodeURIComponent(currentUser.email)}`);
        const users = await res.json();
        
        // 1. Clear existing layers
        visitorMap.eachLayer((layer) => {
            if (layer instanceof L.CircleMarker || layer === heatmapLayer) {
                visitorMap.removeLayer(layer);
            }
        });

        const heatData = [];
        const markers = [];
        
        users.forEach(user => {
            const lat = parseFloat(user.lastGeo?.lat);
            const lon = parseFloat(user.lastGeo?.lon);

            if (!isNaN(lat) && !isNaN(lon)) {
                // Add to Heatmap data
                heatData.push([lat, lon, 1]); 

                // Add Marker
                const marker = L.circleMarker([lat, lon], {
                    radius: 6,
                    fillColor: "#06b6d4",
                    color: "#fff",
                    weight: 1.5,
                    opacity: 1,
                    fillOpacity: 0.8,
                    className: 'visitor-marker-pulse'
                }).addTo(visitorMap);

                const time = user.joinedAt ? new Date(user.joinedAt).toLocaleDateString() : 'Legacy';
                marker.bindPopup(`
                    <div class="p-1 min-w-[140px]">
                        <p class="text-[10px] font-black text-cyan-400 uppercase tracking-widest mb-1">Core Member</p>
                        <p class="text-sm font-bold text-white mb-1">${user.name}</p>
                        <p class="text-[9px] text-gray-400 uppercase">${user.lastGeo.city || 'Unknown'}, ${user.lastGeo.country || ''}</p>
                        <p class="text-[8px] text-gray-500 mt-2">Established: ${time}</p>
                    </div>
                `, { className: 'soul-map-popup' });
                
                markers.push(marker.getLatLng());
            }
        });

        // 2. Add Heatmap Layer for density visualization
        if (heatData.length > 0 && typeof L.heatLayer === 'function') {
            heatmapLayer = L.heatLayer(heatData, {
                radius: 25,
                blur: 15,
                maxZoom: 10,
                gradient: { 0.4: 'blue', 0.65: 'cyan', 1: 'lime' }
            }).addTo(visitorMap);
        }

        // 3. Render Rank Statistics
        renderVisitorStats(users);

        // 4. Auto-zoom to audience
        if (markers.length > 1) {
            visitorMap.fitBounds(L.latLngBounds(markers), { padding: [40, 40] });
        }
    } catch (e) {
        console.error("Map Load Error:", e);
    }
}

function renderVisitorStats(users) {
    const statsList = document.getElementById('visitorStatsList');
    if (!statsList) return;

    const countryMap = {};
    users.forEach(u => {
        const country = u.lastGeo?.country || 'Unknown';
        countryMap[country] = (countryMap[country] || 0) + 1;
    });

    const sorted = Object.entries(countryMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

    if (sorted.length === 0) {
        statsList.innerHTML = '<p class="text-[10px] text-gray-600 italic">No region data detected.</p>';
        return;
    }

    const total = users.length;
    statsList.innerHTML = sorted.map(([country, count]) => {
        const percent = Math.round((count / total) * 100);
        return `
            <div class="group">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-[11px] font-bold text-gray-300 uppercase">${country}</span>
                    <span class="text-[10px] font-black text-cyan-400">${count} (${percent}%)</span>
                </div>
                <div class="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                    <div class="h-full bg-cyan-600 transition-all duration-1000" style="width: ${percent}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

async function sendAnnouncement() {
    const input = document.getElementById('announcementInput');
    const duration = document.getElementById('announcementDuration').value;
    const text = input.value.trim();
    if (!text) return;

    setLoading(true, "Broadcasting Announcement");
    try {
        const res = await fetch(`/api/main?route=announcement&adminEmail=${encodeURIComponent(currentUser.email)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                text, 
                duration: parseInt(duration),
                timestamp: Date.now()
            })
        });
        if (res.ok) {
            showToast("Broadcast active.", "success");
            input.value = '';
            checkAnnouncement();
        }
    } finally {
        setLoading(false);
    }
}

async function deleteAnnouncement() {
    if (!confirm("Stop this broadcast and remove it for all users?")) return;
    setLoading(true, "Removing Broadcast");
    try {
        await fetch(`/api/main?route=announcement&adminEmail=${encodeURIComponent(currentUser.email)}`, {
            method: 'DELETE'
        });
        showToast("Broadcast terminated.", "warning");
        // Clear inputs
        document.getElementById('announcementInput').value = '';
        checkAnnouncement();
    } finally {
        setLoading(false);
    }
}

function editAnnouncement() {
    const activeText = document.getElementById('activeAnnounceText').innerText;
    if (activeText) {
        document.getElementById('announcementInput').value = activeText;
        document.getElementById('announcementInput').focus();
        showToast("Announcement loaded into editor.", "info");
    }
}

async function checkAnnouncement() {
    try {
        const res = await fetch('/api/main?route=announcement');
        const data = await res.json();
        const banner = document.getElementById('announcementBanner');
        const text = document.getElementById('announcementText');
        const adminInfo = document.getElementById('activeAnnouncementInfo');
        const adminText = document.getElementById('activeAnnounceText');

        if (data && data.text) {
            // Update admin UI if visible
            if (adminInfo) {
                adminInfo.classList.remove('hidden');
                adminText.innerText = data.text;
            }
            
            const dismissed = localStorage.getItem('soul_dismissed_announcement');
            if (dismissed === data.timestamp.toString()) {
                banner.classList.add('hidden');
                return;
            }
            text.innerText = data.text;
            banner.classList.remove('hidden');
            banner.dataset.timestamp = data.timestamp;
        } else {
            banner.classList.add('hidden');
            if (adminInfo) adminInfo.classList.add('hidden');
        }
    } catch (e) {
        console.warn("Announcement check failed", e);
    }
}

function dismissAnnouncement() {
    const banner = document.getElementById('announcementBanner');
    if (banner.dataset.timestamp) {
        localStorage.setItem('soul_dismissed_announcement', banner.dataset.timestamp);
    }
    banner.classList.add('hidden');
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
        showBetterError(e.message);
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
        showBetterError(e.message);
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
    document.body.classList.add('cursor-active');

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

// --- WELCOME TOUR LOGIC ---
let currentTourStep = 0;
let activeTourSteps = [];

const desktopTourSteps = [
    {
        selector: 'nav .text-cyan-400.cursor-pointer',
        text: "Hi! I'm sOuL-ie, your guide. Welcome to sOuLViSiON - your new digital sanctuary!",
        pos: { top: '20%', left: '50%' }
    },
    {
        selector: 'nav div.hidden.md\\:flex button[onclick*="notes"]',
        text: "In sOuLNOTES, you can write markdown notes and lock them with secret codes.",
        pos: { top: '40%', left: '30%' }
    },
    {
        selector: 'nav div.hidden.md\\:flex button[onclick*="ai"]',
        text: "Meet sOuLAI. Powerful models ready to assist your creative process.",
        pos: { top: '40%', left: '50%' }
    },
    {
        selector: 'nav div.hidden.md\\:flex button[onclick*="play"]',
        text: "Relax with sOuLPLAY. Stream from YouTube or play local files with vinyl vibes.",
        pos: { top: '40%', left: '70%' }
    },
    {
        selector: '#userProfile',
        text: "Keep track of your stats and system health here in the Dashboard.",
        pos: { top: '15%', left: '80%' }
    },
    {
        selector: 'nav div.hidden.md\\:flex button[onclick*="support"]',
        text: "Love sOuLViSiON? Support our journey to stay free and private for everyone!",
        pos: { top: '80%', left: '50%' }
    }
];

const mobileTourSteps = [
    {
        selector: 'nav h1',
        text: "Welcome to sOuLViSiON Mobile! I'm sOuL-ie, let me show you around.",
        pos: { top: '20%', left: '50%' }
    },
    {
        selector: 'button[onclick="toggleSidebar()"]',
        text: "Tap the Menu to access all your tools like Notes, AI, and Music.",
        pos: { top: '10%', left: '10%' }
    },
    {
        selector: '#aiWidget',
        text: "This bubble is your AI assistant. Tap it for quick help on any page!",
        pos: { top: '85%', left: '85%' }
    },
    {
        selector: '#userProfile',
        text: "Check your system health and manage your profile here.",
        pos: { top: '10%', left: '85%' }
    }
];

function startWelcomeTour() {
    // Force wait if loader is currently active
    const loader = document.getElementById('globalLoader');
    if (loader && !loader.classList.contains('hidden')) {
        setTimeout(startWelcomeTour, 1000);
        return;
    }

    if (localStorage.getItem('soul_tour_done')) return;
    
    // Detect device for tour content
    activeTourSteps = window.innerWidth < 768 ? mobileTourSteps : desktopTourSteps;
    
    currentTourStep = 0;
    const overlay = document.getElementById('tourOverlay');
    overlay.classList.remove('hidden');
    overlay.classList.add('flex'); 
    
    setTimeout(() => {
        document.getElementById('tourBackdrop').classList.add('opacity-100');
    }, 50);

    renderTourStep();
}

function renderTourStep() {
    const step = activeTourSteps[currentTourStep];
    const ghost = document.getElementById('ghostGuide');
    const text = document.getElementById('tourText');
    const tooltip = document.getElementById('tourTooltip');
    const prevHighlight = document.querySelector('.tour-highlight');
    if (prevHighlight) prevHighlight.classList.remove('tour-highlight');

    const target = document.querySelector(step.selector);
    let ghostCenterX;

    if (target && target.offsetParent !== null) { // Ensure target exists and is visible
        target.classList.add('tour-highlight');
        const rect = target.getBoundingClientRect();
        
        // Calculate safe top position (prevent off-screen)
        let topPos = rect.top - 180;
        if (topPos < 20) topPos = rect.bottom + 20; 
        
        ghostCenterX = rect.left + rect.width / 2;
        ghost.style.top = `${topPos}px`;
        ghost.style.left = `${ghostCenterX}px`;
        ghost.style.transform = 'translateX(-50%)';
    } else {
        ghost.style.top = step.pos.top;
        ghost.style.left = step.pos.left;
        ghost.style.transform = 'translate(-50%, -50%)';
        
        // Estimate center X for percentage based positions
        const percent = parseFloat(step.pos.left) || 50;
        ghostCenterX = (percent / 100) * window.innerWidth;
    }

    // Smart Horizontal Positioning for Tooltip
    // Reset classes/styles to prevent conflicts
    tooltip.classList.remove('left-1/2', '-translate-x-1/2', 'left-0', 'right-0');
    tooltip.style.left = '';
    tooltip.style.right = '';
    tooltip.style.transform = '';

    const tooltipWidth = 256; // Matching w-64 in Tailwind
    const margin = 20;

    if (ghostCenterX - (tooltipWidth / 2) < margin) {
        // Too close to left edge
        tooltip.classList.add('left-0');
        tooltip.style.transform = 'translateX(0)';
    } else if (ghostCenterX + (tooltipWidth / 2) > window.innerWidth - margin) {
        // Too close to right edge
        tooltip.classList.add('right-0');
        tooltip.style.left = 'auto';
        tooltip.style.transform = 'translateX(0)';
    } else {
        // Centered
        tooltip.classList.add('left-1/2', '-translate-x-1/2');
    }

    text.innerText = step.text;
}

function nextTourStep() {
    currentTourStep++;
    if (currentTourStep >= activeTourSteps.length) {
        finishTour();
    } else {
        renderTourStep();
    }
}

function skipTour() {
    finishTour();
}

function finishTour() {
    const overlay = document.getElementById('tourOverlay');
    const backdrop = document.getElementById('tourBackdrop');
    const highlight = document.querySelector('.tour-highlight');
    
    if (highlight) highlight.classList.remove('tour-highlight');
    backdrop.classList.remove('opacity-100');
    localStorage.setItem('soul_tour_done', 'true');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
        showToast("Enjoy your journey, Soul Seeker!", "info");
    }, 500);
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

function showAICooldownOverlay() {
    const overlay = document.getElementById('aiCooldownOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    }
}

function hideAICooldownOverlay() {
    const overlay = document.getElementById('aiCooldownOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function retryAICooldown() {
    // Attempt to clear cooldown state and close overlay
    isAICooldownActive = false;
    consecutiveApiFailures = 0;
    if (aiCooldownTimer) clearTimeout(aiCooldownTimer);
    hideAICooldownOverlay();
    showToast("Attempting to reconnect AI...", "info");
}

function goToSupportPage() {
    hideAICooldownOverlay();
    showPage('support');
}

// --- PROMPT ARCHITECT LOGIC ---
function togglePromptArchitect() {
    const modal = document.getElementById('promptArchitectModal');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        document.getElementById('archPersona').focus();
    } else {
        modal.classList.add('hidden');
    }
}

function applyArchitectPrompt() {
    const persona = document.getElementById('archPersona').value.trim() || "Expert Assistant";
    const objective = document.getElementById('archObjective').value.trim();
    const tone = document.getElementById('archTone').value.trim() || "Professional";
    const format = document.getElementById('archFormat').value.trim() || "Markdown";
    const exclusions = document.getElementById('archExclusions').value.trim() || "None";

    if (!objective) return alert("Please specify an objective for the Architect.");

    const masterPrompt = `Act as a ${persona}. Your goal is to execute the following task with a perfect balance of radical creativity and rigorous logical precision.

### 1. THE OBJECTIVE
${objective}

### 2. OPERATIONAL FRAMEWORK
To ensure the highest quality output, follow these cognitive protocols:
* **First-Principles Thinking:** Strip the problem down to its fundamental truths and build up from there. Do not rely on clichés or standard templates.
* **Lateral Thinking:** Explore non-obvious connections and innovative approaches that differentiate this from average results.
* **High-Resolution Detail:** Provide depth, nuance, and specific examples. Avoid vague abstractions.
* **Structural Integrity:** Ensure the output is logically sound, internally consistent, and ready for immediate implementation.

### 3. CONSTRAINTS & STYLE
* **Tone:** ${tone}
* **Format:** ${format}
* **Exclusions:** ${exclusions}

### 4. EXECUTION STEP-BY-STEP
Before providing the final answer, perform these internal steps:
1. **Drafting:** Silently brainstorm three different approaches to this task.
2. **Critique:** Evaluate those approaches for logic gaps or lack of originality.
3. **Synthesis:** Combine the best elements into a final, superior execution.

**Now, proceed with the task. Surprise me with your depth and intelligence.**`;

    const input = document.getElementById('chatInput');
    input.value = masterPrompt;
    autoResize(input);
    togglePromptArchitect();
    showToast("Master Blueprint forged and loaded.", "success");
    
    // Smooth scroll to input if needed
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    sttFinalTranscript = input.value;
    input.focus();
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        btn.innerHTML = `<i class="fas fa-stop-circle text-red-500 animate-pulse"></i>`;
        recognition.active = true;
        showToast("Listening to your soul...", "info");
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let currentFinal = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                currentFinal += transcript;
            } else {
                interimTranscript += transcript;
            }
        }
        
        if (currentFinal) {
            sttFinalTranscript = (sttFinalTranscript.trim() + " " + currentFinal.trim()).trim();
        }

        input.value = (sttFinalTranscript + " " + interimTranscript).trim();
        updateEditorStats(input);
        input.scrollTop = input.scrollHeight;
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
            sttForceStop = true;
            showToast("Microphone access denied.", "error");
        }
        console.warn("STT Note Error:", event.error);
    };

    recognition.onend = () => {
        if (!sttForceStop) {
            try { 
                recognition.start(); 
            } catch(e) {
                setTimeout(() => { if(!sttForceStop) recognition.start(); }, 500);
            }
        } else {
            btn.innerHTML = `<i class="fas fa-microphone"></i>`;
            recognition.active = false;
            showToast("Note taking paused.", "warning");
        }
    };

    recognition.start();
}

// Persistent Background Audio Handler
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if ('mediaSession' in navigator && isMusicPlaying) {
            navigator.mediaSession.playbackState = "playing";
        }
    } else {
        if (isMusicPlaying) updateMusicUI();
    }
});

// --- sOuLSOLVE LOGIC ---
const SOLVE_BUTTONS = {
    simple: [
        { label: 'C', cmd: 'clear', class: 'text-red-400' },
        { label: '(', cmd: '(' },
        { label: ')', cmd: ')' },
        { label: 'DEL', cmd: 'backspace', class: 'text-orange-400' },
        { label: '7', cmd: '7' }, { label: '8', cmd: '8' }, { label: '9', cmd: '9' },
        { label: '÷', cmd: '/', class: 'text-emerald-400 font-black' },
        { label: '4', cmd: '4' }, { label: '5', cmd: '5' }, { label: '6', cmd: '6' },
        { label: '×', cmd: '*', class: 'text-emerald-400 font-black' },
        { label: '1', cmd: '1' }, { label: '2', cmd: '2' }, { label: '3', cmd: '3' },
        { label: '-', cmd: '-', class: 'text-emerald-400 font-black' },
        { label: '0', cmd: '0' }, { label: '.', cmd: '.' }, { label: 'ANS', cmd: 'ans' },
        { label: '+', cmd: '+', class: 'text-emerald-400 font-black' }
    ],
    pro: [
        { label: 'C', cmd: 'clear', class: 'text-red-400' },
        { label: '(', cmd: '(' }, { label: ')', cmd: ')' },
        { label: 'MOD', cmd: '%' },
        { label: 'DEL', cmd: 'backspace', class: 'text-orange-400' },
        
        { label: 'sin', cmd: 'sin(' }, { label: 'cos', cmd: 'cos(' }, { label: 'tan', cmd: 'tan(' }, { label: 'π', cmd: 'pi' }, { label: '÷', cmd: '/', class: 'text-emerald-400' },
        
        { label: 'log', cmd: 'log(' }, { label: 'ln', cmd: 'log(' }, { label: '√', cmd: 'sqrt(' }, { label: '^', cmd: '^' }, { label: '×', cmd: '*', class: 'text-emerald-400' },
        
        { label: '7', cmd: '7' }, { label: '8', cmd: '8' }, { label: '9', cmd: '9' }, { label: '!', cmd: '!' }, { label: '-', cmd: '-', class: 'text-emerald-400' },
        
        { label: '4', cmd: '4' }, { label: '5', cmd: '5' }, { label: '6', cmd: '6' }, { label: 'e', cmd: 'e' }, { label: '+', cmd: '+', class: 'text-emerald-400' },
        
        { label: '1', cmd: '1' }, { label: '2', cmd: '2' }, { label: '3', cmd: '3' }, { label: 'ANS', cmd: 'ans' }, { label: '=', cmd: 'equal', class: 'bg-emerald-600 text-white' },
        
        { label: '0', cmd: '0' }, { label: '00', cmd: '00' }, { label: '.', cmd: '.' }, { label: 'unit', cmd: 'unit(' }, { label: 'matrix', cmd: '[[]]' }
    ]
};

function initSolveInterface() {
    renderSolvePad();
    document.getElementById('solveModeBadge').innerText = solveState.mode === 'pro' ? 'PRO MODE' : 'SIMPLE MODE';
}

function renderSolvePad() {
    const pad = document.getElementById('solvePad');
    const config = SOLVE_BUTTONS[solveState.mode];
    
    pad.innerHTML = config.map(b => {
        let onClick = `handleSolveBtn('${b.cmd}')`;
        if (b.cmd === 'equal') onClick = 'executeSolve()';
        
        return `<button onclick="${onClick}" class="solve-btn ${b.class || ''}">${b.label}</button>`;
    }).join('');
}

function toggleSolveMode() {
    solveState.mode = solveState.mode === 'simple' ? 'pro' : 'simple';
    initSolveInterface();
    showToast(`Switched to ${solveState.mode.toUpperCase()} Interface`, "info");
}

function handleSolveBtn(cmd) {
    const input = document.getElementById('solveInput');
    if (cmd === 'clear') {
        input.value = '';
        solveState.activeExpression = "";
    } else if (cmd === 'backspace') {
        input.value = input.value.slice(0, -1);
    } else if (cmd === 'ans') {
        input.value += solveState.lastAnswer;
    } else if (cmd === '[[]]') {
        input.value += '[[1, 2], [3, 4]]';
    } else {
        input.value += cmd;
    }
    onSolveInput();
    input.focus();
}

function onSolveInput() {
    const raw = document.getElementById('solveInput').value;
    const resultEl = document.getElementById('solveResult');
    const previewEl = document.getElementById('solveLatexPreview');
    const errorEl = document.getElementById('solveError');
    
    if (!raw.trim()) {
        resultEl.innerText = '0';
        previewEl.innerHTML = '';
        errorEl.classList.add('hidden');
        return;
    }

    try {
        // High-speed real-time preview evaluation
        const res = math.evaluate(raw);
        let formatted = res;
        if (typeof res === 'number') formatted = math.format(res, { precision: 10 });
        else if (res && res.isResultSet) formatted = res.entries[0];
        
        resultEl.innerText = formatted;
        resultEl.classList.remove('text-red-400');
        errorEl.classList.add('hidden');
        
        // Try to generate LaTeX preview if not too complex
        try {
            const node = math.parse(raw);
            const latex = node.toTex({parenthesis: 'keep', implicit: 'hide'});
            katex.render(latex, previewEl, { throwOnError: false });
        } catch (e) { previewEl.innerHTML = ''; }

    } catch (e) {
        // Non-intrusive error display for real-time
        errorEl.classList.remove('hidden');
    }
}

async function executeSolve() {
    const input = document.getElementById('solveInput');
    const expr = input.value.trim();
    if (!expr) return;

    try {
        const result = math.evaluate(expr);
        solveState.lastAnswer = result;
        
        const historyItem = {
            id: Date.now(),
            expr,
            res: math.format(result, { precision: 14 }),
            timestamp: Date.now()
        };

        solveState.history.unshift(historyItem);
        renderSolveHistory();
        
        // Clear main input for next one but keep result in big display
        document.getElementById('solveExpression').innerText = expr;
        input.value = '';
        onSolveInput(); // Reset UI
        document.getElementById('solveResult').innerText = historyItem.res;

        if (currentUser) {
            await fetch(`/api/main?route=solve_history&userId=${encodeURIComponent(currentUser.email)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(historyItem)
            });
        }
    } catch (e) {
        showToast("Invalid mathematical syntax.", "error");
    }
}

function renderSolveHistory() {
    const list = document.getElementById('solveHistory');
    if (solveState.history.length === 0) {
        list.innerHTML = '<p class="text-[10px] text-gray-600 italic text-center py-10">No calculations recorded.</p>';
        return;
    }

    list.innerHTML = solveState.history.map(h => `
        <div class="p-2 bg-emerald-900/5 border border-white/5 rounded-lg group hover:border-emerald-500/30 transition cursor-pointer" onclick="resumeSolve('${h.expr.replace(/'/g, "\\'")}')">
            <div class="flex justify-between items-center mb-1">
                <span class="text-[8px] text-gray-500 font-mono">${new Date(h.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                <button onclick="event.stopPropagation(); deleteSolveItem(${h.id})" class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition text-[8px] uppercase">Remove</button>
            </div>
            <p class="text-[10px] font-mono text-gray-400 truncate">${h.expr}</p>
            <p class="text-xs font-black text-emerald-400 truncate mt-0.5">= ${h.res}</p>
            <div class="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <button onclick="event.stopPropagation(); extendSolveWithAI(${h.id})" class="text-[8px] bg-purple-600/20 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20 hover:bg-purple-600 hover:text-white">EXTEND WITH AI</button>
            </div>
        </div>
    `).join('');
}

function resumeSolve(expr) {
    document.getElementById('solveInput').value = expr;
    onSolveInput();
    document.getElementById('solveInput').focus();
}

async function deleteSolveItem(id) {
    solveState.history = solveState.history.filter(h => h.id !== id);
    renderSolveHistory();
    if (currentUser) {
        await fetch(`/api/main?route=solve_history&userId=${encodeURIComponent(currentUser.email)}&id=${id}`, { method: 'DELETE' });
    }
}

async function clearSolveHistory() {
    if (!confirm("Wipe calculation logs?")) return;
    solveState.history = [];
    renderSolveHistory();
    if (currentUser) {
        await fetch(`/api/main?route=solve_history&userId=${encodeURIComponent(currentUser.email)}`, { method: 'DELETE' });
    }
}

async function syncSolveHistory() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/main?route=solve_history&userId=${encodeURIComponent(currentUser.email)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            solveState.history = data;
            renderSolveHistory();
        }
    } catch (e) { console.warn("Solve history sync failed"); }
}

async function extendSolveWithAI(id) {
    const item = solveState.history.find(h => h.id === id);
    if (!item) return;

    const prompt = `Provide a brief but deep mathematical insight or an interesting extension related to this calculation: "${item.expr} = ${item.res}". 
    Explain the underlying logic or provide a related formula/concept in Markdown.`;
    
    document.getElementById('solveAIInput').value = `Explain ${item.expr}`;
    await askSolveAI(prompt);
}

async function askSolveAI(customPrompt = null) {
    if (isAICooldownActive) return showAICooldownOverlay();
    
    const inputEl = document.getElementById('solveAIInput');
    const query = customPrompt || inputEl.value.trim();
    if (!query && pendingFiles.length === 0) return;

    const userMsg = query + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userMsg, 'solveAIChat');
    inputEl.value = '';
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview'), document.getElementById('codeAttachmentPreview'), document.getElementById('solveAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });

    const model = document.getElementById('solveModelSelect').value;
    
    const parts = [{ text: query || " " }];
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    const history = [{ role: 'user', content: userMsg, parts }];

    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];

    await callGeminiAPI(query, 'solveAIChat', history, attachmentsForApi, model);
}

// Keyboard shortcuts for Solver
document.addEventListener('keydown', (e) => {
    if (document.getElementById('solve').classList.contains('active')) {
        const input = document.getElementById('solveInput');
        if (document.activeElement !== input && document.activeElement !== document.getElementById('solveAIInput')) {
            // Auto-focus main input if user starts typing digits or math ops
            if (/^[0-9\+\-\*\/\(\)\.\^]/.test(e.key)) {
                input.focus();
            }
        }
    }
});

// --- sOuLCODE LOGIC ---
const CODE_EXCLUSIONS = ['node_modules', '.git', '.vercel', '.next', 'dist', 'build', '.env', 'package-lock.json', 'yarn.lock', 'venv', '__pycache__', '.vscode'];

async function handleCodeUpload(e) {
    let files = Array.from(e.target.files);
    if (!files.length) return;

    // Optional user-defined exclusions for large projects
    let customExclusions = [];
    if (files.length > 50) {
        const userInput = prompt(`Project contains ${files.length} items. \nStandard exclusions (node_modules, etc.) are active. \nEnter additional comma-separated keywords to exclude (or leave blank):`, "");
        if (userInput) {
            customExclusions = userInput.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
        }
    }

    const allExclusions = [...CODE_EXCLUSIONS, ...customExclusions];

    let skipped = 0;
    const processList = files.filter(f => {
        const fullPath = (f.webkitRelativePath || f.name).toLowerCase();
        const pathSegments = fullPath.split('/');
        
        // Accurate segment matching to avoid accidental exclusion of similarly named files
        const isEx = allExclusions.some(x => {
            const pattern = x.toLowerCase();
            return pathSegments.some(segment => segment === pattern) || fullPath.includes(pattern);
        });

        if(isEx) skipped++;
        return !isEx;
    });

    if(!processList.length) {
        showToast("No valid source files found after filtering.", "warning");
        e.target.value = ''; return;
    }

    setLoading(true, `Indexing ${processList.length} items...`);
    
    // Chunked processing to maintain UI responsiveness
    const CHUNK_SIZE = 25;
    for (let i = 0; i < processList.length; i += CHUNK_SIZE) {
        const chunk = processList.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    projectFiles.push({ 
                        id: Date.now() + Math.random(), 
                        name: file.name, 
                        path: file.webkitRelativePath || file.name, 
                        content: ev.target.result 
                    });
                    resolve();
                };
                reader.onerror = () => resolve();
                reader.readAsText(file);
            });
        }));
    }

    renderFileTree();
    setLoading(false);
    showToast(`Workspace Ready. Indexed ${processList.length} files, skipped ${skipped} ignored items.`, "success");
    e.target.value = '';
}

function renderFileTree() {
    const tree = document.getElementById('fileTree');
    if (!projectFiles.length) {
        tree.innerHTML = '<div class="py-10 text-center"><p class="text-[10px] text-gray-500 italic mb-4">Workspace empty.</p><button onclick="createNewCodeFile()" class="text-[9px] font-black text-blue-400 hover:underline">NEW BLANK FILE</button></div>';
        return;
    }

    tree.innerHTML = projectFiles.sort((a,b) => a.path.localeCompare(b.path)).map(f => {
        const isActive = f.id === activeFileId;
        return `
            <div onclick="selectCodeFile('${f.id}')" class="group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all hover:bg-white/5 ${isActive ? 'bg-blue-600/20 text-white border border-blue-500/30' : 'text-gray-400'}">
                <div class="flex items-center gap-2 min-w-0">
                    <i class="fas fa-file-code text-[10px] opacity-70"></i>
                    <span class="text-[10px] font-medium truncate">${f.path}</span>
                </div>
                <button onclick="event.stopPropagation(); deleteCodeFile('${f.id}')" class="opacity-0 group-hover:opacity-100 hover:text-red-500 p-1"><i class="fas fa-trash-alt text-[9px]"></i></button>
            </div>
        `;
    }).join('');
}

function selectCodeFile(id) {
    activeFileId = Number(id);
    const file = projectFiles.find(f => f.id === activeFileId);
    if (!file) return;
    document.getElementById('activeFileName').innerText = file.path;
    document.getElementById('codeEditor').value = file.content;
    document.getElementById('downloadBtn').classList.remove('hidden');
    const folderBtn = document.getElementById('deleteFolderBtn');
    if(file.path.includes('/')) folderBtn.classList.remove('hidden');
    else folderBtn.classList.add('hidden');
    renderFileTree();
}

function deleteCodeFile(id) {
    const numId = Number(id);
    projectFiles = projectFiles.filter(f => f.id !== numId);
    if(activeFileId === numId) clearEditorState();
    renderFileTree();
}

function deleteActiveFolder() {
    const file = projectFiles.find(f => f.id === activeFileId);
    if(!file || !file.path.includes('/')) return;
    const folder = file.path.split('/').slice(0, -1).join('/') + '/';
    if(!confirm(`Remove all files in ${folder}?`)) return;
    projectFiles = projectFiles.filter(f => !f.path.startsWith(folder));
    if(!projectFiles.find(f => f.id === activeFileId)) clearEditorState();
    renderFileTree();
    showToast(`Removed folder: ${folder}`, "warning");
}

function clearEditorState() {
    activeFileId = null;
    document.getElementById('codeEditor').value = '';
    document.getElementById('activeFileName').innerText = 'No file selected';
    document.getElementById('downloadBtn').classList.add('hidden');
    document.getElementById('deleteFolderBtn').classList.add('hidden');
}

function clearCodeWorkspace() {
    if(projectFiles.length && !confirm("Clear entire session?")) return;
    projectFiles = [];
    clearEditorState();
    renderFileTree();
}

function createNewCodeFile() {
    const name = prompt("Name your file:", "Untitled.txt") || "Untitled.txt";
    const id = Date.now() + Math.random();
    projectFiles.push({ id, name, path: name, content: '' });
    renderFileTree();
    selectCodeFile(id);
}

let codeAutoSaveTimeout;
function handleCodeInput() {
    const status = document.getElementById('editStatus');
    if (status) status.classList.remove('hidden');
    
    clearTimeout(codeAutoSaveTimeout);
    codeAutoSaveTimeout = setTimeout(() => {
        saveActiveFile(true);
        if (status) status.classList.add('hidden');
    }, 1500);
}

function saveActiveFile(isAuto = false) {
    if (!activeFileId) return;
    const file = projectFiles.find(f => f.id === activeFileId);
    if (file) {
        file.content = document.getElementById('codeEditor').value;
        if (!isAuto) showToast("Local file updated.", "success");
    }
}

function downloadActiveFile() {
    if (!activeFileId) return;
    const file = projectFiles.find(f => f.id === activeFileId);
    if (!file) return;

    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
}

async function askCodeAI() {
    stopAllSTT();
    if (isAICooldownActive) {
        showAICooldownOverlay();
        return;
    }
    const inputEl = document.getElementById('codeChatInput');
    const editorEl = document.getElementById('codeEditor');
    const query = inputEl.value.trim();
    if (!query && pendingFiles.length === 0) return;

    let activeFile = projectFiles.find(f => f.id === activeFileId);
    
    // Notebook Auto-Initialization: Use editor content if no file selected
    if (!activeFile && editorEl.value.trim()) {
        const id = Date.now() + Math.random();
        activeFile = { id, name: 'notebook.txt', path: 'notebook.txt', content: editorEl.value };
        projectFiles.push(activeFile);
        activeFileId = id;
        renderFileTree();
        selectCodeFile(id);
        showToast("Editor content indexed as notebook.", "info");
    }

    if (!activeFile && pendingFiles.length === 0) {
        showToast("Upload a file or enter code in the editor to provide context.", "warning");
        return;
    }

    const userMsg = query + (pendingFiles.length ? `\n\n[Attached ${pendingFiles.length} files]` : "");
    appendAIMessage('user', userMsg, 'codeChatBox');
    inputEl.value = '';
    autoResize(inputEl);
    [document.getElementById('aiAttachmentPreview'), document.getElementById('miniAttachmentPreview'), document.getElementById('codeAttachmentPreview'), document.getElementById('solveAttachmentPreview')].forEach(p => { if(p) p.innerHTML = ''; });

    const model = document.getElementById('codeModelSelect').value;
    
    const projectContext = projectFiles.map(f => `File: ${f.path}\nContent:\n${f.content}`).join('\n\n---\n\n');
    
    let activeFilePath = activeFile ? activeFile.path : 'None';
    let activeFileContent = activeFile ? activeFile.content : 'None';

    const systemPrompt = `You are an expert AI code editor. 
    CURRENT_PROJECT_CONTEXT:
    ${projectContext}

    ACTIVE_FILE: ${activeFilePath}
    ACTIVE_FILE_CONTENT: ${activeFileContent}

    USER_REQUEST: ${query}

    INSTRUCTIONS:
    1. You MUST directly edit the active file if the user requests changes.
    2. Return your response in this exact format:
       COMMENTARY: [Brief explanation of changes]
       CODE_START
       [Full new content of ${activeFilePath}]
       CODE_END
    3. If no code change is requested, just answer the question in plain text.`;

    const parts = [{ text: systemPrompt }];
    pendingFiles.forEach(f => parts.push({ inline_data: { mime_type: f.mime_type, data: f.data } }));
    
    const history = [{ role: 'user', content: userMsg, parts }];
    const attachmentsForApi = [...pendingFiles];
    pendingFiles = [];

    await callGeminiAPI(query, 'codeChatBox', history, attachmentsForApi, model);
}

function showDiffOverlay() {
    if (!aiProposedChange) return;
    
    const oldLines = aiProposedChange.originalContent.split('\n');
    const newLines = aiProposedChange.newContent.split('\n');
    
    // Optimized Diff alignment using LCS (Longest Common Subsequence)
    function getDiff(oldArr, newArr) {
        const m = oldArr.length;
        const n = newArr.length;
        
        // Use a single typed array for the DP table to improve memory efficiency
        const dp = new Int32Array((m + 1) * (n + 1));
        const getIdx = (i, j) => i * (n + 1) + j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldArr[i - 1] === newArr[j - 1]) {
                    dp[getIdx(i, j)] = dp[getIdx(i - 1, j - 1)] + 1;
                } else {
                    dp[getIdx(i, j)] = Math.max(dp[getIdx(i - 1, j)], dp[getIdx(i, j - 1)]);
                }
            }
        }

        const result = [];
        let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldArr[i - 1] === newArr[j - 1]) {
                result.unshift({ type: 'equal', old: oldArr[i - 1], new: newArr[j - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[getIdx(i, j - 1)] >= dp[getIdx(i - 1, j)])) {
                result.unshift({ type: 'add', new: newArr[j - 1] });
                j--;
            } else {
                result.unshift({ type: 'delete', old: oldArr[i - 1] });
                i--;
            }
        }
        return result;
    }

    const diff = getDiff(oldLines, newLines);
    
    let origHtml = "";
    let newHtml = "";
    
    diff.forEach(item => {
        const oStr = item.old !== undefined ? escapeHtml(item.old) : null;
        const nStr = item.new !== undefined ? escapeHtml(item.new) : null;

        if (item.type === 'equal') {
            const content = (oStr || '').trim() === '' ? '&nbsp;' : oStr;
            origHtml += `<div>${content}</div>`;
            newHtml += `<div>${content}</div>`;
        } else if (item.type === 'delete') {
            origHtml += `<div class="bg-red-500/30 text-red-200 border-l-2 border-red-500 pl-1"> ${oStr || '&nbsp;'}</div>`;
            newHtml += `<div class="opacity-10 bg-red-900/10">&nbsp;</div>`;
        } else if (item.type === 'add') {
            origHtml += `<div class="opacity-10 bg-green-900/10">&nbsp;</div>`;
            newHtml += `<div class="bg-green-500/30 text-green-200 border-l-2 border-green-500 pl-1"> ${nStr || '&nbsp;'}</div>`;
        }
    });

    document.getElementById('diffOriginal').innerHTML = origHtml;
    document.getElementById('diffProposed').innerHTML = newHtml;
    document.getElementById('diffOverlay').classList.remove('hidden');
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function acceptAIChanges() {
    if (!aiProposedChange) return;
    const file = projectFiles.find(f => f.id === aiProposedChange.fileId);
    if (file) {
        file.content = aiProposedChange.newContent;
        if (activeFileId === file.id) {
            document.getElementById('codeEditor').value = file.content;
        }
        showToast("Changes applied to source.", "success");
    }
    closeDiffOverlay();
}

function rejectAIChanges() {
    showToast("Changes discarded.", "info");
    closeDiffOverlay();
}

function closeDiffOverlay() {
    document.getElementById('diffOverlay').classList.add('hidden');
    aiProposedChange = null;
}

// --- INIT ---
// Performance optimized initialization sequence
const initApp = async () => {
    // 1. Critical UI setup (Immediate)
    const savedTheme = (currentUser && currentUser.theme) ? currentUser.theme : (localStorage.getItem('soul_theme') || 'midnight');
    setTheme(savedTheme);
    
    const initialPath = window.location.pathname.substring(1) || 'home';
    showPage(initialPath, false);
    
    updateAuthUI();
    initCustomCursor();

    // Initial resize trigger for pre-filled or visible textareas
    setTimeout(() => {
        ['chatInput', 'noteInput', 'editNoteText', 'miniChatInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) autoResize(el);
        });
    }, 100);

    // 2. Non-critical metadata
    const yearEl = document.getElementById('currentYear');
    if (yearEl) yearEl.innerText = new Date().getFullYear();

    // 3. Deferred/Async Logic
    requestAnimationFrame(async () => {
        // Marked.js options
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                highlight: (code) => typeof hljs !== 'undefined' ? hljs.highlightAuto(code).value : code,
                breaks: true,
                gfm: true
            });
        }

        const savedVol = localStorage.getItem('soulVolume');
        if (savedVol !== null) {
            const vol = parseFloat(savedVol);
            audioPlayer.volume = vol;
            if (document.getElementById('volumeControl')) document.getElementById('volumeControl').value = vol;
        }

        // Search Input Listeners for Modal
        const explorerInputs = [document.getElementById('ytExplorerInput'), document.getElementById('ytExplorerInputMobile')];
        explorerInputs.forEach(input => {
            if(input) {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') searchYTExplorer(input.id.includes('Mobile'));
                });
            }
        });

        // Parallel non-blocking data fetching
        const backgroundTasks = [
            loadConfig(),
            loadFeedbacks(),
            checkAnnouncement(),
            checkSystemHealth()
        ];

        if (currentUser) {
            backgroundTasks.push(syncAllData());
            backgroundTasks.push(loadCricketSetup());
            
            // Re-trigger tour if user registered but didn't finish/see it
            if (!localStorage.getItem('soul_tour_done')) {
                setTimeout(startWelcomeTour, 4000);
            }
        }

        await Promise.all(backgroundTasks);

        // UI specific secondary setups
        renderAIHistory();
        initGoogleLogin();
        
        // Setup Greetings if not already present
        const chatBox = document.getElementById('chatBox');
        if (chatBox && !chatBox.innerHTML.trim()) {
            appendAIMessage('ai', "### Greetings.\nI am the **sOuLAI** interface. How can I assist your vision today?", 'chatBox');
        }
        
        const miniChatBox = document.getElementById('miniChatBox');
        if (miniChatBox && !miniChatBox.innerHTML.trim()) {
            appendAIMessage('ai', "Hello! I am your quick AI assistant. Ask me anything.", 'miniChatBox');
        }

        document.getElementById('aiWidget').onclick = toggleMiniChat;

        // Synced Scrolling Initialization (Notes)
        const editorEl = document.getElementById('editNoteText');
        const previewEl = document.getElementById('notePreview');
        if (editorEl && previewEl) {
            editorEl.addEventListener('scroll', handleEditorScroll, { passive: true });
            previewEl.addEventListener('scroll', handlePreviewScroll, { passive: true });
        }

        // Synced Scrolling Initialization (Code Diff)
        const diffOrig = document.getElementById('diffOriginal');
        const diffProp = document.getElementById('diffProposed');
        if (diffOrig && diffProp) {
            diffOrig.addEventListener('scroll', handleDiffOriginalScroll, { passive: true });
            diffProp.addEventListener('scroll', handleDiffProposedScroll, { passive: true });
        }

        // Start polling/monitoring
        setInterval(checkSystemHealth, 30000);
        setInterval(checkAnnouncement, 60000);
        
        if (initialPath === 'snake') syncSnakeLeaderboard();
        startTimeUpdates();
    });
};

// Use DOMContentLoaded instead of window.onload for faster initial execution
// --- TIME & CALENDAR ENGINE ---
function startTimeUpdates() {
    const update = () => {
        const now = new Date();
        const is12h = timeFormat === '12h';
        
        // Update Navbar
        const navTime = document.getElementById('navTime');
        const navDate = document.getElementById('navDate');
        if (navTime) navTime.innerText = now.toLocaleTimeString([], { hour12: is12h });
        if (navDate) navDate.innerText = now.toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' });

        // Update Modal if visible
        const modal = document.getElementById('timeModal');
        if (modal && !modal.classList.contains('hidden')) {
            if (clockType === 'digital') {
                document.getElementById('modalDigitalTime').innerText = now.toLocaleTimeString([], { hour12: is12h });
                document.getElementById('modalDigitalDate').innerText = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: '2-digit' });
            } else {
                const hour = now.getHours();
                const min = now.getMinutes();
                const sec = now.getSeconds();

                const hrDeg = (hour % 12) * 30 + min * 0.5;
                const minDeg = min * 6 + sec * 0.1;
                const secDeg = sec * 6;

                document.getElementById('analogHour').style.transform = `translateX(-50%) rotate(${hrDeg}deg)`;
                document.getElementById('analogMin').style.transform = `translateX(-50%) rotate(${minDeg}deg)`;
                document.getElementById('analogSec').style.transform = `translateX(-50%) rotate(${secDeg}deg)`;
            }
        }
    };
    
    update();
    setInterval(update, 1000);
}

function openTimeModal() {
    document.getElementById('timeModal').classList.remove('hidden');
    document.getElementById('timeModal').classList.add('flex');
    document.getElementById('userTimezone').innerText = Intl.DateTimeFormat().resolvedOptions().timeZone;
    renderCalendar();
    setTimeFormat(timeFormat);
    setClockType(clockType);
    document.body.style.overflow = 'hidden';
}

function closeTimeModal() {
    document.getElementById('timeModal').classList.add('hidden');
    document.getElementById('timeModal').classList.remove('flex');
    document.body.style.overflow = '';
}

function setClockType(type) {
    clockType = type;
    const btnD = document.getElementById('btnClockDigital');
    const btnA = document.getElementById('btnClockAnalog');
    const dispD = document.getElementById('displayDigital');
    const dispA = document.getElementById('displayAnalog');
    const formatToggle = document.getElementById('timeFormatToggle');

    if (type === 'digital') {
        if (btnD) btnD.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-cyan-600 text-white transition-all shadow-lg shadow-cyan-600/20";
        if (btnA) btnA.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase text-gray-400 hover:text-white transition-all";
        if (dispD) dispD.classList.remove('hidden');
        if (dispA) dispA.classList.add('hidden');
        if (formatToggle) formatToggle.classList.remove('hidden');
    } else {
        if (btnA) btnA.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-cyan-600 text-white transition-all shadow-lg shadow-cyan-600/20";
        if (btnD) btnD.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase text-gray-400 hover:text-white transition-all";
        if (dispA) dispA.classList.remove('hidden');
        if (dispD) dispD.classList.add('hidden');
        if (formatToggle) formatToggle.classList.add('hidden');
    }
}

function setTimeFormat(format) {
    timeFormat = format;
    localStorage.setItem('soul_time_format', format);
    const btn12 = document.getElementById('btnFormat12h');
    const btn24 = document.getElementById('btnFormat24h');

    if (format === '12h') {
        if (btn12) btn12.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-cyan-600 text-white transition-all shadow-lg shadow-cyan-600/20";
        if (btn24) btn24.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase text-gray-400 hover:text-white transition-all";
    } else {
        if (btn24) btn24.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-cyan-600 text-white transition-all shadow-lg shadow-cyan-600/20";
        if (btn12) btn12.className = "px-4 py-2 rounded-lg text-[10px] font-black uppercase text-gray-400 hover:text-white transition-all";
    }
}

function changeMonth(delta) {
    calendarDate.setMonth(calendarDate.getMonth() + delta);
    renderCalendar();
}

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const header = document.getElementById('calMonthYear');
    
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    
    header.innerText = calendarDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    
    let html = "";
    
    // Prev Month Padding
    for (let i = firstDay; i > 0; i--) {
        html += `<div class="cal-day other-month">${daysInPrevMonth - i + 1}</div>`;
    }
    
    // Current Month
    const today = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
        const isToday = today.getDate() === i && today.getMonth() === month && today.getFullYear() === year;
        html += `<div class="cal-day active-month ${isToday ? 'today' : ''}">${i}</div>`;
    }
    
    // Next Month Padding
    const totalCells = 42;
    const consumed = firstDay + daysInMonth;
    const remaining = totalCells - consumed;
    for (let i = 1; i <= remaining; i++) {
        html += `<div class="cal-day other-month">${i}</div>`;
    }
    
    grid.innerHTML = html;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}