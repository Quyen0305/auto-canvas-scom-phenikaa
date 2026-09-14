# Auto Canvas SCOM Phenikaa

Tiện ích Chrome hỗ trợ làm bài trắc nghiệm trên Canvas, xem video bài giảng và làm bài tập theo dõi bài học SCORM và xuất câu hỏi đã có đáp án đúng ra Excel. Phiên bản hiện tại: **2.2.8**.

Tên repository giữ chữ `scom`; tên kỹ thuật của định dạng bài học là **SCORM**. Khi cài vào Chrome, tiện ích hiển thị tên **Trợ lý học tập · Canvas & SCORM**.

[Cài đặt](#1-cài-đặt) · [Chọn AI](#2-chọn-ai) · [Sử dụng](#3-sử-dụng) · [Xuất Excel](#4-xuất-câu-hỏi-excel) · [Xử lý lỗi](#6-xử-lý-lỗi-thường-gặp)

## 1. Cài đặt

Bạn cần Chrome trên máy tính và tài khoản đã đăng nhập vào trang học. Manifest cho phép cài từ Chrome 120; **Chrome AI có thêm yêu cầu riêng về trình duyệt và phần cứng**. Cài được tiện ích chưa có nghĩa là dùng được AI trên máy.

**Không cần cài Node.js hoặc chạy lệnh để sử dụng tiện ích.**

1. Trên trang repository, chọn **Code → Download ZIP**.
2. Giải nén vào một thư mục cố định trên máy.
3. Mở `chrome://extensions` trong thanh địa chỉ Chrome.
4. Bật **Developer mode / Chế độ dành cho nhà phát triển**.
5. Bấm **Load unpacked / Tải tiện ích đã giải nén**.
6. Chọn thư mục **`extension`**, là thư mục chứa `manifest.json`. Không chọn file ZIP hoặc thư mục ngoài cùng của repository.
7. Bấm biểu tượng mảnh ghép trên thanh công cụ Chrome và ghim **Trợ lý học tập · Canvas & SCORM** để dễ mở.
8. Mở lại hoặc nhấn **F5** ở trang Canvas, bài giảng video đang dùng. Nếu còn bật tiện ích Canvas cũ riêng lẻ, hãy tắt nó để tránh hai tiện ích cùng thao tác.

Thư mục cần chọn:

```text
auto-canvas-scom-phenikaa-main/
├── README.md
├── extension/                 ← Chọn thư mục này
│   ├── manifest.json
│   └── ...
└── tests/
```

Đây là cách cài mã nguồn chưa đóng gói. Có thể đối chiếu với [hướng dẫn Load unpacked của Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## 2. Chọn AI

Bấm biểu tượng tiện ích để mở cửa sổ điều khiển, gọi là **popup**. Mục **Mô hình AI** dùng chung cho cả Canvas và SCORM. Cấu hình được tự lưu, không có trang cài đặt riêng.

| Lựa chọn | Cách xử lý câu hỏi | Cần chuẩn bị |
| --- | --- | --- |
| Gemini API | Gửi nội dung câu hỏi và lựa chọn tới Gemini API của Google | API key hợp lệ, mạng và hạn mức cho model đã chọn |
| Chrome AI · Gemini Nano trên máy | Chạy mô hình qua API AI tích hợp của Chrome | Trình duyệt/phần cứng hỗ trợ; tải mô hình và bộ dịch cần thiết |

### Dùng Gemini API

1. Tạo hoặc lấy API key theo [hướng dẫn Gemini API của Google](https://ai.google.dev/gemini-api/docs/api-key).
2. Trong popup, chọn một model Gemini mà project của bạn có quyền sử dụng.
3. Dán key vào ô **Gemini API key**.
4. Bấm ra ngoài ô nhập hoặc bấm nút chạy. Khi hiện **Đã lưu key**, bạn có thể sử dụng.

Sau khi lưu, ô nhập được làm trống để che key. **Ô trống không có nghĩa là key đã bị xóa**; muốn thay key, nhập key mới vào cùng ô.

Menu hiện có Gemini 2.5 Flash, Gemini 3.7 Flash, Gemini 1.5 Flash và Gemini 2.0 Flash. Đây là danh sách trong mã nguồn, không phải cam kết mọi model còn được Google cung cấp hoặc có quota trong tài khoản của bạn. Nếu model báo không khả dụng, chọn model khác mà project hỗ trợ. Chi phí và hạn mức phụ thuộc dịch vụ Gemini API bạn sử dụng.

### Dùng Chrome AI

1. Chọn **Chrome AI · Gemini Nano trên máy**.
2. Giữ popup mở trong lần chuẩn bị/tải đầu tiên, chờ thông báo sẵn sàng.
3. Bấm nút chạy phù hợp với Canvas hoặc SCORM.

Không cần API key và không có nút “Mở Chrome AI” riêng. Tiện ích tự chuẩn bị khi bạn chọn model hoặc bắt đầu chạy. Từ bản 2.2.3, phiên xử lý dùng **tài liệu nền ẩn**, không tạo tab AI trên thanh tab. Sau khi chuẩn bị xong, bạn có thể đóng popup; trạng thái vẫn được cập nhật khi mở lại popup.

Nếu còn tab **Chrome AI chạy tự động** của bản cũ, hãy đóng tab đó sau khi tải lại tiện ích. Nếu không tạo được tài liệu nền, tiện ích báo lỗi để bạn xử lý; không tự mở một tab thay thế.

Bản này kiểm tra `LanguageModel` và `Translator`. Luồng chuẩn bị chung có thể tải Gemini Nano cùng bộ dịch Việt–Anh; riêng SCORM dùng dịch để xử lý câu hỏi tiếng Việt. Nếu Chrome báo thiếu API hoặc phần cứng không hỗ trợ, xem [tài liệu Built-in AI của Chrome](https://developer.chrome.com/docs/ai/built-in), hoặc tự chọn Gemini API. Tiện ích không tự đổi sang API khi Chrome AI lỗi.

## 3. Sử dụng

Popup tự nhận diện trang đang mở và chọn thẻ **Canvas** hoặc **SCORM**. Bạn vẫn có thể đổi thẻ bằng tay. Nên bấm **Dừng** trước khi đổi AI rồi bắt đầu lại để dùng cấu hình mới.

### Canvas

Mở bài kiểm tra Canvas. Chọn chế độ trong popup hoặc bảng điều khiển nhỏ trên trang:

| Nút | Hoạt động |
| --- | --- |
| **Tự động làm** | Giải các câu đọc được, chọn đáp án và chuyển câu khi có nút phù hợp. Khi hết câu, chế độ này không tự nộp toàn bộ bài; bạn kiểm tra và nộp trên Canvas. |
| **Làm đến 10 điểm** | Giải câu hỏi, kiểm tra đã trả lời đủ, tự nộp bài, đọc kết quả rồi làm lại khi Canvas còn cho phép. Dừng khi điểm lần làm đạt từ 10 trở lên hoặc gặp điều kiện không thể tiếp tục. |
| **Dừng** | Dừng vòng tự động và hủy yêu cầu AI đang xử lý nếu có. Thao tác đã gửi tới Canvas trước đó không được hoàn tác. |

**“10 điểm” là số điểm thực tế Canvas hiển thị**, không tự quy đổi về thang 10 hay 100%. Bài có điểm tối đa dưới 10 không phù hợp với chế độ này; bài thang 20 vẫn có ngưỡng dừng là 10. Chế độ không bảo đảm sẽ đạt 10: AI có thể sai, bài có thể hết lượt, bị khóa hoặc thiếu kết quả từng câu để tiếp tục.

Phần Canvas hiện xử lý giao diện **Classic Quizzes** có lựa chọn một đáp án (`radio`) hoặc nhiều đáp án (`checkbox`). Chưa hỗ trợ đầy đủ New Quizzes nằm trong iframe khác, câu tự luận, kéo thả hoặc câu chỉ có ảnh mà không đọc được nội dung chữ.

### SCORM (video bài giảng)

1. Mở video bài giảng bất kỳ trên canvas và bắt đầu phát nội dung.
2. Mở popup, chọn **SCORM → Bắt đầu**.
3. Theo dõi trạng thái trong popup; bấm **Dừng** khi muốn kết thúc thủ công.

Từ bản 2.2.5, thứ tự khi bấm **Bắt đầu** là: **bật hỗ trợ chạy nền → kiểm tra/chuẩn bị AI → xử lý câu hỏi và chuyển slide**. Video đang phát được hỗ trợ chạy nền ngay trong lúc chờ AI. Giai đoạn này chưa tự chọn đáp án hay chuyển slide. Bấm **Dừng** sẽ tắt cả hỗ trợ chạy nền và yêu cầu bắt đầu đang chờ; AI sẵn sàng sau đó cũng không tự bật lại bài học. Việc chọn model để tải trước trong popup vẫn dùng được độc lập.

Khi đang chạy, tiện ích:

- Đợi video/thanh thời gian kết thúc và nút **Tiếp theo** khả dụng rồi mới chuyển slide.
- Xử lý câu trắc nghiệm khi đọc đủ câu hỏi và lựa chọn, sau đó chọn và gửi đáp án.
- Bấm **Tiếp tục học** hoặc **Học lại/Thử lại** theo phản hồi nhận diện được. Với câu ôn tập, có thể mở lại mục câu hỏi khi mục đó đã được mở khóa.
- Khi **câu hỏi video bị chấm sai**, bấm **Học lại / Thử lại / Tiếp tục học** rồi quay về đúng mục video đã ghi nhớ trước khi bấm nút. Một số bài dùng cùng hành động xem lại nhưng đặt tên nút khác nhau; tiện ích dựa vào phản hồi sai để phân biệt với thao tác tiếp tục sau khi trả lời đúng. Nếu bài phát lại video, yêu cầu trình phát tua khoảng **98%**, kiểm tra video thực sự đã tua rồi chờ phần cuối trước khi trả lời lại. Nếu câu hỏi mở lại ngay thì không cần tua. Chỉ áp dụng khi xác định được video của câu hỏi; không áp dụng cho lượt xem đầu, câu ôn tập hay slide hoàn thành.
- Bật hỗ trợ chạy nền khi đổi tab. Cơ chế này không tua video và không bảo đảm hoạt động trên mọi cấu hình Chrome/trang học.
- Tự dừng khi nhận diện slide hoàn thành bài học và thanh thời gian của slide đó kết thúc.

Nếu không nhận diện được timeline, câu hỏi hoặc phản hồi, tiện ích có thể chờ hoặc dừng để bạn kiểm tra. Bản này được xây dựng theo giao diện Storyline/SCORM đã quan sát, không phải bộ điều khiển chung cho mọi hệ thống SCORM.

Từ bản 2.2.6, lịch sử thử đáp án SCORM được đối chiếu theo **nội dung câu hỏi và lựa chọn trong cùng mục bài học**, kể cả khi bài đảo vị trí đáp án. Lịch sử này dùng trong phiên Bắt đầu hiện tại. Với câu một đáp án, nếu AI lặp lựa chọn đã bị chấm sai, tiện ích thử một lựa chọn chưa bị loại. Mặc định tối đa 3 lần; nếu còn đúng một lựa chọn chưa bị chấm sai thì được thử thêm lựa chọn đó. Chỉ ghi nhận đúng khi bài học xác nhận, không coi lựa chọn thử là đáp án đúng để xuất Excel. Câu nhiều đáp án không áp dụng suy luận lựa chọn cuối; tiện ích dừng nếu AI tiếp tục đưa ra tổ hợp đã sai.

Từ bản 2.2.7, bạn có thể bấm **Bắt đầu** ngay trên màn hình báo sai: tiện ích ghi nhớ mục bài học đang được chọn, bấm nút xem lại, đợi phần giới thiệu mở rồi chọn lại đúng mục video và tua khoảng 98%. Trường hợp này không tự tạo lịch sử cho đáp án đã gửi trước khi tiện ích chạy. Câu ôn tập vẫn được mở lại trực tiếp, không tua video.

Bản 2.2.8 sửa lỗi chờ mãi ở bước nhận diện video trước khi tua. Storyline có thể gắn `aria-hidden="true"` lên đối tượng video đang hiển thị vì đã có phần tử riêng cho trình đọc màn hình. Tiện ích nhận diện riêng trường hợp này, vẫn bỏ qua video bị ẩn bằng CSS, slide ẩn và video tải trước trong thư viện của trình phát.

Việc tua khi xem lại dùng sự kiện `change` của thanh thời gian Storyline, không sửa điểm hoặc trạng thái hoàn thành. Nếu trình phát không chấp nhận thao tác, mục video bị khóa hoặc không xác nhận được video đã tua, tiện ích dừng và báo lý do.

Bản 2.2.4 sửa việc bắt đầu sau khi tab đã bị ẩn: trình phát được thông báo trạng thái hiển thị mới để khôi phục phần đã tạm dừng do đổi tab. Khi Chrome trì hoãn bộ định nhịp, tiện ích kiểm tra lại phiên chạy trước khi quyết định tắt hỗ trợ nền. Nút tạm dừng thủ công và điểm dừng câu hỏi vẫn do trình phát quản lý.

## 4. Xuất câu hỏi Excel

Nút **Xuất câu hỏi Excel** lấy kho đã lưu của **cả Canvas lẫn SCORM**, không phụ thuộc thẻ đang chọn trong popup.

### Thu thập và tải file

1. Với **Canvas**, mở trang bài tập hoặc trang kết quả. Trang kết quả giúp xác nhận đáp án đúng; tiện ích cũng đọc các liên kết lịch sử của chính bài đó còn được phép xem. Không cần bật chế độ tự làm chỉ để thu thập kết quả.
2. Với **SCORM**, nội dung câu hỏi và phản hồi được lưu khi tiện ích đang chạy bằng nút **Bắt đầu**.
3. Bấm **Xuất câu hỏi Excel** và giữ popup mở tới khi file tải xuống.
4. Giải nén file `Cau-hoi-YYYY-MM-DD.zip`. Mỗi thư mục là một nhóm học phần/bài học, mỗi `.xlsx` thuộc một bài tập.

Tên lấy từ trang khi đọc được; nếu thiếu tên, tiện ích dùng mã để phân biệt. Canvas phân nhóm theo học phần và quiz. SCORM phân nhóm theo URL bài học và mục/slide câu hỏi; các bài học ở URL khác nhau không tự được gộp thành một môn.

### Chỉ xuất đáp án đã xác nhận đúng

- Một câu được xuất khi có bằng chứng được chấm đúng và không có kết quả mâu thuẫn. Không xuất câu chỉ có dự đoán AI, câu chỉ làm sai hoặc chưa được chấm.
- Nếu từng chọn sai A, B rồi được chấm đúng C, cột **Correct Answer** chỉ ghi lựa chọn C. Các phương án A/B/C/D gốc vẫn giữ để tạo câu trắc nghiệm.
- Khi Canvas ẩn đáp án đúng nhưng lựa chọn đã chọn được chấm đủ điểm cho **riêng câu đó**, ví dụ `0,6/0,6`, vẫn có thể xác nhận lựa chọn đó. Không suy ra đáp án từ tổng điểm toàn bài.
- Gộp câu trùng trong cùng bài tập theo nội dung và tập lựa chọn, kể cả đảo thứ tự đáp án. Các bộ lựa chọn khác nhau hoặc bài tập khác nhau vẫn được giữ riêng.
- Lịch sử chọn sai và dự đoán AI chỉ lưu bên trong extension, không có sheet lịch sử trong file xuất. Nếu chưa có câu đạt điều kiện, tiện ích báo lý do và không tạo file.

### Cấu trúc XLSX

Sheet **Create a Quiz** giữ 11 cột và hàng hướng dẫn theo mẫu `QuizizzSampleSpreadsheetUpdated_v2.xlsx`. Câu hỏi bắt đầu ở hàng 3.

| Cột | Nội dung |
| --- | --- |
| `Question Text` | Nội dung câu hỏi |
| `Question Type` | `Multiple Choice` cho một đáp án; `Checkbox` cho nhiều đáp án |
| `Option 1` … `Option 5` | Các lựa chọn gốc |
| `Correct Answer` | Số thứ tự đáp án bắt đầu từ 1; ví dụ `3` hoặc `1,3` |
| `Time in seconds` | Để trống trong bản hiện tại |
| `Image Link` | Để trống trong bản hiện tại |
| `Answer explanation` | Ghi nhận đã được bài chấm đúng, không phải lời giải chi tiết của AI |

Câu có trên 5 lựa chọn được giữ đủ trong sheet **Câu trên 5 lựa chọn**. Sheet này là dữ liệu bổ sung, cần xử lý riêng trước khi nhập vào công cụ chỉ nhận 5 lựa chọn. Đã kiểm tra cấu trúc XLSX bằng bộ đọc độc lập; chưa xác nhận nhập trực tiếp vào Quizizz.

**Giới hạn lịch sử cũ:** kho đầy đủ bắt đầu từ bản 2.2.0. Cache ở các bản trước không giữ đủ nội dung để khôi phục mọi câu hỏi. Muốn lấy lượt Canvas cũ, mở lại trang kết quả mà hệ thống còn cho xem. Tiện ích không tự quét toàn bộ tài khoản, không khôi phục được nội dung đã mất hoặc bị hệ thống ẩn hoàn toàn.

## 5. Cập nhật và giữ dữ liệu

1. Dừng các chế độ đang chạy.
2. Tải mã nguồn mới và cập nhật vào **đúng thư mục đã dùng để cài tiện ích**. Nếu dùng Git, chạy `git pull` trong bản clone đó.
3. Tại `chrome://extensions`, bấm biểu tượng **Tải lại** trên thẻ tiện ích.
4. F5 các trang học đang mở, rồi mở popup và chạy lại.

Cấu hình và kho câu hỏi nằm trong hồ sơ Chrome, không nằm trong thư mục mã nguồn. Tải lại cùng tiện ích giữ dữ liệu; gỡ tiện ích hoặc xóa dữ liệu hồ sơ có thể làm mất kho. Xuất Excel giúp giữ các câu đã xác nhận đúng, nhưng **không phải bản sao lưu toàn bộ lịch sử/cấu hình** và hiện chưa có chức năng nhập lại kho từ XLSX.

## 6. Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| Không cài được, báo thiếu `manifest.json` | Giải nén ZIP và chọn thư mục `extension`, không chọn thư mục ngoài cùng. |
| `Extension context invalidated` hoặc tab chưa kết nối kho câu hỏi | Tải lại tiện ích tại `chrome://extensions`, sau đó F5 trang học. |
| Ô API key trống sau khi lưu | Xem dòng **Đã lưu key**. Tiện ích che key bằng cách làm trống ô hiển thị. |
| Gemini báo lỗi key, model không khả dụng hoặc `429` | Kiểm tra key/quyền model và quota trong Google AI Studio; làm theo thông báo chờ hoặc đổi model phù hợp. |
| Chrome AI không sẵn sàng hoặc tải chưa xong | Giữ popup mở trong lần chuẩn bị đầu. Nếu thiếu API/phần cứng hỗ trợ, dùng Gemini API. |
| Chrome báo không hỗ trợ tài liệu AI chạy ẩn | Cập nhật Chrome và tải lại tiện ích để áp dụng quyền `offscreen`, sau đó F5 trang học. Nếu vẫn lỗi, xem thông báo trong popup hoặc chọn Gemini API. |
| Đã làm bài nhưng chưa có câu để xuất | Mở trang kết quả. Mỗi câu cần bằng chứng chấm đúng; chỉ được AI chọn đáp án chưa đủ điều kiện. |
| Tổng bài đạt 10 nhưng không xuất đủ số câu | Kiểm tra điểm và lựa chọn hiển thị ở từng câu. Câu thiếu dữ liệu, mâu thuẫn hoặc trùng sẽ không được xuất như câu độc lập mới. |
| SCORM chờ mãi ở timeline hoặc nút tiếp tục | Kiểm tra video đang phát, nút đã mở khóa và câu hỏi đã hiện đủ; giao diện khác mẫu nhận diện có thể cần chỉnh mã nguồn. |
| Video dừng khi đổi tab | Sau khi cập nhật, tải lại tiện ích **và F5 trang học**, rồi bấm Bắt đầu. Chỉ tải lại tiện ích chưa thay được mã chạy nền đã nạp vào trang cũ. Nếu Chrome đóng băng tab hoặc máy ngủ, mã trong trang cũng không thể chạy trong thời gian đó. |
| Canvas dừng trước khi đạt 10 | Đọc thông báo: có thể bài hết lượt, khóa, thiếu kết quả từng câu, AI lỗi hoặc điểm tối đa dưới 10. |

## 7. Dữ liệu và quyền truy cập

API key, cấu hình AI, cache và lịch sử được lưu bằng `chrome.storage.local`. Trạng thái phiên chạy dùng `chrome.storage.session`. Key được che trên giao diện nhưng tiện ích **không tự mã hóa key bằng mật khẩu riêng**.

Khi dùng Gemini API, nội dung câu hỏi, các lựa chọn và ngữ cảnh phản hồi liên quan được gửi tới Google để giải. Chrome AI thực hiện suy luận qua mô hình trên máy; lần tải mô hình/bộ dịch cần mạng. Quá trình tạo XLSX diễn ra trong extension và không gửi kho câu hỏi tới dịch vụ xuất file bên ngoài.

| Quyền trong manifest | Mục đích |
| --- | --- |
| `storage` | Lưu cấu hình, key, lịch sử và trạng thái |
| `unlimitedStorage` | Cho phép kho câu hỏi vượt quota mặc định của `storage.local`; vẫn phụ thuộc dung lượng máy |
| `activeTab`, `scripting` | Kết nối và chèn mã điều khiển/thu thập vào trang phù hợp |
| `offscreen` | Duy trì tài liệu AI ẩn, không mở tab hoặc cửa sổ AI |
| `https://*/*`, `http://*/*` | Hỗ trợ các tên miền Canvas, trang SCORM và gọi Gemini API |
| `file://*/*` | Hỗ trợ mở mẫu HTML cục bộ khi bật quyền truy cập URL tệp trong Chrome |

Quyền host khai báo rộng, nhưng các bộ thu thập/điều khiển có điều kiện nhận diện trang riêng. Bộ SCORM nhắm tới `scorm.eduone.io.vn`; bộ Canvas cần đường dẫn quiz và cấu trúc DOM phù hợp. API key, token đăng nhập, dữ liệu trang học cá nhân và các file xuất không được đưa vào repository.

## 8. Dành cho người phát triển

Tiện ích dùng **Manifest V3**, JavaScript/CSS thuần và một service worker chung. Mã trong `extension/` được nạp trực tiếp vào Chrome, không cần bước build.

| Thành phần | Vai trò |
| --- | --- |
| `extension/suite-popup.html`, `suite.js`, `suite.css` | Giao diện và thao tác trong popup |
| `extension/suite-background.js`, `shared-settings.js` | Điều phối worker và cấu hình AI dùng chung |
| `extension/content.js`, `core.js`, `background.js`, `playback.js` | Nhận diện và xử lý bài học SCORM |
| `extension/canvas/`, `canvas-compat.js`, `canvas-controls.js` | Mã Canvas và các lớp tích hợp |
| `extension/builtin-engine.js`, `ai.html`, `ai-host.js` | Chuẩn bị Chrome AI và xử lý yêu cầu suy luận |
| `extension/ai-offscreen.html`, `ai-offscreen.js` | Tài liệu ẩn chứa iframe AI cùng nguồn; điều khiển kết nối lại khi worker khởi động lại |
| `extension/archive-content.js`, `question-bank.js` | Thu thập, lưu lâu dài, phân nhóm và đối chiếu đáp án |
| `extension/bank-export.js`, `xlsx-export.js` | Lọc câu đã chấm đúng và tạo ZIP/XLSX |
| `tests/` | Kiểm thử Node.js và DOM mô phỏng bằng jsdom |

Luồng Chrome AI: popup chuẩn bị mô hình nếu cần → worker tạo hoặc dùng lại một tài liệu offscreen → iframe `ai.html` xử lý yêu cầu qua `chrome.runtime.Port`. Tài liệu offscreen dùng lý do `IFRAME_SCRIPTING` để chứa và điều khiển iframe AI, bao gồm khôi phục kết nối mà không tạo lại engine. Cả hai mô-đun dùng chung tài liệu này. Tab `ai.html` mở trực tiếp không khởi tạo engine để tránh tranh kết nối với phiên ẩn.

Tham khảo [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) về tài liệu ẩn và [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) về hỗ trợ iframe cùng nguồn. Phần host chỉ dùng `chrome.runtime` để trao đổi với worker; các thao tác storage/tab nằm ở worker hoặc popup.

### Chạy kiểm thử

Dùng Node.js 22 trở lên, mở terminal tại thư mục repository:

```sh
npm ci
npm test
```

Bản 2.2.8 đã đạt **182 kiểm thử**. Các kiểm thử sử dụng dữ liệu mô phỏng, không đăng nhập hay nộp bài trên tài khoản thật. Phạm vi gồm cấu hình AI, luồng Canvas/SCORM, đối chiếu đáp án khi đảo lựa chọn, quay lại đúng video và xác nhận tua 98%, bật chạy nền trước khi chuẩn bị AI, khởi động trong tab ẩn và khôi phục sau khi bộ định nhịp bị trễ, tạo và kết nối lại tài liệu AI ẩn, hủy thao tác, lưu lịch sử, lọc trùng, bảo vệ dữ liệu và xuất file. Bộ kiểm thử không chạy mô hình Gemini Nano thực tế; khả năng suy luận trong tài liệu ẩn và thao tác tua cần được kiểm tra thêm trên Chrome/trang học đang sử dụng. Đây không phải bảo đảm tương thích với mọi phiên bản giao diện của hệ thống học.

### Đồng bộ mã Canvas gốc

`scripts/build-canvas.cjs` chỉ dành cho người bảo trì có thư mục mã Canvas nguồn:

```sh
node scripts/build-canvas.cjs "/path/to/canvas-source"
```

Lệnh ghi lại các tệp tương ứng trong `extension/canvas/` và cập nhật hash tại `upstream-hashes.json`; không cần chạy khi cài đặt hoặc dùng tiện ích. Hash chuẩn hóa xuống dòng cho phép kiểm tra mã gốc trên các hệ điều hành khác nhau.
