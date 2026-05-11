const { MongoClient } = require('mongodb');
const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const ytSearch = require('yt-search');
const { HttpsProxyAgent } = require('https-proxy-agent');
const Proxifly = require('proxifly');
const PDFDocument = require('pdfkit');

const uri = process.env.MONGODB_URI;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
    if (cachedClient && cachedDb) {
        return { client: cachedClient, db: cachedDb };
    }
    const client = await MongoClient.connect(uri);
    const db = client.db('soulvision');
    cachedClient = client;
    cachedDb = db;
    return { client, db };
}

export default async function handler(req, res) {
    const { method, body, query } = req;
    
    try {
        const { db } = await connectToDatabase();
        
        // Basic Route Handler
        if (query.route === 'auth') {
            const col = db.collection('users');
            const { email, password, name, mode, theme } = body;
            
            if (method === 'PATCH') {
                const userEmail = query.email;
                const update = { name };
                if (password) {
                    update.password = await bcrypt.hash(password, 10);
                }
                if (theme) {
                    update.theme = theme;
                }
                await col.updateOne({ email: userEmail }, { $set: update });
                return res.status(200).json({ success: true });
            }

            const geoData = {
                city: req.headers['x-vercel-ip-city'] || 'Local',
                country: req.headers['x-vercel-ip-country'] || 'Local',
                lat: req.headers['x-vercel-ip-latitude'] || null,
                lon: req.headers['x-vercel-ip-longitude'] || null
            };

            if (mode === 'google') {
                const { credential } = body;
                const ticket = await googleClient.verifyIdToken({
                    idToken: credential,
                    audience: process.env.GOOGLE_CLIENT_ID
                });
                const payload = ticket.getPayload();
                const email = payload['email'];
                const name = payload['name'];
                
                let user = await col.findOne({ email });
                if (!user) {
                    user = { 
                        email, 
                        name, 
                        isAdmin: email === process.env.MAIL_USER,
                        authSource: 'google',
                        lastGeo: geoData,
                        joinedAt: Date.now()
                    };
                    await col.insertOne(user);
                } else {
                    await col.updateOne({ email }, { $set: { lastGeo: geoData } });
                }
                return res.status(200).json(user);
            } else if (mode === 'register') {
                const existing = await col.findOne({ email });
                if (existing) return res.status(400).json({ error: "User already exists" });
                const hashedPassword = await bcrypt.hash(password, 10);
                const newUser = { 
                    email, 
                    password: hashedPassword, 
                    name, 
                    isAdmin: email === process.env.MAIL_USER,
                    lastGeo: geoData,
                    joinedAt: Date.now()
                };
                await col.insertOne(newUser);
                const { password: _, ...userWithoutPass } = newUser;
                return res.status(201).json(userWithoutPass);
            } else {
                const user = await col.findOne({ email });
                if (!user || !(await bcrypt.compare(password, user.password))) {
                    return res.status(401).json({ error: "Invalid credentials" });
                }
                await col.updateOne({ email }, { $set: { lastGeo: geoData } });
                const { password: _, ...userWithoutPass } = user;
                return res.status(200).json(userWithoutPass);
            }
        }

        if (query.route === 'notes') {
            const col = db.collection('notes');
            if (method === 'GET') {
                const showTrash = query.trash === 'true';
                const filter = { userId: query.userId };
                if (showTrash) {
                    filter.isDeleted = true;
                } else {
                    filter.isDeleted = { $ne: true };
                }
                const notes = await col.find(filter).sort({ isPinned: -1, id: -1 }).toArray();
                return res.status(200).json(notes);
            }
            if (method === 'POST') {
                await col.insertOne({ ...body, isDeleted: false, isPinned: false });
                return res.status(201).json({ success: true });
            }
            if (method === 'DELETE') {
                const queryId = isNaN(query.id) ? query.id : Number(query.id);
                const permanent = query.perm === 'true';
                if (permanent) {
                    await col.deleteOne({ id: queryId });
                } else {
                    await col.updateOne({ id: queryId }, { $set: { isDeleted: true, deletedAt: Date.now() } });
                }
                return res.status(200).json({ success: true });
            }
            if (method === 'PATCH') {
                const queryId = isNaN(query.id) ? query.id : Number(query.id);
                const update = { ...body };
                delete update.id;
                await col.updateOne({ id: queryId }, { $set: update });
                return res.status(200).json({ success: true });
            }
        }

        if (query.route === 'users') {
            const adminEmail = query.adminEmail;
            const adminUser = await db.collection('users').findOne({ email: adminEmail });
            if (!adminUser || !adminUser.isAdmin) {
                return res.status(403).json({ error: "Unauthorized access" });
            }

            const col = db.collection('users');
            if (method === 'GET') {
                const users = await col.find({}, { projection: { password: 0 } }).toArray();
                return res.status(200).json(users);
            }
            if (method === 'DELETE') {
                const targetEmail = query.email;
                if (!targetEmail) return res.status(400).json({ error: "Email required" });
                
                // Cleanup all user data
                await col.deleteOne({ email: targetEmail });
                await db.collection('notes').deleteMany({ userId: targetEmail });
                await db.collection('ai_conversations').deleteMany({ userId: targetEmail });
                await db.collection('cricket_history').deleteMany({ userId: targetEmail });
                await db.collection('fun_stats').deleteMany({ userId: targetEmail });
                await db.collection('random_history').deleteMany({ userId: targetEmail });
                await db.collection('music_playlist').deleteMany({ userId: targetEmail });
                
                return res.status(200).json({ success: true });
            }
        }

        if (query.route === 'forgot_password') {
            const tokensCol = db.collection('reset_tokens');
            const usersCol = db.collection('users');

            if (method === 'POST') {
                const { email } = body;
                const user = await usersCol.findOne({ email });
                if (!user) return res.status(404).json({ error: "User not found" });
                if (user.authSource === 'google') return res.status(400).json({ error: "Please login using Google." });

                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                await tokensCol.updateOne(
                    { email },
                    { $set: { otp, createdAt: new Date() } },
                    { upsert: true }
                );

                // Send Email
                if (process.env.MAIL_USER && process.env.MAIL_PASS) {
                    const transporter = nodemailer.createTransport({
                        service: 'gmail',
                        auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
                    });
                    await transporter.sendMail({
                        from: process.env.MAIL_USER,
                        to: email,
                        subject: "sOuLViSiON: Password Reset Code",
                        text: `Your verification code is: ${otp}\n\nThis code will expire in 10 minutes.`
                    });
                }
                return res.status(200).json({ success: true });
            }

            if (method === 'PATCH') {
                const { email, otp, newPassword } = body;
                const record = await tokensCol.findOne({ email, otp });
                
                if (!record) return res.status(400).json({ error: "Invalid or expired code." });
                
                // 10 min expiry check
                const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
                if (record.createdAt < tenMinsAgo) {
                    await tokensCol.deleteOne({ email });
                    return res.status(400).json({ error: "Code expired." });
                }

                const hashedPassword = await bcrypt.hash(newPassword, 10);
                await usersCol.updateOne({ email }, { $set: { password: hashedPassword } });
                await tokensCol.deleteOne({ email });
                
                return res.status(200).json({ success: true });
            }
        }

        if (query.route === 'announcement') {
            const col = db.collection('announcements');
            if (method === 'GET') {
                const latest = await col.find().sort({ timestamp: -1 }).limit(1).toArray();
                const announce = latest[0];
                if (announce && announce.expiresAt && announce.expiresAt < Date.now()) {
                    return res.status(200).json(null);
                }
                return res.status(200).json(announce || null);
            }
            
            const adminEmail = query.adminEmail;
            const adminUser = await db.collection('users').findOne({ email: adminEmail });
            if (!adminUser || !adminUser.isAdmin) return res.status(403).json({ error: "Unauthorized" });

            if (method === 'POST') {
                const { text, duration, timestamp } = body;
                let expiresAt = null;
                if (duration > 0) {
                    expiresAt = timestamp + (duration * 60 * 60 * 1000);
                }
                const doc = { text, timestamp, expiresAt };
                await col.deleteMany({}); // Only one active announcement at a time
                await col.insertOne(doc);
                return res.status(201).json(doc);
            }
            
            if (method === 'DELETE') {
                await col.deleteMany({});
                return res.status(200).json({ success: true });
            }
        }

        if (query.route === 'admin_config') {
            const col = db.collection('config');

            if (method === 'GET') {
                const config = (await col.findOne({ type: 'ai_settings' })) || {};
                // Expose Razorpay Public Key from environment
                config.razorpayKey = process.env.RAZORPAY_KEY_ID;
                return res.status(200).json(config);
            }

            // POST/UPDATE requires admin verification
            const adminEmail = query.adminEmail;
            const adminUser = await db.collection('users').findOne({ email: adminEmail });
            if (!adminUser || !adminUser.isAdmin) {
                return res.status(403).json({ error: "Unauthorized access" });
            }

            if (method === 'POST') {
                // Ensure only 'keys' and 'models' are stored (remove any unified model concepts)
                const updateDoc = {
                    keys: body.keys,
                    models: body.models,
                    type: 'ai_settings' // Always ensure the type is consistent
                };
                await col.updateOne({ type: 'ai_settings' }, { $set: updateDoc }, { upsert: true });
                return res.status(200).json({ success: true });
            }
        }

        if (query.route === 'feedback') {
            const col = db.collection('feedback');
            if (method === 'GET') {
                const list = await col.find().sort({_id: -1}).limit(20).toArray();
                return res.status(200).json(list);
            }
            if (method === 'POST') {
                const item = typeof body === 'string' ? JSON.parse(body) : body;
                await col.insertOne(item);
                return res.status(201).json({ success: true });
            }
        }

        // Contact Form Handling (Email + DB)
        if (query.route === 'messages' && method === 'POST') {
            const col = db.collection('messages');
            const data = typeof body === 'string' ? JSON.parse(body) : body;
            
            // Map attachments to nodemailer format
            const attachments = (data.attachments || []).map(file => ({
                filename: file.name,
                content: file.content,
                encoding: 'base64',
                contentType: file.type
            }));

            const doc = { ...data, timestamp: Date.now() };
            await col.insertOne(doc);

            if (process.env.MAIL_USER && process.env.MAIL_PASS) {
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: process.env.MAIL_USER,
                        pass: process.env.MAIL_PASS
                    }
                });

                const mailOptions = {
                    from: process.env.MAIL_USER,
                    to: process.env.MAIL_RECEIVER || process.env.MAIL_USER,
                    replyTo: data.email,
                    subject: `sOuLViSiON: New Message from ${data.name}`,
                    text: `Name: ${data.name}\nEmail: ${data.email}\n\nMessage:\n${data.message}`,
                    attachments: attachments
                };

                try {
                    await transporter.sendMail(mailOptions);
                } catch (err) {
                    console.error("Email forwarding failed:", err);
                }
            }
            return res.status(201).json({ success: true });
        }

        if (query.route === 'cricket_leaderboard') {
            const col = db.collection('cricket_leaderboard');
            if (method === 'GET') {
                const board = await col.find().sort({ wins: -1, highScore: -1 }).limit(50).toArray();
                return res.status(200).json(board);
            }
        }

        if (query.route === 'snake_leaderboard') {
            const col = db.collection('snake_leaderboard');
            if (method === 'GET') {
                const board = await col.find().sort({ highScore: -1 }).limit(20).toArray();
                return res.status(200).json(board);
            }
        }

        if (query.route === 'quiz_leaderboard') {
            const col = db.collection('users');
            if (method === 'GET') {
                const board = await col.find({ totalSoulScore: { $gt: 0 } })
                                     .sort({ totalSoulScore: -1 })
                                     .limit(10)
                                     .project({ name: 1, totalSoulScore: 1 })
                                     .toArray();
                return res.status(200).json(board);
            }
        }

        if (query.route === 'quiz_score' && method === 'POST') {
            const userId = query.userId;
            const { score } = body;
            const users = db.collection('users');
            const quizCol = db.collection('quiz_score');
            
            await quizCol.insertOne({ ...body, userId, timestamp: Date.now() });
            await users.updateOne({ email: userId }, { $inc: { totalSoulScore: score } });
            
            return res.status(201).json({ success: true });
        }

        // Persistence for AI, Cricket, Fun, Random, Music, Reports, Seek, Solve, Time
        if (['ai_conversations', 'cricket_history', 'cricket_setup', 'fun_stats', 'random_history', 'music_playlist', 'user_reports', 'quiz_score', 'soulseek_history', 'solve_history', 'calendar_events', 'alarms', 'world_clocks'].includes(query.route)) {
            const col = db.collection(query.route);
            const userId = query.userId;

            if (method === 'GET') {
                const filter = userId ? { userId } : {};
                // Sort by lastUpdated primarily, with id as fallback for reliable newest-first order
                const data = await col.find(filter).sort({ lastUpdated: -1, id: -1 }).limit(userId ? 1000 : 50).toArray();
                return res.status(200).json(data);
            }
            if (method === 'POST') {
                const data = typeof body === 'string' ? JSON.parse(body) : body;
                const doc = { ...data, timestamp: Date.now() };
                if (userId) doc.userId = userId;
                await col.insertOne(doc);

                // If it's a snake score, update leaderboard
                if (query.route === 'fun_stats' && data.type === 'snake') {
                    const boardCol = db.collection('snake_leaderboard');
                    const user = await db.collection('users').findOne({ email: userId });
                    const score = Number(data.score);
                    
                    const current = await boardCol.findOne({ userId });
                    if (!current) {
                        await boardCol.insertOne({ userId, name: user.name, highScore: score });
                    } else if (score > current.highScore) {
                        await boardCol.updateOne({ userId }, { $set: { highScore: score } });
                    }
                }

                // If it's a cricket match result, update leaderboard
                if (query.route === 'cricket_history') {
                    const boardCol = db.collection('cricket_leaderboard');
                    const user = await db.collection('users').findOne({ email: userId });
                    const isWin = data.result.includes(data.teamB.name); // T2 always controlled by user in logic
                    const runs = data.teamB.score;
                    const rr = runs / (data.teamB.balls / 6 || 1);

                    const current = await boardCol.findOne({ userId });
                    if (!current) {
                        await boardCol.insertOne({
                            userId,
                            name: user.name,
                            wins: isWin ? 1 : 0,
                            highScore: runs,
                            avgRR: rr,
                            matchCount: 1
                        });
                    } else {
                        const newWins = current.wins + (isWin ? 1 : 0);
                        const newCount = current.matchCount + 1;
                        const newAvgRR = ((current.avgRR * current.matchCount) + rr) / newCount;
                        await boardCol.updateOne({ userId }, {
                            $set: {
                                wins: newWins,
                                matchCount: newCount,
                                avgRR: newAvgRR,
                                highScore: Math.max(current.highScore, runs)
                            }
                        });
                    }
                }

                return res.status(201).json({ success: true });
            }
            if (method === 'PUT') {
                const data = typeof body === 'string' ? JSON.parse(body) : body;
                const { id, ...updateData } = data;
                // Handle numeric IDs (like those from Date.now()) vs string IDs
                const queryId = isNaN(id) ? id : Number(id);
                await col.updateOne({ id: queryId, userId }, { $set: updateData }, { upsert: true });
                return res.status(200).json({ success: true });
            }
            if (method === 'DELETE') {
                if (query.id) {
                    const queryId = isNaN(query.id) ? query.id : Number(query.id);
                    await col.deleteOne({ userId, id: queryId });
                } else {
                    await col.deleteMany({ userId });
                }
                return res.status(200).json({ success: true });
            }
        }

        if (query.route === 'export') {
            const { format, type, data } = body;
            const filename = `sOuLViSiON_${type}_${Date.now()}`;
            
            if (format === 'pdf') {
                return new Promise((resolve) => {
                    try {
                        const doc = new PDFDocument({ 
                            margin: 50, 
                            size: 'A4', 
                            autoFirstPage: true,
                            bufferPages: true 
                        });
                        let chunks = [];

                        // Helper to safely handle characters not supported by standard PDF fonts
                        const cleanStr = (str) => {
                            if (typeof str !== 'string') return "";
                            return str.replace(/[^\x00-\x7F\u00A0-\u00FF\u2010-\u2043\u2200-\u22FF]/g, "?")
                                      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "?");
                        };

                        const drawHeader = () => {
                            let title = "Export";
                            if (type === 'note') title = data.title || 'Untitled Note';
                            else if (type === 'chat') title = data.name || 'Conversation';
                            else if (type === 'report') title = data.name || 'Soul Report';
                            else if (type === 'seek_report') title = data.title || 'Numerology Blueprint';

                            doc.save();
                            doc.rect(0, 0, doc.page.width, 40).fill('#0f172a');
                            doc.fillColor('#06b6d4').font('Helvetica-Bold').fontSize(14).text('sOuLViSiON', 50, 15);
                            doc.fillColor('#94a3b8').font('Helvetica').fontSize(8).text(`${type.toUpperCase()} | ${cleanStr(title)}`, 150, 18, { align: 'right', width: 395 });
                            doc.restore();
                            doc.y = 70;
                        };

                        doc.on('pageAdded', drawHeader);
                        drawHeader();

                        const renderMarkdown = (text) => {
                            const lines = text.split('\n');
                            let inCodeBlock = false;
                            const pageWidth = doc.page.width - 100;

                            for (let i = 0; i < lines.length; i++) {
                                let line = lines[i];
                                const trimmed = line.trim();

                                if (doc.y > 720) doc.addPage();

                                // Code Blocks
                                if (trimmed.startsWith('```')) {
                                    inCodeBlock = !inCodeBlock;
                                    if (inCodeBlock) doc.moveDown(0.5);
                                    else doc.moveDown(0.5);
                                    continue;
                                }

                                if (inCodeBlock) {
                                    doc.save();
                                    const codeHeight = doc.heightOfString(line, { font: 'Courier', size: 9, width: pageWidth - 20 });
                                    if (doc.y + codeHeight > 750) doc.addPage();
                                    doc.rect(50, doc.y - 2, pageWidth, codeHeight + 4).fill('#1e293b');
                                    doc.fillColor('#e2e8f0').font('Courier').fontSize(9).text(cleanStr(line), 60, doc.y, { width: pageWidth - 20 });
                                    doc.restore();
                                    continue;
                                }

                                // Horizontal Rule
                                if (trimmed.match(/^---$|^\*\*\*$|^___$/)) {
                                    doc.moveDown(0.5).strokeColor('#334155').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown(1);
                                    continue;
                                }

                                // Headers
                                const headerMatch = line.match(/^(#{1,3})\s+(.*)/);
                                if (headerMatch) {
                                    const level = headerMatch[1].length;
                                    const content = headerMatch[2];
                                    const sizes = [0, 22, 18, 14];
                                    const colors = [null, '#06b6d4', '#06b6d4', '#0891b2'];
                                    doc.fillColor(colors[level]).font('Helvetica-Bold').fontSize(sizes[level]).text(cleanStr(content)).moveDown(0.5);
                                    continue;
                                }

                                // Blockquotes
                                if (trimmed.startsWith('>')) {
                                    doc.save();
                                    const bqText = cleanStr(line.replace(/^>\s?/, ''));
                                    const bqHeight = doc.heightOfString(bqText, { font: 'Helvetica-Oblique', size: 11, width: pageWidth - 25 });
                                    if (doc.y + bqHeight > 750) doc.addPage();
                                    doc.strokeColor('#06b6d4').lineWidth(2).moveTo(55, doc.y).lineTo(55, doc.y + bqHeight).stroke();
                                    doc.fillColor('#64748b').font('Helvetica-Oblique').fontSize(11).text(bqText, 70, doc.y, { width: pageWidth - 25 });
                                    doc.restore();
                                    doc.moveDown(0.2);
                                    continue;
                                }

                                // Standard line / Paragraph / List Item
                                if (trimmed === '') {
                                    doc.moveDown(0.5);
                                    continue;
                                }

                                let xOffset = 50;
                                let listPrefix = '';
                                
                                // Check for Task List / Checklist
                                const taskMatch = line.match(/^(\s*[*+-] )\[([ xX])\]\s+(.*)/);
                                if (taskMatch) {
                                    listPrefix = taskMatch[2].trim().toLowerCase() === 'x' ? ' [X] ' : ' [ ] ';
                                    line = taskMatch[3];
                                    xOffset = 70;
                                } else {
                                    // Regular Unordered/Ordered List
                                    const listMatch = line.match(/^(\s*(\*|-|\d+\.)\s+)(.*)/);
                                    if (listMatch) {
                                        listPrefix = listMatch[2] + ' ';
                                        line = listMatch[3];
                                        xOffset = 70;
                                    }
                                }

                                doc.fontSize(11).fillColor('#334155');

                                // Handle Prefix (Bullet/Checkbox)
                                if (listPrefix) {
                                    doc.font('Helvetica-Bold').text(listPrefix, 50, doc.y, { continued: true });
                                }

                                // Inline Style Parser (Bold, Italic, Link, Inline Code)
                                const inlineRegex = /(\[.*?\]\(.*?\))|(\*\*.*?\*\*)|(\*.*?\*)|(`.*?`)/g;
                                const parts = line.split(inlineRegex).filter(p => p !== undefined && p !== '');

                                parts.forEach((part, index) => {
                                    const isLast = index === parts.length - 1;
                                    const options = { continued: !isLast, width: pageWidth - (xOffset - 50) };
                                    if (index === 0) options.x = xOffset;

                                    if (part.startsWith('[') && part.includes('](')) {
                                        const linkMatch = part.match(/\[(.*?)\]\((.*?)\)/);
                                        if (linkMatch) {
                                            const [_, linkText, url] = linkMatch;
                                            doc.fillColor('#2563eb').font('Helvetica-Bold').text(cleanStr(linkText), { ...options, link: url, underline: true });
                                        }
                                    } else if (part.startsWith('**') && part.endsWith('**')) {
                                        doc.fillColor('#1e293b').font('Helvetica-Bold').text(cleanStr(part.slice(2, -2)), options);
                                    } else if (part.startsWith('*') && part.endsWith('*')) {
                                        doc.fillColor('#334155').font('Helvetica-Oblique').text(cleanStr(part.slice(1, -1)), options);
                                    } else if (part.startsWith('`') && part.endsWith('`')) {
                                        doc.fillColor('#c026d3').font('Courier').text(cleanStr(part.slice(1, -1)), options);
                                    } else {
                                        doc.fillColor('#334155').font('Helvetica').text(cleanStr(part), options);
                                    }
                                });

                                doc.text('', { continued: false }); // Reset continuation
                                doc.moveDown(0.2);
                            }
                        };

                        doc.on('data', chunk => chunks.push(chunk));
                        doc.on('end', () => {
                            const result = Buffer.concat(chunks);
                            res.setHeader('Content-Type', 'application/pdf');
                            res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
                            res.status(200).send(result);
                            resolve();
                        });

                        // Route based Content Generation
                        if (type === 'chat' && data.messages) {
                            data.messages.forEach(m => {
                                doc.fillColor(m.role === 'user' ? '#7c3aed' : '#06b6d4')
                                   .fontSize(10).font('Helvetica-Bold').text(m.role.toUpperCase());
                                doc.fontSize(8).fillColor('#94a3b8').font('Helvetica').text(new Date().toLocaleString(), { align: 'right' });
                                doc.moveDown(0.5);
                                renderMarkdown(m.content);
                                doc.moveDown(1.5);
                                doc.strokeColor('#f1f5f9').lineWidth(0.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown(1);
                            });
                        } else if (type === 'note') {
                            doc.fillColor('#06b6d4').fontSize(22).font('Helvetica-Bold').text(cleanStr(data.title) || 'Untitled Note');
                            doc.fillColor('#94a3b8').fontSize(9).font('Helvetica').text(`TYPE: ${(data.type || 'Note').toUpperCase()} | DATE: ${new Date(data.id).toLocaleDateString()}`);
                            doc.moveDown(1);
                            renderMarkdown(data.text);
                        } else if (type === 'report') {
                             // Soul Focus Report Layout
                            doc.fillColor('#06b6d4').fontSize(24).font('Helvetica-Bold').text(`SOUL REPORT`, { align: 'center' }).moveDown(1);
                            doc.fillColor('#334155').fontSize(14).font('Helvetica-Bold').text(`Metrics Overview`, { underline: true }).moveDown(0.5);
                            doc.fontSize(11).font('Helvetica').text(`Vitality (Health): ${data.metrics?.health || 0}`);
                            doc.text(`Abundance (Wealth): ${data.metrics?.wealth || 0}`).moveDown(1);
                            
                            doc.fillColor('#7c3aed').fontSize(14).font('Helvetica-Bold').text(`Soul Reflections`, { underline: true }).moveDown(0.5);
                            data.qna.forEach(item => {
                                doc.fillColor('#1e293b').fontSize(11).font('Helvetica-Bold').text(`Q: ${cleanStr(item.question)}`);
                                doc.fillColor('#475569').font('Helvetica').text(`A: ${cleanStr(item.answer)}`).moveDown(0.5);
                                if (doc.y > 700) doc.addPage();
                            });

                            if (data.analysis) {
                                doc.addPage();
                                doc.fillColor('#06b6d4').fontSize(18).font('Helvetica-Bold').text(`AI Holistic Analysis`).moveDown(1);
                                renderMarkdown(data.analysis);
                            }
                        } else if (type === 'seek_report') {
                            doc.fillColor('#f97316').fontSize(24).font('Helvetica-Bold').text(`NUMEROLOGY BLUEPRINT`, { align: 'center' }).moveDown(1);
                            doc.fillColor('#475569').fontSize(10).font('Helvetica').text(`Calculated for: ${cleanStr(data.title)}`, { align: 'center' }).moveDown(2);
                            
                            doc.fillColor('#ea580c').fontSize(16).font('Helvetica-Bold').text(`Vedic Synthesis`).moveDown(0.5);
                            renderMarkdown(data.summary || "");
                            
                            doc.addPage();
                            doc.fillColor('#64748b').fontSize(16).font('Helvetica-Bold').text(`Journey History`).moveDown(1);
                            
                            (data.history || []).forEach(m => {
                                const role = m.role === 'user' ? 'Seeker' : 'Oracle';
                                doc.fillColor(m.role === 'user' ? '#7c3aed' : '#f97316').fontSize(10).font('Helvetica-Bold').text(role.toUpperCase());
                                doc.moveDown(0.2);
                                doc.fillColor('#334155').font('Helvetica').fontSize(10).text(cleanStr(m.content)).moveDown(1);
                                if (doc.y > 700) doc.addPage();
                            });
                        } else if (type === 'calendar_event_report') {
                            doc.fillColor('#06b6d4').fontSize(24).font('Helvetica-Bold').text(`CALENDAR EVENTS REPORT`, { align: 'center' }).moveDown(1);
                            doc.fillColor('#475569').fontSize(10).font('Helvetica').text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' }).moveDown(2);
                            
                            const eventsByDate = data.reduce((acc, event) => {
                                const date = new Date(event.date).toLocaleDateString();
                                acc[date] = acc[date] || [];
                                acc[date].push(event);
                                return acc;
                            }, {});

                            for (const date in eventsByDate) {
                                doc.addPage();
                                doc.fillColor('#06b6d4').fontSize(16).font('Helvetica-Bold').text(date).moveDown(0.5);
                                eventsByDate[date].sort((a,b) => new Date(a.date) - new Date(b.date)).forEach(event => {
                                    doc.fillColor('#334155').fontSize(12).font('Helvetica-Bold').text(`${event.time} - ${cleanStr(event.title)}`);
                                    if (event.description) {
                                        doc.fillColor('#475569').fontSize(10).font('Helvetica').text(cleanStr(event.description)).moveDown(0.2);
                                    }
                                    doc.moveDown(0.5);
                                });
                            }
                        }
                        doc.end();
                    } catch (pdfErr) {
                        console.error("PDF Export Error:", pdfErr);
                        res.status(500).send("PDF Generation Failed");
                        resolve();
                    }
                });
            } else if (format === 'markdown' || format === 'txt') {
                let content = "";
                if (type === 'chat') {
                    content = `# Chat Export: ${data.name}\n\n` + data.messages.map(m => `### ${m.role.toUpperCase()}\n${m.content}`).join('\n\n---\n\n');
                } else {
                    content = `# ${data.title || 'Untitled Note'}\n\n${data.text}`;
                }
                res.setHeader('Content-Type', format === 'markdown' ? 'text/markdown' : 'text/plain');
                res.setHeader('Content-Disposition', `attachment; filename=${filename}.${format === 'markdown' ? 'md' : 'txt'}`);
                return res.send(content);
            }
        }

        if (query.route === 'yt_suggest') {
            const q = query.q;
            if (!q) return res.status(200).json([]);
            try {
                const response = await fetch(`https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(q)}`);
                const text = await response.text();
                const match = text.match(/\["(.*?)",\[(.*?)\]\]/);
                if (match) {
                    const json = JSON.parse(`[${match[2]}]`);
                    const suggestions = json.map(item => item[0]);
                    return res.status(200).json(suggestions);
                }
                return res.status(200).json([]);
            } catch (err) {
                return res.status(200).json([]);
            }
        }

        if (query.route === 'yt_search') {
            const q = query.q;
            const isExplorer = query.explorer === 'true';
            if (!q) return res.status(400).json({ error: "Query required" });
            
            let searchOptions = {
                query: q,
                hl: 'en',
                gl: 'US',
                timeout: 10000 
            };

            let proxyUrl = null;

            if (process.env.PROXIFLY_API_KEY) {
                try {
                    const proxifly = new (Proxifly.default || Proxifly)({ apiKey: process.env.PROXIFLY_API_KEY });
                    const proxies = await proxifly.getProxy({
                        quantity: 1,
                        https: true,
                        protocol: ['http', 'https']
                    }).catch(() => null);

                    if (proxies && Array.isArray(proxies) && proxies.length > 0) {
                        const p = proxies[0];
                        if (p.ip && p.port) {
                            proxyUrl = `${p.protocol || 'http'}://${p.ip}:${p.port}`;
                        }
                    }
                } catch (err) {
                    console.warn("Proxy rotation skip:", err.message);
                }
            }

            let r;
            if (proxyUrl) {
                try {
                    const agent = new HttpsProxyAgent(proxyUrl);
                    searchOptions.agent = agent;
                    r = await ytSearch(searchOptions);
                } catch (proxyError) {
                    delete searchOptions.agent;
                    r = await ytSearch(searchOptions);
                }
            } else {
                r = await ytSearch(searchOptions);
            }
            
            const results = r.videos || [];
            return res.status(200).json(isExplorer ? results : results.slice(0, 15));
        }

        res.status(404).json({ error: "Route not found" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}