const express = require('express');
const axios = require('axios');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static('public'));

const MIMO_API_KEY = process.env.MIMO_API_KEY;
const MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';

// Conversation history per user
const conversations = new Map();

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    // Get or create conversation history
    if (!conversations.has(userId)) {
      conversations.set(userId, [{
        role: 'system',
        content: 'You are a helpful personal AI assistant. Help with tasks, scheduling, questions, and productivity. Be concise and actionable.'
      }]);
    }

    const history = conversations.get(userId);
    history.push({ role: 'user', content: message });

    // Call MiMo API
    const response = await axios.post(`${MIMO_BASE_URL}/chat/completions`, {
      model: 'mimo-v2-pro',
      messages: history,
      temperature: 0.7,
      max_tokens: 1000
    }, {
      headers: { 'Authorization': `Bearer ${MIMO_API_KEY}` }
    });

    const reply = response.data.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });

    // Keep only last 10 messages to manage context
    if (history.length > 21) {
      history.splice(1, 2);
    }

    res.json({ 
      success: true, 
      reply: reply,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Chat error:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
});

// Task management
const tasks = new Map();

app.post('/api/tasks', async (req, res) => {
  try {
    const { title, dueDate, priority, userId } = req.body;
    
    const taskId = Date.now().toString();
    const task = {
      id: taskId,
      title,
      dueDate,
      priority: priority || 'medium',
      userId,
      completed: false,
      createdAt: new Date().toISOString()
    };

    if (!tasks.has(userId)) {
      tasks.set(userId, []);
    }
    tasks.get(userId).push(task);

    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tasks', (req, res) => {
  const { userId } = req.query;
  const userTasks = tasks.get(userId) || [];
  res.json({ success: true, tasks: userTasks });
});

// Quick actions
app.post('/api/quick-action', async (req, res) => {
  try {
    const { action, params } = req.body;
    
    const actionPrompts = {
      'daily-briefing': 'Provide a brief daily briefing with: current time, weather summary, and 3 productivity tips.',
      'meeting-summary': `Summarize this meeting: ${params.notes}`,
      'email-draft': `Draft a professional email about: ${params.topic}`,
      'task-prioritize': `Help prioritize these tasks: ${params.tasks}`
    };

    const response = await axios.post(`${MIMO_BASE_URL}/chat/completions`, {
      model: 'mimo-v2-pro',
      messages: [{
        role: 'system',
        content: 'You are a helpful assistant providing quick, actionable responses.'
      }, {
        role: 'user',
        content: actionPrompts[action] || params.prompt
      }],
      temperature: 0.6,
      max_tokens: 800
    }, {
      headers: { 'Authorization': `Bearer ${MIMO_API_KEY}` }
    });

    res.json({ 
      success: true, 
      result: response.data.choices[0].message.content 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected');
  
  socket.on('message', async (data) => {
    try {
      const { message, userId } = data;
      
      // Process with MiMo
      const response = await axios.post(`${MIMO_BASE_URL}/chat/completions`, {
        model: 'mimo-v2-pro',
        messages: [{ role: 'user', content: message }],
        temperature: 0.7,
        max_tokens: 500
      }, {
        headers: { 'Authorization': `Bearer ${MIMO_API_KEY}` }
      });

      socket.emit('reply', {
        message: response.data.choices[0].message.content,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🤖 Personal AI Assistant running on http://localhost:${PORT}`);
  console.log(`📊 API endpoints:`);
  console.log(`   POST /api/chat           - Chat with assistant`);
  console.log(`   POST /api/tasks          - Create task`);
  console.log(`   GET  /api/tasks          - Get tasks`);
  console.log(`   POST /api/quick-action   - Quick actions`);
  console.log(`\n✨ Powered by Xiaomi MiMo API`);
});
