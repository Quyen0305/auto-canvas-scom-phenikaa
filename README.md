# Auto Canvas SCOM Phenikaa

Chrome extension kết hợp hỗ trợ trắc nghiệm Canvas và bài học SCORM cho Phenikaa. Phiên bản hiện tại: **2.2.2**. Một popup dùng chung lựa chọn AI và chức năng xuất câu hỏi Excel.

## Cài đặt

1. Tải mã nguồn bằng **Code → Download ZIP** trên GitHub rồi giải nén, hoặc clone repository.
2. Mở `chrome://extensions`, bật **Developer mode / Chế độ dành cho nhà phát triển**.
3. Chọn **Load unpacked / Tải tiện ích đã giải nén**, trỏ tới thư mục **extension** trong mã nguồn.
4. Mở lại hoặc F5 trang Canvas/SCORM, sau đó mở popup tiện ích.

Khi cập nhật, thay mã nguồn trong cùng thư mục đã cài, bấm **Tải lại** trên trang quản lý tiện ích và F5 trang học để giữ cấu hình cùng kho câu hỏi đã lưu.

## Cách dùng

1. Mở popup tiện ích trên trang Canvas hoặc SCORM.
2. F5 trang SCORM và Canvas để nhận bản mới. Giữ extension Canvas riêng ở trạng thái tắt để tránh chạy trùng.
3. Chọn **mô hình AI** ngay trong popup. Danh sách dùng chung: Gemini 2.5 Flash, Gemini 3.7 Flash (`gemini-3.7-flash`), Gemini 1.5 Flash, Gemini 2.0 Flash và Chrome AI. Model cũ đã lưu ngoài danh sách vẫn được giữ để chọn; tính khả dụng do nhà cung cấp quyết định.
4. Nếu chọn Gemini, nhập API key rồi rời ô nhập hoặc bấm nút chạy. Tiện ích tự lưu; ô trống giữ nguyên key đã có. Key được ẩn sau khi lưu.
5. **SCORM:** Bắt đầu / Dừng. **Canvas:** Tự động làm / Làm đến 10 điểm / Dừng, trong popup hoặc widget trên trang.

Popup tự chọn SCORM hoặc Canvas theo trang đang mở. Có thể chuyển thẻ mà không đổi lựa chọn AI. Không cần nút Lưu, Kiểm tra, Mở Chrome AI hay trang Cài đặt thứ hai.

## Các mặc định tự động

- SCORM bật giữ bài học chạy khi chuyển tab trong mỗi lần Bắt đầu. Vẫn đợi timeline thật kết thúc, tôn trọng điểm dừng câu hỏi và dừng khi hoàn thành bài học.
- Canvas bật tự chọn đáp án hợp lệ và tự chuyển câu. Các cờ cũ từng tắt được đưa về bật khi đọc cấu hình. Chế độ tự động chỉ chạy sau khi bạn yêu cầu; bật mặc định không tự khởi chạy bài.
- Làm đến 10 điểm giữ nguyên kiểm tra dữ liệu chấm, giới hạn quyền làm lại của bài, sao lưu câu trả lời trước điều hướng và nút Dừng.
- Ẩn checkbox và công cụ phụ khỏi UI. Widget Canvas giữ Tự động làm, Làm đến 10 điểm, Dừng và kết quả.

## AI và dữ liệu chung

Mô hình, nguồn AI và API key dùng chung cho Canvas và SCORM. Lần nâng cấp đầu ưu tiên cấu hình Canvas trong bản hợp nhất; nếu không có thì dùng cấu hình SCORM. Nếu hai key khác nhau, giữ bản sao key SCORM cũ trong bộ nhớ extension để có thể khôi phục, không hiển thị key trên UI hoặc đóng gói key vào ZIP.

Cache, lịch sử chấm và trạng thái chạy vẫn tách riêng giữa hai công cụ. Thay model không xóa lịch sử. Các thay đổi nguồn AI nên dùng từ lần bắt đầu tiếp theo; yêu cầu AI đang chạy giữ cơ chế hủy/xác thực riêng của từng phần.

Chrome AI được tự chuẩn bị khi chọn hoặc bấm bắt đầu. Lần tải đầu cần giữ popup mở tới khi hoàn tất vì Chrome yêu cầu thao tác trong trang khởi tạo. Nếu đóng popup trong lúc tải, mở lại và chọn/bắt đầu để thử lại. Khi đã sẵn sàng, tab AI nền duy trì phiên xử lý. Không tự chuyển sang Gemini API khi Chrome AI lỗi.

## Lưu và xuất câu hỏi Excel

Kho câu hỏi được lưu tự động trên máy, riêng với cache AI. Giữ tất cả lượt đã thu thập, không tự xóa theo thời hạn cache. Quyền `unlimitedStorage` dành cho kho lịch sử; gỡ extension hoặc xóa dữ liệu extension vẫn làm mất kho, nên xuất định kỳ để sao lưu.

