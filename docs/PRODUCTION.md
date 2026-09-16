# 生产部署与发布手册 · 1.1.0-rc.4

## 1. 本版可部署边界

目标是单工作空间的内部经营工作台。使用Docker运行两个API、两个Worker、Caddy HTTPS入口和独立PostgreSQL。Compose只提供单主机部署，不是跨机房容灾方案。公网启用之前，需要真实域名、独立服务器、访问防护、备份目的地及业务验收负责人。

系统不会自动登录交易平台、发帖、扣款、退款、调用付费AI或向合作方付款。对账确认是内部计算快照，不是认定某份协议已经签署或法律应付款。

## 2. 配置原则

`data/production`存放正式环境文件和随机密码，不得提交Git或放入交付包。不要复用开发配置。运行连接是`tome_app`，无超级用户、建库、建角色、复制和表所有者权限；迁移连接是`tome_owner`，只用于维护窗口。数据库和API端口不直接暴露到宿主机。

部署的默认监听为127.0.0.1；只有显式`--public`生成配置才监听所有网卡。第一次新建时完成以下配置（将域名改为实际值）：

```sh
node scripts/production-config.mjs --domain=inventory.your-company.com --public
```

版本唯一来源为 package.json.version；生成器据此写入 TOME_IMAGE_TAG 和 configuration.json.appVersion。Compose 缺少 tag 即失败，镜像构建校验 APP_VERSION 与 package 相同。升级已有配置时由运维明确更新这两个版本字段，不能重新生成并覆盖密码。

镜像会随源码带入只读的 `agent/skills/tome-ingest` 标准 Skill/Profile，使 `/api/agent-ingest/skill` 与 `/api/agent-ingest/profile` 可在运行时校验内容哈希；其中不应放入第三方账号、Cookie、Token 或 selector 私密资料。`tome-ingest` CLI 是交付包内的本地客户端，不需要也不应写入生产容器的会话凭据。

分发基础和运营动作都不包含任何真实平台连接器。AnQiCMS Spike 也只是受限分发会话可读取的本地资料合同，没有 HTTP 客户端、外部 endpoint 调用或凭据字段。若将来创建分发会话，Token 只在创建响应中显示一次，应由操作者用受控渠道交给执行环境；应用数据库和 Receipt 只保存哈希/是否签发，不保存 Token。不要把 Token、Cookie、密码或验证码写入 Channel 的端点字段、配置文件、日志、测试、镜像或数据库备注。

该命令不会覆盖已有目录或重置密码。配置生成后应备份密钥至受控位置，并检查`configuration.json`中的origin、域名和rehearsal状态。

## 3. 初次部署到空环境

以下命令都在源码根目录执行；首次部署前确认项目名与现有项目不冲突：

```sh
docker compose -p tome-production -f compose.production.yaml --env-file data/production/compose.env --profile tools build api-a migration
docker compose -p tome-production -f compose.production.yaml --env-file data/production/compose.env up -d --wait postgres
```

继续前先核对数据库确实为此项目新创建的空库，不能对有业务数据的库使用“初次空库”路径。

```sh
docker compose -p tome-production -f compose.production.yaml --env-file data/production/compose.env --profile tools run --rm -e TOME_DEPLOY_APPROVED=YES migration scripts/migrate-safe.mjs --production --initial-empty
docker compose -p tome-production -f compose.production.yaml --env-file data/production/compose.env up -d --wait api-a api-b worker-a worker-b proxy
docker compose -p tome-production -f compose.production.yaml --env-file data/production/compose.env run --rm --no-deps api-a dist/cli.js admin
```

最后一条交互式创建管理员。随机密码位于应用共享卷中的`/app/data/first-admin.txt`；由授权管理员在本机查看后首次登录修改，不粘贴到聊天、日志或工单。不要直接写数据库创建固定默认密码。

Caddy只有在域名解析和80/443访问符合条件时才能获得公认证书。localhost演练使用内部CA，正式配置不应填写`tls internal`。容器内自动安装的演练CA不会向Mac的系统信任库安装证书。

## 4. 上线检查

```sh
node scripts/production-preflight.mjs --config-dir=data/production --project=tome-production
```

