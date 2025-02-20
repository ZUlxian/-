// pages/index/index.js
import NetworkManager from '../../utils/networkManager.js';

const SERVICE_UUID = '0000FE01-0000-1000-8000-00805F9B34FB';
const formatFileSize = (size) => {
    if (size < 1024) {
        return size + ' B';
    } else if (size < 1024 * 1024) {
        return (size / 1024).toFixed(2) + ' KB';
    } else if (size < 1024 * 1024 * 1024) {
        return (size / (1024 * 1024)).toFixed(2) + ' MB';
    } else {
        return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
};
const APP_CODE = 'FASTFILE';
const MANUFACTURER_ID = 0xFFFE;
const CHUNK_SIZE = 20;
const PROTOCOL = {
  HEADER: 0xAA55AA55,
  VERSION: 0x02,
  TYPE: {
    FILE_INFO: 0x01,
    FILE_DATA: 0x02,
    ACK: 0x03,
    RESUME: 0x04,
    ERROR: 0x05,
    PAIR_REQUEST: 0x06, 
    PAIR_RESPONSE: 0x07  
  }
};

Page({
  data: {
    currentRole: '',            // 当前角色：'sender' 或 'receiver'
    files: [],                 // 文件列表
    nearbyUsers: [],           // 附近的蓝牙设备
    isSearching: false,        // 是否正在搜索设备
    selectedFile: null,        // 选中的文件
    connectedUser: null,       // 已连接的用户
    transferProgress: 0,       // 传输进度(0-100)
    serviceId: '',            // 服务ID
    characteristicId: '',     // 特征值ID
    receivedData: [],         // 接收到的数据
    receivedSize: 0,          // 已接收大小
    totalSize: 0,             // 总大小
    isReceiving: false,       // 是否正在接收
    pairCode: '',            // 配对码
    showPairCodeInput: false, // 是否显示配对码输入框
    pendingDeviceId: '',     // 待连接的设备ID
    transferMode: 'bluetooth', // 传输模式
    expectedChunkIndex: 0,    // 期望的数据块索引
    isEnhancedMode: false,    // 是否启用增强模式
    connectionStatus: '', // 用于显示连接状态
    pairingStatus: '',       // 配对状态信息
    isPairing: false,        // 是否正在配对
    sentPairRequest: false,  // 是否已发送配对请求
    receivedPairRequest: false, // 是否已收到配对请求 
    pairRequestTimestamp: 0 ,  // 配对请求时间戳
    transferStatus: '',       // 传输状态
    networkInfo: null,        // 网络信息
    canResume: false,        // 是否可以恢复传输
    transferSpeed: 0,         // 传输速度
    remainingTime: 0,         // 剩余时间
    lastTransferTime: null,   // 上次传输时间
    lastTransferSize: 0,      // 上次传输大小
    reconnectAttempts: 0,     // 重连尝试次数
    maxReconnectAttempts: 3,  // 最大重连次数
    receivedFileHistory: [], // 改为数组而不是 Set
    receivedFiles: [],
    currentReceivedFile: null
  },

  formatFileSize(size) {
    if (size < 1024) {
        return size + ' B';
    } else if (size < 1024 * 1024) {
        return (size / 1024).toFixed(2) + ' KB';
    } else if (size < 1024 * 1024 * 1024) {
        return (size / (1024 * 1024)).toFixed(2) + ' MB';
    } else {
        return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
  },

// 格式化时间戳
formatTimestamp(timestamp) {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
  
    if (diffDays > 0) {
      return diffDays === 1 ? '昨天' : `${diffDays}天前`;
    } else if (diffHours > 0) {
      return `${diffHours}小时前`;
    } else if (diffMins > 0) {
      return `${diffMins}分钟前`;
    } else {
      return '刚刚';
    }
  },
  
  // 复制文件路径
  copyFilePath(e) {
    const path = e.currentTarget.dataset.path;
    if (!path) return;
    
    wx.setClipboardData({
      data: path,
      success: () => {
        wx.showToast({
          title: '路径已复制',
          icon: 'success'
        });
      }
    });
  },
  
  // 清空接收历史
  clearReceivedHistory() {
    wx.showModal({
      title: '清空历史',
      content: '确定要清空接收文件历史记录吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            receivedFiles: [],
            receivedFileHistory: []
          });
          wx.showToast({
            title: '历史已清空',
            icon: 'success'
          });
        }
      }
    });
  },
  
  // 点击文件项
  handleFileItemTap(e) {
    const filePath = e.currentTarget.dataset.filePath;
    if (!filePath) return;
    
    wx.showActionSheet({
      itemList: ['打开文件', '复制路径', '保存到本地'],
      success: (res) => {
        switch (res.tapIndex) {
          case 0: // 打开文件
            this.openFile(filePath);
            break;
          case 1: // 复制路径
            wx.setClipboardData({
              data: filePath,
              success: () => {
                wx.showToast({
                  title: '路径已复制',
                  icon: 'success'
                });
              }
            });
            break;
          case 2: // 保存到本地
            this.saveFileToUserAccessible(filePath, filePath.split('/').pop())
              .then(() => {
                wx.showToast({
                  title: '文件已保存',
                  icon: 'success'
                });
              })
              .catch(error => {
                console.error('[文件操作] 保存文件失败:', error);
                wx.showToast({
                  title: '保存失败',
                  icon: 'none'
                });
              });
            break;
        }
      }
    });
  },
  
  // 打开文件
  openFile(filePath) {
    // 获取文件扩展名
    const ext = filePath.split('.').pop().toLowerCase();
    
    // 根据文件类型选择不同的打开方式
    if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
      // 图片预览
      wx.previewImage({
        urls: [filePath],
        fail: (err) => {
          console.error('预览图片失败:', err);
          wx.showToast({
            title: '无法预览此文件',
            icon: 'none'
          });
        }
      });
    } else if (['mp4', 'mov', '3gp', 'avi'].includes(ext)) {
      // 视频播放
      wx.navigateTo({
        url: `/pages/player/player?filePath=${encodeURIComponent(filePath)}&fileType=video`
      });
    } else if (['mp3', 'wav', 'aac', 'flac'].includes(ext)) {
      // 音频播放
      wx.navigateTo({
        url: `/pages/player/player?filePath=${encodeURIComponent(filePath)}&fileType=audio`
      });
    } else if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf', 'txt'].includes(ext)) {
      // 文档预览
      wx.openDocument({
        filePath: filePath,
        showMenu: true,
        fail: (err) => {
          console.error('打开文档失败:', err);
          wx.showToast({
            title: '无法预览此文件',
            icon: 'none'
          });
        }
      });
    } else {
      // 其他类型文件
      wx.showToast({
        title: '无法直接预览此类型文件',
        icon: 'none'
      });
    }
  },

// 同步设备状态到对方
syncDeviceState(device, state) {
    if (!this.networkManager || !this.networkManager.udp || !device) return;
    
    try {
      const stateMessage = {
        type: 'device_state',
        deviceId: this.networkManager.deviceId,
        deviceName: wx.getSystemInfoSync().brand || '远程设备',
        state: state,
        timestamp: Date.now()
      };
      
      console.log('[同步] 发送设备状态:', stateMessage);
      
      // 如果有对方地址，发送状态更新
      if (device.address) {
        this.networkManager.udp.send({
          address: device.address,
          port: this.networkManager.discoveryPort,
          message: JSON.stringify(stateMessage),
          success: () => console.log('[同步] 设备状态同步成功'),
          fail: (err) => console.error('[同步] 设备状态同步失败:', err)
        });
      }
      
      // 广播状态更新
      this.networkManager.udp.send({
        address: '255.255.255.255',
        port: this.networkManager.discoveryPort,
        message: JSON.stringify(stateMessage),
        fail: (err) => console.error('[同步] 广播状态同步失败:', err),
        success: () => console.log('[同步] 广播状态同步成功')
      });
    } catch (error) {
      console.error('[同步] 发送设备状态失败:', error);
    }
  },

