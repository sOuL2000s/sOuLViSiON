const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

export default async function handler(req, res) {
    const { method, body, query } = req;
    
    try {
        await client.connect();
        const db = client.db('soulvision');
        
        // Basic Route Handler
        if (query.route === 'notes') {
            const col = db.collection('notes');
            if (method === 'GET') {
                const notes = await col.find({ userId: query.userId }).toArray();
                return res.status(200).json(notes);
            }
            if (method === 'POST') {
                await col.insertOne(body);
                return res.status(201).json({ success: true });
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

        res.status(404).json({ error: "Route not found" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}