它检查Compose配置、容器健康、非root只读运行、私有端口和真实TLS访问，并核对 package、配置、两个 API 实时版本、两个 API/Worker 镜像 OCI label 及 HTTPS 入口版本一致。它不会把localhost演练当成公网验证。默认仍返回NO_GO，直到授权运维人员独立核对下面几件事，并在配置目录保存`operations-approval.json`：

```json
{
  "businessUat": false,
  "offHostBackupVerified": false,
  "recoveryDrillReviewed": false,
  "domainAndFirewallReviewed": false,
  "alertRecipientConfirmed": false
}
```

这些字段是人工确认记录，不是自动审计证书。必须实际完成后才改为true。尤其不能只为让脚本变绿而跳过备份、告警或业务验收。代码验证报告不等于这台正式服务器已经通过所有检查。

## 5. 升级、备份和回退

本版采用受控维护窗口，不承诺数据库升级和前端静态资源更新零中断。提前构建新镜像、通知用户、停止写入，再停止两组API与Worker；确认所有CLI也退出。安全迁移使用数据库级独占维护锁，因此不同目录或不同容器里的运行实例也会阻止迁移。

正式库已有数据时，不允许`--initial-empty`。需要可恢复、同数据库、24小时内的备份清单，并向迁移容器设置`BACKUP_MANIFEST=/backups/对应路径/manifest.json`。迁移脚本会核对备份元数据与既有迁移文件校验；**元数据校验不能代替真正恢复演练**。数据库管理员应另外核验dump内容、原始素材、密钥和保存位置。

现有`backup.mjs`/`restore.mjs`针对本地开发拓扑，已执行全模型恢复演练。**本版尚未交付正式Compose拓扑的自动异地备份程序**；生产运维必须独立配置并验收数据库与素材卷的一致性备份和恢复方式。未完成之前不启用真实经营写入。不得把本地test库恢复通过当成正式库备份就绪。

升级时应用不自动执行迁移，也不自动重放外部交易。已应用migration不得修改；新增版本必须向前迁移。恢复只落入新库和新素材位置，核对商品身份、TM序列、历史快照、图片哈希后再批准切换；禁止原地覆盖未知数据。

回退前检查应用与schema兼容性。当前runtime要求migration清单与校验完全匹配，不能随意换回旧镜像；涉及schema差异应优先向前修复，或在明确恢复点上整体恢复。不要执行`docker compose down -v`，它会删除此项目持久卷。

## 6. 故障处置

API或Worker子进程异常退出时容器退出并由Docker重启；看门狗在连续健康检查失败后终止自己的子进程。单API恢复期间另一个API仍可提供服务，但故障窗口里的个别请求可能失败。网关不重放写请求；使用原幂等键核对和重试，避免重复成交。

Worker租约过期由其他Worker接续，超过失败预算进入FAILED待人工处理，不伪装成功。停机预留和失效素材重新读取时会再次核验。健康页面展示进程心跳、失败任务、待办下架和延迟；**未配置外部通知收件人，不代表已经接通告警服务**。

数据库或磁盘故障会使API不就绪或退出，不能继续依赖内存接受订单。本单机方案无法承受整机故障；正式要求多主机高可用时，应把数据库迁入已验证的主备服务、素材迁入持久共享存储，再部署跨主机应用和入口并进行故障切换演练。

## 7. 当前已验证的平台

历史版本曾在用户Mac的Docker Linux环境构建和演练；当前源码的实际验收以 CURRENT-RELEASE.md 与 VALIDATION.md 为准，不能沿用旧镜像证据。没有把未运行的Windows、特定云主机、跨可用区故障切换或公网证书写成通过。示例服务器域名、自动申请公网证书及真实平台账户均未启用。

## 1.0.1 稳定化：1Panel、备份和 PushPlus

1Panel 是运维入口，不改变本项目 Compose 的数据库账号隔离、版本检查及维护门禁。不要用面板普通网站目录备份代替数据库与原图的一致性备份。所有命令从对应源码版本的仓库目录执行，配置路径必须指向自己创建的本应用配置；不得复用其他应用数据库。

### 一致性备份与独立恢复

