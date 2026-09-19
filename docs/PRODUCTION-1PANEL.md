# ToMeBoutique · 1Panel 当前生产运行与升级维护记录

> 用途：给后续 ChatGPT / Codex / WorkBuddy / 其他运维 Agent 直接读取，快速理解当前 ToMe 线上部署事实，避免重复摸索或误操作。
> 当前记录时间：2026-09-20
> 当前生产域名：`https://tome.23cc.cn`

本文是指定生产环境的**时间点运行记录**；通用部署、迁移、备份和上线门禁仍以 [PRODUCTION](PRODUCTION.md) 为准，当前源码事实以 [CURRENT-RELEASE](CURRENT-RELEASE.md) 为准。发生冲突时，不得用本文较旧的版本号、SHA 或运行状态覆盖目标版本自己的发布与迁移说明。

健康接口、容器状态和版本可由后续操作者重新检查；业务 UAT、异机备份、恢复评审、防火墙和告警送达等人工事实，必须以生产配置目录中的对应证据为准，不能仅凭本文文字改写批准状态。

---

## 1. 当前生产基线

| 项目 | 当前事实 |
|---|---|
| GitHub 仓库 | `BA7IEE/tome-workbench` |
| 核对时 `origin/main` SHA | `f203fac9105e5a66a650a740b57d291ac1ef14c2` |
| 当前生产部署源码 SHA | `f203fac9105e5a66a650a740b57d291ac1ef14c2` |
| 当前线上版本 | `1.1.0-rc.8` |
| rc.8 合并 PR | `#39` |
| rc.8 main CI | `35440676922`，已成功 |
| 1Panel | `2.3.1` |
| Docker | `27.0.3` |
| Docker Compose | `v2.28.1` |
| Node.js | `v22.23.2` |
| npm | `10.9.8` |
| Git | `2.34.1` |
| 服务器源码目录 | `/opt/tome/tome-workbench` |
| Compose project | `tome-production` |
| 部署模式 | `EXTERNAL_REVERSE_PROXY` |
| Reverse Proxy Provider | `1PANEL` |
| 公网入口 | 1Panel / OpenResty |
| 正式域名 | `https://tome.23cc.cn` |

截至 2026-09-20 的核对时点，`origin/main`、生产部署源码和线上运行版本一致，`package.json` 为：

```text
1.1.0-rc.8
```

---

## 2. 当前架构

```text
Internet
   │
   │ 80 / 443
   ▼
1Panel 2.3.1
OpenResty
   │
   │ 负载均衡：tome_backend
   ├──────────────► 127.0.0.1:14318
   │                    │
   │                    ▼
   │              tome-production-api-a-1
   │
   └──────────────► 127.0.0.1:14319
                        │
                        ▼
                  tome-production-api-b-1

         api-a / api-b
               │
               ▼
         PostgreSQL 16
      tome-production-postgres-1

       worker-a / worker-b
               │
               └── 使用同一 PostgreSQL
```

### 常驻容器

```text
tome-production-postgres-1
tome-production-api-a-1
tome-production-api-b-1
tome-production-worker-a-1
tome-production-worker-b-1
```

正常情况下不应常驻：

```text
migration
proxy
```

原因：

- `migration` 属于 `tools` profile，只在维护时临时运行。
- `proxy` 属于 `internal-proxy` profile。
- 当前生产明确使用 `EXTERNAL_REVERSE_PROXY + 1PANEL`，所以项目内置 Caddy **不得常驻**。

---

## 3. 当前端口边界

### ToMe 对宿主机的端口

```text
API-A  127.0.0.1:14318 -> 4318/tcp
API-B  127.0.0.1:14319 -> 4318/tcp
```

两个 API **只能绑定到 `127.0.0.1`**。

PostgreSQL：

```text
5432/tcp
```

仅 Docker 内部使用，没有宿主机公网映射。

两个 Worker：

```text
4318/tcp
```

没有宿主机映射。

### OpenResty

公网网站入口：

```text
80/tcp
443/tcp
```

ToMe 自身不得直接公开：

```text
14318
14319
5432
```

