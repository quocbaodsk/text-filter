/**
 * Text Filter - Renderer Process
 * Xử lý logic giao diện và tương tác người dùng
 */

// ===== BIẾN TOÀN CỤC =====
let selectedFile = null
let outputFile = null
let currentKeyword = ''

// ===== LẤY CÁC ELEMENTS =====
const fileDisplay = document.getElementById('fileDisplay')
const fileName = document.getElementById('fileName')
const browseBtn = document.getElementById('browseBtn')
const keywordInput = document.getElementById('keywordInput')
const findBtn = document.getElementById('findBtn')
const cancelBtn = document.getElementById('cancelBtn')
const progressWrapper = document.getElementById('progressWrapper')
const statusBox = document.getElementById('statusBox')
const statusText = document.getElementById('statusText')
const stats = document.getElementById('stats')
const matchedCount = document.getElementById('matchedCount')
const totalCount = document.getElementById('totalCount')
const openFolderBtn = document.getElementById('openFolderBtn')

// RAM Usage Elements
const ramUsage = document.getElementById('ramUsage')
const ramFill = document.getElementById('ramFill')
const ramPercentage = document.getElementById('ramPercentage')
const ramDetails = document.getElementById('ramDetails')

// Disk I/O Elements
const diskIO = document.getElementById('diskIO')
const diskReadSpeed = document.getElementById('diskReadSpeed')
const diskWriteSpeed = document.getElementById('diskWriteSpeed')

// Output Preview Elements
const outputPlaceholder = document.getElementById('outputPlaceholder')
const outputContent = document.getElementById('outputContent')
const outputText = document.getElementById('outputText')
const lineCount = document.getElementById('lineCount')
const copyBtn = document.getElementById('copyBtn')

// ===== SỰ KIỆN: CHỌN FILE =====
browseBtn.addEventListener('click', async () => {
  try {
    const filePath = await window.electronAPI.openFile()

    if (filePath) {
      selectedFile = filePath
      const fileNameOnly = filePath.split(/[\\\\/]/).pop()

      fileName.textContent = fileNameOnly
      fileName.classList.add('selected')

      updateStatus('success', `✓ Đã chọn file: ${fileNameOnly}`)
      hideResults()
    }
  } catch (error) {
    updateStatus('error', `✗ Lỗi: ${error.message}`)
  }
})

// ===== SỰ KIỆN: TÌM KIẾM =====
findBtn.addEventListener('click', handleSearch)

cancelBtn.addEventListener('click', handleCancel)

keywordInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') {
    handleSearch()
  }
})

// ===== HÀM XỬ LÝ TÌM KIẾM =====
async function handleSearch() {
  const keyword = keywordInput.value.trim()

  // Validate đầu vào
  if (!selectedFile) {
    showToast('info', 'Chưa chọn file', 'Vui lòng chọn file đầu vào')
    return
  }

  if (!keyword) {
    showToast('info', 'Chưa nhập từ khóa', 'Vui lòng nhập từ khóa cần tìm')
    keywordInput.focus()
    return
  }

  // Bắt đầu xử lý
  setProcessingState(true)
  updateStatus('processing', '⏳ Đang tìm kiếm và lọc dữ liệu...')
  hideResults()

  try {
    const result = await window.electronAPI.searchKeyword(selectedFile, keyword)

    if (result.success) {
      outputFile = result.outputFile
      currentKeyword = keyword // Lưu từ khóa để highlight

      // Hiển thị kết quả
      showResults(result.matchedLines, result.totalLines, keyword)
      updateStatus('success', `Hoàn tất! Tìm thấy ${result.matchedLines} dòng`)

      // Đọc và hiển thị output preview
      try {
        const content = await window.electronAPI.readFile(outputFile)
        showOutputPreview(content, result.matchedLines)
      } catch (readError) {
        console.error('Không thể đọc file output:', readError)
      }

      // Hiển thị toast thành công
      showToast('success', 'Tìm kiếm hoàn tất!', `Tìm thấy ${result.matchedLines.toLocaleString()} / ${result.totalLines.toLocaleString()} dòng`)
    }
  } catch (error) {
    // Kiểm tra nếu là lỗi hủy bỏ
    if (error.message.includes('hủy') || error.message.includes('bị hủy')) {
      updateStatus('info', 'Đã hủy tìm kiếm')
      showToast('info', 'Đã hủy', 'Quá trình tìm kiếm đã được hủy')
    } else {
      updateStatus('error', `Lỗi: ${error.message}`)
      showToast('error', 'Có lỗi xảy ra', error.message)
    }
    hideOutputPreview()
  } finally {
    setProcessingState(false)
  }
}

// ===== HÀM XỬ LÝ HỦY TÌM KIẾM =====
async function handleCancel() {
  try {
    const result = await window.electronAPI.cancelSearch()

    if (result.success) {
      updateStatus('info', 'Đang hủy...')
      showToast('info', 'Đang hủy', result.message)
    } else {
      showToast('info', 'Thông báo', result.message)
    }
  } catch (error) {
    console.error('Lỗi hủy tìm kiếm:', error)
    showToast('error', 'Lỗi', error.message)
  }
}

// ===== SỰ KIỆN: MỞ THƯ MỤC =====
openFolderBtn.addEventListener('click', () => {
  if (outputFile) {
    window.electronAPI.openFolder(outputFile)
  }
})

// ===== HÀM HIỂN THỊ KẾT QUẢ =====
function showResults(matched, total, keyword) {
  matchedCount.textContent = matched.toLocaleString()
  totalCount.textContent = total.toLocaleString()
  stats.style.display = 'flex'
  openFolderBtn.style.display = 'flex'
}

