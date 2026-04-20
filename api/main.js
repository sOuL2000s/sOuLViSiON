const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

export default async function handler(req, res) {
    const { method, body, query } = req;
    
    try {
        await client.connect();
        const db = client.db('soulvision');
        
        // Basic Route Handler
        if (query.route === 'auth') {
            const col = db.collection('users');
            const { email, password, name, mode } = body;
            
            if (mode === 'register') {
                const existing = await col.findOne({ email });
                if (existing) return res.status(400).json({ error: "User already exists" });
                const newUser = { email, password, name, isAdmin: email.includes('admin@soulvision.com') };
                await col.insertOne(newUser);
                return res.status(201).json(newUser);
            } else {
                const user = await col.findOne({ email, password });
                if (!user) return res.status(401).json({ error: "Invalid credentials" });
                return res.status(200).json(user);
            }
        }

        if (query.route === 'notes') {
            const col = db.collection('notes');
            if (method === 'GET') {
                const notes = await col.find({ userId: query.userId }).sort({id: -1}).toArray();
                return res.status(200).json(notes);
            }
            if (method === 'POST') {
                await col.insertOne(body);
                return res.status(201).json({ success: true });
            }
            if (method === 'DELETE') {
                await col.deleteOne({ id: parseInt(query.id) });
                return res.status(200).json({ success: true });
            }
            if (method === 'PATCH') {
                await col.updateOne({ id: parseInt(query.id) }, { $set: { text: body.text } });
                return res.status(200).json({ success: true });
            }
        }

        if (query.route === 'admin_config') {
            const col = db.collection('config');
            if (method === 'GET') {
                const config = await col.findOne({ type: 'ai_settings' });
                return res.status(200).json(config);
            }
            if (method === 'POST') {
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

        // Persistence for AI, Cricket, Fun, Random
        if (['ai_conversations', 'cricket_history', 'cricket_setup', 'fun_stats', 'random_history'].includes(query.route)) {
            const col = db.collection(query.route);
            const userId = query.userId;

            if (method === 'GET') {
                if (!userId) return res.status(400).json({ error: "UserId required" });
                const data = await col.find({ userId }).sort({ timestamp: -1 }).toArray();
                return res.status(200).json(data);
            }
            if (method === 'POST') {
                const doc = { ...body, userId, timestamp: Date.now() };
                await col.insertOne(doc);
                return res.status(201).json({ success: true });
            }
            if (method === 'PUT') {
                const { id, ...updateData } = body;
                await col.updateOne({ id: id, userId }, { $set: updateData }, { upsert: true });
                return res.status(200).json({ success: true });
            }
            if (method === 'DELETE') {
                if (query.id) {
                    await col.deleteOne({ userId, id: parseInt(query.id) });
                } else {
                    await col.deleteMany({ userId });
                }
                return res.status(200).json({ success: true });
            }
        }

        res.status(404).json({ error: "Route not found" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}