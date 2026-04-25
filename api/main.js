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
                // Handle legacy field mapping if necessary
                if (!config.unifiedModel && config.miniChatModel) {
                    config.unifiedModel = config.miniChatModel;
                }
                return res.status(200).json(config);
            }

            // POST/UPDATE requires admin verification
            const adminEmail = query.adminEmail;
            const adminUser = await db.collection('users').findOne({ email: adminEmail });
            if (!adminUser || !adminUser.isAdmin) {
                return res.status(403).json({ error: "Unauthorized access" });
            }

            if (method === 'POST') {
                // Ensure field is renamed if present in payload
                if (body.miniChatModel && !body.unifiedModel) {
                    body.unifiedModel = body.miniChatModel;
                }
                await col.updateOne({ type: 'ai_settings' }, { $set: body }, { upsert: true });
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
                    text: `Name: ${data.name}\nEmail: ${data.email}\n\nMessage:\n${data.message}`
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

        // Persistence for AI, Cricket, Fun, Random, Music, Reports
        if (['ai_conversations', 'cricket_history', 'cricket_setup', 'fun_stats', 'random_history', 'music_playlist', 'user_reports', 'quiz_score'].includes(query.route)) {
            const col = db.collection(query.route);
            const userId = query.userId;

            if (method === 'GET') {
                if (!userId) return res.status(400).json({ error: "UserId required" });
                const data = await col.find({ userId }).sort({ timestamp: -1 }).toArray();
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
                        const cleanStr = (str) => {
                            if (typeof str !== 'string') return "";
                            return str.replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, " ");
                        };

                        const doc = new PDFDocument({ margin: 50, size: 'A4' });
                        let chunks = [];

                        doc.on('error', err => {
                            console.error("PDFKit Stream Error:", err);
                            resolve();
                        });

                        doc.on('data', chunk => chunks.push(chunk));
                        doc.on('end', () => {
                            const result = Buffer.concat(chunks);
                            res.setHeader('Content-Type', 'application/pdf');
                            res.setHeader('Content-Length', result.length);
                            res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
                            res.status(200).send(result);
                            resolve();
                        });

                        doc.font('Helvetica-Bold');
                        doc.fillColor('#06b6d4').fontSize(24).text(`sOuLViSiON`, { align: 'center' });
                        doc.fillColor('#333333').fontSize(10).text(`${type.toUpperCase()} EXPORT`, { align: 'center' });
                        doc.moveDown(0.5);
                        doc.fontSize(8).font('Helvetica').fillColor('#999999').text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
                        doc.moveDown();
                        doc.strokeColor('#eeeeee').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
                        doc.moveDown(2);

                        if (type === 'chat' && data.messages) {
                            data.messages.forEach(m => {
                                doc.fillColor(m.role === 'user' ? '#7c3aed' : '#06b6d4')
                                   .fontSize(10).font('Helvetica-Bold').text(m.role.toUpperCase(), { continued: true })
                                   .fillColor('#999999').font('Helvetica').text(`  |  ${new Date().toLocaleTimeString()}`);
                                doc.moveDown(0.5);
                                doc.fillColor('#333333').fontSize(11).text(cleanStr(m.content), { align: 'left', lineGap: 2 });
                                doc.moveDown(1.5);
                            });
                        } else if (type === 'note') {
                            doc.fillColor('#06b6d4').fontSize(18).font('Helvetica-Bold').text(cleanStr(data.title) || 'Untitled Note');
                            doc.fillColor('#999999').fontSize(9).font('Helvetica').text(`Type: ${(data.type || 'Note').toUpperCase()} | Deadline: ${data.deadline || 'None'}`);
                            doc.moveDown();
                            doc.strokeColor('#eeeeee').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
                            doc.moveDown();
                            doc.fillColor('#333333').fontSize(12).text(cleanStr(data.text), { lineGap: 3 });
                        } else if (type === 'report') {
                            doc.fillColor('#ef4444').fontSize(22).font('Helvetica-Bold').text(`SPIRITUAL PROGRESS REPORT`, { align: 'center' });
                            doc.moveDown();
                            doc.fillColor('#333333').fontSize(14).font('Helvetica-Bold').text(`Metrics & Abundance`, { underline: true });
                            doc.fontSize(10).font('Helvetica').text(`Vitality (Health): ${data.metrics.health}`);
                            doc.fontSize(10).text(`Prosperity (Wealth): ${data.metrics.wealth}`);
                            doc.moveDown();
                            doc.fillColor('#06b6d4').fontSize(14).font('Helvetica-Bold').text(`Soul Wisdom`, { underline: true });
                            doc.fillColor('#444444').fontSize(11).font('Helvetica-Oblique').text(cleanStr(data.advice));
                            doc.moveDown();
                            doc.fillColor('#7c3aed').fontSize(14).font('Helvetica-Bold').text(`Inner Reflections`, { underline: true });
                            data.qna.forEach(item => {
                                doc.fillColor('#333333').fontSize(10).font('Helvetica-Bold').text(`Q: ${cleanStr(item.question)}`);
                                doc.fillColor('#666666').fontSize(10).font('Helvetica').text(`A: ${cleanStr(item.answer)}`);
                                doc.moveDown(0.5);
                            });
                            doc.moveDown();
                            doc.fillColor('#333333').fontSize(14).font('Helvetica-Bold').text(`Journal Logs`, { underline: true });
                            data.journals.forEach(j => {
                                doc.fontSize(8).fillColor('#999999').font('Helvetica').text(new Date(j.id).toLocaleDateString());
                                doc.fontSize(10).fillColor('#444444').text(cleanStr(j.content));
                                doc.moveDown(0.5);
                            });
                        }
                        doc.end();
                    } catch (pdfErr) {
                        console.error("CRITICAL PDF ERROR:", pdfErr);
                        res.status(500).json({ error: "PDF Generation Failed: " + pdfErr.message });
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

        if (query.route === 'yt_search') {
            const q = query.q;
            if (!q) return res.status(400).json({ error: "Query required" });
            
            let searchOptions = {
                query: q,
                hl: 'en',
                gl: 'US',
                timeout: 10000 // 10 second timeout for faster failure recovery
            };

            let proxyUrl = null;

            if (process.env.PROXIFLY_API_KEY) {
                try {
                    // Proxifly handling might need different import styles depending on version
                    // but we try the standard constructor provided in main.js
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
                    // Using version 5.0.1 of https-proxy-agent for CommonJS compatibility
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
            
            return res.status(200).json(r.videos ? r.videos.slice(0, 15) : []);
        }

        res.status(404).json({ error: "Route not found" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}