---

## 4. 1Panel 当前配置

### 4.1 容器 → 编排

Compose project：

```text
tome-production
```

Compose 文件：

```text
/opt/tome/tome-workbench/compose.production.yaml
```

1Panel 会根据 Docker Compose labels 自动识别该项目。

不要再创建第二个同名/重复 ToMe 编排。

### 4.2 环境变量

正式环境变量源文件：

```text
/opt/tome/tome-workbench/data/production/compose.env
```

1Panel 编排界面同时维护项目根目录：

```text
/opt/tome/tome-workbench/.env
```

当前两边都应至少保持：

```text
TOME_IMAGE_TAG=1.1.0-rc.8
TOME_DEPLOYMENT_MODE=EXTERNAL_REVERSE_PROXY
TOME_API_BIND=127.0.0.1
TOME_API_A_PORT=14318
TOME_API_B_PORT=14319
TOME_BIND=127.0.0.1
```

> 后续升级时，`data/production/compose.env` 与根目录 `.env` 的 `TOME_IMAGE_TAG` 必须同步。

---

## 5. 1Panel 网站 / OpenResty 配置

网站：

```text
tome.23cc.cn
```

网站类型：

```text
反向代理
```

负载均衡名称：

```text
tome_backend
```

Upstream：

```text
127.0.0.1:14318   权重 1
127.0.0.1:14319   权重 1
```

反向代理目标：

```text
http://tome_backend
```

### HTTPS

当前已经：

- HTTPS 正常
- HTTP/2 正常
- HTTP 自动跳转 HTTPS
- `/api/system/health` 返回 200
- `/api/system/ready` 返回 200

当前验证：

```bash
curl -fsS https://tome.23cc.cn/api/system/health
```

应返回：

```json
{"status":"up","version":"1.1.0-rc.8"}
```

```bash
curl -fsS https://tome.23cc.cn/api/system/ready
```

应返回：

```json
{"status":"ready","database":"up","storage":"accessible"}
```

---

## 6. 生产配置目录

正式配置目录：

```text
/opt/tome/tome-workbench/data/production
```

关键文件：

```text
compose.env
configuration.json
api.env
migration.env
proxy.env
owner-password.txt
app-password.txt
operations-approval.json
evidence/
backups/
```

### 严禁泄露

以下内容不要发到聊天、Issue、日志、截图或 Git：

```text
owner-password.txt
app-password.txt
api.env
migration.env
任何 Token / Cookie / 密码
```

### 严禁重新生成正式配置

现网已经存在：

```text
data/production
```

后续升级**不要再次执行**：

```bash
node scripts/production-config.mjs ...
```

因为生产配置包含现有随机密码与环境事实。

---

## 7. PostgreSQL 当前事实

数据库：

```text
tome_production
```

Owner / migration role：

```text
tome_owner
```

Runtime role：

```text
tome_app
```

`api-a / api-b / worker-a / worker-b` 使用 `tome_app`。

数据库不对宿主机公网发布端口。

---

## 8. rc.7 首次部署故障与 rc.8 修复

### 8.1 rc.7 实际发生过的问题

rc.7 在这台真实 1Panel 空服务器首次初始化时：

1. PostgreSQL 正常启动。
2. 18 个 Prisma migration 全部成功。
3. 但 `tome_app` 运行角色没有存在。
4. 导致 API-A、API-B、Worker-A、Worker-B 首次启动全部失败。
5. 实际错误：

```text
password authentication failed for user "tome_app"
```

继续检查发现：

```text
ERROR: role "tome_app" does not exist
```

当时人工创建 `tome_app`、同步密码并补齐最小表/序列权限后，系统恢复正常。

### 8.2 rc.8 已修复

PR #39 修复了这个生产初始化缺口。

rc.8 production migration 现在会显式：

- 创建或同步 `tome_app`
- 同步生产密码
- 强制 `NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOREPLICATION / NOBYPASSRLS`
- 设置 statement / lock / idle transaction timeout
- 设置 schema/default privileges
- migration 后补齐既有 table / sequence 权限
- 使用 `tome_app` 真实连接做运行权限验证

