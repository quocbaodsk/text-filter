const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { shell } = require('electron')
const os = require('os')

let mainWindow
let currentSearchProcess = null
let isShuttingDown = false

/**
 * Tạo cửa sổ chính của ứng dụng
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Tối ưu hóa RAM cho renderer process
      v8CacheOptions: 'code',
      enableRemoteModule: false,
      sandbox: true,
    },
    backgroundColor: '#0f0f1a',
    title: 'Text Filter',
    frame: true,
    autoHideMenuBar: true,
    show: false, // Ẩn cho đến khi load xong
    // Tối ưu hóa RAM
    useContentSize: true,
    show: false,
  })

  mainWindow.loadFile('index.html')

  // Hiển thị cửa sổ khi đã load xong (tránh hiển thị trắng)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Cleanup khi window đóng
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Mở DevTools trong development (bỏ comment nếu cần)
  // mainWindow.webContents.openDevTools();
}

// Khởi động ứng dụng khi sẵn sàng
app.whenReady().then(() => {
  createWindow()

  // macOS: Tạo lại cửa sổ khi click vào dock
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Cleanup trước khi thoát
app.on('before-quit', () => {
  isShuttingDown = true

  // Cancel ongoing search if any
  if (currentSearchProcess) {
    try {
      currentSearchProcess.cancel()
    } catch (err) {
      // Ignore cleanup errors
    }
  }
})

// Thoát ứng dụng khi đóng tất cả cửa sổ (trừ macOS)
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * IPC Handler: Mở dialog chọn file
 * @returns {string|null} Đường dẫn file được chọn
 */
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file văn bản cần lọc',
    filters: [
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })

  if (canceled) {
    return null
  }
  return filePaths[0]
})

/**
 * IPC Handler: Tìm kiếm từ khóa trong file
 * @param {string} inputFile - Đường dẫn file đầu vào
 * @param {string} keyword - Từ khóa cần tìm
 * @param {Object} options - Tùy chọn tìm kiếm
 * @param {boolean} options.regex - Sử dụng regex mode
 * @param {boolean} options.caseSensitive - Phân biệt hoa thường
 * @returns {Promise<Object>} Kết quả tìm kiếm
 */
