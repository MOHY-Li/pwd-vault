# Pwd-Vault

全平台密码管理器 — 零信任架构，本地优先，密钥永不离开设备。

## 技术栈

- **Core**: Rust (XChaCha20-Poly1305 + Argon2id + HKDF)
- **Desktop/Mobile**: Tauri 2.0
- **Frontend**: SolidJS + Tailwind CSS + Vite
- **Platform**: iOS / Android / macOS / Windows / Linux

## 特性

- 自定义加密 Vault 文件格式（.vault），每条记录独立加密
- 主密码 + 生物识别解锁（Face ID / Touch ID / 指纹 / Windows Hello）
- TOTP/HOTP 二步验证
- 密码生成器（随机字符 + Diceware 单词）
- 密码强度评估 + 泄露检测（HIBP k-anonymity）
- 导入导出（.vault / JSON / CSV / Bitwarden / 1Password / KeePass）
- 自动锁定 + 剪贴板超时清除
- 中/英双语
- 暗色/亮色主题

## 快速开始

```bash
# 前置要求
# - Rust (edition 2024)
# - Node.js 20+
# - Tauri CLI 2.0

# 安装 Tauri CLI
cargo install tauri-cli

# 开发模式
cargo tauri dev

# 构建
cargo tauri build
```

## 文档

- [技术方案详细设计](PLAN.md)

## License

MIT