CI 新增：

```text
npm run test:production-bootstrap
```

它会从：

```text
tome_app 不存在
+ 新空生产数据库
```

开始跑正式 `--production --initial-empty` migration。

rc.8 PR 与 main CI 均已通过。

---

## 9. 当前运行状态验证

当前线上已确认：

```text
api-a      1.1.0-rc.8 healthy
api-b      1.1.0-rc.8 healthy
worker-a   1.1.0-rc.8 healthy
worker-b   1.1.0-rc.8 healthy
postgres   healthy
```

检查命令：

```bash
cd /opt/tome/tome-workbench

docker compose \
  -p tome-production \
  -f compose.production.yaml \
  --env-file data/production/compose.env \
  ps
```

API 本机检查：

```bash
curl -fsS http://127.0.0.1:14318/api/system/health
echo
curl -fsS http://127.0.0.1:14319/api/system/health
echo
```

公网检查：

```bash
curl -fsS https://tome.23cc.cn/api/system/health
echo
curl -fsS https://tome.23cc.cn/api/system/ready
echo
```

---

## 10. 双 API 故障切换已实际验证

已真实执行：

```text
停 API-A -> tome.23cc.cn 仍正常
恢复 API-A -> healthy

停 API-B -> tome.23cc.cn 仍正常
恢复 API-B -> healthy
```

说明 1Panel/OpenResty 的 `tome_backend` 双节点负载均衡已经实际生效，而不是仅配置存在。

---

## 11. Production Preflight

执行：

```bash
cd /opt/tome/tome-workbench

node scripts/production-preflight.mjs \
  --config-dir=data/production \
  --project=tome-production
```

当前软件检查已经达到：

```text
softwareReady: true
```

当前仍未完成的运维门禁：

```text
offHostBackupVerified
recoveryDrillReviewed
domainAndFirewallReviewed
alertRecipientConfirmed
```

因此当前可能仍显示：

```text
publicReady: false
decision: NO_GO
```

这 **不代表 ToMe 软件运行失败**。

业务 UAT 已完成并记录，所以 `businessUat` 已不在 pending 列表中。

---

## 12. 后续升级 Agent 必须先做的检查

任何 Agent 在升级前必须先执行：

```bash
cd /opt/tome/tome-workbench

git status --short
git rev-parse HEAD
node -p "require('./package.json').version"

docker compose \
  -p tome-production \
  -f compose.production.yaml \
  --env-file data/production/compose.env \
  ps

curl -fsS https://tome.23cc.cn/api/system/health
echo
curl -fsS https://tome.23cc.cn/api/system/ready
echo
```

并确认：

1. 当前目录正确。
2. Git 工作区没有未知改动。
3. 当前版本与线上 runtime 一致。
4. 5 个常驻服务正常。
5. 公网 health / ready 正常。

这里的“一致”必须在每次维护前重新执行命令证明，不能从本文记录时间推断。

---

## 13. 标准升级流程

> 以下是通用框架。未来版本如果新增数据库 migration 或明确要求维护窗口，必须优先遵循该版本的 `docs/PRODUCTION.md`，不要机械套用滚动升级。

### 13.1 获取新源码

```bash
cd /opt/tome/tome-workbench

git fetch origin
git checkout <已通过 main CI 的固定 SHA>

git rev-parse HEAD
node -p "require('./package.json').version"
```

**不要直接把未验收的动态 `main` 当生产基线。**

应锁定：

```text
固定 SHA
+
对应版本
+
该 SHA 的 main CI success
```

### 13.2 不要重新生成 data/production

禁止：

```bash
rm -rf data/production
node scripts/production-config.mjs ...
```

已有生产密码与配置必须保留。

### 13.3 更新版本字段

更新：

```text
data/production/compose.env
```

中的：

```text
TOME_IMAGE_TAG=<新版本>
```

同步根目录 `.env` 的同一字段，并更新：

```text
data/production/configuration.json
```

中的：

```json
"appVersion": "<新版本>"
```

更新前建议备份：

