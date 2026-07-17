# 墨笔 🖋️

<div align="center">

![Python](https://img.shields.io/badge/python-3.10+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.109.0-green.svg)
![React](https://img.shields.io/badge/react-18.3.1-blue.svg)
![License](https://img.shields.io/badge/license-GPL%20v3-blue.svg)

**基于 AI 的智能小说创作助手**

[特性](#-特性) • [快速开始](#-快速开始) • [配置说明](#%EF%B8%8F-配置说明) • [项目结构](#-项目结构)

</div>

---

## ✨ 特性

- 🤖 **多 AI 模型** - 支持 OpenAI、Gemini、Claude 等主流模型
- 📝 **智能向导** - AI 自动生成大纲、角色和世界观
- 👥 **角色管理** - 人物关系、组织架构可视化管理
- 📖 **章节编辑** - 支持创建、编辑、重新生成和润色
- 🌐 **世界观设定** - 构建完整的故事背景
- 🔐 **多种登录** - 本地账户、LinuxDO OAuth、邮箱认证
- 💾 **PostgreSQL** - 生产级数据库,多用户数据隔离
- 🎨 **暗黑玻璃态** - 现代化暗黑主题界面,支持明暗切换
- 🛡️ **质量闭环** - 章节分析反馈到下次生成,AI 去味,默认启用写作 Skill
- 🐳 **Docker 部署** - 一键启动,开箱即用

## 💻 硬件配置要求

| 组件 | 最低配置 | 推荐配置 |
|------|---------|---------|
| **CPU** | 2 核 | 4 核 |
| **内存** | 2 GB RAM | 8 GB RAM |
| **存储** | 10 GB | 20 GB SSD |
| **网络** | 稳定互联网连接(调用 AI API) | 同左 |

> 本项目依赖外部 AI API(OpenAI/Claude/Gemini),不需要本地 GPU。Embedding 模型约 400 MB,运行时加载到内存。

## 🚀 快速开始

### Windows 一键启动(推荐)

双击项目根目录的 `start.bat` 即可:

- 自动检查 Python / Node.js 环境
- 自动复制 `.env`(若不存在)
- 自动安装前端依赖(若 `node_modules` 缺失)
- 启动后端(FastAPI,:8000)和前端(Vite,:5173)
- 自动打开浏览器到 http://localhost:5173

本地账号:`admin` / `admin123`

### 从源码构建

#### 前置准备

- Python 3.10+
- Node.js 16+
- PostgreSQL 18(或使用 Docker)
- 至少一个 AI 服务的 API Key(OpenAI/Gemini/Claude)
- Embedding 模型 `paraphrase-multilingual-MiniLM-L12-v2`(约 120 MB,首次启动自动下载;Windows 下若下载失败见 [backend/app/services/memory_service.py](backend/app/services/memory_service.py) 的本地目录加载逻辑)

#### 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 配置 .env
cp .env.example .env
# 编辑 .env 填入 DATABASE_URL、AI API Key 等

# 启动 PostgreSQL(可使用 Docker)
docker run -d --name postgres \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=mumuai_novel \
  -p 5432:5432 \
  postgres:18-alpine

# 执行数据库迁移
python -m alembic -c alembic-postgres.ini upgrade head

# 启动后端
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### 前端

```bash
cd frontend
npm install
npm run dev    # 开发模式,http://localhost:5173
npm run build  # 生产构建
```

### Docker Compose 部署

```bash
# 1. 配置环境变量
cp backend/.env.example .env
# 编辑 .env 填入必要配置

# 2. 启动服务
docker-compose up -d

# 3. 访问应用
# http://localhost:8000
```

## ⚙️ 配置说明

### 必需配置(`.env`)

```bash
# PostgreSQL 数据库
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/mumuai_novel

# AI 服务
OPENAI_API_KEY=your_openai_key
OPENAI_BASE_URL=https://api.openai.com/v1
DEFAULT_AI_PROVIDER=openai
DEFAULT_MODEL=gpt-4o-mini

# 本地账户登录
LOCAL_AUTH_ENABLED=true
LOCAL_AUTH_USERNAME=admin
LOCAL_AUTH_PASSWORD=admin123
```

### 可选配置

```bash
# LinuxDO OAuth
LINUXDO_CLIENT_ID=your_client_id
LINUXDO_CLIENT_SECRET=your_client_secret
LINUXDO_REDIRECT_URI=http://localhost:8000/api/auth/linuxdo/callback
# LinuxDO 专用代理(可选,仅影响 OAuth token 请求)
LINUXDO_PROXY_URL=http://127.0.0.1:7890

# 邮箱认证
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=your_email@example.com
SMTP_PASSWORD=your_smtp_password

# PostgreSQL 连接池(高并发优化)
DATABASE_POOL_SIZE=30
DATABASE_MAX_OVERFLOW=20

# 会话 Cookie Secure 标记
# HTTPS 部署保持 true;HTTP 访问若登录 Cookie 不保存则设为 false
SESSION_COOKIE_SECURE=true
```

> **中转 API**:支持所有 OpenAI 兼容格式的中转服务,只需修改 `OPENAI_BASE_URL`。

## 📁 项目结构

```
墨笔/
├── backend/                 # 后端服务
│   ├── app/
│   │   ├── api/            # API 路由
│   │   ├── models/         # 数据模型
│   │   ├── services/       # 业务逻辑
│   │   │   ├── ai_clients/     # AI 客户端封装
│   │   │   ├── cover_providers/# 封面生成
│   │   │   ├── chapter_context_service.py  # 章节上下文构建
│   │   │   ├── plot_analyzer.py            # 章节质量分析
│   │   │   ├── prompt_service.py           # 提示词模板
│   │   │   └── memory_service.py           # 向量记忆检索
│   │   ├── skills/         # 写作技能(Skill)
│   │   │   ├── story-long-write/   # 长篇写作
│   │   │   ├── story-short-write/  # 短篇写作
│   │   │   ├── story-deslop/       # AI 去味
│   │   │   └── story-full-review/  # 全文审校
│   │   ├── middleware/     # 中间件
│   │   ├── database.py     # 数据库连接
│   │   └── main.py         # 应用入口
│   ├── alembic/            # 数据库迁移
│   ├── scripts/            # 工具脚本
│   └── requirements.txt
├── frontend/               # 前端应用
│   ├── src/
│   │   ├── pages/         # 页面组件
│   │   ├── components/    # 通用组件
│   │   ├── services/      # API 服务
│   │   ├── store/         # 状态管理(Zustand)
│   │   └── theme/         # 主题(暗黑玻璃态)
│   └── package.json
├── start.bat              # Windows 一键启动
├── docker-compose.yml     # Docker Compose 配置
├── Dockerfile             # Docker 镜像构建
└── README.md
```

## 🛠️ 技术栈

**后端**:FastAPI • PostgreSQL • SQLAlchemy 2.0 • asyncpg • ChromaDB • sentence-transformers • OpenAI/Claude/Gemini SDK

**前端**:React 18 • TypeScript • Ant Design 5 • Zustand • Vite • react-router-dom

## 📖 使用指南

1. **登录** - 使用本地账户(`admin`/`admin123`)、LinuxDO OAuth 或邮箱认证
2. **创建项目** - 选择"使用向导创建",输入基本信息
3. **AI 生成** - AI 自动生成大纲、角色和世界观
4. **编辑完善** - 管理角色关系,生成和编辑章节
5. **质量分析** - 章节生成后自动分析,反馈到下一章续写

### API 文档

- Swagger UI:`http://localhost:8000/docs`
- ReDoc:`http://localhost:8000/redoc`

## 🤝 贡献

欢迎提交 Issue 和 Pull Request!

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

## 📝 许可证

本项目采用 [GNU General Public License v3.0](LICENSE)

**GPL v3 意味着:**
- ✅ 可自由使用、修改和分发
- ✅ 可用于商业目的
- 📝 必须开源修改版本
- 📝 必须保留原作者版权
- 📝 衍生作品必须使用 GPL v3 协议

## 🙏 致谢

本项目基于 [MuMuAINovel](https://github.com/xiamuceer-j/MuMuAINovel) 二次开发,感谢原作者的开源贡献。

- [FastAPI](https://fastapi.tiangolo.com/) - Python Web 框架
- [React](https://react.dev/) - 前端框架
- [Ant Design](https://ant.design/) - UI 组件库
- [PostgreSQL](https://www.postgresql.org/) - 数据库
- [ChromaDB](https://www.trychroma.com/) - 向量数据库
- [sentence-transformers](https://www.sbert.net/) - Embedding 模型

---

<div align="center">

**如果这个项目对你有帮助,请给个 ⭐️ Star!**

</div>
