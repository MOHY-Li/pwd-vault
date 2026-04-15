# Pwd-Vault

<p align="center">
  <img src="src-tauri/icons/128x128.png" width="128" height="128" alt="Pwd-Vault Icon">
</p>

<p align="center">
  <strong>安全的本地密码管理器</strong><br>
  零信任架构 · 本地优先 · 密钥永不离开设备
</p>

<p align="center">
  <a href="https://github.com/MOHY-Li/pwd-vault/releases"><img src="https://img.shields.io/github/v/release/MOHY-Li/pwd-vault?color=emerald" alt="Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20ARM-black" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

---

## 安装

### Homebrew (推荐)

```bash
brew tap MOHY-Li/pwd-vault
brew install --cask pwd-vault
```

### 手动下载

从 [Releases](https://github.com/MOHY-Li/pwd-vault/releases) 下载最新 DMG，拖入 Applications 即可。

## 功能

- **4 种条目类型** — 登录 / 笔记 / 卡包 / 身份，每种类型差异化字段展示
- **AES-256 加密** — 本地加密存储，主密码通过 Argon2id 派生密钥
- **密码生成器** — 可配置长度、字符集、排除易混淆字符
- **密码强度评估** — 实时评估 + 进度条 + 破解时间估算
- **TOTP 两步验证** — otpauth URI 解析，实时倒计时刷新
- **收藏 & 标签** — 星标收藏、标签管理、按类型过滤
- **导入导出** — `.vault` 加密备份 + `.json` 明文格式
- **智能去重** — 导入时按类型自动检测重复，支持跳过/重命名
- **审计日志** — 完整操作记录，显示标题 + ID
- **回收站** — 条目软删除与恢复
- **密码历史** — 修改密码时自动保存历史记录
- **拖拽上传** — 支持拖拽文件导入
- **条目排序** — 按标题字母 A-Z 排序
- **必填验证** — 按类型验证核心必填字段

## 截图

| 登录界面 | 主界面 |
|:---:|:---:|
| 锁定/创建密码库 | 条目管理 + 侧边栏 |

## 技术栈

| 层 | 技术 |
|---|---|
| 核心加密 | Rust (XChaCha20-Poly1305 + Argon2id + HKDF-SHA256) |
| 桌面框架 | Tauri 2.0 |
| 前端 | SolidJS + TailwindCSS + TypeScript |
| 构建 | Vite + Cargo |

## 加密架构

```
Master Password
    │
    ▼ Argon2id (256 MiB, 4 iterations, parallelism 4)
Master Key (32 bytes)
    │
    ├──► HKDF("pwd-vault-auth-hash")   → Auth Hash (密码验证)
    ├──► HKDF("pwd-vault-vault-key")   → Vault Key (加密索引)
    ├──► HKDF("pwd-vault-mac-key")     → MAC Key (文件完整性)
    └──► HKDF("pwd-vault-entry-key-seed") → Entry Key Seed
              │
              └──► HKDF(entry_id) → Per-Entry Key (每条记录独立密钥)
```

## 项目结构

```
pwd-vault/
├── crates/
│   ├── core/              # Rust 核心加密库
│   │   └── src/
│   │       ├── crypto.rs       # XChaCha20-Poly1305 加密 + BLAKE3 MAC
│   │       ├── vault.rs        # .vault 文件格式
│   │       ├── entry.rs        # Entry 数据结构
│   │       ├── generator.rs    # 密码生成器
│   │       ├── strength.rs     # 密码强度评估
│   │       ├── totp.rs         # TOTP 二步验证
│   │       ├── import_export.rs # 导入导出 + 去重
│   │       └── audit.rs        # 审计日志
│   └── tauri-plugin/      # Tauri IPC 桥接层
│       └── src/commands.rs     # Tauri commands
├── src/                   # SolidJS 前端
│   ├── App.tsx
│   ├── api.ts
│   ├── stores/vault.ts
│   └── components/
│       ├── auth/               # 登录/解锁
│       ├── layout/             # 布局 + 侧边栏
│       ├── vault/              # 条目管理 + 审计日志
│       └── import-export/      # 导入导出
└── src-tauri/             # Tauri 配置
    ├── src/main.rs
    └── tauri.conf.json
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式
cargo tauri dev

# 构建发布版
cargo tauri build
```

## 发版流程

```bash
# 1. 打包
cargo tauri build

# 2. 创建 GitHub Release
gh release create vX.Y.Z target/release/bundle/dmg/Pwd-Vault_X.Y.Z_aarch64.dmg

# 3. 更新 Homebrew Cask (计算新 sha256)
shasum -a 256 target/release/bundle/dmg/Pwd-Vault_X.Y.Z_aarch64.dmg
# 编辑 homebrew-pwd-vault 仓库的 Casks/pwd-vault.rb，更新 version + sha256
```

## License

MIT
