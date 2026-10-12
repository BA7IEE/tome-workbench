# Sharp 兼容安全补丁

PR #57 的第一次完整 CI（[38183927527](https://github.com/BA7IEE/tome-workbench/actions/runs/38183927527)，head `67a399e`）在既有 npm audit high gate 发现基线 sharp 0.35.4 漏洞，尚未运行浏览器回归。

固定升级至 sharp 0.35.5，并同步其匹配的 @img/sharp 0.35.5 与 libvips 1.3.4 锁项。依据：[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[官方 0.35.5 发布](https://github.com/lovell/sharp/releases/tag/v0.35.5)。公告说明较早版本的上游 librsvg 存在内存安全问题，0.35.5 的预编译包提供修复后的 librsvg。

这是解除实际 CI 安全阻塞的最小补丁，不改变 AntD/ProComponents、上传/原图/授权规则、业务接口或 migration，也不降低审计门槛。package-lock 仅修改 sharp 及其平台二进制依赖，其他锁定包不变。Mac 仅在 256MiB Node heap 上限下解析 package-lock（ignore-scripts、无依赖安装/原生构建）；完整 npm ci/audit、图片与领域回归继续在既有独立 Linux CI。

本补丁尚需自身固定 head 的完整 CI，不能引用基线成功或前一次失败运行作通过证据。没有合并、部署或真实数据写入。
