# Auto Canvas SCOM Phenikaa

Tiện ích Chrome hỗ trợ làm bài trắc nghiệm trên Canvas, xem video bài giảng và làm bài tập theo dõi bài học SCORM. Phiên bản hiện tại: **2.4.1**.

Tên repository giữ chữ `scom`; tên kỹ thuật của định dạng bài học là **SCORM**. Khi cài vào Chrome, tiện ích hiển thị tên **Trợ lý học tập · Canvas & SCORM**.

[Cài đặt](#1-cài-đặt) · [Chọn AI](#2-chọn-ai) · [Sử dụng](#3-sử-dụng) · [Xử lý lỗi](#6-xử-lý-lỗi-thường-gặp)

## 1. Cài đặt

Bạn cần Chrome trên máy tính và tài khoản đã đăng nhập vào trang học. Manifest cho phép cài từ Chrome 111; **Chrome AI có thêm yêu cầu riêng về trình duyệt và phần cứng**. Cài được tiện ích chưa có nghĩa là dùng được AI trên máy.

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

Bấm biểu tượng tiện ích để mở cửa sổ điều khiển, gọi là **popup**. Mục **Mô hình AI** dùng chung cho cả Canvas và SCORM. Cấu hình chỉ tồn tại trong RAM của phiên tiện ích, không có trang cài đặt riêng.

| Lựa chọn | Cách xử lý câu hỏi | Cần chuẩn bị |
| --- | --- | --- |
| Gemini API | Gửi nội dung câu hỏi và lựa chọn tới Gemini API của Google | API key hợp lệ, mạng và hạn mức cho model đã chọn |
| Groq · GPT-OSS 120B + Tavily | Tìm kiếm web qua Tavily, đưa nội dung nguồn cho Groq suy luận | Key Groq và key Tavily |
| Cloudflare · GPT-OSS 120B + Tavily | Tìm kiếm Tavily rồi gọi Workers AI | Token Cloudflare có quyền Workers AI: Read, Account ID 32 ký tự và key Tavily |
| OpenRouter · Mô hình miễn phí + Tavily | Dùng `openrouter/free` chọn một model miễn phí hỗ trợ JSON; Tavily tìm kiếm riêng | Key OpenRouter và key Tavily |
| 9Router · AI + tìm kiếm trên VPS | Tìm kiếm rồi suy luận qua cùng máy chủ 9Router | Một key 9Router, URL máy chủ, tên model AI/combo và model tìm kiếm |
| Gemini 2.5 Flash + Google Search | Gọi công cụ Google Search tích hợp trong Gemini | Một key Gemini; project có quyền/model/hạn mức phù hợp |
| Chrome AI · Gemini Nano trên máy | Chạy mô hình qua API AI tích hợp của Chrome | Trình duyệt/phần cứng hỗ trợ; tải mô hình và bộ dịch cần thiết |

### Dùng Gemini API

1. Tạo hoặc lấy API key theo [hướng dẫn Gemini API của Google](https://ai.google.dev/gemini-api/docs/api-key).
2. Trong popup, chọn một model Gemini mà project của bạn có quyền sử dụng.
3. Dán key vào ô **Gemini API key**.
4. Khi nhập key, tiện ích nhận ngay vào RAM của phiên Chrome, dùng chung cho Canvas và SCORM. Dòng **Key tạm trong RAM đã sẵn sàng** xác nhận key đã nhận; đóng/mở popup không làm xóa key.
5. Bấm **Bắt đầu** hoặc chế độ Canvas cần chạy. Thao tác khởi động Gemini API được worker tiếp tục xử lý kể cả khi đóng popup ngay sau khi bấm.

Key chỉ dùng tạm trong phiên Chrome, không ghi xuống đĩa. Ô nhập được làm trống khi bấm chạy để che key; mở lại popup vẫn nhận diện được key tạm và không bắt nhập lại. Bấm Dừng, kết thúc lượt, đóng tab hoặc chuyển sang bài khác không xóa key. Key chỉ mất khi Chrome thực sự thoát; nhập key mới sẽ thay key đang dùng. Chrome cũng tự xóa bộ nhớ phiên khi tải lại, cập nhật, vô hiệu hóa hoặc gỡ tiện ích.

Chrome hỗ trợ `storage.session` giữ key và lựa chọn AI trong RAM ngay cả khi service worker tự khởi động lại. Không gọi `setAccessLevel` để dùng vùng nhớ này. Nếu máy thiếu/chặn API bộ nhớ phiên, tiện ích dùng RAM của worker; ở chế độ dự phòng đó, worker khởi động lại sẽ mất key và cần nhập lại. Key không được hiển thị lại trên popup hoặc ghi vào `storage.local`.

Chọn model mà project Google của bạn được phép sử dụng. Danh sách trong tiện ích là danh sách tĩnh; thông báo của API quyết định model và hạn mức có thực sự khả dụng hay không.

### AI kết hợp tìm kiếm web (2.4.0)

Chọn một trong bốn phương án có tìm kiếm trong popup. Giao diện tự hiện đúng ô nhập:

- **Groq + Tavily:** hai key. Lấy key tại [Groq Console](https://console.groq.com/keys) và [Tavily](https://app.tavily.com).
- **Cloudflare + Tavily:** token Cloudflare, Account ID và key Tavily. Tạo token có quyền **Workers AI: Read**, giới hạn đúng account; Account ID không phải API key. Xem [hướng dẫn Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/).
- **OpenRouter + Tavily:** hai key, lấy key AI tại [OpenRouter](https://openrouter.ai/keys). Tiện ích chọn `openrouter/free`, không dùng model có phí, plugin tìm kiếm có phí hay `:online`. Router có thể thay đổi model thực tế theo danh sách và khả năng hỗ trợ JSON.
- **Gemini + Google Search:** chỉ một key Gemini; lựa chọn riêng dùng Gemini 2.5 Flash. Google tự quyết định có thực hiện tìm kiếm cho câu hỏi hay không. Nếu API không trả nguồn, giao diện ghi rõ chưa xác nhận bằng nguồn ngoài.

Key AI được giữ riêng theo nhà cung cấp trong RAM của phiên Chrome; Gemini thường và Gemini + Google Search dùng chung key Google. Key Tavily dùng chung cho ba phương án ghép. Đóng popup, Dừng hoặc đổi phương án không xóa các key đã nhập. Không hiện lại key thật; đổi phương án làm trống các ô nhập để tránh gửi nhầm key. Tất cả vẫn mất khi thoát hẳn Chrome hoặc tải lại tiện ích; vùng nhớ phiên bị chặn thì dùng RAM worker như giải thích ở trên.

Các phương án web xử lý **từng câu riêng**. Với Tavily, mỗi câu gửi một lượt tìm kiếm `fast`, lấy tối đa ba nguồn với đoạn trích có giới hạn; câu hỏi đầy đủ và đáp án vẫn gửi nguyên vẹn cho AI. Chuỗi truy vấn tối đa 400 ký tự Unicode. Ngữ cảnh câu hỏi có thể được gửi cả nhà cung cấp tìm kiếm và AI. Cần mạng; không tải model hay cài phần mềm tìm kiếm về máy.

Kết quả hiển thị liên kết **Nguồn tham khảo** trên Canvas và bảng nguồn nhỏ trên SCORM. Với Google Search, gợi ý tìm kiếm do Google trả về được hiển thị trong iframe cách ly không cho chạy script. Các liên kết/nguồn này chỉ ở trang đang mở, không ghi vào kho đáp án hay đĩa.

**Không tự thử lại cho bốn phương án web mới:** nếu lỗi mạng, timeout, key, quyền, model hay quota, tiện ích báo đúng bên gặp lỗi và dừng. Không tự đổi nhà cung cấp hoặc bỏ tìm kiếm. Tavily lỗi/không trả nguồn thì chưa gọi AI. Dừng hủy yêu cầu đang chạy và ngăn yêu cầu đang đọc key tiếp tục gửi API. Gemini thường giữ chính sách thử lại đã có trong bản 2.3.2.

Miễn phí phụ thuộc tài khoản và hạn mức của nhà cung cấp, không phải miễn phí vô hạn. Đối chiếu [Groq](https://console.groq.com/docs/rate-limits), [Cloudflare](https://developers.cloudflare.com/workers-ai/platform/pricing/), [OpenRouter Free Router](https://openrouter.ai/docs/guides/routing/routers/free-router), [Tavily](https://docs.tavily.com/documentation/api-credits) và [Google](https://ai.google.dev/gemini-api/docs/pricing). Không cần bật gói trả phí để dùng các lựa chọn này trong hạn mức cho phép. Nếu tài khoản của bạn đã bật tính phí tự động, chính sách tính phí thuộc tài khoản đó.

OpenRouter BYOK có thể quản lý key nhà cung cấp tại máy chủ OpenRouter, nhưng đây là cơ chế khác với key RAM trong tiện ích. Phiên bản này không gửi key Groq/Gemini/Cloudflare sang OpenRouter để tạo BYOK và không đăng ký dịch vụ tính phí thay bạn.

### Dùng 9Router trên VPS (2.4.1)

Tiện ích hỗ trợ một đầu mối 9Router cho cả Canvas và SCORM. 9Router phải được cài và chạy sẵn trên VPS hoặc máy chủ riêng; phiên bản tiện ích không tự cài, thuê VPS hoặc tạo tài khoản nhà cung cấp.

1. Trong dashboard 9Router, cấu hình ít nhất một kết nối **AI** và một kết nối **Web Search** (Tavily, Exa, Brave, Perplexity… theo phiên bản bạn dùng). Nhập các key của nhà cung cấp ở 9Router, không nhập chúng vào ô key của tiện ích.
2. Bật yêu cầu API key cho gateway, tạo key 9Router và dùng HTTPS khi truy cập VPS từ bên ngoài.
3. Trong popup tiện ích, chọn **9Router · AI + tìm kiếm trên VPS**.
4. Nhập **9Router API key** và **Địa chỉ 9Router**, ví dụ `https://router.example.com/v1`. Có thể nhập URL gốc hoặc đường dẫn reverse proxy; tiện ích thêm `/v1` khi thiếu. Không nhập endpoint `/chat/completions` hay `/search`, thông tin đăng nhập, query hoặc fragment vào URL. HTTP chỉ được chấp nhận cho `localhost`, `127.0.0.1` hoặc `[::1]` khi thử trên cùng máy.
5. Nhập đúng tên **Model AI hoặc combo** đã cấu hình trong 9Router. Lấy ID từ dashboard hoặc API `/v1/models`; không dùng tên hiển thị khác với ID.
6. Nhập **Model tìm kiếm**, ví dụ `tavily/search`, `exa/search` hoặc tên combo tìm kiếm đã cấu hình. Lấy ID từ danh sách Web Search hoặc `/v1/models/web`. Đây là tên model, không phải API key thứ hai.
7. Bấm chế độ chạy phù hợp.

Tiện ích gửi một yêu cầu `/v1/search`, lấy tối đa ba nguồn, rồi gửi nội dung nguồn cùng câu hỏi tới `/v1/chat/completions`. Cả hai dùng **cùng key 9Router** và cùng địa chỉ máy chủ. Kết quả `snippet`/`content` được xử lý như dữ liệu nguồn; các đáp án vẫn được kiểm tra trước khi chọn. Không gọi Tavily/OpenRouter trực tiếp khi bạn chọn 9Router.

Key gateway và cấu hình phía tiện ích giữ trong RAM theo phiên Chrome, có thể khôi phục sau khi đóng popup hoặc worker khởi động lại. Thay địa chỉ gateway làm vô hiệu key cũ để tránh gửi nhầm key sang máy chủ khác; nhập lại key đúng máy chủ. Bản này không tự đăng ký BYOK hay gửi các key khác sang VPS.

**Việc lưu dữ liệu trên VPS do 9Router quản lý riêng:** key nhà cung cấp có thể được lưu trong database 9Router; thoát Chrome không xóa chúng. Tắt request/response logging (`ENABLE_REQUEST_LOGS=false`) nếu không muốn 9Router ghi nội dung câu hỏi/đáp án. Không bật các chế độ lưu prompt/response khác trên gateway. Tiện ích không ghi đáp án hoặc nguồn web xuống đĩa.

Phía tiện ích không tự thử lại hay đổi model khi 9Router lỗi, và nút Dừng hủy yêu cầu đang chạy. Combo hoặc retry cấu hình trên 9Router vẫn có thể thực hiện các lượt thử/đổi provider phía VPS; chọn model trực tiếp nếu muốn hạn chế hành vi đó. Gateway thêm một bước mạng và không loại bỏ được lỗi/quota của nhà cung cấp. Token Saver của 9Router được yêu cầu tắt cho lượt chat này để giữ nguyên câu hỏi/đáp án và định dạng trả lời.

Hướng dẫn gốc: [9Router](https://github.com/decolua/9router), [Docker](https://github.com/decolua/9router/blob/master/DOCKER.md), [Chat API](https://github.com/decolua/9router/blob/master/skills/9router-chat/SKILL.md), [Web Search API](https://github.com/decolua/9router/blob/master/skills/9router-web-search/SKILL.md). API và tên model có thể khác ở các bản fork; phần tích hợp này theo giao thức của `decolua/9router`.

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

Từ bản 2.2.6, lịch sử thử đáp án SCORM được đối chiếu theo **nội dung câu hỏi và lựa chọn trong cùng mục bài học**, kể cả khi bài đảo vị trí đáp án. Lịch sử này dùng trong phiên Bắt đầu hiện tại. Với câu một đáp án, nếu AI lặp lựa chọn đã bị chấm sai, tiện ích thử một lựa chọn chưa bị loại. Mặc định tối đa 3 lần; nếu còn đúng một lựa chọn chưa bị chấm sai thì được thử thêm lựa chọn đó. Chỉ ghi nhận đúng khi bài học xác nhận, không coi lựa chọn thử là đáp án đúng khi chưa có phản hồi xác nhận. Câu nhiều đáp án không áp dụng suy luận lựa chọn cuối; tiện ích dừng nếu AI tiếp tục đưa ra tổ hợp đã sai.

Từ bản 2.2.7, bạn có thể bấm **Bắt đầu** ngay trên màn hình báo sai: tiện ích ghi nhớ mục bài học đang được chọn, bấm nút xem lại, đợi phần giới thiệu mở rồi chọn lại đúng mục video và tua khoảng 98%. Trường hợp này không tự tạo lịch sử cho đáp án đã gửi trước khi tiện ích chạy. Câu ôn tập vẫn được mở lại trực tiếp, không tua video.

Bản 2.2.8 sửa lỗi chờ mãi ở bước nhận diện video trước khi tua. Storyline có thể gắn `aria-hidden="true"` lên đối tượng video đang hiển thị vì đã có phần tử riêng cho trình đọc màn hình. Tiện ích nhận diện riêng trường hợp này, vẫn bỏ qua video bị ẩn bằng CSS, slide ẩn và video tải trước trong thư viện của trình phát.

Việc tua khi xem lại dùng sự kiện `change` của thanh thời gian Storyline, không sửa điểm hoặc trạng thái hoàn thành. Nếu trình phát không chấp nhận thao tác, mục video bị khóa hoặc không xác nhận được video đã tua, tiện ích dừng và báo lý do.

Bản 2.2.4 sửa việc bắt đầu sau khi tab đã bị ẩn: trình phát được thông báo trạng thái hiển thị mới để khôi phục phần đã tạm dừng do đổi tab. Khi Chrome trì hoãn bộ định nhịp, tiện ích kiểm tra lại phiên chạy trước khi quyết định tắt hỗ trợ nền. Nút tạm dừng thủ công và điểm dừng câu hỏi vẫn do trình phát quản lý.

## 4. Không lưu đáp án

Bản 2.3.0 bỏ bộ nhớ đệm Gemini, lưu phản hồi chấm Canvas, kho câu hỏi/đáp án và xuất Excel. Mỗi lượt giải Canvas đều gọi AI lại; không lấy đáp án hoặc loại trừ lựa chọn từ lượt cũ. Chế độ **Làm đến 10 điểm** vẫn đọc tổng điểm và làm lại nếu được phép, nhưng không học đáp án từ kết quả cũ, nên có thể lặp lỗi và dùng thêm hạn mức API.

SCORM chỉ giữ các lần thử tạm trong lượt đang chạy để xử lý phản hồi sai; không ghi lịch sử ra đĩa hoặc tái sử dụng sau lần Bắt đầu mới. Các đáp án trên trang và bản nháp Canvas vẫn do hệ thống học quản lý, không phải kho lưu trữ của tiện ích.

Khi nâng cấp, tiện ích thử xóa key cũ và kho đáp án đã lưu. Nếu trình duyệt chặn đọc/xóa, việc dọn này không cản trở khởi động; tiện ích không đọc hoặc dùng lại dữ liệu cũ và không ghi thêm dữ liệu mới. Khi có lại quyền, tải lại tiện ích để thử dọn lần nữa.

## 5. Cập nhật

1. Dừng các chế độ đang chạy.
2. Tải mã nguồn mới và cập nhật vào **đúng thư mục đã dùng để cài tiện ích**. Nếu dùng Git, chạy `git pull` trong bản clone đó.
3. Tại `chrome://extensions`, bấm biểu tượng **Tải lại** trên thẻ tiện ích.
4. F5 các trang học đang mở, rồi mở popup và chạy lại.

Sau khi tải lại tiện ích, bộ nhớ phiên bị Chrome xóa, cấu hình được đặt về mặc định và key phải nhập lại. Mã nguồn trên branch `feature/ai-canvas-enhancements` là bản này; khi tải ZIP, chọn đúng branch trước.

### Lỗi Gemini và thử lại (2.3.2)

Trạng thái Canvas hiển thị model, nguyên nhân từ API, thời gian còn lại và lượt thử tiếp theo. Dòng chờ 1 giây có thể chỉ là giây cuối của bộ đếm; mỗi lần gửi lại đều phải tuân theo thời gian giãn cách, không gọi API mỗi giây.

- Lỗi tần suất **429**: giữ thời gian chờ của bản trước và tôn trọng chỉ dẫn từ Google, không thêm thời gian chờ nhân tạo. Nếu Google không gửi chỉ dẫn, giữ cơ chế dự phòng 5, 10, 20, 40 giây cộng đệm 1 giây vốn có.
- Hết quota ngày hoặc quota model bằng 0: dừng ngay và yêu cầu kiểm tra hạn mức trong Google AI Studio, không lặp thử lại.
- Lỗi tạm thời **408/500/502/503/504**, mạng hoặc timeout: giữ chính sách chờ hiện có rồi thử lại, tôn trọng Retry-After khi Google yêu cầu. Không tự gửi sớm hơn thời điểm Google cho phép.
- Lỗi key, quyền, tín dụng, cấu hình hoặc model **400/401/402/403/404**: dừng với hướng dẫn cụ thể. Không tự chuyển model.
- Tối đa 5 lần thử cho một nhóm; nút Dừng vẫn hủy thời gian chờ. Dừng vì lỗi không xóa key tạm của phiên Chrome.

Tiện ích có thể xử lý lỗi và thời gian chờ, nhưng không tăng được quota tài khoản hoặc khắc phục sự cố dịch vụ của Google.

## 6. Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| Không cài được, báo thiếu `manifest.json` | Giải nén ZIP và chọn thư mục `extension`, không chọn thư mục ngoài cùng. |
| `Extension context invalidated` hoặc tab chưa kết nối | Tải lại tiện ích tại `chrome://extensions`, sau đó F5 trang học. |
| Ô API key trống sau khi Bắt đầu | Key vẫn dùng tạm trong RAM của phiên Chrome. Đóng popup, Dừng hoặc đổi tab/bài không xóa key; xem dòng trạng thái key tạm. |
| `setAccessLevel is not a function` hoặc service worker không đăng ký được | Cập nhật sang bản 2.3.0, tải lại tiện ích và F5 trang học. Bản này không cần API đó để khởi động. |
| Windows chặn truy cập ổ C | Tiện ích không cần ghi key/cấu hình/đáp án ra đĩa để chạy. Quyền cài/chạy tiện ích và quyền truy cập trang/API vẫn phải được trình duyệt cho phép; thông báo chặn ổ C là vấn đề riêng. |
| Gemini báo lỗi key, model không khả dụng hoặc `429` | Kiểm tra key/quyền model và quota trong Google AI Studio; làm theo thông báo chờ hoặc đổi model phù hợp. |
| Chrome AI không sẵn sàng hoặc tải chưa xong | Giữ popup mở trong lần chuẩn bị đầu. Nếu thiếu API/phần cứng hỗ trợ, dùng Gemini API. |
| Chrome báo không hỗ trợ tài liệu AI chạy ẩn | Cập nhật Chrome và tải lại tiện ích để áp dụng quyền `offscreen`, sau đó F5 trang học. Nếu vẫn lỗi, xem thông báo trong popup hoặc chọn Gemini API. |
| SCORM chờ mãi ở timeline hoặc nút tiếp tục | Kiểm tra video đang phát, nút đã mở khóa và câu hỏi đã hiện đủ; giao diện khác mẫu nhận diện có thể cần chỉnh mã nguồn. |
| Video dừng khi đổi tab | Sau khi cập nhật, tải lại tiện ích **và F5 trang học**, rồi bấm Bắt đầu. Chỉ tải lại tiện ích chưa thay được mã chạy nền đã nạp vào trang cũ. Nếu Chrome đóng băng tab hoặc máy ngủ, mã trong trang cũng không thể chạy trong thời gian đó. |
| Canvas dừng trước khi đạt 10 | Đọc thông báo: có thể bài hết lượt, khóa, thiếu kết quả từng câu, AI lỗi hoặc điểm tối đa dưới 10. |

## 7. Dữ liệu và quyền truy cập

API key và lựa chọn AI giữ trong RAM của phiên Chrome qua `storage.session` nếu có hỗ trợ, với RAM của worker làm dự phòng. Trạng thái chạy dùng RAM của worker. Không ghi mới vào `storage.local`; vùng đó chỉ được đọc/xóa để dọn dữ liệu nhạy cảm của bản cũ. Lỗi quyền lưu trữ không cản trở tiện ích khởi động.

Service worker có thể bị Chrome kết thúc khi không hoạt động. SCORM gửi tín hiệu trạng thái mỗi 15 giây trong lượt đang chạy để duy trì phiên thông thường. Nếu trình duyệt vẫn khởi động lại worker hoặc tab bị đóng băng, trạng thái chạy có thể mất; mở popup và bấm chạy lại. Key còn trong RAM phiên nếu vùng nhớ đó có hỗ trợ, nên không phải nhập lại. Chỉ chế độ dự phòng worker RAM mới mất cả key khi worker khởi động lại.

Khi dùng Gemini API, nội dung câu hỏi, các lựa chọn và ngữ cảnh phản hồi liên quan được gửi tới Google để giải. Chrome AI thực hiện suy luận qua mô hình trên máy; lần tải mô hình/bộ dịch cần mạng.

| Quyền trong manifest | Mục đích |
| --- | --- |
| `storage` | Bộ nhớ phiên RAM cho key tạm và dọn key/kho đáp án của bản cũ nếu quyền cho phép |
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
| `extension/suite-background.js`, `shared-settings.js`, `runtime-storage.js` | Điều phối worker, cấu hình và trạng thái RAM dùng chung |
| `extension/content.js`, `core.js`, `background.js`, `playback.js` | Nhận diện và xử lý bài học SCORM |
| `extension/canvas/`, `canvas-compat.js`, `canvas-controls.js` | Mã Canvas và các lớp tích hợp |
| `extension/builtin-engine.js`, `ai.html`, `ai-host.js` | Chuẩn bị Chrome AI và xử lý yêu cầu suy luận |
| `extension/ai-offscreen.html`, `ai-offscreen.js` | Tài liệu ẩn chứa iframe AI cùng nguồn; điều khiển kết nối lại khi worker khởi động lại |
| `tests/` | Kiểm thử Node.js và DOM mô phỏng bằng jsdom |

Luồng Chrome AI: popup chuẩn bị mô hình nếu cần → worker tạo hoặc dùng lại một tài liệu offscreen → iframe `ai.html` xử lý yêu cầu qua `chrome.runtime.Port`. Tài liệu offscreen dùng lý do `IFRAME_SCRIPTING` để chứa và điều khiển iframe AI, bao gồm khôi phục kết nối mà không tạo lại engine. Cả hai mô-đun dùng chung tài liệu này. Tab `ai.html` mở trực tiếp không khởi tạo engine để tránh tranh kết nối với phiên ẩn.

Tham khảo [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) về tài liệu ẩn và [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) về hỗ trợ iframe cùng nguồn. Phần host chỉ dùng `chrome.runtime` để trao đổi với worker; các thao tác storage/tab nằm ở worker hoặc popup.

### Chạy kiểm thử

Dùng Node.js 22 trở lên, mở terminal tại thư mục repository:

```sh
npm ci
npm test
```

Kiểm thử mô phỏng worker không có `setAccessLevel`/`storage.session`, lưu trữ bị chặn, nhận key thủ công, xóa key, không dùng cache, giao diện popup và luồng Canvas/SCORM. Bộ kiểm thử không chạy Gemini Nano thật, không đăng nhập hoặc nộp bài trên tài khoản thật, và không bảo đảm tương thích với mọi giao diện hệ thống học.

Mã Canvas đã có thay đổi riêng cho chế độ không lưu đáp án; không chép đè từ mã nguồn cũ vì có thể đưa cơ chế lưu trữ trở lại.
