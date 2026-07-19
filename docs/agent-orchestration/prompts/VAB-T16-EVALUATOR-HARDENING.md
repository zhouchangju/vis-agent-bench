# VAB-T16：Evaluator 证据信任边界加固

```prompt
修复只读审查对三套 Case Evaluator 的证据可伪造与 fail-open 问题。只能修改 VAB-T16 allowed_paths。

必须交付：
1. 通用 trusted observation envelope/attestation 校验：绑定 run_id、case_id、observation SHA-256、
   fixture manifest SHA-256、workspace/diff 或 command evidence SHA-256、browser evidence SHA-256、
   hidden control execution SHA-256 和 collector 标识。验证文件必须位于控制面指定的 run root，
   路径 realpath 后不可逃逸。
2. 三个 production evaluator 默认拒绝裸 observation/任意 observationPath；只有测试显式
   `allowTestDouble: true` 才可绕过，且 evidence 必须标记 test-double、不可作为真实 Run 结论。
3. 股权几何检查 fail closed：缺 bounds/path/source/target、未知端点、无共同实体、快照实体丢失
   均失败；增加 adversarial tests。
4. 对 observation 中的结论型布尔值建立 provenance 要求，至少绑定至原始 browser action/state、
   command/hidden-control 证据；缺 provenance 不得通过。
5. 不伪造密码学安全：这是控制面完整性绑定，不是对同一 OS 用户恶意进程的强隔离，文档明确边界。

保持 rubric/check 映射和既有反例。完成三套测试、npm test、diff check、evidence 后独立提交。
```
