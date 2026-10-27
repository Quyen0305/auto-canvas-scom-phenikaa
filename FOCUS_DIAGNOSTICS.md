# Focus Isolation Test — Auto-Canvas

Bộ đo thụ động và 8 phép thử riêng biệt để tìm thao tác có tương quan với mất focus trên **trang Canvas luyện tập hoặc môi trường thử nghiệm do bạn kiểm soát**. Không chặn, giả mạo hay xóa log Canvas.

## Sử dụng
1. Cài bản extension từ nhánh `feature/focus-isolation-diagnostics` bằng Chrome > Extensions > Developer mode > Load unpacked, chọn thư mục `extension`. Có thể chạy trên trang mẫu tự tạo tương thích DOM Canvas. Đừng thay extension đang dùng trước khi sao lưu.
2. Trên trang, nhấn **Alt + Shift + D** để mở **Focus Isolation Test**. Không cần popup Chrome.
3. Bấm **Chạy 8 test**. Mỗi test lặp **3 lần**. Khi xong, bấm **Xuất JSON** để xem dữ liệu. Có thể nhấn **Đóng** để dừng.
4. Có thể mở lại và thử phím **X** trong một bài luyện tập được phép dùng AI. Khi bộ đo đang bật, nó sẽ ghi mốc `shortcut_x`, `solve_start`, `dom_read_start/done`, `storage_start/done`, `api_request_start`, `api_response_received`, `answer_apply_start/done`, `solve_complete/error`. Phần thử này **có thể gọi API thật và chọn câu trả lời** theo cấu hình extension; chỉ thực hiện trên bài thực hành được phép.
5. Xuất JSON; báo cáo không chứa nội dung câu hỏi, phương án, hay API key.

## Phạm vi đo
- T01 nghỉ; T02 phím X trên nút giả (không kích hoạt phím tắt trang); T03 truy vấn DOM, không thu nội dung; T04 đọc một cài đặt extension; T05 heartbeat background; T06 chờ mô phỏng AI, không gọi mạng; T07 render kết quả giả; T08 click radio giả.
- Thống kê `blur`, `focus`, `visibilitychange`, `document.hasFocus()`, và timeline mốc xử lý.
- `hasFocus() = false` từ trước khi chạy test => **không thể quy lỗi cho test**. Có blur trong lúc test chỉ cho thấy **tương quan thời gian**, chưa xác định được hàm gọi gây blur.
- Các sự kiện trong báo cáo là ở phía trình duyệt, **không xác nhận** Quiz Log phía máy chủ đã ghi gì.
- Mỗi lần nhấn Chạy 8 test xóa timeline của phiên trước; xuất báo cáo trước khi chạy lại.
- Công cụ không hook hoặc sửa Canvas focus handlers, không tắt event, không gửi yêu cầu AI trong 8 test.

## Đọc kết quả
- `withBlur`: các test có sự kiện `window.blur` khi thực hiện.
- `failedActions`: các test bị lỗi khi gọi API Chrome hoặc thao tác giả.
- `timeline`: thời điểm miligiây tương đối giữa các sự kiện để đối chiếu với `auto_canvas_phase`.

Nhánh này tách khỏi bản sản xuất. Chưa có bằng chứng chạy thực tế trên Canvas của người dùng; cần kiểm thử trong Chrome.
