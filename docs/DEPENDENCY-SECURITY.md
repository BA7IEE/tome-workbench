# 依赖安全修复

本切片处理审计报告中的 1 high、2 moderate，独立于来源资料 UI 改动。应用和数据库版本仍为 1.1.0-rc.13，不增加 migration，不改变经营数据、来源事实、原图、权限、回执或上传限制。

## 修复范围

| 依赖 | 原版本 | 修复版本 | 使用位置 |
| --- | --- | --- | --- |
| multer | 2.3.0 | 2.4.0 | Nest 上传解析器，沿用现有 override |
| brace-expansion | 1.1.18 | 1.1.21 | ESLint 间接依赖 |
| brace-expansion | 2.1.4 | 2.1.7 | archiver 的 glob / readdir-glob 依赖 |
| brace-expansion | 5.0.9 | 5.0.12 | typescript-eslint 间接依赖 |

Nest、React、Prisma 等直接框架依赖不变；brace-expansion 不跨大版本，也不通过统一 override 强行替换不同版本接口。multer 新版不再依赖 concat-stream，lockfile 同步移除已无引用的 concat-stream、其独立 readable-stream、buffer-from、typedarray；根 bin 元数据与既有 package.json 对齐，没有新增命令。

上游依据：[multer 中断上传文件残留修复](https://github.com/advisories/GHSA-3pph-fpjx-jg34)、[brace-expansion 递归栈耗尽修复](https://github.com/advisories/GHSA-qhr7-859c-m2p7)、[逗号解析递归修复](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)、[异常输入计算量修复](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)。这些是依赖层漏洞依据，不表示已发现生产被利用。

## 复验与边界

1. `npm ci` 从 lockfile 安装，`npm run db:generate` 生成对应客户端；检查实际安装树中的四组修复版本。
2. `node scripts/prepare-test.mjs` 仅准备独立 tome_test，不输出连接凭据。
3. 类型、lint、构建与完整 `npm run verify:release`，保留全部单元、PG、两浏览器、HA、恢复和静态门禁；两浏览器范围一致，skip/retry/flaky 均为 0。
4. `npm audit --audit-level=high --json` 的当前原始结果进入版本化 audit.json。审计通过只证明本次依赖快照，无替代业务验证的含义。
5. `npm run pack` 后逐文件核对清单哈希，排除实际环境配置、凭据、运行数据、会话和备份。

上传验证沿用既有真实原图及异常恢复用例，没有为升级放宽断言，也没有使用生产文件作夹具。各分支分别生成与当前源码相符的验证报告，不能把依赖分支的结果冒充 UI 合并后结果。当前完整结果见 [VALIDATION](VALIDATION.md)。合并 main、生产部署和真实业务 UAT 均需后续明确授权。
