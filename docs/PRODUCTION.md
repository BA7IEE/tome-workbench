# 生产部署与发布手册 · 0.2.0-rc.2

## 1. 本版可部署边界

目标是单工作空间的内部经营工作台。使用Docker运行两个API、两个Worker、Caddy HTTPS入口和独立PostgreSQL。Compose只提供单主机部署，不是跨机房容灾方案。公网启用之前，需要真实域名、独立服务器、访问防护、备份目的地及业务验收负责人。

系统不会自动登录交易平台、发帖、扣款、退款、调用付费AI或向合作方付款。对账确认是内部计算快照，不是认定某份协议已经签署或法律应付款。

## 2. 配置原则

`data/production`存放正式环境文件和随机密码，不得提交Git或放入交付包。不要复用开发配置。运行连接是`tome_app`，无超级用户、建库、建角色、复制和表所有者权限；迁移连接是`tome_owner`，只用于维护窗口。数据库和API端口不直接暴露到宿主机。

部署的默认监听为127.0.0.1；只有显式`--public`生成配置才监听所有网卡。第一次新建时完成以下配置（将域名改为实际值）：

```sh
node scripts/production-config.mjs --domain=inventory.your-company.com --public
```

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

它检查Compose配置、容器健康、非root只读运行、私有端口和真实TLS访问。它不会把localhost演练当成公网验证。默认仍返回NO_GO，直到授权运维人员独立核对下面几件事，并在配置目录保存`operations-approval.json`：

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

本次在用户Mac的Docker Linux环境实际构建、部署和浏览器操作。准确架构与镜像ID记录在验证报告。没有把未运行的Windows、特定云主机、跨可用区故障切换或公网证书写成通过。示例服务器域名、自动申请公网证书及真实平台账户均未启用。