// 处理蓝牙特征值变化
handleBLEValueChange(result) {
    const value = result.value;
    const dv = new DataView(value);
    
    if (dv.getUint32(0) === PROTOCOL.HEADER) {
      const type = dv.getUint8(5);
      const length = dv.getUint16(6);
      const payload = new Uint8Array(value.slice(8, 8 + length));
      
      switch(type) {
        case PROTOCOL.TYPE.PAIR_REQUEST:
          this.handlePairRequest(result.deviceId, payload);
          break;
          
        case PROTOCOL.TYPE.PAIR_RESPONSE:
          this.handlePairResponse(result.deviceId, payload);
          break;
          
        case PROTOCOL.TYPE.FILE_INFO:
          const info = JSON.parse(new TextDecoder().decode(payload));
          this.setData({
            isReceiving: true,
            totalSize: info.size,
            receivedSize: 0,
            receivedData: [],
            expectedChunkIndex: 0,
            transferStatus: 'receiving'
          });
          break;
          
        case PROTOCOL.TYPE.FILE_DATA:
          const chunkIndex = dv.getUint16(8);
          if (chunkIndex === this.data.expectedChunkIndex) {
            this.data.receivedData.push(payload.slice(2));
            this.setData({
              receivedSize: this.data.receivedSize + payload.byteLength - 2,
              transferProgress: Math.floor(
                (this.data.receivedSize + payload.byteLength - 2) / this.data.totalSize * 100
              ),
              expectedChunkIndex: this.data.expectedChunkIndex + 1
            });
            this.updateTransferStats();
          } else {
            this.requestRetransmit();
          }
          break;
  
        case PROTOCOL.TYPE.ERROR:
          this.handleTransferError(payload);
          break;
      }
    }
  },
  
  // 处理配对请求
  async handlePairRequest(deviceId, payload) {
    try {
      const requestData = JSON.parse(new TextDecoder().decode(payload));
      console.log('[配对] 收到配对请求:', requestData);
      
      wx.hideLoading();
      
      // 显示配对码输入对话框
      this.setData({
        showPairCodeInput: true,
        pendingDeviceId: deviceId,
        pairCode: '',
        isPairing: true,
        receivedPairRequest: true,
        pairRequestTimestamp: requestData.timestamp,
        connectionStatus: `来自 ${requestData.deviceName || '未知设备'} 的连接请求`
      });
    } catch (error) {
      console.error('[配对] 解析配对请求失败:', error);
    }
  },
  
  // 处理配对响应
  async handlePairRequest(deviceId, payload) {
    try {
      const requestData = JSON.parse(new TextDecoder().decode(payload));
      console.log('[配对] 收到配对请求:', requestData);
      
      wx.hideLoading();
      
      // 强制显示提示，先显示模态框
      wx.showModal({
        title: '收到配对请求',
        content: `设备"${requestData.deviceName || '未知设备'}"请求配对，请输入配对码`,
        showCancel: false,
        confirmText: '确定',
        success: () => {
          // 用户点击确定后再显示输入框
          this.setData({
            showPairCodeInput: true,
            pendingDeviceId: deviceId,
            pairCode: '',
            isPairing: true,
            receivedPairRequest: true,
            pairRequestTimestamp: requestData.timestamp,
            connectionStatus: `来自 ${requestData.deviceName || '未知设备'} 的连接请求`
          });
          
          console.log('[配对] 已显示配对码输入框');
          
          // 尝试震动提醒（如果平台支持）
          try {
            wx.vibrateLong();
          } catch (e) {
            // 忽略不支持的平台
          }
        }
      });
    } catch (error) {
      console.error('[配对] 解析配对请求失败:', error);
    }
  },

  async onLoad() {
    try {
      console.log('[Page] 页面加载开始...');
      
      // 初始化 NetworkManager
      this.networkManager = new NetworkManager();
      
      // 设置网络管理器回调
      this.setupNetworkCallbacks();

// 设置配对请求回调
this.networkManager.onPairRequest = (request, remoteInfo, socket) => {
    console.log('[配对] 收到配对请求回调:', request);
    // 处理UDP配对请求
    this.handleUDPPairRequest(request, remoteInfo, socket);
};

// 配对响应回调 - 增强版
this.networkManager.onPairResponse = (response, remoteInfo) => {
    console.log('[配对] 收到配对响应:', response);
    if (response && this.data.pendingDeviceId) {
        // 确保方法存在
        if (typeof this.handlePairResponseWifi === 'function') {
            this.handlePairResponseWifi(this.data.pendingDeviceId, response);
        } else {
            console.error('[配对] handlePairResponseWifi方法不存在');
            // 尝试基本处理
            wx.hideLoading();
            if (response.success) {
                // 创建一个临时设备
                let tempDevice = null;
                
                // 尝试从NetworkManager中查找设备
                if (this.networkManager && response.fromDeviceId) {
                    const remoteDevice = this.networkManager.lanDevices.get(response.fromDeviceId);
                    if (remoteDevice) {
                        tempDevice = {
                            deviceId: remoteDevice.deviceId,
                            name: remoteDevice.name || remoteDevice.deviceName || '远程设备',
                            address: remoteDevice.address,
                            via: 'wifi',
                            RSSI: -50
                        };
                    }
                }
                
                // 如果找不到设备，创建临时设备
                if (!tempDevice && remoteInfo) {
                    tempDevice = {
                        deviceId: response.deviceId || response.fromDeviceId || 'temp-device',
                        name: '远程设备',
                        address: remoteInfo.address,
                        via: 'wifi',
                        RSSI: -50
                    };
                }
                
                if (tempDevice) {
                    this.setData({
                        isPairing: false,
                        sentPairRequest: false,
                        connectedUser: tempDevice,
                        transferStatus: 'connected',
                        connectionStatus: `已连接到 ${tempDevice.name}`
                    });
                }
                
                wx.showToast({ title: '配对成功', icon: 'success' });
            } else {
                wx.showToast({ title: '配对失败', icon: 'none' });
            }
        }
    } else {
        console.warn('[配对] 收到响应但无法处理:', response);
    }
};
      
      // 初始化配对监听器
      if (this.networkManager.initPairingListener) {
        this.networkManager.initPairingListener();
      }
      
      // 获取网络信息
      const networkInfo = await NetworkManager.getNetworkType();
      this.setData({ networkInfo });
      
      // 初始化蓝牙
      await this.initializeBluetoothTransfer();
      console.log('[Page] 蓝牙初始化完成');

        wx.onNetworkStatusChange(async (res) => {
            await this.checkConnectionStatus();
        });

        wx.onBluetoothAdapterStateChange(async (res) => {
            await this.checkConnectionStatus();
        });

      // 监听蓝牙状态变化
      wx.onBLEConnectionStateChange((res) => {
        console.log('[Page] 蓝牙连接状态变化:', res);
        if (!res.connected && this.data.connectedUser) {
          wx.showToast({ title: '连接已断开', icon: 'none' });
          this.setData({ 
            connectedUser: null,
            transferStatus: 'disconnected'
          });
          this.handleDisconnection();
        }
      });
    } catch (error) {
      console.error('[Page] 初始化失败:', error);
      wx.showToast({ 
        title: '初始化失败，请检查设备权限', 
        icon: 'none' 
      });
    }
  },

  setupNetworkCallbacks() {
    // 设备发现回调
    this.networkManager.onLANDeviceFound = (devices) => {
        const currentDevices = [...this.data.nearbyUsers];
        
        // 合并蓝牙和LAN设备列表，避免重复和过滤自己
        devices.forEach(lanDevice => {
          // 不添加自己的设备
          if (lanDevice.deviceId === this.networkManager.deviceId) {
            console.log('[设备发现] 跳过本机设备:', lanDevice);
            return;
          }
          
          const existingIndex = currentDevices.findIndex(
            device => device.deviceId === lanDevice.deviceId
          );
          
          if (existingIndex === -1) {
            console.log('[设备发现] 添加新发现的设备:', lanDevice);
            currentDevices.push({
              ...lanDevice,
              RSSI: -50, // 默认信号强度
              isEnhanced: false
            });
          }
        });
        
        this.setData({ nearbyUsers: currentDevices });
    };
  
    this.networkManager.onReceiveStart = (fileName, fileSize) => {
        // 显示通知
        wx.showToast({
            title: '正在接收文件...',
            icon: 'loading',
            duration: 2000
        });
        
        // 更新UI状态
        this.setData({
            isReceiving: true,
            totalSize: fileSize,
            receivedSize: 0,
            transferStatus: 'receiving',
            transferProgress: 0
        });
    };

    // 传输进度回调
    this.networkManager.onProgress = (progress, transferredSize) => {
        this.setData({ transferProgress: progress });
        this.updateTransferStats(transferredSize);
    };

    // 修改文件接收完成回调
    this.networkManager.onComplete = (result) => {
        try {
            if (!result || !result.path) {
                console.error('[文件接收] 接收到无效的完成回调结果');
                return;
            }

            // 检查是否是重复的文件，使用数组方法而不是 Set
            const fileKey = `${result.name}_${result.size}_${result.transferId}`;
            if (this.data.receivedFileHistory.includes(fileKey)) {
                console.log('[文件接收] 检测到重复文件，跳过处理:', fileKey);
                return;
            }

            // 更新传输状态
            this.setData({ 
                transferStatus: 'completed',
                transferProgress: 100,
                selectedFile: null  // 重要：清除选中的文件
            });

            // 记录此次接收的文件
            const newHistory = [...this.data.receivedFileHistory, fileKey];
            const newFileInfo = {
                path: result.path,
                name: result.name,
                size: result.size,
                timestamp: Date.now()
            };

            this.setData({
                receivedFileHistory: newHistory,
                receivedFiles: [...this.data.receivedFiles, newFileInfo],
                currentReceivedFile: newFileInfo
            });

            const innerAudioContext = wx.createInnerAudioContext();
            innerAudioContext.src = '/assets/audio/notification.mp3';
            innerAudioContext.play();
            
            try {
                wx.vibrateLong();
            } catch (e) {
                // 忽略不支持的平台
            }

            // 显示保存对话框
            wx.showModal({
                title: '传输完成',
                content: `收到文件"${result.name}"，大小: ${this.formatFileSize(result.size)}`,
                confirmText: '保存',
                cancelText: '关闭',
                success: (res) => {
                    if (res.confirm) {
                        // 保存文件
                        this.saveFileToUserAccessible(result.path, result.name)
                            .then(() => {
                                wx.showToast({
                                    title: '文件已保存',
                                    icon: 'success'
                                });
                            })
                            .catch(error => {
                                console.error('[文件接收] 保存文件失败:', error);
                                wx.showToast({
                                    title: '保存失败',
                                    icon: 'none'
                                });
                            });
                    }
                    
                    // 无论保存与否，都清除当前文件状态
                    this.setData({ currentReceivedFile: null });
                }
            });

            // 设置30秒后清理历史记录
            setTimeout(() => {
                const history = this.data.receivedFileHistory;
                const index = history.indexOf(fileKey);
                if (index > -1) {
                    history.splice(index, 1);
                    this.setData({ receivedFileHistory: history });
                }
            }, 30000);

        } catch (error) {
            console.error('[文件接收] 处理完成回调时出错:', error);
            this.setData({ 
                transferStatus: 'error',
                selectedFile: null  // 出错时也要清除选中的文件
            });
        }
    };

    // 添加传输状态更新回调
    this.networkManager.onTransferStatusUpdate = (statusInfo) => {
        console.log('[调试] onTransferStatusUpdate被调用:', statusInfo);
        
        if (statusInfo.status === 'completed') {
            this.setData({
                transferStatus: 'completed',
                transferProgress: 100,
                selectedFile: null  // 清除选中的文件
            });
        }
    };

    // 错误处理回调
    this.networkManager.onError = (error) => {
        wx.showToast({ 
            title: error.message || '传输出错', 
            icon: 'none' 
        });
        this.setData({ transferStatus: 'error' });
    };

  
    // 断开连接回调
    this.networkManager.onConnectionLost = (deviceInfo) => {
        console.log('[连接] 收到设备断开连接通知:', deviceInfo);
        
        // 无论是否为当前连接的设备，都强制断开
        if (this.data.connectedUser) {
            // 清除连接状态
            this.setData({
                connectedUser: null,
                connectionStatus: '',
                transferStatus: 'disconnected'
            });
            
            // 重置导航栏标题
            wx.setNavigationBarTitle({
                title: '面对面快传'
            });
            
            // 显示提示
            wx.showToast({
                title: '连接已断开',
                icon: 'none'
            });
        }
    };
  
    // 取消配对回调
    this.networkManager.onPairCancel = (message) => {
        // 如果正在显示配对弹窗，则关闭
        if (this.data.showPairCodeInput) {
            // 判断是否是自己发起的配对
            const isSender = this.data.sentPairRequest;
            // 判断消息是否来自自己
            const isFromSelf = message.deviceId === this.networkManager.deviceId;
            
            this.setData({
                showPairCodeInput: false,  
                pairCode: '',
                isPairing: false,
                pendingDeviceId: '',
                pairingStatus: ''
            });
            
            // 根据不同情况显示不同提示
            if (isFromSelf) {
                // 是自己取消的
                wx.showToast({
                    title: '您已取消配对',
                    icon: 'none'
                });
            } else {
                // 是对方取消的
                wx.showToast({
                    title: '对方已取消配对',
                    icon: 'none'  
                });
            // 可以尝试震动提醒
                try {
                    wx.vibrateLong();
                } catch(e) {
                    // 忽略不支持的平台
                }
            }
        }
    };
        // 添加传输状态更新回调
    this.networkManager.onTransferStatusUpdate = (statusInfo) => {
        console.log('[调试] onTransferStatusUpdate被调用:', {
            info: statusInfo,
            currentState: {
                selectedFile: !!this.data.selectedFile,
                fileName: this.data.selectedFile?.name,
                transferStatus: this.data.transferStatus
            }
        });
        
        // 重要：不要检查选中的文件，因为这会阻止状态更新
        // 只检查传输状态，确保任何准备中或传输中的文件都能更新状态
        if (statusInfo.status === 'completed' && 
            (this.data.transferStatus === 'preparing' || 
            this.data.transferStatus === 'transferring')) {
            
            // 更新界面状态
            this.setData({
                transferStatus: 'completed',
                transferProgress: 100
            });
            
            // 显示提示
            wx.showToast({
                title: '传输完成',
                icon: 'success'
            });
        }
    };
},

  async checkConnectionStatus() {
    try {
        const networkInfo = await wx.getNetworkType();
        const isWifiAvailable = networkInfo.networkType === 'wifi';
        
        let isBluetoothAvailable = false;
        try {
            const bluetoothState = await wx.getBluetoothAdapterState();
            isBluetoothAvailable = bluetoothState.available;
        } catch (error) {
            console.log('蓝牙不可用');
        }

        let mode = 'none';
        if (isBluetoothAvailable && isWifiAvailable) {
            mode = 'both';
        } else if (isBluetoothAvailable) {
            mode = 'bluetooth';
        } else if (isWifiAvailable) {
            mode = 'wifi';
        }

        this.setData({ transferMode: mode });
        return mode;
    } catch (error) {
        console.error('状态检查失败:', error);
        this.setData({ transferMode: 'none' });
        return 'none';
    }
},

