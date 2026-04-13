# Pwd-Vault

全平台密码管理器 — 零信任架构，本地优先，密钥永不离开设备。

## 技术栈

- **Core**: Rust (XChaCha20-Poly1305 + Argon2id + HKDF-SHA256)
- **Desktop/Mobile**: Tauri 2.0
- **Frontend**: SolidJS + Tailwind CSS v4 + Vite + TypeScript
- **Platform**: iOS / Android / macOS / Windows / Linux

## 项目结构

```
pwd-vault/
├── crates/
│   ├── core/                   # Rust 核心加密库
│   │   └── src/
│   │       ├── crypto.rs       # XChaCha20-Poly1305 加密 + BLAKE3 MAC + HKDF 密钥派生
│   │       ├── vault.rs        # .vault 文件格式 (Header → Index → Entries → MAC)
│   │       ├── vault_index.rs  # 加密索引 (条目元数据 + 文件夹)
│   │       ├── entry.rs        # Entry 数据结构 (15 字段)
│   │       ├── generator.rs    # 密码生成器 (随机字符 + Diceware)
│   │       ├── strength.rs     # 密码强度评估 (熵计算 + 破解时间)
│   │       ├── totp.rs         # TOTP 二步验证 (SHA1/256/512)
│   │       ├── import_export.rs # 导入导出 (6格式导入 + 2格式导出)
│   │       ├── dedup.rs        # 去重引擎 (两遍扫描: 精确去重 → 冲突检测)
│   │       ├── audit.rs        # 审计日志 (500条环形缓冲)
│   │       └── error.rs        # 错误类型
│   └── tauri-plugin/           # Tauri IPC 桥接层
│       └── src/
│           ├── commands.rs     # 25 个 Tauri commands
│           └── lib.rs          # 插件注册
├── src/                        # SolidJS 前端
│   ├── api.ts                  # Tauri IPC 类型化封装
│   ├── stores/vault.ts         # 状态管理 (createSignal + createStore)
│   ├── App.tsx                 # 根组件
│   └── components/
│       ├── auth/LockScreen.tsx        # 创建/解锁密码库
│       ├── layout/
│       │   ├── Sidebar.tsx            # 侧边栏 (搜索 + 分类过滤 + 操作)
│       │   └── MainLayout.tsx         # 布局容器
│       ├── vault/
│       │   ├── MainContent.tsx        # 条目详情 + TOTP 实时显示
│       │   ├── EntryEditor.tsx        # 新建/编辑条目
│       │   ├── Trash.tsx              # 回收站 (软删除/恢复/永久删除)
│       │   └── AuditLog.tsx           # 审计日志
│       ├── generator/PasswordGen.tsx  # 密码生成器
│       └── import-export/
│           └── ImportExport.tsx       # 导入导出
├── src-tauri/                  # Tauri 应用配置
│   ├── src/main.rs             # 应用入口
│   └── tauri.conf.json         # 窗口/CSP配置
├── PLAN.md                     # 技术方案详细设计
└── README.md
```

## 特性

- **自定义 .vault 二进制格式** — Header → 加密索引 → 每条记录独立加密 → BLAKE3 MAC
- **零信任架构** — 主密码通过 Argon2id 派生密钥，密钥永不离开设备
- **每条记录独立加密** — XChaCha20-Poly1305 AEAD，每条记录独立 nonce + 密钥
- **文件完整性** — BLAKE3 keyed hash (HKDF 派生 MAC 密钥)，覆盖全文件
- **回收站** — 软删除机制，支持恢复/永久删除/清空
- **TOTP 二步验证** — 支持 SHA1/SHA256/SHA512，实时倒计时刷新
- **密码生成器** — 随机字符模式 + Diceware 单词模式
- **密码强度评估** — 熵计算 + 破解时间估算
- **导入导出** — JSON / CSV / Bitwarden JSON+CSV / 1Password CSV / KeePass XML
- **审计日志** — 记录所有操作（创建/更新/删除/导入/导出/锁定）
- **自动锁定** — 闲置超时自动锁定，全局事件监听
- **严格 CSP** — 防止 XSS 攻击
- **原子写入** — .tmp 文件 + sync_all + rename，防止写入中断损坏

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
              └──► HKDF(entry_id)      → Per-Entry Key (每条记录独立密钥)
```

## .vault 文件格式

```
┌─────────────────────────────────────┐
│ Header (77 bytes)                   │
│  Magic (4B) | Version (1B)          │
│  Flags (1B) | Argon2 Params (7B)    │
│  Salt (32B) | Auth Hash (32B)       │
├─────────────────────────────────────┤
│ Encrypted Index                     │
│  Nonce (24B) | Length (4B)          │
│  Ciphertext (variable)             │
├─────────────────────────────────────┤
│ Encrypted Entries                   │
│  [Length(4B) | Nonce(24B) | CT] × N│
├─────────────────────────────────────┤
│ File MAC (32 bytes, BLAKE3)         │
└─────────────────────────────────────┘
```

## 开发进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | Rust 核心库 (crypto/vault/entry/generator/strength/totp/import_export/dedup/audit) | ✅ 完成 |
| Phase 2 | Tauri IPC 桥接 + SolidJS 前端 MVP | ✅ 完成 |
| Phase 3 | 导入导出/TOTP/回收站/审计日志/自动锁定 | ✅ 完成 |
| Phase 4 | macOS/Windows 真机测试 + 打包 | 🔲 待开始 |

### 质量指标

- Rust: 84 单元测试，0 clippy warnings
- TypeScript: 0 编译错误
- 经过 4 轮代码审查，累计修复 19 个问题

## 快速开始

```bash
# 前置要求
# - Rust (edition 2024)
# - Node.js 20+
# - Tauri CLI 2.0

# 安装前端依赖
npm install

# 开发模式
cargo tauri dev

# 构建发布版
cargo tauri build
```

## 文档

- [技术方案详细设计](PLAN.md)

## License

MIT