```bash
cp data/production/compose.env data/production/compose.env.before-upgrade.bak
cp data/production/configuration.json data/production/configuration.json.before-upgrade.bak
```

### 13.4 构建新镜像

```bash
docker compose \
  -p tome-production \
  -f compose.production.yaml \
  --env-file data/production/compose.env \
  --profile tools \
  build api-a migration
```

检查：

```bash
docker images | grep tome-workbench
```

升级后暂时保留上一版本镜像作为短期回退保险。

---

## 14. 数据库 migration 升级规则

### 没有新增 migration

如果新版本没有新增数据库 migration，并且 release docs 明确允许 schema-compatible rolling update：

- 不运行 migration。
- 可以滚动更新 API / Worker。

### 有新增 migration

如果 `prisma/migrations/` 出现新 migration：

**不要自行运行 `--initial-empty`。**

`--initial-empty` 只允许首次新空库部署。

已有正式库必须按照该版本：

```text
docs/PRODUCTION.md
```

的 existing-production migration 流程执行。

通常涉及：

- 维护窗口
- 停止写入
- 正式备份
- `BACKUP_MANIFEST`
- 安全 migration
- 再启动应用

Agent 不得为了省事绕过生产 migration 门禁。

---

## 15. 无 migration 时的滚动升级方法

仅在确认版本 schema-compatible / 无新 migration 时使用。

### API-A

```bash
docker compose \
  -p tome-production \
  -f compose.production.yaml \
  --env-file data/production/compose.env \
  up -d --no-deps --force-recreate api-a
```

等待 `healthy`。

### API-B

```bash
docker compose \
  -p tome-production \
  -f compose.production.yaml \
  --env-file data/production/compose.env \
  up -d --no-deps --force-recreate api-b
```

必须 `healthy`。

### Worker

```bash
docker compose \
  -p tome-production \
  -f compose.production.yaml \
  --env-file data/production/compose.env \
  up -d --no-deps --force-recreate worker-a worker-b
```

然后完整检查 `docker compose ... ps`。

---

## 16. 升级完成后的强制验证

### 两个 API

```bash
curl -fsS http://127.0.0.1:14318/api/system/health
echo
curl -fsS http://127.0.0.1:14319/api/system/health
echo
```

两边版本必须相同。

### 公网

```bash
curl -fsS https://tome.23cc.cn/api/system/health
echo
curl -fsS https://tome.23cc.cn/api/system/ready
echo
```

### Preflight

```bash
node scripts/production-preflight.mjs \
  --config-dir=data/production \
  --project=tome-production
```

至少必须：

```text
softwareReady: true
```

---

## 17. 回退原则

如果只是应用版本问题，而且：

- 没有数据库 schema 变更；
- 老版本仍兼容当前数据库；

可以把 `TOME_IMAGE_TAG` 与 `configuration.json.appVersion` 切回上一版本，并滚动重建 API / Worker。

但如果升级涉及 migration：

**不要简单把镜像切回旧版本。**

必须先判断旧代码是否兼容新 schema。如不兼容，应优先向前修复，或基于明确恢复点做整体恢复。

---

## 18. 严禁操作

任何后续 Agent 都必须避免：

```bash
docker compose down -v
```

该命令可能删除生产 volume。

同样不要：

```bash
docker volume rm tome-production_tome_database
docker volume rm tome-production_tome_media
rm -rf data/production
```

不要为了“重新部署干净一点”而重建正式数据库。

不要对现有生产库执行：

```text
--initial-empty
```

不要启动项目 `internal-proxy / proxy`。

不要把 API 改成：

```text
0.0.0.0:14318
0.0.0.0:14319
```

---

## 19. 1Panel 操作原则

1Panel 是当前 ToMe 的运维入口，但生产事实仍由仓库与 Docker Compose 定义。

Agent 不应在 1Panel GUI 中随意：

- 改 Compose YAML 结构；
- 改数据库卷；
- 改 API 端口；
- 开启项目内置 Caddy；
- 新建第二套 ToMe 编排；
- 重新生成 production secrets。

1Panel 主要用于：

