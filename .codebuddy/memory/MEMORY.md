# 长期记忆

## 部署环境（重要）
- 项目通过 Docker/1Panel 部署在远程服务器 `root@43.255.122.252`（SSH 免密，deploy.ps1 配置）
- 服务器项目路径：`/opt/1panel/apps/novel-assistant`
- 远程数据库为 **PostgreSQL 容器** `1Panel-postgresql-QDKg`，库名 `mumuai_novel`（.env 的 DATABASE_URL 指向它）
- 应用容器名 `novel-assistant`；向量记忆库位于容器内 `/app/data/chroma_db`
- 本地 SQLite（`data/ai_story.db`、`backend/data/ai_story.db`）为空壳，**真实数据在远程 PostgreSQL**
- 操作远程数据库：SSH 后用 `docker exec -i 1Panel-postgresql-QDKg psql ...`（注意必须加 `-i` 才能传入 heredoc/SQL）
- 操作远程应用逻辑：`docker exec novel-assistant python -c "..."`（可导入 app.services）

## 数据操作约定
- 清空章节内容需同步清理：plot_analysis、analysis_tasks、story_memories、分析来源伏笔（source_type='analysis'），并把章节 status 置 draft、项目 current_words 归零、清理向量库 collection（memory_service.delete_project_memories）

## 用户偏好
- 部署脚本：deploy.ps1（SSH 远程触发）、hot-deploy.sh、auto-update.sh
- 远程脚本文件放 /tmp 执行；本地临时脚本用完即删
