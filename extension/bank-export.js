globalThis.BankExport = (() => {
  const headers = ['Question Text', 'Question Type', 'Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5', 'Correct Answer', 'Time in seconds', 'Image Link', 'Answer explanation'];
  const instructions = ['Text of the question\n\n(required)\n\n\n', 'Question Type\n\n(default is Multiple Choice)\n\n',
    'Text for option 1\n\n(required in all cases except open-ended & draw questions)', 'Text for option 2\n\n(required in all cases except open-ended & draw questions)',
    'Text for option 3\n\n(optional)\n\n\n', 'Text for option 4\n\n(optional)\n\n\n', 'Text for option 5\n\n(optional)\n\n\n',
    'The correct option choice (between 1-5).\n\nLeave blank for "Open-Ended", "Poll", "Draw" and "Fill-in-the-Blank".', 'Time in seconds\n\n(optional, default value is 30 seconds)\n',
    'Link of the image\n\n(optional)\n\n\n', 'Explanation for the answer\n(optional)\n\n\n'];
  const numbers = (entry, answers) => answers.map(text => entry.question.options.indexOf(text) + 1).sort((a, b) => a - b).join(',');
  const filename = value => (String(value).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 85) || 'Chưa có tên');
  function sheets(entries) {
    entries = entries.filter(entry => QuestionBank.result(entry).verified);
    const rows = [headers, instructions], overflow = [];
    const maxOptions = entries.reduce((max, entry) => Math.max(max, entry.question.options.length), 5);
    const optionHeaders = Array.from({length: maxOptions}, (_, i) => 'Option ' + (i + 1));
    overflow.push(['Question Text', 'Question Type', ...optionHeaders, 'Correct Answer', 'Ghi chú']);
    for (const entry of entries) {
      const q = entry.question, outcome = QuestionBank.result(entry), type = q.multiple ? 'Checkbox' : 'Multiple Choice';
      const correct = numbers(entry, outcome.answers);
      const explanation = outcome.status;
      if (q.options.length <= 5) rows.push([q.text, type, ...Array.from({length: 5}, (_, i) => q.options[i] || ''), correct, '', '', explanation]);
      else overflow.push([q.text, type, ...Array.from({length: maxOptions}, (_, i) => q.options[i] || ''), correct, 'Mẫu Quizizz chỉ hỗ trợ 5 lựa chọn. ' + explanation]);
    }
    const out = [{name: 'Create a Quiz', rows, instructions: true, widths: [70, 23, 35, 35, 35, 35, 35, 20, 19, 30, 65]}];
    if (overflow.length > 1) out.push({name: 'Câu trên 5 lựa chọn', rows: overflow, widths: [70, 23, ...optionHeaders.map(() => 35), 22, 65]});
    return out;
  }
  function build(entries, warning = '') {
    if (!entries.length) throw Error('Chưa có câu hỏi đã lưu. Mở bài tập hoặc trang kết quả rồi xuất lại.');
    const total = entries.length;
    entries = entries.filter(entry => QuestionBank.result(entry).verified);
    const skipped = total - entries.length;
    if (!entries.length) throw Error('Chưa có câu nào có đáp án được bài chấm đúng và không mâu thuẫn. Chưa tạo file xuất.');
    const courses = new Map(), files = []; let groups = 0, verified = 0;
    for (const entry of entries) {
      if (!courses.has(entry.courseId)) courses.set(entry.courseId, new Map());
      const course = courses.get(entry.courseId);
      if (!course.has(entry.scope)) course.set(entry.scope, []);
      course.get(entry.scope).push(entry);
      if (QuestionBank.result(entry).verified) verified++;
    }
    let c = 0;
    for (const course of courses.values()) {
      c++; let g = 0;
      for (const list of course.values()) {
        g++; groups++;
        list.sort((a, b) => a.firstSeen - b.firstSeen);
        const label = list.at(-1);
        files.push({name: `${String(c).padStart(2, '0')} ${filename(label.courseTitle)}/${String(g).padStart(2, '0')} ${filename(label.exerciseTitle)}.xlsx`, data: SuiteXlsx.workbook(sheets(list))});
      }
    }
    files.push({name: 'Đọc trước.txt', data: `Kho câu hỏi Canvas và SCORM\n\n${entries.length} câu đã được bài chấm đúng trong ${groups} bài tập, ${courses.size} học phần. Bỏ qua ${skipped} câu chưa xác nhận hoặc có kết quả mâu thuẫn.\n\nMỗi XLSX thuộc một bài tập. Sheet Create a Quiz giữ 11 cột và hàng hướng dẫn của mẫu Quizizz. Correct Answer chỉ chứa đáp án đã được chấm đúng: số thứ tự bắt đầu từ 1, nhiều đáp án cách nhau bằng dấu phẩy. Các lựa chọn gốc vẫn được giữ đầy đủ để nhập trắc nghiệm.\nKhông xuất lịch sử chọn sai, dự đoán AI hay ghi chú từ các lượt làm. Lịch sử vẫn được lưu bên trong extension để đối chiếu. Câu trên 5 lựa chọn có đáp án đã xác nhận nằm riêng trong sheet Câu trên 5 lựa chọn.\nCâu trùng được gộp trong cùng bài tập, kể cả đảo thứ tự lựa chọn. Các bài tập khác nhau vẫn được giữ riêng.\nKho lưu từ bản 2.2.0. Với lượt cũ, mở lại kết quả nếu trang học còn cho xem. SCORM lưu khi chạy tiện ích.\n${warning ? '\nCó dữ liệu chưa đọc được; hãy tải lại trang kết quả và xuất lại.\n' : ''}`});
    return {bytes: SuiteXlsx.zip(files), questions: entries.length, groups, verified, skipped};
  }
  return {build, sheets, headers, instructions};
})();