- 查看编排与容器状态；
- 查看日志；
- 管理 OpenResty 网站；
- 管理 HTTPS 证书；
- 管理 `tome_backend` 负载均衡；
- 必要的启停与观察。

涉及版本升级、migration、preflight，优先在：

```text
/opt/tome/tome-workbench
```

执行仓库正式命令。

---

## 20. 当前生产镜像保留策略

当前服务器至少存在：

```text
tome-workbench:1.1.0-rc.8
tome-workbench-migration:1.1.0-rc.8

tome-workbench:1.1.0-rc.7
tome-workbench-migration:1.1.0-rc.7
```

rc.7 暂时作为短期回退保险保留。

---

## 21. 当前业务验收状态

已验证：

- 管理员登录
- 修改初始管理员密码
- 工作台正常加载
- 新建 UAT 商品
- 商品库可见
- 编辑字段可保存
- 刷新后数据保持
- 图片 / 素材上传
- 库存 / 商品状态操作
- 商品分发读取
- 退出重新登录
- 数据持久化

UAT 证据目录：

```text
data/production/evidence/
```

初始管理员凭据文件已在修改密码后删除：

```text
/app/data/first-admin.txt
```

---

## 22. 故障快速诊断

### API / Worker 全部 Restarting

先检查：

```bash
docker compose \
  -p tome-production \
  -f compose.production.yaml \
  --env-file data/production/compose.env \
  ps -a
```

日志：

```bash
docker compose \
  -p tome-production \
  -f compose.production.yaml \
  --env-file data/production/compose.env \
  logs --tail=200 api-a api-b worker-a worker-b
```

数据库：

```bash
docker compose \
  -p tome-production \
  -f compose.production.yaml \
  --env-file data/production/compose.env \
  ps postgres
```

### 检查 runtime role

```bash
docker compose \
  -p tome-production \
  -f compose.production.yaml \
  --env-file data/production/compose.env \
  run --rm --no-deps \
  --entrypoint node \
  api-a \
  -e '
(async () => {
  try {
    const { runtime } = require("./scripts/runtime-lock.cjs");
    const release = await runtime("api");
    console.log("RUNTIME_LOCK_OK");
    await release();
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
'
```

rc.8 正常应输出：

```text
RUNTIME_LOCK_OK
```

---

## 23. 给后续 Agent 的最短上下文

```text
ToMeBoutique 正式生产运行在 1Panel 2.3.1。

仓库：BA7IEE/tome-workbench
生产目录：/opt/tome/tome-workbench
域名：https://tome.23cc.cn
Compose project：tome-production
部署模式：EXTERNAL_REVERSE_PROXY
provider=1PANEL

当前线上：1.1.0-rc.8
main SHA：f203fac9105e5a66a650a740b57d291ac1ef14c2

OpenResty 负载均衡：tome_backend
127.0.0.1:14318
127.0.0.1:14319

常驻服务：postgres / api-a / api-b / worker-a / worker-b

不要启动项目 internal proxy。
不要重建 data/production。
不要执行 docker compose down -v。
不要对已有正式库执行 --initial-empty。

生产配置：
data/production/compose.env
data/production/configuration.json

1Panel 同步 ENV：项目根目录 .env

升级前先检查 docs/PRODUCTION.md、是否新增 migration、目标 SHA 的 main CI。
无 migration 且 schema-compatible 时可滚动升级 API-A → API-B → workers。
有 migration 时必须按正式生产维护/备份流程执行。

升级后必须检查：
两个 API /health
公网 /health
公网 /ready
production-preflight softwareReady=true。
```

---

## 24. 当前结论

当前 ToMe 已经完成：

```text
源码 rc.8
↓
生产 Docker Compose
↓
PostgreSQL
↓
双 API
↓
双 Worker
↓
1Panel/OpenResty
↓
双节点负载均衡
↓
HTTPS
↓
tome.23cc.cn
```

软件运行层面已经通过正式 production preflight：

```text
softwareReady: true
```

后续 Agent 应在保持现有数据、Secrets、Volumes、域名和 1Panel 入口不变的前提下进行版本升级与维护。