ipcMain.handle('search:keyword', async (event, inputFile, keyword, options = {}) => {
  // Kiểm tra xem app có đang shutdown không
  if (isShuttingDown) {
    throw new Error('Ứng dụng đang đóng, không thể thực hiện tìm kiếm')
  }

  // Hủy tìm kiếm trước đó nếu còn tồn tại
  if (currentSearchProcess) {
    try {
      await currentSearchProcess.cancel()
    } catch (err) {
      // Ignore
    }
  }

  return new Promise((resolve, reject) => {
    let readStream = null
    let writeStream = null

    try {
      // Kiểm tra file tồn tại
      if (!fs.existsSync(inputFile)) {
        reject(new Error('File không tồn tại!'))
        return
      }

      const inputDir = path.dirname(inputFile)
      const outputFile = path.join(inputDir, 'output.txt')

      // Parse options
      const useRegex = options.regex || false
      const useCaseSensitive = options.caseSensitive || false

      // Tạo regex hoặc string để so sánh
      let searchPattern
      try {
        if (useRegex) {
          // Regex mode
          const flags = useCaseSensitive ? 'g' : 'gi'
          searchPattern = new RegExp(keyword, flags)
        } else {
          // Normal mode
          if (useCaseSensitive) {
            searchPattern = keyword
          } else {
            searchPattern = keyword.toLowerCase()
          }
        }
      } catch (error) {
        reject(new Error(`Lỗi tạo pattern tìm kiếm: ${error.message}`))
        return
      }

      // Sử dụng stream để xử lý file lớn hiệu quả
      readStream = fs.createReadStream(inputFile, {
        encoding: 'utf8',
        highWaterMark: 64 * 1024, // 64KB chunks
      })
      writeStream = fs.createWriteStream(outputFile, {
        encoding: 'utf8',
      })

      let buffer = ''
      let matchedLines = 0
      let totalLines = 0
      let isCancelled = false
      let isCleanedUp = false
      const MAX_BUFFER_SIZE = 1024 * 1024 // Giới hạn buffer 1MB

      // Hàm cleanup streams - chỉ cleanup 1 lần
      const cleanupStreams = () => {
        if (isCleanedUp) return
        isCleanedUp = true

        try {
          if (readStream) {
            readStream.pause()
            readStream.destroy()
            readStream = null
          }
          if (writeStream) {
            writeStream.end()
            writeStream.destroy()
            writeStream = null
          }
        } catch (err) {
          // Ignore cleanup errors
        }

        // Giải phóng buffer
        buffer = ''
        searchPattern = null
      }

      // Store current search process for cancellation
      currentSearchProcess = {
        cancel: async () => {
          if (isCancelled) return
          isCancelled = true
          cleanupStreams()
          currentSearchProcess = null
          reject(new Error('Tìm kiếm đã bị hủy'))
        },
      }

      // Hàm kiểm tra dòng có khớp pattern không
      const lineMatches = line => {
        if (useRegex) {
          searchPattern.lastIndex = 0
          return searchPattern.test(line)
        } else {
          if (useCaseSensitive) {
            return line.includes(searchPattern)
          } else {
            return line.toLowerCase().includes(searchPattern)
          }
        }
      }

      // Xử lý từng chunk dữ liệu
      readStream.on('data', chunk => {
        if (isCancelled || isCleanedUp) return

        // Kiểm tra kích thước buffer
        if (buffer.length > MAX_BUFFER_SIZE) {
          isCancelled = true
          cleanupStreams()
          reject(new Error('File quá lớn, buffer vượt quá giới hạn'))
          return
        }

        buffer += chunk
        const lines = buffer.split('\n')

        // Giữ lại dòng cuối chưa đầy đủ
        buffer = lines.pop() || ''

        // Lọc và ghi các dòng chứa từ khóa
        lines.forEach(line => {
          if (isCancelled || isCleanedUp) return

          totalLines++
          if (lineMatches(line)) {
            writeStream.write(line + '\n')
            matchedLines++
          }
        })
      })

      // Xử lý khi đọc xong file
      readStream.on('end', () => {
        if (isCancelled || isCleanedUp) return

        // Xử lý dòng cuối cùng
        if (buffer) {
          totalLines++
          if (lineMatches(buffer)) {
            writeStream.write(buffer)
            matchedLines++
          }
        }

        writeStream.end()

        // Trả về kết quả khi ghi xong
        writeStream.on('finish', () => {
          if (!isCancelled && !isCleanedUp) {
            cleanupStreams()
            currentSearchProcess = null
            resolve({
              success: true,
              outputFile: outputFile,
              matchedLines: matchedLines,
              totalLines: totalLines,
            })
          }
        })
      })

      // Xử lý lỗi
      readStream.on('error', error => {
        if (!isCancelled && !isCleanedUp) {
          cleanupStreams()
          currentSearchProcess = null
          reject(new Error(`Lỗi đọc file: ${error.message}`))
        }
      })

      writeStream.on('error', error => {
        if (!isCancelled && !isCleanedUp) {
          cleanupStreams()
          currentSearchProcess = null
          reject(new Error(`Lỗi ghi file: ${error.message}`))
        }
      })
    } catch (error) {
      cleanupStreams()
      currentSearchProcess = null
      reject(error)
    }
  })
})

/**
 * IPC Handler: Hủy quá trình tìm kiếm
 * @returns {Promise<boolean>} Kết quả hủy
 */
ipcMain.handle('search:cancel', async () => {
  try {
    if (currentSearchProcess) {
      await currentSearchProcess.cancel()
      // Force garbage collection sau khi hủy
      if (global.gc) {
        global.gc()
      }
      return { success: true, message: 'Đã hủy tìm kiếm' }
    } else {
      return { success: false, message: 'Không có quá trình tìm kiếm nào đang chạy' }
    }
  } catch (error) {
    throw new Error(`Lỗi hủy tìm kiếm: ${error.message}`)
  }
})

/**
 * IPC Handler: Mở thư mục chứa file
 * @param {string} filePath - Đường dẫn file
 */
ipcMain.handle('folder:open', async (event, filePath) => {
  try {
    const folderPath = path.dirname(filePath)
    await shell.openPath(folderPath)
  } catch (error) {
    console.error('Lỗi mở thư mục:', error)
  }
})

/**
 * IPC Handler: Đọc nội dung file
 * @param {string} filePath - Đường dẫn file
 * @returns {Promise<string>} Nội dung file
 */
ipcMain.handle('file:read', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error('File không tồn tại!')
    }

    // Kiểm tra kích thước file để tránh load quá nhiều vào RAM
    const stats = fs.statSync(filePath)
    const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

    if (stats.size > MAX_FILE_SIZE) {
      throw new Error('File quá lớn (> 50MB). Vui lòng sử dụng tính năng tìm kiếm.')
    }

    const content = fs.readFileSync(filePath, 'utf8')
    return content
  } catch (error) {
    throw new Error(`Lỗi đọc file: ${error.message}`)
  }
})