- **Canvas:** lưu câu hỏi và lựa chọn trên các trang đã mở, cả thao tác thủ công. Trang kết quả bổ sung điểm chấm và đáp án đúng nếu Canvas công khai. Tiện ích đọc các liên kết lịch sử của chính bài đó để gom các lượt cũ còn được phép xem; không nộp bài hay điều hướng trong quá trình thu thập.
- **SCORM:** khi chạy Bắt đầu, lưu nội dung câu hỏi, các lựa chọn, đáp án đã gửi và phản hồi đúng/sai trước khi bấm Tiếp tục hoặc Học lại. Không suy ra “đúng” chỉ vì nút Tiếp tục xuất hiện.
- Bấm **Xuất câu hỏi Excel**, giữ popup mở đến khi tải xuống. Tiện ích gom thêm dữ liệu ở các tab Canvas đang mở rồi tạo một ZIP: mỗi thư mục là một học phần, mỗi XLSX là một bài tập. Dùng tên hiển thị khi đọc được; nếu thiếu tên sẽ giữ mã/nhóm học phần riêng, không trộn các bài khác nhau.
- Sheet **Create a Quiz** giữ đúng 11 cột và hàng hướng dẫn của `QuizizzSampleSpreadsheetUpdated_v2.xlsx`. Đáp án đúng dùng số bắt đầu từ 1; nhiều đáp án dùng dạng `1,3`. Cột thời gian và ảnh để trống nếu chưa thu thập được.
- File xuất chỉ chứa câu có đáp án đã được bài chấm đúng. Không xuất sheet lịch sử, các lượt chọn sai hay dự đoán AI. Lịch sử vẫn lưu bên trong extension để đối chiếu. Câu trên 5 lựa chọn có đáp án đúng được giữ đủ trong sheet **Câu trên 5 lựa chọn**, vì mẫu Quizizz chỉ có 5 cột đáp án.
- Gộp câu trùng trong cùng bài tập theo nội dung và tập lựa chọn, kể cả khi đảo thứ tự đáp án. Các câu có bộ lựa chọn khác nhau hoặc thuộc bài tập khác được giữ riêng. Không bỏ dấu tiếng Việt để so trùng.
- Chỉ xuất khi có bằng chứng chấm đúng và không mâu thuẫn. Câu chỉ có dự đoán AI, chưa chấm, hoặc có kết quả mâu thuẫn được bỏ qua hoàn toàn khi xuất. Nếu không có câu đạt điều kiện thì không tạo file. Các lựa chọn gốc của câu trắc nghiệm vẫn được giữ; Correct Answer chỉ đánh dấu đáp án đã xác nhận đúng.
- Popup đọc trực tiếp kho lưu sau khi đợi thu thập Canvas hoàn tất, không truyền toàn bộ lịch sử qua phản hồi của worker. Nếu chưa có dữ liệu và tab không kết nối được, thông báo yêu cầu tải lại tiện ích và F5 trang kết quả. Canvas ẩn đáp án đúng vẫn có thể xác nhận lựa chọn đã chọn khi câu đó được chấm đủ điểm, ví dụ 0,6/0,6; không suy ra từ tổng điểm cả bài.

**Lịch sử trước 2.2.0:** cache cũ chỉ giữ hash và đáp án, không đủ để phục hồi nội dung toàn bộ câu hỏi. Kho mới tận dụng đáp án đã chấm còn lưu khi gặp lại câu đó. Với Canvas, mở trang kết quả bài cũ để gom các lượt còn có liên kết lịch sử; các câu không còn được trang học hiển thị thì không thể khôi phục. Chưa hỗ trợ thu thập Canvas New Quizzes trong iframe ngoài trang quiz hiện tại hoặc câu không dùng lựa chọn radio/checkbox.

## Cấu trúc và kiểm tra

- `shared-settings.js`: lựa chọn AI chung, chuyển cấu hình cũ và bật mặc định tự động.
- `archive-content.js`, `question-bank.js`: thu thập, phân nhóm, lưu lịch sử bền vững và lọc câu trùng; không đổi thuật toán giải Canvas gốc.
- `xlsx-export.js`, `bank-export.js`: xuất XLSX trực tiếp trên máy, không gửi kho câu hỏi tới dịch vụ ngoài; ô chứa nội dung luôn là văn bản, không thực thi công thức Excel.
- `suite-popup.html`, `suite.js`, `suite.css`: popup tối giản.
- `canvas-controls.js`: nút popup gọi chính các nút chế độ đang có trên trang Canvas.
- `canvas-compat.js`: adapter lưu trữ và giao diện; `canvas/` giữ mã giải bài, cache và học kết quả của Canvas.
- `content.js`, `core.js`, `playback.js`: logic SCORM giữ bản sửa Học lại/timeline hiện có.
- `suite-background.js`: một worker cho cả hai phần. Không đăng ký `options_page`; URL trang cài đặt cũ chuyển về popup chung.
- Mã Canvas gốc được giữ bên trong các lớp tích hợp; hash trong `extension/canvas/upstream-hashes.json` dùng để kiểm tra tính toàn vẹn.

Cài Node.js 22 trở lên, chạy `npm ci` rồi `npm test` tại thư mục repository. Kiểm thử bao gồm chuyển cấu hình cũ, chia sẻ model/key, nút Canvas/SCORM, hủy trong lúc chuẩn bị AI, lưu/xuất câu hỏi, đọc lịch sử cũ, lọc trùng khi đảo đáp án, cô lập học phần/bài tập, bảo vệ key và token. Bản 2.2.2 đã qua 21 kiểm thử liên quan kho câu hỏi và popup, gồm phản hồi xuất bị rỗng, tab cũ chưa kết nối, lựa chọn bị vô hiệu hóa nhưng đã chấm đủ điểm và loại bỏ lịch sử sai khỏi file xuất. XLSX xuất từ chính bộ xuất đã được mở lại bằng bộ đọc độc lập và so đủ 11 tiêu đề/hàng hướng dẫn với mẫu người dùng, xác nhận không có sheet lịch sử. Chưa kiểm tra xuất trên tài khoản học thật hoặc nhập trực tiếp vào Quizizz.

ZIP chỉ chứa `extension/` và README, không chứa dữ liệu HTML mẫu, token, key, node_modules hoặc bản lưu UI cũ.
