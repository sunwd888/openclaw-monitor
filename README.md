# 🦞 OpenClaw Monitor

OpenClaw Monitor 是一款为 [OpenClaw](https://github.com/openclaw/openclaw) 量身打造的实时 Web 监控面板。它提供了直观的界面来追踪 Agent 活动、模型通讯、Token 使用量以及系统性能，并具备智能自愈功能。

## ✨ 特性

- **📊 实时性能监控**：追踪平均响应时间、Token 速率、总请求数和错误计数。
- **📝 增强型日志系统**：
  - 实时滚动日志流。
  - 强大的过滤功能（按级别：INFO/WARN/ERROR；按类型：Agent/工具/浏览器/Telegram）。
  - 全文搜索与日志导出 (JSON)。
- **💬 模型通讯追踪**：实时显示用户与模型之间的对话内容。
- **📊 会话状态**：详细显示当前的 Token 消耗（输入/输出分解）及上下文窗口占用率。
- **🛡️ 智能自愈 (Watchdog)**：自动检测严重的网络挂死（如 Telegram API 故障）并尝试自动重启恢复。
- **🚀 一键控制**：支持直观的模型切换和系统全重启。

## 🚀 快速开始

### 1. 克隆/下载本仓库
```bash
git clone https://github.com/YourUsername/openclaw-monitor.git
cd openclaw-monitor
```

### 2. 安装依赖
```bash
npm install
```

### 3. 启动监控
```bash
npm start
```

### ⚙️ 高级配置 (环境变量)

您可以直接在项目根目录下创建一个 `.env` 文件来管理配置（参考 `.env.example`）：

```env
PORT=18790
OPENCLAW_HOME=/your/custom/path
LOG_DIR=/your/log/path
```

或者在启动时通过命令行指定变量：

| 变量 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `PORT` | 监控面板端口 | `18790` |
| `OPENCLAW_HOME` | OpenClaw 配置文件目录 | `~/.openclaw` |
| `LOG_DIR` | 日志存储目录 | `/tmp/openclaw` |

**示例：**
```bash
OPENCLAW_HOME=/path/to/custom/.openclaw LOG_DIR=/var/log/openclaw npm start
```

启动后，访问 [http://127.0.0.1:18790](http://127.0.0.1:18790) 即可开始监控。

## 📂 文件结构

- `index.html`：极简且功能强大的单页前端，使用 Vanilla CSS 和 JS。
- `server.js`：轻量级 Node.js 后端，利用 WebSocket 提供实时数据。
- `package.json`：项目元数据及依赖。

## 🔒 隐私与安全

本项遵循**代码与配置分离**原则：
- **API Keys**：监控程序仅修改本地 `~/.openclaw/openclaw.json` 的模型选择，**绝不会读取或泄露**您的 API Keys、Token 或代理等敏感信息。
- **分享提示**：如果您想将监控面板分享给他人，只需分享本仓库代码即可，**请勿分享您的 `~/.openclaw` 文件夹**。

## 📄 开源协议

本项目采用 [MIT](LICENSE) 协议。