async initializeBluetoothTransfer() {
    try {
        // 检查WiFi状态
        const networkInfo = await wx.getNetworkType();
        const isWifiAvailable = networkInfo.networkType === 'wifi';
        
        // 检查蓝牙状态
        let isBluetoothAvailable = false;
        try {
            await wx.openBluetoothAdapter();
            isBluetoothAvailable = true;
        } catch (error) {
            console.log('蓝牙不可用');
        }

        // 设置传输模式
        let mode = 'none';
        if (isBluetoothAvailable && isWifiAvailable) {
            mode = 'both';
        } else if (isBluetoothAvailable) {
            mode = 'bluetooth';
        } else if (isWifiAvailable) {
            mode = 'wifi';
        }

        this.setData({ transferMode: mode });
    } catch (error) {
        console.error('初始化失败:', error);
        this.setData({ transferMode: 'none' });
    }
},

async handleSearchNearby() {
    if (this.data.isSearching) {
        await this.stopSearch();
        return;
    }

    try {
        // 重新初始化
        await this.initializeBluetoothTransfer(); // 重新初始化蓝牙
        await this.checkConnectionStatus();        // 检查连接状态
        
        if (this.data.transferMode === 'none') {
            wx.showToast({
                title: '请确保WiFi或蓝牙已开启',
                icon: 'none'
            });
            return;
        }

        this.setData({ 
            isSearching: true, 
            nearbyUsers: [],
            isEnhancedMode: false
        });

        // 重新初始化网络管理器
        await this.networkManager.initDiscovery();

        // 如果蓝牙可用，重新启动蓝牙搜索
        if (this.data.transferMode === 'bluetooth' || this.data.transferMode === 'both') {
            await this.startDeviceDiscovery();
        }
    } catch (error) {
        console.error('搜索失败:', error);
        wx.showToast({ 
            title: error.message || '搜索失败', 
            icon: 'none' 
        });
        this.setData({ isSearching: false });
    }
},

