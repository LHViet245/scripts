# laosiji-vi — dựng `laosiji-new.js` từ upstream

`laosiji-new.js` **không sửa tay nữa**. File được dựng tự động từ bản build của upstream
([ZiPenOk/scripts](https://github.com/ZiPenOk/scripts), file `laosiji-amane.js`) theo các bước:

1. **Header**: giữ tên `JAV Lái Xe - Mới` và namespace của fork để Tampermonkey nhận đúng script cũ, không mất cài đặt. Đổi link cập nhật về fork, bỏ `@match` của 115. Phiên bản có dạng `<bản upstream>-vi`.
2. **Dịch**: dùng AST (acorn) nên chỉ đụng vào nội dung chuỗi, không đụng vào code. Mỗi chuỗi được phân loại như sau:
   - Khoá thuộc tính, regex, selector CSS và **console log** → giữ nguyên.
   - Chuỗi dùng để **so sánh với nội dung trang web** (`===`, `.includes`, `switch`, …) → tra `i18n/compare.json`.
   - Chữ hiển thị → tra `i18n/strings.json` (cả chuỗi), không có thì dịch theo cụm bằng `i18n/phrases.json`.
   - Sau khi dịch, build kiểm tra chuỗi token phải giống hệt upstream. Nếu không giống thì dừng.
3. **Bản vá** (`patches.mjs`): tắt 115, bỏ tab/công tắc 115, dịch tiêu đề sang ngôn ngữ chọn được. Bản vá nào không khớp thì build dừng và báo tên.
4. **Addon** (`addon/*.js`): code riêng của fork, nối vào cuối file. Hiện có ô chọn ngôn ngữ dịch tiêu đề.

Các liên kết ở chân bảng cài đặt và console log giữ nguyên như upstream.

## Cài đặt lần đầu

```bash
git remote add upstream https://github.com/ZiPenOk/scripts.git   # nếu chưa có
cd tools/laosiji-vi && npm install
```

## Cập nhật khi upstream có bản mới

```bash
git fetch upstream
cd tools/laosiji-vi
npm run report        # chỉ báo cáo, chưa ghi file
```

Đọc dòng báo cáo:

| Báo cáo | Cách xử lý |
|---|---|
| `cụm chưa dịch: N` | Mở `out/missing.json`, thêm bản dịch vào `i18n/phrases.json` (theo cụm) hoặc `i18n/strings.json` (cả câu, đọc tự nhiên hơn) |
| `chuỗi so sánh chưa phân loại: N` | Mở `out/undecided.json`, ghi quyết định vào `i18n/compare.json` (xem bên dưới) |
| `Bản vá "…" thất bại` | Upstream đổi code chỗ đó; sửa mẫu khớp trong `patches.mjs` |
| `Bản dịch làm đổi cấu trúc code` | Lỗi trong `lib/i18n.mjs` (hiếm). Không được bỏ qua |

Khi `report` sạch thì chạy:

```bash
npm run build         # ghi ../../laosiji-new.js và upstream.lock.json
npm run smoke         # chạy thử upstream và bản dựng trên trang mẫu (jsdom), so sánh lỗi
```

Sau đó cài thử vào trình duyệt, kiểm tra bảng cài đặt, trang chi tiết và danh sách, rồi commit cả `laosiji-new.js`, `upstream.lock.json` và `i18n/`.

`out/phrased.json` liệt kê các câu được ghép từ nhiều cụm. Nên đọc lướt file này. Câu nào ghép không hay thì thêm bản dịch nguyên câu vào `strings.json`.

## `compare.json`: chuỗi so sánh

Một số chuỗi tiếng Trung vừa là chữ hiển thị, vừa được code đem đi so sánh. Ví dụ code tìm nhãn `有码` trên trang JavBus, hoặc so lại nhãn tab do chính script tạo ra. Mỗi chuỗi như vậy cần một quyết định:

- `"keep"`: chuỗi so sánh với **nội dung của trang web** (trang vẫn là tiếng Trung) → giữ nguyên.
- `"translate"`: chuỗi so sánh với **chữ do script tự tạo** → dịch giống hệt nơi tạo ra chữ đó.
- `"chuỗi cụ thể"`: ép một bản dịch riêng, dùng khi cần khớp chính xác với chữ ở nơi khác.

Khoá có thể kèm chữ ký mảng: `"收藏 @ 收藏|已收藏|观看"` nghĩa là "chuỗi `收藏` nằm trong mảng bắt đầu bằng 3 phần tử đó". Cách này giúp cùng một chuỗi có quyết định khác nhau ở những chỗ khác nhau.

Nguyên tắc: **chuỗi giống nhau thì luôn dịch giống nhau**. Nếu nhãn tạo ra và nhãn đem so sánh được dịch khác nhau, tính năng sẽ hỏng một cách âm thầm.

## Các file khác

- `i18n/keep.json`: chuỗi luôn giữ nguyên.
- `i18n/context.json`: thay theo ngữ cảnh trước khi dịch cụm. Ví dụ `>关闭</option>` → `Tắt` thay vì `Đóng`.
- `config.json`: nguồn upstream, header, `revision`. Tăng `revision` khi chỉ đổi bản dịch mà upstream chưa có bản mới, khi đó phiên bản thành `x.y.z-vi.1`, … để Tampermonkey nhận cập nhật.
- `upstream.lock.json`: commit upstream đã dùng cho lần build gần nhất.

Thuật ngữ thống nhất: 鉴定记录 = Lịch sử đánh giá, 资源管理 = Quản lý tài nguyên, 屏蔽 = Chặn, 收藏 = Lưu, 观看 = Xem, 短评 = Đánh giá, 磁力 = Magnet, 番号 = Mã, 有码/无码 = Có che/Không che, 瀑布流 = Cuộn vô tận.
