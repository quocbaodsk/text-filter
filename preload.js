/**
 * Text Filter - Preload Script
 * Cầu nối an toàn giữa Renderer Process và Main Process
 */

const { contextBridge, ipcRenderer } = require('electron')

// Expose API an toàn cho renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Mở dialog chọn file
   * @returns {Promise<string|null>}
   */
  openFile: () => ipcRenderer.invoke('dialog:openFile'),

  /**
   * Tìm kiếm từ khóa
   * @param {string} inputFile - Đường dẫn file
   * @param {string} keyword - Từ khóa
   * @returns {Promise<Object>}
   */
  searchKeyword: (inputFile, keyword) => ipcRenderer.invoke('search:keyword', inputFile, keyword),

  /**
   * Hủy quá trình tìm kiếm
   * @returns {Promise<Object>}
   */
  cancelSearch: () => ipcRenderer.invoke('search:cancel'),

  /**
   * Mở thư mục
   * @param {string} filePath - Đường dẫn file
   * @returns {Promise<void>}
   */
  openFolder: filePath => ipcRenderer.invoke('folder:open', filePath),

  /**
   * Đọc nội dung file
   * @param {string} filePath - Đường dẫn file
   * @returns {Promise<string>}
   */
  readFile: filePath => ipcRenderer.invoke('file:read', filePath),

  /**
   * Lấy thông tin RAM usage
   * @returns {Promise<Object>}
   */
  getRamUsage: () => ipcRenderer.invoke('system:getRamUsage'),

  /**
   * Lấy tốc độ đọc ghi đĩa
   * @returns {Promise<Object>}
   */
  getDiskIO: () => ipcRenderer.invoke('system:getDiskIO'),
})
