const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// Simple .env parser
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
                const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
                process.env[key.trim()] = value;
            }
        });
    }
}
loadEnv();

const PORT = process.env.PORT || 18790;
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(process.env.HOME, '.openclaw');
const LOG_DIR = process.env.LOG_DIR || '/tmp/openclaw';
const SESSION_FILE = path.join(OPENCLAW_HOME, 'agents/main/sessions/sessions.json');

// Get today's log file
function getLogFile() {
    const today = new Date().toISOString().split('T')[0];
    return path.join(LOG_DIR, `openclaw-${today}.log`);
}

// Event labels in Chinese
const EVENT_LABELS = {
    'embedded run agent start': '🚀 Agent 开始运行',
    'embedded run agent end': '✅ Agent 运行结束',
    'embedded run prompt start': '📝 发送提示词',
    'embedded run tool start': '🔧 开始执行工具',
    'embedded run tool end': '✅ 工具执行完成',
    'lane enqueue': '📥 任务入队',
    'lane dequeue': '📤 任务出队',
    'session state': '📊 会话状态变更',
    'run registered': '📋 运行已注册',
    'compaction': '🗜️ 上下文压缩',
    'browser': '🌐 浏览器操作',
    'web_fetch': '🔗 网页抓取',
    'exec': '⚡ 执行命令',
    'gateway': '🌉 网关',
    'error': '❌ 错误',
    'failed': '❌ 失败',
    'telegram': '📨 Telegram'
};

// Get Chinese label for a message
function getEventLabel(message) {
    const lowerMsg = message.toLowerCase();
    for (const [key, label] of Object.entries(EVENT_LABELS)) {
        if (lowerMsg.includes(key.toLowerCase())) {
            return label;
        }
    }
    return '📋 日志';
}

// Parse a log line into structured data
function parseLogLine(line) {
    try {
        // Try to parse as JSON (OpenClaw logs are JSON)
        const data = JSON.parse(line);
        const message = data['1'] || JSON.stringify(data).substring(0, 200);
        const subsystem = typeof data['0'] === 'string' ?
            (data['0'].includes('subsystem') ? JSON.parse(data['0']).subsystem : data['0']) :
            'unknown';
        return {
            time: data.time || data._meta?.date || new Date().toISOString(),
            level: data._meta?.logLevelName || 'INFO',
            subsystem: subsystem,
            label: getEventLabel(message),
            message: message,
            raw: line
        };
    } catch {
        // Plain text log
        return {
            time: new Date().toISOString(),
            level: 'INFO',
            subsystem: 'system',
            label: getEventLabel(line),
            message: line.substring(0, 200),
            raw: line
        };
    }
}

// Read session info
function getSessionInfo() {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
            // sessions.json is an object with session keys as properties
            const sessions = [];
            for (const [key, session] of Object.entries(data)) {
                if (typeof session === 'object' && session.sessionId) {
                    sessions.push({
                        key: key,
                        sessionId: session.sessionId,
                        updatedAt: session.updatedAt,
                        model: session.model || 'unknown',
                        inputTokens: session.inputTokens || 0,
                        outputTokens: session.outputTokens || 0,
                        totalTokens: session.totalTokens || 0,
                        contextTokens: session.contextTokens || session.contextWindow || 128000,
                        compactionCount: session.compactionCount || 0
                    });
                }
            }
            return { sessions };
        }
    } catch (e) {
        console.error('Error reading session:', e.message);
    }
    return { sessions: [] };
}

// Get the latest session file
function getLatestSessionFile() {
    const sessionsDir = path.join(OPENCLAW_HOME, 'agents/main/sessions');
    try {
        const files = fs.readdirSync(sessionsDir)
            .filter(f => f.endsWith('.jsonl') && !f.includes('deleted') && !f.includes('lock'))
            .map(f => ({
                name: f,
                path: path.join(sessionsDir, f),
                mtime: fs.statSync(path.join(sessionsDir, f)).mtime
            }))
            .sort((a, b) => b.mtime - a.mtime);
        return files[0]?.path || null;
    } catch {
        return null;
    }
}