维护窗口先停止本项目 api-a、api-b、worker-a、worker-b 和其他 CLI 写入者，再运行：

```sh
node scripts/production-backup.mjs --config-dir=/私有配置目录 --project=tome-你的项目名 --offline-confirmed
```

脚本拒绝 API/Worker 仍在运行的项目，持有数据库维护锁，检查活跃事务，生成 database.dump、media、各类 manifest 和 checksums.sha256。备份前后数据库摘要必须相同。备份完成或失败后，由操作者检查结果并恢复原服务；脚本不会悄悄启动业务进程。

恢复只能使用新的 `tome_restore_` 数据库名及不存在的媒体目录，已有目标直接拒绝：

```sh
node scripts/production-restore.mjs --config-dir=/私有配置目录 --project=tome-你的项目名 --backup=/备份目录 --target=tome_restore_20260916 --media-dir=/新的恢复媒体目录
```

脚本先核验全包 SHA，再恢复至独立数据库，核验全部模型摘要、迁移、TM 序列及媒体哈希。结果为 reports/production-recovery.json；这不启动公开应用、不覆盖业务库。每月至少演练一次，并由经营者核对样本后保存评审证据。

### 服务器之外的备份副本

只放在同一台腾讯云服务器上的备份，仍会随整机故障、磁盘损坏或误删一起丢失。最低建议在服务器之外保留一份，例如腾讯云 COS；可用 1Panel 的 COS 备份账户或独立运维工具上传上述已验证的完整备份目录。应用不引入云 SDK，也不保存云密钥。异地域副本进一步覆盖地域故障；具体地域、保留期由经营者选择。

上传后必须从 COS 下载到新的临时目录，用恢复脚本验证哈希并完成恢复演练，才能确认异机备份有效。仅配置账户或看到上传任务成功不足以把 offHostBackupVerified 设为 true。建议日备份保留 7 份、周备份保留 4 份；实际保留周期需结合数据量及经营要求确认。

1Panel 官方设置说明：https://1panel.cn/docs/v1/user_manual/settings/ 。面板版本不同，菜单可能不同；本项目不自动修改面板任务。

### PushPlus 告警（明确启用才发送）

独立于应用进程执行监控采集：

```sh
node scripts/production-status.mjs --config-dir=/私有配置目录 --project=tome-你的项目名 > /私有监控目录/status.json
node scripts/production-notify.mjs --report=/私有监控目录/status.json
```

第二条默认只预览。PushPlus Token 放服务器权限 600 的独立文件，不能放源码、参数值、日志或聊天。创建权限 700 的状态目录，明确启用后才运行：

```sh
node scripts/production-notify.mjs --report=/私有监控目录/status.json --token-file=/私有监控目录/pushplus-token --state-dir=/私有监控目录/notify-state --send
```

仅发送固定健康检查名称，不转发原始报告、商品或财务记录。重复相同告警 30 分钟内抑制；首次健康不发送，故障恢复发送恢复通知。网络结果不确定也先记发送尝试，避免立即重复。异常退出留下 notify.lock 时应先确认无通知进程，再处理锁文件。不要自动重试不确定请求。

可由明确配置的 1Panel 计划任务执行；采集失败时也应检查退出码和 status.json 是否完整，不可把脚本异常当健康。服务器上的任务不能发现整机断电，因此还需要服务器之外的可用性探测来检查 HTTPS /api/system/ready，并送达同一接收人。当前仓库不自动创建任务或开通外部服务。

PushPlus 官方接口：https://www.pushplus.plus/doc/guide/api.html 。接口 code=200 仅表示接收请求，不代表微信收到。先做一次人工确认的测试告警，由接收人确认实际送达并记录时间，再登记 alertRecipientConfirmed 的证据。源码测试只验证请求格式和错误处理，不冒充实际送达。

### 人工批准证据

operations-approval.json 的每个批准项还需 `evidence[批准项]`：`file`（配置目录内相对文件）、`sha256`、`reviewedAt`（ISO 时间）。文件应包含操作者、场景、实际结果及时间；布尔值 true 单独无效。合成演练不能代替真实业务 UAT、COS 副本、域名/防火墙和告警收件人确认。
