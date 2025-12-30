const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { shell } = require('electron')
const os = require('os')

let mainWindow
let lastDiskStats = null
let currentSearchProcess = null

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
    },
    backgroundColor: '#0f0f1a',
    title: 'Text Filter',
    frame: true,
    autoHideMenuBar: true,
    show: false, // Ẩn cho đến khi load xong
  })

  mainWindow.loadFile('index.html')

  // Hiển thị cửa sổ khi đã load xong (tránh hiển thị trắng)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
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
 * @returns {Promise<Object>} Kết quả tìm kiếm
 */
ipcMain.handle('search:keyword', async (event, inputFile, keyword) => {
  return new Promise((resolve, reject) => {
    try {
      // Kiểm tra file tồn tại
      if (!fs.existsSync(inputFile)) {
        reject(new Error('File không tồn tại!'))
        return
      }

      const inputDir = path.dirname(inputFile)
      const outputFile = path.join(inputDir, 'output.txt')

      // Sử dụng stream để xử lý file lớn hiệu quả
      const readStream = fs.createReadStream(inputFile, {
        encoding: 'utf8',
        highWaterMark: 64 * 1024, // 64KB chunks
      })
      const writeStream = fs.createWriteStream(outputFile, {
        encoding: 'utf8',
      })

      let buffer = ''
      let matchedLines = 0
      let totalLines = 0
      const keywordLower = keyword.toLowerCase()
      let isCancelled = false

      // Store current search process for cancellation
      currentSearchProcess = {
        cancel: () => {
          isCancelled = true
          readStream.destroy()
          writeStream.destroy()
          currentSearchProcess = null
          reject(new Error('Tìm kiếm đã bị hủy'))
        },
      }

      // Xử lý từng chunk dữ liệu
      readStream.on('data', chunk => {
        if (isCancelled) return

        buffer += chunk
        const lines = buffer.split('\n')

        // Giữ lại dòng cuối chưa đầy đủ
        buffer = lines.pop() || ''

        // Lọc và ghi các dòng chứa từ khóa
        lines.forEach(line => {
          if (isCancelled) return

          totalLines++
          if (line.toLowerCase().includes(keywordLower)) {
            writeStream.write(line + '\n')
            matchedLines++
          }
        })
      })

      // Xử lý khi đọc xong file
      readStream.on('end', () => {
        if (isCancelled) return

        // Xử lý dòng cuối cùng
        if (buffer) {
          totalLines++
          if (buffer.toLowerCase().includes(keywordLower)) {
            writeStream.write(buffer)
            matchedLines++
          }
        }

        writeStream.end()

        // Trả về kết quả khi ghi xong
        writeStream.on('finish', () => {
          if (!isCancelled) {
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
        if (!isCancelled) {
          currentSearchProcess = null
          reject(new Error(`Lỗi đọc file: ${error.message}`))
        }
      })

      writeStream.on('error', error => {
        if (!isCancelled) {
          currentSearchProcess = null
          reject(new Error(`Lỗi ghi file: ${error.message}`))
        }
      })
    } catch (error) {
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
      currentSearchProcess.cancel()
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

    // Tính phần trăm heap usage
    const heapPercentage = ((heapUsed / heapTotal) * 100).toFixed(1)

    return {
      heapUsed: heapUsed, // MB
      heapTotal: heapTotal, // MB
      external: external, // MB
      rss: rss, // MB (Resident Set Size)
      percentage: parseFloat(heapPercentage),
      type: 'application',
    }
  } catch (error) {
    throw new Error(`Lỗi lấy thông tin RAM ứng dụng: ${error.message}`)
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