// Read model communication messages from session file
function getMessages() {
    const sessionFile = getLatestSessionFile();
    if (!sessionFile) return { messages: [] };

    try {
        const content = fs.readFileSync(sessionFile, 'utf8');
        const lines = content.trim().split('\n');
        const messages = [];

        for (const line of lines.slice(-100)) { // Last 100 entries
            try {
                const data = JSON.parse(line);
                if (data.type === 'message' && data.message) {
                    const msg = data.message;
                    let textContent = '';

                    if (Array.isArray(msg.content)) {
                        for (const item of msg.content) {
                            if (item.type === 'text') {
                                textContent += item.text;
                            } else if (item.type === 'tool_use') {
                                textContent += `[工具调用: ${item.name}]`;
                            } else if (item.type === 'tool_result') {
                                textContent += `[工具返回]`;
                            }
                        }
                    } else if (typeof msg.content === 'string') {
                        textContent = msg.content;
                    }

                    messages.push({
                        id: data.id,
                        time: data.timestamp,
                        role: msg.role,
                        content: textContent.substring(0, 500),
                        fullContent: textContent
                    });
                }
            } catch { }
        }

        return { messages: messages.slice(-20) }; // Return last 20 messages
    } catch (e) {
        console.error('Error reading messages:', e.message);
        return { messages: [] };
    }
}

// Get all available models from openclaw.json
function getAvailableModels() {
    const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const models = [];

        // Extract models from all providers
        if (config.models && config.models.providers) {
            for (const [providerName, provider] of Object.entries(config.models.providers)) {
                if (provider.models && Array.isArray(provider.models)) {
                    for (const model of provider.models) {
                        models.push({
                            id: `${providerName}/${model.id}`,
                            name: model.name || model.id,
                            provider: providerName,
                            contextWindow: model.contextWindow,
                            maxTokens: model.maxTokens
                        });
                    }
                }
            }
        }

        // Get current primary model
        const primaryModel = config.agents?.defaults?.model?.primary || 'unknown';

        return { models, currentPrimary: primaryModel };
    } catch (e) {
        console.error('Error reading models:', e.message);
        return { models: [], currentPrimary: 'unknown' };
    }
}

// Watchdog for self-healing
const Watchdog = {
    errorCounts: {},
    lastRestart: 0,
    COOLDOWN: 5 * 60 * 1000, // 5 minutes
    THRESHOLD: 5,
    patterns: [
        { id: 'telegram_fail', text: "Network request for", label: 'Telegram 通讯故障' },
        { id: 'chrome_ext_fail', text: "Chrome extension relay is running, but no tab is connected", label: '浏览器扩展未连接' }
    ],

    check(log) {
        if (!log || !log.message) return;

        const now = Date.now();
        if (now - this.lastRestart < this.COOLDOWN) return;

        for (const pattern of this.patterns) {
            if (log.message.includes(pattern.text)) {
                this.errorCounts[pattern.id] = (this.errorCounts[pattern.id] || 0) + 1;
                console.log(`[Watchdog] Detected ${pattern.label} (${this.errorCounts[pattern.id]}/${this.THRESHOLD})`);

                if (this.errorCounts[pattern.id] >= this.THRESHOLD) {
                    this.triggerRestart(`检测到持续错误: ${pattern.label}`);
                }
            }
        }
    },

    triggerRestart(reason) {
        const now = Date.now();
        if (now - this.lastRestart < this.COOLDOWN) return;

        console.log(`\x1b[31m[Watchdog] TRIGGERING RESTART: ${reason}\x1b[0m`);
        this.lastRestart = now;
        this.errorCounts = {}; // Reset counts

        // Broadcast to all clients
        wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(JSON.stringify({
                    type: 'notification',
                    data: { title: '🚀 系统自愈中', message: reason, level: 'WARN' }
                }));
            }
        });

        // Use the same restart logic as model switch
        const { exec } = require('child_process');
        const uid = process.getuid();
        const restartCmd = `launchctl bootout gui/${uid}/ai.openclaw.gateway 2>&1; sleep 2; pkill -9 -f openclaw-gateway 2>&1; sleep 1; openclaw gateway --force`;

        exec(restartCmd, (error) => {
            if (error) console.error('[Watchdog] Restart failed:', error);
            else console.log('[Watchdog] Restart command executed');
        });
    }
};