async startDeviceDiscovery() {
    try {
        const options = this.data.isEnhancedMode 
            ? {
                allowDuplicatesKey: false,
                interval: 0,
                powerLevel: 'high'
            }
            : { 
                allowDuplicatesKey: false,
                services: [SERVICE_UUID]
            };

        await wx.stopBluetoothDevicesDiscovery();
        await wx.startBluetoothDevicesDiscovery(options);
        
        wx.onBluetoothDeviceFound((res) => {
            res.devices.forEach(device => {
                // 检查设备是否已存在
                const existingIndex = this.data.nearbyUsers.findIndex(
                    d => d.deviceId === device.deviceId
                );

                if (this.data.isEnhancedMode) {
                    // 增强模式：允许添加任何设备
                    const newDevice = {
                        deviceId: device.deviceId,
                        name: device.name || device.localName || '未知设备',
                        RSSI: device.RSSI,
                        isEnhanced: true,
                        via: 'bluetooth'
                    };

                    if (existingIndex === -1) {
                        // 设备不存在，直接添加
                        this.setData({
                            nearbyUsers: [...this.data.nearbyUsers, newDevice]
                        });
                    }
                } else {
                    // 普通模式：只添加符合条件的设备
                    if (!device.advertisData) return;
                    try {
                        const advertisData = new Uint8Array(device.advertisData);
                        const view = new DataView(advertisData.buffer);
                        
                        if (view.getUint16(0, true) === MANUFACTURER_ID) {
                            const appCode = String.fromCharCode(
                                view.getUint8(2),
                                view.getUint8(3),
                                view.getUint8(4),
                                view.getUint8(5)
                            );
                            
                            if (appCode === APP_CODE) {
                                const newDevice = {
                                    deviceId: device.deviceId,
                                    name: device.name || '未知设备',
                                    RSSI: device.RSSI,
                                    isEnhanced: false,
                                    via: 'bluetooth'
                                };

                                if (existingIndex === -1) {
                                    this.setData({
                                        nearbyUsers: [...this.data.nearbyUsers, newDevice]
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        console.error('解析广播数据失败:', error);
                    }
                }
            });
        });
    } catch (error) {
        console.error('蓝牙搜索失败:', error);
    }
},

async stopSearch() {
    try {
        // 检查蓝牙是否可用再执行蓝牙相关操作
        if (this.data.transferMode === 'bluetooth' || this.data.transferMode === 'both') {
            try {
                const res = await wx.getBluetoothAdapterState();
                if (res.available) {
                    await wx.stopBluetoothDevicesDiscovery();
                    await wx.closeBluetoothAdapter();
                }
            } catch (error) {
                console.log('蓝牙不可用，跳过停止蓝牙搜索');
            }
        }
        
        // 停止 UDP 发现
        if (this.networkManager) {
            await this.networkManager.cleanup();
        }
        
        // 完全重置所有状态
        this.setData({ 
            isSearching: false,
            nearbyUsers: [],
            isEnhancedMode: false,
            transferMode: 'none'
        });
    } catch (error) {
        console.error('停止搜索出错:', error);
        this.setData({ 
            isSearching: false,
            nearbyUsers: [],
            isEnhancedMode: false,
            transferMode: 'none'
        });
    }
},

async toggleEnhancedMode() {
    if (!this.data.isEnhancedMode) {
        // 当用户尝试开启增强模式时，先显示提示
        wx.showModal({
            title: '开启增强模式',
            content: '该模式下会无视所有设备特征码，直接搜索带有蓝牙信号的设备。通常情况下用不到此功能，一般是搜索老旧设备会比较有用。是否开启？',
            confirmText: '开启',
            cancelText: '取消',
            success: async (res) => {
                if (res.confirm) {
                    // 用户确认开启
                    this.setData({
                        isEnhancedMode: true
                    });

                    // 重新开始增强模式的蓝牙搜索
                    await wx.stopBluetoothDevicesDiscovery();
                    await this.startDeviceDiscovery();

                    wx.showToast({
                        title: '已开启增强模式',
                        icon: 'none'
                    });
                }
            }
        });
    } else {
        // 关闭增强模式，清除增强模式发现的设备
        const normalDevices = this.data.nearbyUsers.filter(device => !device.isEnhanced);
        
        this.setData({
            isEnhancedMode: false,
            nearbyUsers: normalDevices
        });

        // 重新开始普通模式的蓝牙搜索
        await wx.stopBluetoothDevicesDiscovery();
        await this.startDeviceDiscovery();

        wx.showToast({
            title: '已关闭增强模式',
            icon: 'none'
        });
    }

    // 重新开始蓝牙搜索
    await wx.stopBluetoothDevicesDiscovery();
    await this.startDeviceDiscovery();
},

handleConnect(e) {
    const deviceId = e.currentTarget.dataset.deviceid;
    const device = this.data.nearbyUsers.find(d => d.deviceId === deviceId);
    
    if (!device) {
      wx.showToast({ 
        title: '设备信息无效', 
        icon: 'none' 
      });
      return;
    }

   
    console.log('[配对] 当前设备信息:', device);
    console.log('[配对] NetworkManager状态:', {
      initialized: !!this.networkManager.udp,
      discoveryPort: this.networkManager.discoveryPort,
      devices: Array.from(this.networkManager.lanDevices.values())
    });

    // 检测平台是否为Windows开发环境
    const systemInfo = wx.getSystemInfoSync();
    const isWindows = systemInfo.platform === 'windows';
    console.log('[配对] 当前平台:', systemInfo.platform);
    
    // 生成4位数配对码
    const pairCode = Math.floor(1000 + Math.random() * 9000).toString();
    this.targetPairCode = pairCode;
    
    console.log('[配对] 生成配对码:', pairCode);
    console.log('[配对] 当前配对状态:', {
        targetPairCode: this.targetPairCode,
        isPairing: this.data.isPairing,
        sentPairRequest: this.data.sentPairRequest
    });
  
    // 显示配对码对话框，但不等待用户操作就发送配对请求
    wx.showModal({
        title: '设备配对',
        content: `配对码：${pairCode}\n已向对方发送连接请求。`,
        showCancel: true,
        cancelText: '取消',
        confirmText: '',  // 隐藏确定按钮
        success: async (res) => {
          if (res.cancel) {
            // 用户点击取消，中断配对过程
            this.cancelOngoingPairing();
            // 通知其他设备取消配对
            if (this.networkManager && this.networkManager.udp) {
              const cancelMessage = {
                type: 'pair_cancel',
                deviceId: this.networkManager.deviceId,
                timestamp: Date.now()
              };
              
              // 广播取消消息
              this.networkManager.udp.send({
                address: '255.255.255.255',
                port: this.networkManager.discoveryPort,
                message: JSON.stringify(cancelMessage)
              });
            }
          }
        }
      });

    // 立即发送配对请求
    try {
      console.log('[配对] 立即发送配对请求，无需用户确认');
      // 根据设备类型选择连接方式
      if (isWindows || device.via === 'wifi' || device.via === 'udp' || device.address) {
        console.log('[配对] 使用WiFi方式配对');
        this.connectWifi(device, pairCode).catch(error => {
          console.error('[配对] WiFi连接失败:', error);
        });
      } else {
        console.log('[配对] 使用蓝牙方式配对');
        this.createBasicConnection(device).then(() => {
          this.sendPairRequest(device.deviceId, pairCode).catch(error => {
            console.error('[配对] 发送配对请求失败:', error);
          });
        }).catch(error => {
          console.error('[配对] 创建蓝牙连接失败:', error);
          wx.showToast({
            title: '蓝牙连接失败: ' + error.message,
            icon: 'none'
          });
        });
      }
      
      this.setData({
        isPairing: true,
        sentPairRequest: true,
        pairDevice: device  // 新增：保存对方设备信息
      });

    } catch (error) {
      console.error('配对请求失败:', error);
      wx.showToast({
        title: '配对请求失败: ' + error.message,
        icon: 'none'
      });
    }
  },
  
  // 发送配对请求函数
  async sendPairRequest(deviceId, pairCode) {
    // 加密配对码 (简单加密，生产环境可用更复杂的方式)
    const encryptedCode = this.encryptPairCode(pairCode);
    
    const pairRequest = {
      type: 'pair_request',
      timestamp: Date.now(),
      deviceName: wx.getSystemInfoSync().brand || '未知设备',
      pairCode: pairCode  
    };
    
    const payload = this.str2ab(JSON.stringify(pairRequest));
    const packet = this.createPacket(PROTOCOL.TYPE.PAIR_REQUEST, payload);
    
    console.log('[配对] 正在发送配对请求...');
    await this.writeBLEValue(packet);
    console.log('[配对] 已发送配对请求，配对码:', pairCode);
    
    // 设置一个超时检测
    setTimeout(() => {
      if (this.data.isPairing && this.data.sentPairRequest) {
        console.log('[配对] 警告：配对请求可能未被接收，对方未显示输入框');
      }
    }, 5000);
  },
  
// WiFi配对方法
async connectWifi(device, pairCode) {
    try {
      console.log('[配对] 使用WiFi发起配对请求，设备信息:', device);
      
      // 设置状态
      this.setData({
        pendingDeviceId: device.deviceId,
        isPairing: true,
        sentPairRequest: true,
        pairingStatus: '等待对方输入配对码...'
      });
      
      // 构建配对请求
      const pairRequest = {
        type: 'pair_request',
        timestamp: Date.now(),
        deviceName: wx.getSystemInfoSync().brand || '未知设备',
        pairCode: pairCode,
        deviceId: device.deviceId
      };
      
      console.log('[配对] 配对请求内容:', pairRequest);
      
      // 尝试通过NetworkManager发送配对请求
      if (this.networkManager) {
        try {
          // 使用NetworkManager的sendPairRequest方法
          await this.networkManager.sendPairRequest(device, pairRequest);
          console.log('[配对] 配对请求已发送');
        } catch (error) {
          console.error('[配对] 通过NetworkManager发送配对请求失败:', error);
          
          // 如果NetworkManager发送失败，尝试直接使用UDP
          if (this.networkManager.udp) {
            try {
              console.log('[配对] 尝试多种方式发送配对请求');
              const messageStr = JSON.stringify(pairRequest);
              
              // 1. 尝试广播到所有设备
              this.networkManager.udp.send({
                address: '255.255.255.255',
                port: this.networkManager.discoveryPort,
                message: messageStr,
                fail: (err) => console.error('[配对] 广播失败:', err),
                success: () => console.log('[配对] 广播成功')
              });
              
              // 2. 尝试直接发送到设备地址
              if (device.address) {
                console.log(`[配对] 尝试直接发送到设备: ${device.address}`);
                this.networkManager.udp.send({
                  address: device.address,
                  port: this.networkManager.discoveryPort,
                  message: messageStr,
                  fail: (err) => console.error(`[配对] 直接发送到${device.address}失败:`, err),
                  success: () => console.log(`[配对] 直接发送到${device.address}成功`)
                });
              }
              
              // 3. 尝试发送到本地广播地址
              if (device.address && device.address.startsWith('192.168.')) {
                const parts = device.address.split('.');
                const broadcastAddress = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
                console.log(`[配对] 尝试发送到本地广播地址: ${broadcastAddress}`);
                this.networkManager.udp.send({
                  address: broadcastAddress,
                  port: this.networkManager.discoveryPort,
                  message: messageStr,
                  fail: (err) => console.error(`[配对] 发送到本地广播地址失败:`, err),
                  success: () => console.log(`[配对] 发送到本地广播地址成功`)
                });
              }
              
              // 4. 特别处理devtools设备
              const devtoolsDevice = Array.from(this.networkManager.lanDevices.values())
                .find(d => d.name === 'devtools' || d.deviceName === 'devtools');
                
              if (devtoolsDevice && devtoolsDevice.address) {
                console.log('[配对] 尝试直接发送到devtools:', devtoolsDevice.address);
                this.networkManager.udp.send({
                  address: devtoolsDevice.address,
                  port: this.networkManager.discoveryPort,
                  message: messageStr,
                  fail: (err) => console.error('[配对] 直接发送到devtools失败:', err),
                  success: () => console.log('[配对] 直接发送到devtools成功')
                });
              }
            } catch (e) {
              console.error('[配对] 手动发送尝试失败:', e);
            }
          } else {
            throw error; // 如果无法发送，抛出错误
          }
        }
      } else {
        // 模拟发送成功，用于开发环境测试
        console.log('[配对] 模拟WiFi发送配对请求 (开发环境)');
        // 模拟收到配对响应
        setTimeout(() => {
          const fakeResponse = {
            success: true,
            timestamp: Date.now()
          };
          this.handlePairResponseWifi(device.deviceId, fakeResponse);
        }, 5000);
      }
    } catch (error) {
      console.error('[配对] WiFi配对请求失败:', error);
      throw error;
    }
  },

  // 基础连接函数
  async createBasicConnection(device) {
    await wx.createBLEConnection({ deviceId: device.deviceId });
    const { services } = await wx.getBLEDeviceServices({ 
      deviceId: device.deviceId 
    });
  
    for (const service of services) {
      const { characteristics } = await wx.getBLEDeviceCharacteristics({
        deviceId: device.deviceId,
        serviceId: service.uuid
      });
  
      const writeChar = characteristics.find(char => 
        char.properties.write || char.properties.writeNoResponse
      );
  
      if (writeChar) {
        this.setData({
          serviceId: service.uuid,
          characteristicId: writeChar.uuid,
          pendingDeviceId: device.deviceId
        });
        
        await this.setupBasicReceiver(device.deviceId);
        return;
      }
    }
  
    throw new Error('未找到可用的传输通道');
  },
  
  // 设置基础接收器
  async setupBasicReceiver(deviceId) {
    try {
      // 先清除可能存在的旧监听器
      try {
        wx.offBLECharacteristicValueChange();
      } catch (e) {
        // 忽略可能的错误
      }
      
      // 添加延时，确保监听器被正确清除
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 重新注册监听器 - 确保使用bind绑定this上下文
      const boundHandler = this.handleBLEValueChange.bind(this);
      wx.onBLECharacteristicValueChange(boundHandler);
      console.log('[配对] 已设置特征值变化监听器');
      
      // 在启用通知前记录一下当前连接状态
      console.log('[配对] 当前连接状态:', {
        deviceId,
        serviceId: this.data.serviceId,
        characteristicId: this.data.characteristicId
      });
      
      // 然后开启通知
      await wx.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId: this.data.serviceId,
        characteristicId: this.data.characteristicId,
        state: true,
        success: () => {
          console.log('[配对] 成功开启特征值通知');
        },
        fail: (err) => {
          console.error('[配对] 开启特征值通知失败:', err);
        }
      });
      
      // 测试监听器是否正常工作
      console.log('[配对] 监听器设置和通知已开启');
    } catch (error) {
      console.error('[配对] 设置基础接收监听失败:', error);
      throw new Error('设置基础接收监听失败');
    }
  },

  generatePairCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  },

  onPairCodeInput(e) {
    const inputCode = e.detail.value;
    this.setData({ pairCode: inputCode });
    
    console.log('[配对] 配对码输入:', {
        inputCode,
        targetCode: this.targetPairCode,
        receivedPairRequest: this.data.receivedPairRequest,
        sentPairRequest: this.data.sentPairRequest,
        isPairing: this.data.isPairing
    });
    
    // 当输入满4位数字时自动验证
    if (inputCode.length === 4) {
        if (this.data.receivedPairRequest) {
            // 接收方：验证输入的配对码与请求中的配对码是否匹配
            if (inputCode === this.targetPairCode) {
                this.confirmPairCode();
            } else {
                wx.showToast({
                    title: '配对码错误',
                    icon: 'error',
                    duration: 1500
                });
                
                setTimeout(() => {
                    this.setData({ pairCode: '' });
                }, 200);
            }
        } else if (this.data.sentPairRequest) {
            // 发送方：验证输入的配对码与生成的配对码是否匹配
            if (inputCode === this.targetPairCode) {
                this.confirmPairCode();
            } else {
                wx.showToast({
                    title: '配对码错误',
                    icon: 'error',
                    duration: 1500
                });
                
                setTimeout(() => {
                    this.setData({ pairCode: '' });
                }, 200);
            }
        }
    }
},

  cancelPairCode() {
    this.setData({ 
      showPairCodeInput: false, 
      pairCode: '', 
      pendingDeviceId: '' 
    });
  },

  initiatePairing(deviceId) {
    if (this.data.currentRole === 'sender') {
      this.targetPairCode = this.generatePairCode();
      wx.showModal({
        title: '配对码',
        content: `请告诉对方配对码：${this.targetPairCode}`,
        success: () => this.setData({ 
          showPairCodeInput: true,
          pendingDeviceId: deviceId
        })
      });
    } else {
      this.setData({ 
        showPairCodeInput: true, 
        pendingDeviceId: deviceId 
      });
    }
  },

  async confirmPairCode() {
    // 验证配对码格式
    if (!this.data.pairCode || this.data.pairCode.length !== 4) {
        wx.showToast({
            title: '请输入4位配对码',
            icon: 'none'
        });
        return;
    }
    
    console.log('[配对] 开始验证配对码:', {
        inputCode: this.data.pairCode,
        targetCode: this.targetPairCode,
        receivedPairRequest: this.data.receivedPairRequest,
        sentPairRequest: this.data.sentPairRequest,
        pendingDeviceId: this.data.pendingDeviceId,
        pairRequestTimestamp: this.data.pairRequestTimestamp
    });

    // 验证配对码是否匹配
    if (this.data.pairCode !== this.targetPairCode) {
        wx.showToast({
            title: '配对码错误',
            icon: 'error'
        });
        this.setData({ pairCode: '' });
        return;
    }
    
    try {
        if ((this.data.connectionMode === 'wifi' || this.data.pendingRemoteInfo) && 
            this.data.pendingRemoteInfo && 
            this.networkManager && 
            this.networkManager.udp
        ) {
            // 使用UDP/WiFi发送响应
            console.log('[配对] 使用UDP/WiFi发送配对响应');
            
            const response = {
                type: 'pair_response',
                success: true,
                timestamp: Date.now(),
                deviceId: this.data.pendingDeviceId,
                fromDeviceId: this.networkManager.deviceId,
                deviceName: wx.getSystemInfoSync().brand || '远程设备',
                pairCode: this.data.pairCode  
            };
            
            console.log('[配对] UDP配对响应内容:', response);
            console.log('[配对] 发送到:', this.data.pendingRemoteInfo);
            
            // 发送响应
            this.networkManager.udp.send({
                address: this.data.pendingRemoteInfo.address,
                port: this.data.pendingRemoteInfo.port,
                message: JSON.stringify(response),
                fail: (err) => {
                    console.error('[配对] 发送UDP配对响应失败:', err);
                    throw new Error('发送配对响应失败:' + (err.errMsg || JSON.stringify(err)));
                },
                success: () => {
                    console.log('[配对] 发送UDP配对响应成功');
                }
            });
            
            // 广播到本地网络以防端口不匹配
            if (this.data.pendingRemoteInfo.address.startsWith('192.168.')) {
                const parts = this.data.pendingRemoteInfo.address.split('.');
                const broadcastAddress = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
                
                this.networkManager.udp.send({
                    address: broadcastAddress,
                    port: this.networkManager.discoveryPort,
                    message: JSON.stringify(response),
                    fail: (err) => console.error('[配对] 广播配对响应失败:', err),
                    success: () => console.log('[配对] 广播配对响应成功')
                });
            }
        } else if (this.data.serviceId && this.data.characteristicId) {
            // 使用蓝牙发送响应
            console.log('[配对] 使用蓝牙发送配对响应');
            const responsePayload = {
                success: true,
                timestamp: Date.now(),
                pairCode: this.data.pairCode 
            };
            
            const payload = this.str2ab(JSON.stringify(responsePayload));
            const packet = this.createPacket(PROTOCOL.TYPE.PAIR_RESPONSE, payload);
            
            await this.writeBLEValue(packet);
        } else {
            throw new Error('无法确定发送配对响应的方式，请检查连接状态');
        }
        
        // 创建设备连接
        let device = this.data.nearbyUsers.find(d => d.deviceId === this.data.pendingDeviceId);
        if (!device && this.networkManager) {
            const remoteDevice = this.networkManager.lanDevices.get(this.data.pendingDeviceId);
            if (remoteDevice) {
                device = {
                    deviceId: remoteDevice.deviceId,
                    name: remoteDevice.name || remoteDevice.deviceName || '远程设备',
                    address: remoteDevice.address,
                    via: 'wifi',
                    RSSI: -50
                };
            }
        }
        
        if (!device && this.data.pendingRemoteInfo) {
            device = {
                deviceId: this.data.pendingDeviceId || 'temp-device-' + Date.now(),
                name: '远程设备',
                address: this.data.pendingRemoteInfo.address,
                via: 'wifi',
                RSSI: -50
            };
        }
        
        if (device) {
            this.setData({
                showPairCodeInput: false,
                pairCode: '',
                isPairing: false,
                connectedUser: device,
                transferStatus: 'connected',
                connectionStatus: `已连接到 ${device.name || '未知设备'}`
            });
            
            wx.showToast({
                title: '配对成功',
                icon: 'success'
            });
            
            wx.setNavigationBarTitle({
                title: `已连接到 ${device.name || '未知设备'}`
            });
        } else {
            throw new Error('无法创建有效的设备连接');
        }
    } catch (error) {
        console.error('[配对] 配对确认失败:', error);
        wx.showToast({
            title: '配对失败: ' + (error.message || '未知错误'),
            icon: 'none'
        });
        this.setData({
            showPairCodeInput: false,
            pairCode: '',
            isPairing: false
        });
    }
},
  
  async cancelPairCode() {
    // 如果是接收方取消，发送拒绝配对的响应
    if (this.data.pendingDeviceId && this.data.receivedPairRequest) {
      await this.rejectPairCode();
    }
    
    this.setData({ 
      showPairCodeInput: false, 
      pairCode: '', 
      pendingDeviceId: '',
      isPairing: false,
      receivedPairRequest: false,
      sentPairRequest: false
    });
  },

// 处理UDP配对请求
async handleUDPPairRequest(request, remoteInfo, socket) {
    try {
      console.log('[配对] 收到UDP配对请求:', request, '来自:', remoteInfo);
      
      // 保存请求中的配对码
      this.targetPairCode = request.pairCode;
      
      console.log('[配对] 保存接收到的配对码:', {
          receivedCode: request.pairCode,
          savedTargetCode: this.targetPairCode
      });
      
      wx.hideLoading();
      
      // 增加平台检测的日志
      const platform = wx.getSystemInfoSync().platform;
      console.log('[配对] 当前平台:', platform, '准备显示配对请求');
      
      if (platform === 'windows' || platform === 'devtools') {
        console.log('⭐⭐⭐在Windows/devtools环境显示配对请求');
        try {
          // 直接显示配对输入界面，无需额外确认
          this.setData({
            showPairCodeInput: true,
            pendingDeviceId: request.deviceId || request.fromDeviceId,
            pendingRemoteInfo: remoteInfo,
            pendingSocket: socket,
            pairCode: '',  // 清空配对码，等待用户输入
            isPairing: true,
            receivedPairRequest: true,
            pairRequestTimestamp: request.timestamp,
            connectionMode: 'wifi',
            connectionStatus: `来自 ${request.deviceName || '未知设备'} 的配对请求`,
            receivedPairCode: request.pairCode,  // 新增字段保存接收到的配对码
            pairDevice: {  // 新增：保存发起方设备信息
                deviceId: request.deviceId || request.fromDeviceId,
                name: request.deviceName,
                address: remoteInfo.address
            }
          });
          
          console.log('[配对] 跳过模态框显示');
        } catch (e) {
          console.error('[配对] 设置配对状态失败:', e);
        }
      } else {
        // 直接显示配对码输入框，跳过确认对话框
        this.setData({
          showPairCodeInput: true,
          pendingDeviceId: request.deviceId || request.fromDeviceId,
          pendingRemoteInfo: remoteInfo,
          pendingSocket: socket,
          pairCode: '',  // 清空配对码，等待用户输入
          isPairing: true,
          receivedPairRequest: true,
          pairRequestTimestamp: request.timestamp,
          connectionMode: 'wifi',
          connectionStatus: `来自 ${request.deviceName || '未知设备'} 的配对请求`,
          receivedPairCode: request.pairCode  // 新增字段保存接收到的配对码
        });
        
        // 尝试震动提醒
        try {
          wx.vibrateLong();
        } catch (e) {
          // 忽略不支持的平台
        }
      }
    } catch (error) {
      console.error('[配对] 处理UDP配对请求失败:', error);
      // 出错时也尝试显示配对输入框
      
      try {
        this.setData({
          showPairCodeInput: true,
          pendingDeviceId: request.deviceId || request.fromDeviceId,
          pendingRemoteInfo: remoteInfo,
          pendingSocket: socket,
          pairCode: '',  // 清空配对码
          isPairing: true,
          receivedPairRequest: true,
          receivedPairCode: request.pairCode  // 新增字段保存接收到的配对码
        });
      } catch (e) {
        console.error('[配对] 紧急显示配对输入框失败:', e);
      }
    }
},
  
  // UDP拒绝配对
  rejectUDPPairCode(socket, remoteInfo) {
    try {
        const response = {
            type: 'pair_response',
            success: true,
            timestamp: Date.now(),
            deviceId: this.data.pendingDeviceId,
            fromDeviceId: this.networkManager.deviceId  // 使用自己的ID
          };
      
      socket.send({
        address: remoteInfo.address,
        port: remoteInfo.port,
        message: JSON.stringify(response)
      });
    } catch (error) {
      console.error('[配对] 发送UDP拒绝配对失败:', error);
    }
  },

  // 1. 简单的配对码加密函数(用于演示，实际可使用更安全的方式)
encryptPairCode(code) {
    // 简单异或加密
    const key = [0x37, 0x92, 0xF6, 0x4D];
    const result = [];
    
    for (let i = 0; i < code.length; i++) {
      result.push(code.charCodeAt(i) ^ key[i % key.length]);
    }
    
    return result;
  },
  
  // 2. 拒绝配对
  async rejectPairCode() {
    try {
      const responsePayload = {
        success: false,
        reason: '对方取消了配对',
        timestamp: Date.now()
      };
      
      const payload = this.str2ab(JSON.stringify(responsePayload));
      const packet = this.createPacket(PROTOCOL.TYPE.PAIR_RESPONSE, payload);
      
      await this.writeBLEValue(packet);
    } catch (error) {
      console.error('[配对] 发送拒绝配对响应失败:', error);
    }
  },
 // ZU_xian's code fingerprint
  async handlePairResponseWifi(deviceId, response) {
    try {
      console.log('[配对] 处理WiFi配对响应:', response, '设备ID:', deviceId);
      console.log('[配对] 本地设备ID:', this.networkManager.deviceId);
      
      wx.hideLoading();
      
      if (!response.success) {
        console.error('[配对] 配对被拒绝:', response.reason || '未知原因');
        wx.showToast({
          title: '配对被拒绝: ' + (response.reason || '未知原因'),
          icon: 'none'
        });
        
        this.setData({
          isPairing: false,
          sentPairRequest: false,
          pendingDeviceId: ''
        });
        return;
      }
      
      // 配对成功，完成连接
      let device = null;
      
      // 优先使用response中的发送方设备信息
      if (response.fromDeviceId && response.fromDeviceId !== this.networkManager.deviceId) {
        console.log('[配对] 尝试通过fromDeviceId查找设备:', response.fromDeviceId);
        device = this.data.nearbyUsers.find(d => d.deviceId === response.fromDeviceId);
        
        if (!device && this.networkManager) {
          const fromDevice = this.networkManager.lanDevices.get(response.fromDeviceId);
          if (fromDevice) {
            device = {
              deviceId: fromDevice.deviceId,
              name: fromDevice.name || fromDevice.deviceName || '远程设备',
              address: fromDevice.address,
              via: 'wifi',
              RSSI: -50
            };
            console.log('[配对] 从NetworkManager找到发送方设备:', device);
          }
        }
      }
      
      // 如果找不到发送方设备，再尝试使用deviceId
      if (!device) {
        console.log('[配对] 尝试通过deviceId查找设备:', deviceId);
        device = this.data.nearbyUsers.find(d => d.deviceId === deviceId);
}
      
      if (!device && this.networkManager) {
        console.log('[配对] 在nearbyUsers中未找到设备，尝试从NetworkManager中查找');
        
        // 尝试通过fromDeviceId查找
        if (response.fromDeviceId && response.fromDeviceId !== this.networkManager.deviceId) {
          const fromDevice = this.networkManager.lanDevices.get(response.fromDeviceId);
          if (fromDevice) {
            device = {
              deviceId: fromDevice.deviceId,
              name: fromDevice.name || fromDevice.deviceName || '远程设备',
              address: fromDevice.address,
              via: 'wifi',
              RSSI: -50
            };
            console.log('[配对] 通过fromDeviceId找到设备:', device);
          }
        }
        
        // 如果还没找到，再尝试通过deviceId查找
        if (!device) {
          const lanDevice = this.networkManager.lanDevices.get(deviceId);
          if (lanDevice) {
            device = {
              deviceId: lanDevice.deviceId,
              name: lanDevice.name || lanDevice.deviceName || '远程设备',
              address: lanDevice.address,
              via: 'wifi',
              RSSI: -50
            };
            console.log('[配对] 从NetworkManager中找到设备:', device);
          }
        }
      }
      
      if (device) {
        this.setData({
          isPairing: false,
          sentPairRequest: false,
          connectedUser: device,
          transferStatus: 'connected',
          connectionStatus: `已连接到 ${device.name || '未知设备'}`
        });
        
        // 同步设备状态
        this.syncDeviceState(device, 'connected');
        
        wx.showToast({
          title: '配对成功',
          icon: 'success'
        });
        
        wx.setNavigationBarTitle({
          title: `已连接到 ${device.name || '未知设备'}`
        });
      } else {
        console.error('[配对] 未找到待连接设备:', deviceId);
        const tempDevice = {
          deviceId: deviceId,
          name: '远程设备',
          via: 'wifi',
          address: response.remoteInfo ? response.remoteInfo.address : 
                  (this.data.pendingRemoteInfo ? this.data.pendingRemoteInfo.address : null)
        };
        
        this.setData({
          isPairing: false,
          sentPairRequest: false,
          connectedUser: tempDevice,
          transferStatus: 'connected',
          connectionStatus: `已连接到远程设备`
        });
        
        // 同步临时设备状态
        this.syncDeviceState(tempDevice, 'connected');
        
        wx.showToast({
          title: '配对成功',
          icon: 'success'
        });
        
        wx.setNavigationBarTitle({
          title: `已连接到远程设备`
        });
      }
    } catch (error) {
      console.error('[配对] 处理WiFi配对响应失败:', error);
      wx.showToast({
        title: '配对失败: ' + (error.message || '未知错误'),
        icon: 'none'
      });
      
      this.setData({
        isPairing: false,
        sentPairRequest: false,
        pendingDeviceId: ''
      });
    }
  },

  async proceedWithConnection(deviceId) {
    const device = this.data.nearbyUsers.find(d => d.deviceId === deviceId);
    if (!device) return;

    try {
        wx.showLoading({ title: '正在连接...' });
        
        if (device.via === 'bluetooth') {
            await this.connectBluetooth(device);
        } else {
            this.setData({
                connectedUser: device,
                transferStatus: 'connected',
                connectionStatus: `已连接到 ${device.name || '未知设备'}`
            });
        }
        
        wx.showToast({ title: '连接成功', icon: 'success' });
    } catch (error) {
        console.error('连接失败:', error);
        wx.showToast({ title: '连接失败', icon: 'none' });
    } finally {
        wx.hideLoading();
    }
},

  async connectBluetooth(device) {
    await wx.createBLEConnection({ deviceId: device.deviceId });
    const { services } = await wx.getBLEDeviceServices({ 
      deviceId: device.deviceId 
    });

    for (const service of services) {
      const { characteristics } = await wx.getBLEDeviceCharacteristics({
        deviceId: device.deviceId,
        serviceId: service.uuid
      });

      const writeChar = characteristics.find(char => 
        char.properties.write || char.properties.writeNoResponse
      );

      if (writeChar) {
        this.setData({
          serviceId: service.uuid,
          characteristicId: writeChar.uuid,
          connectedUser: device,
          transferStatus: 'connected'
        });
        
        await this.setupReceiver(device.deviceId);
        return;
      }
    }

    throw new Error('未找到可用的传输通道');
  },

  async setupReceiver(deviceId) {
    try {
      await wx.notifyBLECharacteristicValueChange({
        deviceId,
        serviceId: this.data.serviceId,
        characteristicId: this.data.characteristicId,
        state: true
      });
  
      // 使用通用的处理函数
      wx.onBLECharacteristicValueChange(this.handleBLEValueChange.bind(this));
    } catch (error) {
      throw new Error('设置接收监听失败');
    }
  },

  async handleUpload() {
    if (!this.data.connectedUser) {
        wx.showToast({ 
            title: '请先连接接收方', 
            icon: 'none' 
        });
        return;
    }

    try {
        // 直接调用文件选择器，不要提前设置状态
        const fileResult = await new Promise((resolve, reject) => {
            wx.chooseMessageFile({
                count: 1,
                type: 'file',
                success: (res) => {
                    console.log('[上传] 文件选择成功:', res);
                    resolve(res);
                },
                fail: (error) => {
                    console.error('[上传] 文件选择失败:', error);
                    reject(error);
                }
            });
        });

        if (!fileResult || !fileResult.tempFiles || !fileResult.tempFiles.length) {
            throw new Error('未获取到文件信息');
        }

        const file = fileResult.tempFiles[0];
        
        // 选择文件成功后再设置准备中状态
        this.setData({
            selectedFile: {...file, originalName: file.name},
            transferStatus: 'preparing',
            lastTransferTime: Date.now(),
            lastTransferSize: 0
        });
        
        // 检查文件大小
        if (file.size > 100 * 1024 * 1024) { // 100MB限制
            wx.showModal({
                title: '文件过大',
                content: '请选择小于100MB的文件',
                showCancel: false
            });
            return;
        }

        // 执行文件传输逻辑...
        console.log('[上传] 准备传输文件...');
        
        // 根据连接方式选择传输方法
        if (this.data.connectedUser.via === 'bluetooth') {
            console.log('[上传] 使用蓝牙传输');
            await this.sendFileViaBluetooth(file);
        } else {
            console.log('[上传] 使用WiFi传输');
            try {
                await this.networkManager.sendFile(file.path, this.data.connectedUser, file);
            } catch (error) {
                console.error('[上传] WiFi传输失败:', error);
                wx.showToast({
                    title: '文件传输失败: ' + (error.message || '未知错误'),
                    icon: 'none',
                    duration: 3000
                });
                return;
            }
        }
        
        // 传输成功的提示
        wx.showToast({
            title: '传输成功',
            icon: 'success'
        });
    } catch (error) {
        console.error('[上传] 文件处理失败:', error);
        wx.showToast({ 
            title: error.message || '文件处理失败',
            icon: 'none',
            duration: 2000
        });
        
        // 恢复状态
        this.setData({
            transferStatus: '',
            selectedFile: null
        });
    }
},

async saveFileToUserAccessible(tempFilePath, fileName) {
    try {
      // 获取系统信息，判断平台
      const systemInfo = wx.getSystemInfoSync();
      console.log('[文件保存] 当前平台:', systemInfo.platform);
      
      // 根据文件类型选择不同的保存方式
      const fileExt = fileName.split('.').pop().toLowerCase();
      
      if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
        // 图片保存到相册
        return await new Promise((resolve, reject) => {
          wx.saveImageToPhotosAlbum({
            filePath: tempFilePath,
            success: resolve,
            fail: (error) => {
              console.error('[文件保存] 保存图片失败:', error);
              reject(error);
            }
          });
        });
      } else if (systemInfo.platform === 'devtools' || systemInfo.platform === 'windows') {
        // 开发工具环境使用特殊处理
        console.log('[文件保存] 开发环境，使用临时存储');
        return tempFilePath; // 开发环境直接返回临时路径
      } else if (systemInfo.platform === 'android' || systemInfo.platform === 'ios') {
        // 移动设备环境
        try {
          // 先尝试使用 saveFileToDisk
          return await new Promise((resolve, reject) => {
            wx.saveFileToDisk({
              filePath: tempFilePath,
              fileName: fileName,
              success: resolve,
              fail: (error) => {
                if (error.errMsg && error.errMsg.includes('function cannot run')) {
                  // 如果不支持 saveFileToDisk，尝试保存到用户文件夹
                  const fs = wx.getFileSystemManager();
                  const savedPath = `${wx.env.USER_DATA_PATH}/saved_${Date.now()}_${fileName}`;
                  
                  fs.copyFile({
                    srcPath: tempFilePath,
                    destPath: savedPath,
                    success: () => {
                      console.log('[文件保存] 已保存到:', savedPath);
                      resolve(savedPath);
                    },
                    fail: (copyError) => {
                      console.error('[文件保存] 复制文件失败:', copyError);
                      reject(copyError);
                    }
                  });
                } else {
                  reject(error);
                }
              }
            });
          });
        } catch (error) {
          console.error('[文件保存] saveFileToDisk 失败:', error);
          
          // 后备方案：保存到用户空间
          const fs = wx.getFileSystemManager();
          const savedPath = `${wx.env.USER_DATA_PATH}/saved_${Date.now()}_${fileName}`;
          
          return await new Promise((resolve, reject) => {
            fs.copyFile({
              srcPath: tempFilePath,
              destPath: savedPath,
              success: () => {
                console.log('[文件保存] 已保存到用户空间:', savedPath);
                resolve(savedPath);
              },
              fail: reject
            });
          });
        }
      } else {
        // 其他平台的后备处理
        console.log('[文件保存] 未知平台，使用通用方法');
        const fs = wx.getFileSystemManager();
        const savedPath = `${wx.env.USER_DATA_PATH}/saved_${Date.now()}_${fileName}`;
        
        return await new Promise((resolve, reject) => {
          fs.copyFile({
            srcPath: tempFilePath,
            destPath: savedPath,
            success: () => resolve(savedPath),
            fail: reject
          });
        });
      }
    } catch (error) {
      console.error('[文件保存] 保存过程出错:', error);
      throw error;
    }
  },

  async sendFileViaBluetooth(file) {
    try {
      wx.showLoading({ title: '准备发送...' });
      
      // 计算文件校验和
      const checksum = await this.calculateFileChecksum(file.path);
      
      const infoPacket = this.createPacket(
        PROTOCOL.TYPE.FILE_INFO,
        this.str2ab(JSON.stringify({
          size: file.size,
          name: file.name,
          checksum,
          timestamp: Date.now(),
          chunks: Math.ceil(file.size / CHUNK_SIZE)
        }))
      );
      await this.writeBLEValue(infoPacket);

      const fileContent = await this.readFile(file.path);
      for (let i = 0; i * CHUNK_SIZE < fileContent.byteLength; i++) {
        const chunkHeader = new DataView(new ArrayBuffer(2));
        chunkHeader.setUint16(0, i);
        
        const chunkData = fileContent.slice(
          i * CHUNK_SIZE,
          (i + 1) * CHUNK_SIZE
        );
        
        const chunkChecksum = await this.calculateBufferChecksum(chunkData);
        const packet = this.createPacket(
          PROTOCOL.TYPE.FILE_DATA,
          this.mergeBuffers(
            chunkHeader.buffer,
            chunkChecksum,
            chunkData
          )
        );
        
        await this.writeBLEValue(packet);
        
        const progress = Math.floor((i + 1) * CHUNK_SIZE / file.size * 100);
        this.setData({
          transferProgress: Math.min(progress, 100),
          transferStatus: 'transferring'
        });

        this.updateTransferStats(i * CHUNK_SIZE);
      }
      
      wx.showToast({ title: '发送完成', icon: 'success' });
    } catch (error) {
      console.error('发送文件失败:', error);
      wx.showToast({ title: '发送失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ 
        transferProgress: 0,
        transferStatus: 'completed'
      });
    }
  },

  updateTransferStats(transferredSize) {
    const now = Date.now();
    const timeDiff = (now - this.data.lastTransferTime) / 1000;
    
    if (timeDiff > 0) {
      const bytesDiff = transferredSize - this.data.lastTransferSize;
      const speed = bytesDiff / timeDiff;
      const remainingBytes = this.data.selectedFile ? 
        (this.data.selectedFile.size - transferredSize) : 0;
      const remainingTime = speed > 0 ? remainingBytes / speed : 0;

      this.setData({
        transferSpeed: this.formatSpeed(speed),
        remainingTime: this.formatTime(remainingTime),
        lastTransferTime: now,
        lastTransferSize: transferredSize
      });
    }
  },

  formatSpeed(bytesPerSecond) {
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let speed = bytesPerSecond;
    let unitIndex = 0;
    
    while (speed >= 1024 && unitIndex < units.length - 1) {
      speed /= 1024;
      unitIndex++;
    }
    
    return `${speed.toFixed(1)} ${units[unitIndex]}`;
  },

  formatTime(seconds) {
    if (seconds < 60) {
      return `${Math.ceil(seconds)}秒`;
    } else if (seconds < 3600) {
      return `${Math.ceil(seconds / 60)}分钟`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.ceil((seconds % 3600) / 60);
      return `${hours}小时${minutes}分钟`;
    }
  },

  // 蓝牙相关辅助函数
  createPacket(type, payload) {
    const header = new ArrayBuffer(8);
    const dv = new DataView(header);
    dv.setUint32(0, PROTOCOL.HEADER);
    dv.setUint8(4, PROTOCOL.VERSION);
    dv.setUint8(5, type);
    dv.setUint16(6, payload.byteLength);
    return this.mergeBuffers(header, payload);
  },

  async writeBLEValue(value, retries = 3) {
    const deviceId = this.data.connectedUser ? 
                   this.data.connectedUser.deviceId : 
                   this.data.pendingDeviceId;
                   
    if (!deviceId) {
      console.error('[蓝牙] 写入失败：未找到设备ID');
      throw new Error('未找到设备ID');
    }
    
    for (let i = 0; i < retries; i++) {
      try {
        await new Promise((resolve, reject) => {
          wx.writeBLECharacteristicValue({
            deviceId: deviceId,
            serviceId: this.data.serviceId,
            characteristicId: this.data.characteristicId,
            value,
            success: (res) => {
              console.log('[蓝牙] 写入特征值成功');
              resolve(res);
            },
            fail: (err) => {
              console.error('[蓝牙] 写入特征值失败:', err);
              reject(err);
            }
          });
        });
        return;
      } catch (err) {
        console.warn(`[蓝牙] 写入失败，第${i+1}次重试:`, err);
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, 300)); // 增加重试间隔
      }
    }
  },

  async calculateFileChecksum(filePath) {
    return new Promise((resolve) => {
      wx.getFileSystemManager().readFile({
        filePath,
        success: (res) => {
          const data = new Uint8Array(res.data);
          let hash = 0;
          for (let i = 0; i < data.length; i++) {
            hash = ((hash << 5) - hash) + data[i];
            hash = hash & hash;
          }
          resolve(hash.toString(16));
        }
      });
    });
  },

  async calculateBufferChecksum(buffer) {
    const data = new Uint8Array(buffer);
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data[i];
      hash = hash & hash;
    }
    return new TextEncoder().encode(hash.toString(16));
  },

  mergeBuffers(...buffers) {
    const totalLength = buffers.reduce((acc, buf) => acc + buf.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    
    buffers.forEach(buffer => {
      merged.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    });
    
    return merged.buffer;
  },

  str2ab(str) {
    return new TextEncoder().encode(str).buffer;
  },

  async readFile(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        success: res => resolve(res.data),
        fail: reject
      });
    });
  },

  handleDisconnection() {
    if (this.data.transferStatus === 'transferring') {
      this.setData({
        transferStatus: 'interrupted',
        canResume: true
      });
    }
    
    if (this.data.reconnectAttempts < this.data.maxReconnectAttempts) {
      this.reconnect();
    }
  },

  async reconnect() {
    this.setData({
      reconnectAttempts: this.data.reconnectAttempts + 1
    });

    try {
      await this.proceedWithConnection(this.data.connectedUser.deviceId);
      this.setData({ reconnectAttempts: 0 });
    } catch (error) {
      console.error('重连失败:', error);
    }
  },

  handleDisconnect() {
    wx.showModal({
      title: '取消连接',
      content: '确定要断开与当前设备的连接吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            if (this.data.connectedUser) {
              // 保存当前设备信息用于发送断开消息
              const deviceToDisconnect = this.data.connectedUser;
  
              // 发送断开连接的消息（在重置状态之前发送）
              const disconnectMessage = {
                type: 'device_state',
                deviceId: this.networkManager.deviceId,
                deviceName: wx.getSystemInfoSync().brand || '远程设备',
                state: 'disconnected',
                timestamp: Date.now()
              };
              
              if (this.networkManager && this.networkManager.udp) {
                const messageStr = JSON.stringify(disconnectMessage);
                
                try {
                  // 如果有对方的具体地址，先直接发送
                  if (deviceToDisconnect.address) {
                    await new Promise((resolve, reject) => {
                      this.networkManager.udp.send({
                        address: deviceToDisconnect.address,
                        port: this.networkManager.discoveryPort,
                        message: messageStr,
                        success: resolve,
                        fail: reject
                      });
                    });
                  }
                  
                  // 再广播断开消息
                  await new Promise((resolve, reject) => {
                    this.networkManager.udp.send({
                      address: '255.255.255.255',
                      port: this.networkManager.discoveryPort,
                      message: messageStr,
                      success: resolve,
                      fail: reject
                    });
                  });
                } catch (error) {
                  console.error('[断开] 发送断开消息失败:', error);
                }
              }
  
              // 如果是蓝牙连接，断开蓝牙
              if (deviceToDisconnect.via === 'bluetooth') {
                try {
                  await wx.closeBLEConnection({
                    deviceId: deviceToDisconnect.deviceId
                  });
                } catch (err) {
                  console.warn('[断开] 断开蓝牙连接失败:', err);
                }
              }
  
              // 最后才重置所有状态
              this.setData({
                connectedUser: null,
                connectionStatus: '',
                transferStatus: 'disconnected',
                transferProgress: 0
              });
  
              // 重置导航栏标题
              wx.setNavigationBarTitle({
                title: '面对面快传'
              });
  
              wx.showToast({
                title: '已断开连接',
                icon: 'success'
              });
            }
          } catch (error) {
            console.error('[断开] 断开连接失败:', error);
            wx.showToast({
              title: '断开连接失败',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  async onUnload() {
    // 先停止搜索
    await this.stopSearch();

    // 如果有连接的设备，断开连接
    if (this.data.connectedUser) {
        if (this.data.connectedUser.via === 'bluetooth') {
            try {
                await wx.closeBLEConnection({ 
                    deviceId: this.data.connectedUser.deviceId 
                });
            } catch (err) {
                console.log('断开蓝牙连接失败:', err);
            }
        }
    }

    // 关闭蓝牙适配器
    try {
        await wx.closeBluetoothAdapter();
    } catch (err) {
        console.log('关闭蓝牙适配器失败:', err);
    }

    // 重置数据
    this.setData({
        receivedFileHistory: [],
        receivedFiles: [],
        currentReceivedFile: null
    });

    // 清理网络管理器
    if (this.networkManager) {
        this.networkManager.cleanup();
    }
},

  simulatePairCodeInput() {
    console.log('[调试] 模拟显示配对码输入框');
    
    this.setData({
      showPairCodeInput: true,
      pendingDeviceId: 'test-device-id',
      pairCode: '',
      isPairing: true,
      receivedPairRequest: true,
      pairRequestTimestamp: Date.now(),
      connectionStatus: `来自 测试设备 的连接请求`
    });
    
    console.log('[调试] 已显示配对码输入框');
  },

// 取消正在进行的配对
async cancelOngoingPairing() {
    try {
        // 如果已连接，断开连接
        if (this.data.pendingDeviceId) {
            if (this.data.transferMode === 'bluetooth' || this.data.transferMode === 'both') {
                try {
                    await wx.closeBLEConnection({
                        deviceId: this.data.pendingDeviceId
                    });
                } catch (error) {
                    console.log('[配对] 断开蓝牙连接失败，可能未建立连接:', error);
                }
            }
        }

        // 发送取消消息
        if (this.networkManager && this.networkManager.udp) {
            const cancelMessage = {
                type: 'pair_cancel',
                deviceId: this.networkManager.deviceId,
                timestamp: Date.now()
            };

            // 如果有配对设备信息，直接发送给对方
            if (this.data.pairDevice && this.data.pairDevice.address) {
                this.networkManager.udp.send({
                    address: this.data.pairDevice.address,
                    port: this.networkManager.discoveryPort,
                    message: JSON.stringify(cancelMessage),
                    success: () => console.log('[配对] 发送取消消息成功'),
                    fail: (err) => console.error('[配对] 发送取消消息失败:', err)
                });
            }

            // 同时也广播取消消息
            this.networkManager.udp.send({
                address: '255.255.255.255',
                port: this.networkManager.discoveryPort,
                message: JSON.stringify(cancelMessage),
                success: () => console.log('[配对] 广播取消消息成功'),
                fail: (err) => console.error('[配对] 广播取消消息失败:', err)
            });
        }

        // 重置所有配对状态
        this.setData({
            isPairing: false,
            sentPairRequest: false,
            pendingDeviceId: '',
            pairingStatus: '',
            showPairCodeInput: false,
            pairDevice: null  // 清除配对设备信息
        });

        wx.hideLoading();
        console.log('[配对] 已取消配对过程');

    } catch (error) {
        console.error('[配对] 取消配对过程出错:', error);
        // 强制重置状态
        this.setData({
            isPairing: false,
            sentPairRequest: false,
            pendingDeviceId: '',
            pairingStatus: '',
            showPairCodeInput: false,
            pairDevice: null
        });

        wx.hideLoading();
    }
},

  simulatePairRequest() {
    const fakeRequest = {
      type: 'pair_request',
      timestamp: Date.now(),
      deviceName: 'Manual Test',
      pairCode: '1234',
      deviceId: 'test-device'
    };
    
    const fakeRemoteInfo = {
      address: '127.0.0.1',
      port: 40000
    };
    
    // 假装我们收到了配对请求
    this.handleUDPPairRequest(fakeRequest, fakeRemoteInfo, this.networkManager.udp);
  }
});