# Native Binaries cho macOS

Thư mục này chứa các native binary cần thiết cho SENNET macOS build.

## Cấu trúc

```
bin/
├── README.md                    # File này
├── libcore-darwin-arm64         # sing-box cho Apple Silicon (M1-M5)
└── libcore-darwin-amd64         # sing-box cho Intel Mac
```

## Cách build sing-box cho macOS

### 1. Cài đặt Go
```bash
brew install go
```

### 2. Clone sing-box
```bash
git clone https://github.com/SagerNet/sing-box.git
cd sing-box
```

### 3. Build cho Apple Silicon (ARM64)
```bash
CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build -o libcore-darwin-arm64 ./cmd/sing-box
```

### 4. Build cho Intel (AMD64)
```bash
CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 go build -o libcore-darwin-amd64 ./cmd/sing-box
```

### 5. Copy vào thư mục bin/
```bash
cp libcore-darwin-arm64 sennetv1mac/bin/
cp libcore-darwin-amd64 sennetv1mac/bin/
```

## Build Universal Binary (dùng lipo)

Nếu đã có cả 2 bản, có thể tạo universal binary:
```bash
lipo -create libcore-darwin-arm64 libcore-darwin-amd64 -output libcore-darwin-universal
```

## Lưu ý

- **KHÔNG** commit binary files vào git (quá lớn)
- Build sing-box với CGO_ENABLED=1 để hỗ trợ TUN mode
- Cần macOS SDK để build (chỉ build được trên Mac)
- Phiên bản sing-box khuyến nghị: >= 1.8.0