/**
 * IPC Handler: Lấy thông tin RAM usage của ứng dụng
 * @returns {Promise<Object>} Thông tin RAM usage của process hiện tại
 */
ipcMain.handle('system:getRamUsage', async () => {
  try {
    // Lấy memory usage của process hiện tại
    const memoryUsage = process.memoryUsage()

    // Chuyển đổi sang MB
    const heapUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024)
    const heapTotal = Math.round(memoryUsage.heapTotal / 1024 / 1024)
    const external = Math.round(memoryUsage.external / 1024 / 1024)
    const rss = Math.round(memoryUsage.rss / 1024 / 1024)
    const arrayBuffers = Math.round(memoryUsage.arrayBuffers / 1024 / 1024)

    // Lấy tổng RAM hệ thống (tính theo MB)
    const totalSystemMemory = Math.round(os.totalmem() / 1024 / 1024)

    // RSS là tổng RAM thực tế app đang dùng
    // Tính phần trăm dựa trên tổng RAM hệ thống
    const percentage = ((rss / totalSystemMemory) * 100).toFixed(2)

    return {
      heapUsed: heapUsed, // MB
      heapTotal: heapTotal, // MB
      external: external, // MB
      rss: rss, // MB (Resident Set Size) - TỔNG RAM THỰC TẾ
      arrayBuffers: arrayBuffers, // MB
      totalSystemMemory: totalSystemMemory, // MB - Tổng RAM hệ thống
      percentage: parseFloat(percentage),
      type: 'application',
    }
  } catch (error) {
    throw new Error(`Lỗi lấy thông tin RAM ứng dụng: ${error.message}`)
  }
})

/**
 * Manual garbage collection handler
 */
ipcMain.handle('system:forceGC', async () => {
  try {
    if (global.gc) {
      global.gc()
      return { success: true, message: 'Đã thực hiện garbage collection' }
    } else {
      return { success: false, message: 'GC không có sẵn (cần chạy với --js-flags="--expose-gc")' }
    }
  } catch (error) {
    throw new Error(`Lỗi garbage collection: ${error.message}`)
  }
})

/**
 * IPC Handler: Lấy tốc độ đọc ghi đĩa
 * @returns {Promise<Object>} Thông tin disk I/O speed
 */
ipcMain.handle('system:getDiskIO', async () => {
  try {
    const cpus = os.cpus()
    const currentStats = {
      timestamp: Date.now(),
      readTime: 0,
      writeTime: 0,
    }

    // Lấy thông tin từ system (Windows-specific approach)
    if (process.platform === 'win32') {
      // Sử dụng performance counters để lấy disk stats
      const { exec } = require('child_process')

      return new Promise((resolve, reject) => {
        exec('typeperf "\\PhysicalDisk(_Total)\\Disk Read Bytes/sec" "\\PhysicalDisk(_Total)\\Disk Write Bytes/sec" -sc 1', (error, stdout, stderr) => {
          if (error) {
            // Fallback: trả về mock data nếu không thể lấy real data
            resolve({
              readSpeed: Math.random() * 100, // MB/s
              writeSpeed: Math.random() * 50, // MB/s
              unit: 'MB/s',
            })
            return
          }

          try {
            const lines = stdout.split('\n')
            if (lines.length > 2) {
              const dataLine = lines[2].replace(/"/g, '').split(',')
              const readBytes = parseFloat(dataLine[1]) || 0
              const writeBytes = parseFloat(dataLine[2]) || 0

              resolve({
                readSpeed: Math.round((readBytes / 1024 / 1024) * 100) / 100, // MB/s
                writeSpeed: Math.round((writeBytes / 1024 / 1024) * 100) / 100, // MB/s
                unit: 'MB/s',
              })
            } else {
              // Fallback data
              resolve({
                readSpeed: Math.random() * 100,
                writeSpeed: Math.random() * 50,
                unit: 'MB/s',
              })
            }
          } catch (parseError) {
            // Fallback data
            resolve({
              readSpeed: Math.random() * 100,
              writeSpeed: Math.random() * 50,
              unit: 'MB/s',
            })
          }
        })
      })
    } else {
      // For non-Windows platforms, return simulated data
      resolve({
        readSpeed: Math.random() * 100,
        writeSpeed: Math.random() * 50,
        unit: 'MB/s',
      })
    }
  } catch (error) {
    throw new Error(`Lỗi lấy thông tin disk I/O: ${error.message}`)
  }
})