function hideResults() {
  stats.style.display = 'none'
  openFolderBtn.style.display = 'none'
  hideOutputPreview()
}

// ===== HÀM HIỂN THỊ OUTPUT PREVIEW =====
function showOutputPreview(content, count) {
  outputPlaceholder.style.display = 'none'
  outputContent.style.display = 'flex'

  // Highlight từ khóa trong nội dung
  if (currentKeyword) {
    const highlightedContent = highlightKeyword(content, currentKeyword)
    outputText.innerHTML = highlightedContent
  } else {
    outputText.textContent = content
  }

  lineCount.textContent = `${count.toLocaleString()} dòng`
  copyBtn.style.display = 'flex'
}

// ===== HÀM HIGHLIGHT TỪ KHÓA =====
function highlightKeyword(text, keyword) {
  if (!keyword) return escapeHtml(text)

  // Escape HTML để tránh XSS
  const escapedText = escapeHtml(text)
  const escapedKeyword = escapeHtml(keyword)

  // Tạo regex để tìm từ khóa (case insensitive)
  const regex = new RegExp(`(${escapeRegex(escapedKeyword)})`, 'gi')

  // Thay thế từ khóa bằng span highlight
  return escapedText.replace(regex, '<span class="highlight">$1</span>')
}

// ===== HÀM ESCAPE HTML =====
function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// ===== HÀM ESCAPE REGEX =====
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hideOutputPreview() {
  outputPlaceholder.style.display = 'flex'
  outputContent.style.display = 'none'
  outputText.textContent = ''
  lineCount.textContent = '0 dòng'
  copyBtn.style.display = 'none'
}

// ===== HÀM CẬP NHẬT TRẠNG THÁI =====
function updateStatus(type, message) {
  statusText.textContent = message
  statusBox.className = 'status-box'

  if (type === 'success') {
    statusBox.classList.add('success')
  } else if (type === 'error') {
    statusBox.classList.add('error')
  } else if (type === 'processing') {
    statusBox.classList.add('processing')
  }
}

// ===== HÀM THIẾT LẬP TRẠNG THÁI XỬ LÝ =====
function setProcessingState(isProcessing) {
  findBtn.disabled = isProcessing
  browseBtn.disabled = isProcessing
  keywordInput.disabled = isProcessing

  if (isProcessing) {
    progressWrapper.style.display = 'block'
    cancelBtn.style.display = 'flex'
    findBtn.style.display = 'none'
  } else {
    progressWrapper.style.display = 'none'
    cancelBtn.style.display = 'none'
    findBtn.style.display = 'flex'
  }
}

// ===== HÀM HIỂN THỊ TOAST NOTIFICATION =====
const toastContainer = document.getElementById('toastContainer')

function showToast(type, title, message, duration = 4000) {
  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    error:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
  }

  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${message ? `<div class="toast-message">${message}</div>` : ''}
    </div>
    <button class="toast-close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `

  toastContainer.appendChild(toast)

  const closeBtn = toast.querySelector('.toast-close')
  const removeToast = () => {
    toast.classList.add('hiding')
    setTimeout(() => toast.remove(), 300)
  }

  closeBtn.addEventListener('click', removeToast)
  setTimeout(removeToast, duration)
}

// ===== SỰ KIỆN: COPY NỘI DUNG =====
copyBtn.addEventListener('click', async () => {
  const content = outputText.textContent
  if (content) {
    try {
      await navigator.clipboard.writeText(content)
      showToast('success', 'Đã copy!', 'Nội dung đã được copy vào clipboard', 2000)
    } catch (err) {
      showToast('error', 'Lỗi', 'Không thể copy nội dung', 2000)
    }
  }
})

// ===== HÀM CẬP NHẬT RAM USAGE =====
async function updateRamUsage() {
  try {
    const ramInfo = await window.electronAPI.getRamUsage()

    // Cập nhật progress bar
    ramFill.style.width = `${ramInfo.percentage}%`

    // Cập nhật màu sắc dựa trên mức sử dụng
    if (ramInfo.percentage > 80) {
      ramFill.style.backgroundColor = '#ef4444' // red
    } else if (ramInfo.percentage > 60) {
      ramFill.style.backgroundColor = '#f59e0b' // amber
    } else {
      ramFill.style.backgroundColor = '#10b981' // green
    }

    // Cập nhật text - hiển thị heap used/heap total của ứng dụng
    ramPercentage.textContent = `${ramInfo.percentage}%`
    ramDetails.textContent = `${ramInfo.heapUsed} MB / ${ramInfo.heapTotal} MB`
  } catch (error) {
    console.error('Lỗi cập nhật RAM usage:', error)
  }
}

// ===== HÀM CẬP NHẬT DISK I/O =====
async function updateDiskIO() {
  try {
    const diskInfo = await window.electronAPI.getDiskIO()

    // Cập nhật text
    diskReadSpeed.textContent = `${diskInfo.readSpeed.toFixed(1)} ${diskInfo.unit}`
    diskWriteSpeed.textContent = `${diskInfo.writeSpeed.toFixed(1)} ${diskInfo.unit}`
  } catch (error) {
    console.error('Lỗi cập nhật Disk I/O:', error)
    diskReadSpeed.textContent = '0.0 MB/s'
    diskWriteSpeed.textContent = '0.0 MB/s'
  }
}

// ===== KHỞI TẠO =====
document.addEventListener('DOMContentLoaded', () => {
  console.log('Text Filter initialized')
  keywordInput.focus()

  // Cập nhật RAM usage mỗi 2 giây
  updateRamUsage()
  setInterval(updateRamUsage, 2000)

  // Cập nhật Disk I/O mỗi 1 giây
  updateDiskIO()
  setInterval(updateDiskIO, 1000)
})