// Switch the primary model in openclaw.json
function switchPrimaryModel(newModelId) {
    const configPath = path.join(OPENCLAW_HOME, 'openclaw.json');
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        if (!config.agents.defaults.model) config.agents.defaults.model = {};

        const oldModel = config.agents.defaults.model.primary;
        config.agents.defaults.model.primary = newModelId;

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

        console.log(`Model switched: ${oldModel} -> ${newModelId}`);

        // Set last restart to now to avoid double restart if watchdog triggers right after
        Watchdog.lastRestart = Date.now();
        Watchdog.triggerRestart(`模型切换: ${newModelId}`);

        return { success: true, oldModel, newModel: newModelId, restarted: true };
    } catch (e) {
        console.error('Error switching model:', e.message);
        return { success: false, error: e.message };
    }
}

// HTTP server for static files
// HTTP server for static files
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    } else if (req.url === '/api/session') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getSessionInfo()));
    } else if (req.url === '/api/messages') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getMessages()));
    } else if (req.url === '/api/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getAvailableModels()));
    } else if (req.url === '/api/model/switch' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { modelId } = JSON.parse(body);
                const result = switchPrimaryModel(modelId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
    } else if (req.url === '/api/system/restart' && req.method === 'POST') {
        Watchdog.triggerRestart('用户手动请求重启');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Restart triggered' }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// WebSocket server for live logs
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');

    // Send initial session info
    ws.send(JSON.stringify({ type: 'session', data: getSessionInfo() }));

    // Send initial messages
    ws.send(JSON.stringify({ type: 'messages', data: getMessages() }));

    // Watch log file
    const logFile = getLogFile();
    let lastSize = 0;

    // Initial read of last 50 lines
    if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n').slice(-50);
        lines.forEach(line => {
            if (line.trim()) {
                ws.send(JSON.stringify({ type: 'log', data: parseLogLine(line) }));
            }
        });
        lastSize = fs.statSync(logFile).size;
    }

    // Watch for new log entries
    const interval = setInterval(() => {
        try {
            if (!fs.existsSync(logFile)) return;

            const stat = fs.statSync(logFile);
            if (stat.size > lastSize) {
                const fd = fs.openSync(logFile, 'r');
                const buffer = Buffer.alloc(stat.size - lastSize);
                fs.readSync(fd, buffer, 0, buffer.length, lastSize);
                fs.closeSync(fd);

                const newContent = buffer.toString('utf8');
                const lines = newContent.trim().split('\n');
                lines.forEach(line => {
                    if (line.trim()) {
                        const parsedLog = parseLogLine(line);
                        ws.send(JSON.stringify({ type: 'log', data: parsedLog }));

                        // Check for errors to self-heal
                        Watchdog.check(parsedLog);
                    }
                });

                lastSize = stat.size;
            }

            // Also send session updates
            ws.send(JSON.stringify({ type: 'session', data: getSessionInfo() }));
        } catch (e) {
            console.error('Watch error:', e.message);
        }
    }, 1000);

    ws.on('close', () => {
        console.log('Client disconnected');
        clearInterval(interval);
    });
});

server.listen(PORT, () => {
    console.log(`🦞 OpenClaw Monitor running at http://127.0.0.1:${PORT}`);
    console.log(`   Watching logs at: ${getLogFile()}`);
});
