/* networkManager.js
 * @author ZU_xian
 * @copyright ZU_xian UDP file transfer WeChat applet
 * Created by ZU_xian (2025)
 * All rights reserved.
 */
class NetworkManager {
  constructor() {
      this.udp = null;
      this.transferUdp = null;
      this.discoveryPort = null;
      this.transferStates = new Map();
      this.transferPort = null;
      this.discoveryInterval = null;
      this.foundDevices = new Map();
      this.lanDevices = new Map();
      this.deviceId = this.generateDeviceId();
      this.isTransferring = false;
      this.currentChunks = new Map();
      this.ackTimeouts = new Map();
      this.retryCount = new Map();
      this.maxRetries = 3;
      this.chunkSize = 60000;
      this.ackTimeout = 1000;
      this.portRetryAttempts = 0;
      this.maxPortRetries = 10;
      this.startPort = 40000;
      this.isInitializing = false;
      this.initRetryCount = 0;
      this.maxInitRetries = 3;
      this.currentTransferId = null;
      this.currentFileInfo = null;
      this.processedTransfers = new Map();
      this.transferLocks = new Map();
      this.processedAcks = new Map();
      this.activeTransfers = new Set();
      this.lastProcessedFile = null;
      
      this.onProgress = null;
      this.onComplete = null;
      this.onError = null;
      this.onDeviceFound = null;
      this.onLANDeviceFound = null;
      this.onReceiveStart = null;
      this.onConnectionLost = null;
      this.onReceiveComplete = null;
      this.onPairRequest = null;  
      this.onPairResponse = null;
      this.onPairCancel = null; 
      this.onTransferStatusUpdate = null;
  }

  generateDeviceId() {
      return 'device_' + Math.random().toString(36).substr(2, 9);
  }

  resetTransferState() {
      this.isTransferring = false;
      this.currentChunks.clear();
      this.currentTransferId = null;
      this.currentFileInfo = null;
      
      this.ackTimeouts.forEach(timeout => clearTimeout(timeout));
      this.ackTimeouts.clear();
      this.retryCount.clear();
      
      this.activeTransfers.clear();
      this.processedAcks.clear();
  }

  static async getNetworkType() {
      return new Promise((resolve, reject) => {
          wx.getNetworkType({
              success: (res) => {
                  resolve({
                      type: res.networkType,
                      signalStrength: res.signalStrength || 0,
                      isWifi: res.networkType === 'wifi',
                      isStable: true
                  });
              },
              fail: reject
          });
      });
  }

  async initDiscovery() {
      if (this.isInitializing) {
          return false;
      }

      if (this.initRetryCount >= this.maxInitRetries) {
          return false;
      }
  
      this.isInitializing = true;
  
      try {
          this.cleanup();
  
          const discoveryPort = await this.bindAvailablePort();
          if (!discoveryPort) {
              throw new Error('无法找到可用的发现端口');
          }
  
          const transferPort = await this.bindAvailablePort(discoveryPort + 1000);
          if (!transferPort) {
              throw new Error('无法找到可用的传输端口');
          }
  
          this.udp = wx.createUDPSocket();
          const boundDiscoveryPort = this.udp.bind(discoveryPort);
          if (!boundDiscoveryPort) {
              throw new Error('绑定发现端口失败');
          }
          this.discoveryPort = boundDiscoveryPort;
          
          this.transferUdp = wx.createUDPSocket();
          const boundTransferPort = this.transferUdp.bind(transferPort);
          if (!boundTransferPort) {
              throw new Error('绑定传输端口失败');
          }
          this.transferPort = boundTransferPort;
  
          this.udp.onMessage((res) => {
              this.handleMessage(res);
          });
  
          this.transferUdp.onMessage((res) => {
              this.handleTransferMessage(res);
          });
  
          this.udp.onError((error) => {
              this.handleUDPError(error);
          });
  
          this.transferUdp.onError((error) => {
              this.handleUDPError(error);
          });
  
          await this.startDiscoveryBroadcast();
  
          this.isInitializing = false;
          this.initRetryCount = 0;
          return true;
  
      } catch (error) {
          this.isInitializing = false;
          this.initRetryCount++;
          this.cleanup();
          throw error;
      }
  }

  async initTransferSocket() {
      if (this.transferUdp) {
          try {
              this.transferUdp.close();
          } catch (e) {}
      }
      
      this.transferUdp = wx.createUDPSocket();
      const transferPort = await this.bindAvailablePort(this.startPort + 1000);
      if (!transferPort) {
          return false;
      }
      
      this.transferPort = transferPort;
      
      this.transferUdp.onMessage((res) => {
          try {
              let messageStr;
              if (typeof res.message === 'string') {
                  messageStr = res.message;
              } else {
                  messageStr = String.fromCharCode.apply(null, new Uint8Array(res.message));
              }
              
              const message = JSON.parse(messageStr);
              
              switch(message.type) {
                  case 'FILE_START':
                      this.transferUdp.send({
                          address: res.remoteInfo.address,
                          port: res.remoteInfo.port,
                          message: JSON.stringify({
                              type: 'FILE_START_ACK',
                              transferId: message.transferId,
                              timestamp: Date.now()
                          })
                      });
                      
                      this.handleFileStart(message, res.remoteInfo);
                      break;
                      
                  case 'FILE_DATA':
                      this.handleFileData(message, res.remoteInfo);
                      break;
                      
                  case 'FILE_COMPLETE':
                      this.handleFileComplete(message);
                      break;
              }
              
          } catch (error) {}
      });
      
      return true;
  }

  async bindAvailablePort(startingPort = null) {
      const start = startingPort || this.startPort;
      
      for (let i = 0; i < this.maxPortRetries; i++) {
          try {
              const testPort = start + i;
              
              const socket = wx.createUDPSocket();
              const boundPort = socket.bind(testPort);
              
              if (boundPort) {
                  socket.close();
                  return testPort;
              }
              
              socket.close();
              
          } catch (error) {
              continue;
          }
      }
      return null;
  }

  handleUDPError(error) {
      if (this.onError) {
          this.onError({
              type: 'UDP_ERROR',
              message: error.errMsg || '网络连接错误',
              originalError: error
          });
      }
      
      this.cleanup();
  }

  async checkPermissions() {
      try {
          await new Promise((resolve, reject) => {
              wx.authorize({
                  scope: 'scope.userLocation',
                  success: resolve,
                  fail: reject
              });
          });
          return true;
      } catch (error) {
          wx.showModal({
              title: '需要授权',
              content: '请在设置中允许使用位置权限，以便发现附近设备',
              confirmText: '去设置',
              success: (res) => {
                  if (res.confirm) {
                      wx.openSetting();
                  }
              }
          });
          return false;
      }
  }

  async startDiscoveryBroadcast() {
      try {
          const message = {
              type: 'DISCOVER',
              deviceId: this.deviceId,
              deviceName: wx.getSystemInfoSync().brand || '未知设备',
              deviceType: 'lan',
              timestamp: Date.now()
          };

          await this.broadcastMessage(message);

          if (this.discoveryInterval) {
              clearInterval(this.discoveryInterval);
          }

          this.discoveryInterval = setInterval(async () => {
              try {
                  message.timestamp = Date.now();
                  await this.broadcastMessage(message);
              } catch (error) {}
          }, 3000);
      } catch (error) {
          throw error;
      }
  }

  async broadcastMessage(message) {
      if (!this.udp) {
          throw new Error('UDP socket未初始化');
      }
  
      return new Promise((resolve, reject) => {
          try {
              const messageStr = JSON.stringify(message);
  
              this.udp.send({
                  address: '255.255.255.255',
                  port: this.discoveryPort,
                  message: messageStr,
                  success: () => {
                      resolve();
                  },
                  fail: (error) => {
                      reject(error);
                  }
              });
          } catch (error) {
              reject(error);
          }
      });
  }

  handleMessage(res) {
      try {
          if (!res.message) {
              return;
          }
      
          let messageStr;
          if (typeof res.message === 'string') {
              messageStr = res.message;
          } else {
              const uint8Array = new Uint8Array(res.message);
              messageStr = String.fromCharCode.apply(null, uint8Array);
          }
      
          const message = JSON.parse(messageStr);
          
          switch(message.type) {
              case 'DISCOVER':
                  this.handleDiscoveryMessage(message, res.remoteInfo);
                  break;
              case 'DISCOVER_REPLY':
                  this.handleDiscoveryReply(message, res.remoteInfo);
                  break;
              case 'FILE_START':
                  this.handleFileStart(message, res.remoteInfo);
                  break;
              case 'FILE_DATA':
                  this.handleFileData(message, res.remoteInfo);
                  break;
              case 'FILE_ACK':
                  this.handleFileAck(message);
                  break;
              case 'FILE_COMPLETE':
                  this.handleFileComplete(message);
                  break;
              case 'pair_request':
                  this.handlePairRequest(message, res.remoteInfo);
                  break;
              case 'pair_response':
                  this.handlePairResponse(message, res.remoteInfo);
                  break;
              case 'device_state':
                  this.handleDeviceState(message, res.remoteInfo);
                  break;
              case 'PREPARE_TRANSFER':
                  const senderInfo = res.remoteInfo;
                  
                  if (!this.transferUdp) {
                      this.initTransferSocket().then(result => {
                          this.sendToDevice({
                              address: senderInfo.address,
                              port: senderInfo.port
                          }, {
                              type: 'PREPARE_TRANSFER_ACK',
                              transferId: message.transferId,
                              transferPort: this.transferPort,
                              ready: result,
                              timestamp: Date.now()
                          });
                      });
                  } else {
                      this.sendToDevice({
                          address: senderInfo.address,
                          port: senderInfo.port
                      }, {
                          type: 'PREPARE_TRANSFER_ACK',
                          transferId: message.transferId,
                          transferPort: this.transferPort,
                          ready: true,
                          timestamp: Date.now()
                      });
                  }
                  
                  if (this.onPrepareTransfer) {
                      this.onPrepareTransfer(message);
                  }
                  break;
  
              case 'PREPARE_TRANSFER_ACK':
                  if (message.ready) {
                      const transferState = Array.from(this.transferStates.values())
                          .find(state => state.id === message.transferId);
                      
                      if (transferState) {
                          const targetDevice = Array.from(this.lanDevices.values())
                              .find(device => device.address === res.remoteInfo.address);
              
                          if (targetDevice) {
                              targetDevice.transferPort = message.transferPort;
                              this.lanDevices.set(targetDevice.deviceId, targetDevice);
                              
                              this.continueFileTransfer(targetDevice, transferState);
                          }
                      }
                  }
                  break;
              
              case 'TRANSFER_INFO':
                  const device = this.lanDevices.get(message.deviceId);
                  if (device) {
                      device.transferPort = message.transferPort;
                      this.lanDevices.set(message.deviceId, device);
                  }
                  
                  this.udp.send({
                      address: res.remoteInfo.address,
                      port: res.remoteInfo.port,
                      message: JSON.stringify({
                          type: 'TRANSFER_INFO',
                          deviceId: this.deviceId,
                          transferPort: this.transferPort,
                          timestamp: Date.now()
                      })
                  });
                  
                  if (this.onTransferInfoReceived) {
                      this.onTransferInfoReceived(message, res.remoteInfo);
                  }
                  break;
  
              default:
                  break;
          }
      } catch (error) {}
  }

  handleTransferMessage(res) {
      try {
          let messageStr;
          if (typeof res.message === 'string') {
              messageStr = res.message;
          } else {
              messageStr = String.fromCharCode.apply(null, new Uint8Array(res.message));
          }
          
          const message = JSON.parse(messageStr);
          
          switch(message.type) {
              case 'FILE_START': {
                  this.sendSingleFileStartAck(message, res.remoteInfo);
                  this.handleFileStart(message, res.remoteInfo);
                  break;
              }
              case 'FILE_START_ACK': {
                  const ackKey = `${message.transferId}_${message.timestamp}`;
                  if (this.processedAcks.has(ackKey)) {
                      return;
                  }
                  
                  this.processedAcks.set(ackKey, true);
                  setTimeout(() => {
                      this.processedAcks.delete(ackKey);
                  }, 5000);
                  
                  if (this.onFileStartAck) {
                      this.onFileStartAck(message);
                      this.isTransferring = false;
                      this.resetTransferState(); 
                  }
                  break;
              }
              case 'FILE_DATA': {
                  this.handleFileData(message, res.remoteInfo);
                  break;
              }
              case 'FILE_ACK':
                  this.handleFileAck(message);
                  break;
              case 'FILE_COMPLETE':
                  this.handleFileComplete(message);
                  break;
              
              case 'FILE_RECEIVED_CONFIRM': {
                  this.resetTransferState();
                  this.activeTransfers.delete(message.transferId);
                  
                  if (this.onTransferStatusUpdate) {
                      this.onTransferStatusUpdate({
                          status: 'completed',
                          transferId: message.transferId,
                          fileName: message.fileName,
                          timestamp: message.timestamp
                      });
                  }
                  break;
              }
          }
      } catch (error) {}
  }

  sendSingleFileStartAck(message, remoteInfo) {
      const ackMessage = {
          type: 'FILE_START_ACK',
          transferId: message.transferId,
          timestamp: Date.now()
      };
      
      if (this.transferUdp) {
          this.transferUdp.send({
              address: remoteInfo.address,
              port: remoteInfo.port,
              message: JSON.stringify(ackMessage)
          });
      }
  }
  
  handleFileData(message, remoteInfo) {
      if (!this.isTransferring) {
          return;
      }
  
      if (message.transferId !== this.currentTransferId) {
          return;
      }
  
      try {
          const data = wx.base64ToArrayBuffer(message.data);
          
          this.currentChunks.set(message.chunkIndex, data);
          
          for (let i = 0; i < 3; i++) {
              setTimeout(() => {
                  if (this.transferUdp) {
                      const ackMessage = {
                          type: 'FILE_ACK',
                          transferId: message.transferId,
                          chunkIndex: message.chunkIndex,
                          status: 'success',
                          timestamp: Date.now()
                      };
  
                      this.transferUdp.send({
                          address: remoteInfo.address,
                          port: remoteInfo.port,
                          message: JSON.stringify(ackMessage)
                      });
                  }
              }, i * 100);
          }
  
          const totalReceived = Array.from(this.currentChunks.values())
              .reduce((sum, chunk) => sum + chunk.byteLength, 0);
          
          if (this.onProgress) {
              this.onProgress(
                  Math.floor(totalReceived / this.totalSize * 100),
                  totalReceived
              );
          }
  
          if (totalReceived >= this.totalSize) {
              this.handleFileComplete({
                  transferId: this.currentTransferId,
                  timestamp: Date.now()
              });
          }
      } catch (error) {
          if (this.transferUdp) {
              const errorMessage = {
                  type: 'FILE_ACK',
                  transferId: message.transferId,
                  chunkIndex: message.chunkIndex,
                  status: 'error',
                  error: error.message,
                  timestamp: Date.now()
              };
  
              this.transferUdp.send({
                  address: remoteInfo.address,
                  port: remoteInfo.port,
                  message: JSON.stringify(errorMessage)
              });
          }
      }
  }
  
  async sendAck(remoteInfo, ackMessage) {
      try {
          await new Promise((resolve, reject) => {
              if (!this.transferUdp) {
                  reject(new Error('传输socket未初始化'));
                  return;
              }
              
              this.transferUdp.send({
                  address: remoteInfo.address,
                  port: remoteInfo.port || this.transferPort,
                  message: JSON.stringify(ackMessage),
                  success: () => {
                      resolve();
                  },
                  fail: (error) => {
                      reject(error);
                  }
              });
          });
      } catch (error) {}
  }

  handleDeviceState(message, remoteInfo) {
      if (!message.deviceId) return;
      
      const device = this.lanDevices.get(message.deviceId);
      if (device) {
          device.state = message.state;
          device.lastUpdate = Date.now();
          
          if (message.state === 'connected') {
              device.connected = true;
          } else if (message.state === 'disconnected') {
              device.connected = false;
              
              if (this.onConnectionLost) {
                  this.onConnectionLost({
                      deviceId: message.deviceId,
                      deviceName: device.name || device.deviceName || '远程设备',
                      reason: 'remote_disconnect',
                      fromDeviceId: message.deviceId
                  });
              }
          }
          
          this.lanDevices.set(message.deviceId, device);
      }
      
      if (this.onLANDeviceFound) {
          this.onLANDeviceFound(Array.from(this.lanDevices.values()));
      }
  }

  handleDiscoveryMessage(message, remoteInfo) {
      if (message.deviceId === this.deviceId) {
          return;
      }

      const device = {
          deviceId: message.deviceId,
          name: message.deviceName,
          deviceName: message.deviceName,
          address: remoteInfo.address,
          type: message.deviceType || 'lan',
          timestamp: message.timestamp,
          via: 'udp'
      };

      this.lanDevices.set(device.deviceId, device);
      
      if (this.onLANDeviceFound) {
          this.onLANDeviceFound(Array.from(this.lanDevices.values()));
      }

      this.broadcastMessage({
          type: 'DISCOVER_REPLY',
          deviceId: this.deviceId,
          deviceName: wx.getSystemInfoSync().brand || '未知设备',
          deviceType: 'lan',
          timestamp: Date.now()
      });
  }

  handleDiscoveryReply(message, remoteInfo) {
      if (message.deviceId === this.deviceId) return;
  
      const device = {
          deviceId: message.deviceId,
          name: message.deviceName,
          deviceName: message.deviceName,
          address: remoteInfo.address,
          type: message.deviceType || 'lan',
          timestamp: message.timestamp,
          via: 'udp'
      };
  
      this.lanDevices.set(device.deviceId, device);
      
      if (this.onLANDeviceFound) {
          this.onLANDeviceFound(Array.from(this.lanDevices.values()));
      }
  }

  async continueFileTransfer(device, state) {
      try {
          if (!state.fileInfo) {
              throw new Error('文件信息不存在');
          }
  
          if (!state.fileInfo.path) {
              throw new Error('文件路径不存在');
          }
  
          if (!device.transferPort) {
              throw new Error('传输端口未设置');
          }
  
          if (!state.fileInfo.path.startsWith('http://') && 
              !state.fileInfo.path.startsWith('wxfile://')) {
              throw new Error('文件路径格式无效');
          }
  
          const waitForAck = new Promise((resolve, reject) => {
              let timeoutId = setTimeout(() => {
                  this.onFileStartAck = null;
                  reject(new Error('等待文件开始确认超时'));
              }, 10000);
      
              this.onFileStartAck = (ackMessage) => {
                  if (ackMessage.transferId === state.id) {
                      clearTimeout(timeoutId);
                      this.onFileStartAck = null;
                      state.receivedAck = true;
                      state.status = 'transferring';
                      resolve();
                  }
              };
          });
  
          const startMessage = {
              type: 'FILE_START',
              transferId: state.id,
              fileName: state.fileInfo.name,
              originalFileName: state.fileInfo.originalName || state.fileInfo.name,
              fileSize: state.fileInfo.size,
              chunkSize: this.chunkSize,
              timestamp: Date.now()
          };
  
          for (let i = 0; i < 3; i++) {
              setTimeout(async () => {
                  try {
                      await this.sendToDevice(device, startMessage, 'transfer');
                  } catch (error) {}
              }, i * 500);
          }
  
          await waitForAck;
  
          const fileContent = await this.readFile(state.fileInfo.path);
  
          let offset = 0;
          while (offset < state.fileInfo.size) {
              const chunk = fileContent.slice(
                  offset,
                  Math.min(offset + this.chunkSize, state.fileInfo.size)
              );
              
              const chunkMessage = {
                  type: 'FILE_DATA',
                  transferId: state.id,
                  chunkIndex: Math.floor(offset / this.chunkSize),
                  data: wx.arrayBufferToBase64(chunk),
                  checksum: await this.calculateChecksum(chunk),
                  timestamp: Date.now()
              };
              
              await this.sendToDevice(device, chunkMessage, 'transfer');
              offset += chunk.byteLength;
              
              if (this.onProgress) {
                  this.onProgress(
                      Math.floor(offset / state.fileInfo.size * 100),
                      offset
                  );
              }
          }
  
          const completeMessage = {
              type: 'FILE_COMPLETE',
              transferId: state.id,
              fileName: state.fileInfo.name,
              originalFileName: state.fileInfo.originalName || state.fileInfo.name,
              checksum: await this.calculateChecksum(fileContent),
              timestamp: Date.now()
          };
  
          await this.sendToDevice(device, completeMessage, 'transfer');
  
          if (this.onComplete) {
              this.onComplete();
          }
      } catch (error) {
          throw error;
      }
  }

  handleFileStart(message, remoteInfo) {
      if (this.activeTransfers.has(message.transferId)) {
          this.sendFileStartAck(remoteInfo, message.transferId);
          return;
      }

      const processed = this.processedTransfers.get(message.transferId);
      if (processed) {
          const timeDiff = Date.now() - processed.timestamp;
          if (timeDiff < 30000) {
              this.sendFileStartAck(remoteInfo, message.transferId);
              return;
          }
      }

      if (this.lastProcessedFile) {
          const timeDiff = Date.now() - this.lastProcessedFile.timestamp;
          if (timeDiff < 2000 && 
              this.lastProcessedFile.fileName === message.fileName && 
              this.lastProcessedFile.fileSize === message.fileSize) {
              this.sendFileStartAck(remoteInfo, message.transferId);
              return;
          }
      }

      try {
          this.activeTransfers.add(message.transferId);
          
          this.isTransferring = true;
          this.currentTransferId = message.transferId;
          this.currentChunks.clear();
          this.totalSize = message.fileSize;
          
          this.currentFileInfo = {
              fileName: message.fileName,
              originalFileName: message.originalFileName,
              fileSize: message.fileSize
          };
          
          let fileName = '';
          try {
              fileName = decodeURIComponent(escape(message.originalFileName || message.fileName));
          } catch (e) {
              fileName = message.fileName;
          }
          
          if (this.onReceiveStart) {
              this.onReceiveStart(fileName, message.fileSize);
          }
          
          this.sendFileStartAck(remoteInfo, message.transferId);
          
      } catch (error) {
          this.resetTransferState();
          this.activeTransfers.delete(message.transferId);
      }
  }

  sendFileStartAck(remoteInfo, transferId) {
      const ackMessage = {
          type: 'FILE_START_ACK',
          transferId: transferId,
          timestamp: Date.now()
      };
      
      if (this.transferUdp) {
          for (let i = 0; i < 3; i++) {
              setTimeout(() => {
                  this.transferUdp.send({
                      address: remoteInfo.address,
                      port: remoteInfo.port,
                      message: JSON.stringify(ackMessage)
                  });
              }, i * 200);
          }
      }
  }

  handleFileAck(message) {
      const chunkIndex = message.chunkIndex;
      const timeout = this.ackTimeouts.get(chunkIndex);
      
      if (timeout) {
          clearTimeout(timeout);
          this.ackTimeouts.delete(chunkIndex);
      }

      if (message.status === 'success') {
          this.retryCount.delete(chunkIndex);
      }
  }

  async sendFile(filePath, targetDevice) {
      if (targetDevice) {
          targetDevice.isLastSender = true;
          this.lanDevices.set(targetDevice.deviceId, targetDevice);
          
          Array.from(this.lanDevices.values()).forEach(device => {
              if (device.deviceId !== targetDevice.deviceId) {
                  device.isLastSender = false;
                  this.lanDevices.set(device.deviceId, device);
              }
          });
      }
      
      if (this.isTransferring) {
          throw new Error('已有文件正在传输中');
      }
      
      try {
          this.isTransferring = true;
          const fileInfo = await this.getFileInfo(filePath);
          
          const originalFile = arguments.length > 2 ? arguments[2] : null;
          
          const transferId = Date.now().toString();
          const state = {
              id: transferId,
              startTime: Date.now(),
              fileInfo: {
                  ...fileInfo,
                  path: filePath,
                  originalName: originalFile?.originalName || fileInfo.name
              },
              receivedAck: false,
              status: 'preparing'
          };
          this.transferStates.set(transferId, state);
  
          const startMessage = {
              type: 'FILE_START',
              transferId: transferId,
              fileName: fileInfo.name,
              originalFileName: originalFile?.originalName || fileInfo.name,
              fileSize: fileInfo.size,
              chunkSize: this.chunkSize,
              timestamp: Date.now()
          };
  
          await this.sendToDevice(targetDevice, {
              type: 'PREPARE_TRANSFER',
              transferId: transferId,
              timestamp: Date.now()
          });
  
          await new Promise(resolve => setTimeout(resolve, 1000));
  
          const ackPromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                  this.onFileStartAck = null;
                  reject(new Error('等待文件开始确认超时'));
              }, 5000);
              
              this.onFileStartAck = (ackMessage) => {
                  if (ackMessage.transferId === transferId) {
                      clearTimeout(timeout);
                      this.onFileStartAck = null;
                      state.receivedAck = true;
                      state.status = 'transferring';
                      resolve();
                  }
              };
          });
  
          await this.sendToDevice(targetDevice, startMessage, 'transfer');
          
          await ackPromise;
          
          let offset = 0;
          const fileContent = await this.readFile(filePath);
          
          while (offset < fileInfo.size) {
              const chunk = fileContent.slice(
                  offset,
                  Math.min(offset + this.chunkSize, fileInfo.size)
              );
              
              const chunkMessage = {
                  type: 'FILE_DATA',
                  transferId: transferId,
                  chunkIndex: Math.floor(offset / this.chunkSize),
                  data: wx.arrayBufferToBase64(chunk),
                  checksum: await this.calculateChecksum(chunk),
                  timestamp: Date.now()
              };
              
              await this.sendToDevice(targetDevice, chunkMessage, 'transfer');
              offset += chunk.byteLength;
              
              if (this.onProgress) {
                  this.onProgress(
                      Math.floor(offset / fileInfo.size * 100),
                      offset
                  );
              }
          }
  
          const waitForConfirm = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                  this.onTransferStatusUpdate = null;
                  reject(new Error('等待接收确认超时'));
              }, 10000);
  
              const originalHandler = this.onTransferStatusUpdate;
              this.onTransferStatusUpdate = (statusInfo) => {
                  if (statusInfo.status === 'completed' && 
                      statusInfo.transferId === transferId) {
                      clearTimeout(timeout);
                      this.onTransferStatusUpdate = originalHandler;
                      resolve();
                  } else if (originalHandler) {
                      originalHandler(statusInfo);
                  }
              };
          });
  
          const completeMessage = {
              type: 'FILE_COMPLETE',
              transferId: transferId,
              fileName: fileInfo.name,
              originalFileName: originalFile?.originalName || fileInfo.name,
              checksum: await this.calculateChecksum(fileContent),
              timestamp: Date.now()
          };

          await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                  reject(new Error('等待接收确认超时'));  
              }, 10000);

              const onStatusUpdate = (status) => {
                  if(status.status === 'completed' && status.transferId === transferId) {
                      clearTimeout(timeout);
                      this.isTransferring = false;
                      this.currentTransferId = null;
                      resolve();
                  }  
              };

              const originalCallback = this.onTransferStatusUpdate;
              this.onTransferStatusUpdate = (status) => {
                  onStatusUpdate(status);
                  if(originalCallback) originalCallback(status);
              };

              this.sendToDevice(targetDevice, completeMessage, 'transfer').catch(reject);
          });

          this.resetTransferState();

      } catch (error) {
          this.resetTransferState();
          throw error;
      } finally {
          this.isTransferring = false;
      }
  }

  async sendChunkWithRetry(device, chunkMessage, chunkIndex) {
      return new Promise((resolve, reject) => {
          const sendChunk = async () => {
              try {
                  await this.sendToDevice(device, chunkMessage);
                  
                  this.ackTimeouts.set(chunkIndex, setTimeout(() => {
                      const retries = this.retryCount.get(chunkIndex) || 0;
                      if (retries < this.maxRetries) {
                          this.retryCount.set(chunkIndex, retries + 1);
                          sendChunk();
                      } else {
                          reject(new Error(`块${chunkIndex}发送失败`));
                      }
                  }, this.ackTimeout));

              } catch (error) {
                  reject(error);
              }
          };

          sendChunk();
      });
  }

  async sendToDevice(device, message, mode = 'discovery') {
      return new Promise((resolve, reject) => {
          try {
              const targetPort = mode === 'transfer' ? 
                  (device.transferPort || this.transferPort) : 
                  this.discoveryPort;
              const socket = mode === 'transfer' ? this.transferUdp : this.udp;
              
              if (!socket) {
                  throw new Error(`${mode} socket未初始化`);
              }
              
              socket.send({
                  address: device.address,
                  port: targetPort,
                  message: JSON.stringify(message),
                  success: (res) => {
                      resolve(res);
                  },
                  fail: (err) => {
                      reject(err);
                  }
              });
          } catch (error) {
              reject(error);
          }
      });
  }

  async exchangeTransferInfo(device) {
      const info = {
          type: 'TRANSFER_INFO',
          deviceId: this.deviceId,
          transferPort: this.transferPort,
          timestamp: Date.now()
      };
      
      try {
          await this.sendToDevice(device, info);
          
          return new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                  this.onTransferInfoReceived = null;
                  reject(new Error('等待传输信息交换超时'));
              }, 5000);
              
              this.onTransferInfoReceived = (infoMessage, remoteInfo) => {
                  if (infoMessage.deviceId === device.deviceId) {
                      clearTimeout(timeout);
                      this.onTransferInfoReceived = null;
                      
                      device.transferPort = infoMessage.transferPort;
                      
                      resolve(device);
                  }
              };
          });
      } catch (error) {
          throw error;
      }
  }

  async getFileInfo(filePath) {
      return new Promise((resolve, reject) => {
          const fs = wx.getFileSystemManager();
          fs.getFileInfo({
              filePath,
              success: (res) => {
                  const fileName = filePath.split('/').pop();
                  resolve({
                      ...res,
                      name: fileName
                  });
              },
              fail: (error) => {
                  reject(error);
              }
          });
      });
  }

  async readFile(filePath) {
      return new Promise((resolve, reject) => {
          const fs = wx.getFileSystemManager();
          fs.readFile({
              filePath,
              success: res => {
                  resolve(res.data);
              },
              fail: (error) => {
                  reject(error);
              }
          });
      });
  }

  async calculateChecksum(data) {
      const buffer = new Uint8Array(data);
      let hash = 0;
      for (let i = 0; i < buffer.length; i++) {
          hash = ((hash << 5) - hash) + buffer[i];
          hash = hash & hash;
      }
      return hash.toString(16);
  }

  async saveFile(fileName, fileData) {
      if (!fileName) {
          throw new Error('文件名不能为空');
      }
  
      return new Promise((resolve, reject) => {
          const fs = wx.getFileSystemManager();
          const dir = `${wx.env.USER_DATA_PATH}/received_files`;
  
          try {
              try {
                  fs.accessSync(dir);
              } catch (e) {
                  fs.mkdirSync(dir, true);
              }
  
              const timestamp = Date.now();
              const fileNameParts = fileName.split('.');
              const ext = fileNameParts.length > 1 ? fileNameParts.pop() : '';
              const name = fileNameParts.join('.');
              const finalFileName = `${name}_${timestamp}${ext ? '.' + ext : ''}`;
              const filePath = `${dir}/${finalFileName}`;
  
              fs.writeFile({
                  filePath,
                  data: fileData,
                  success: () => {
                      resolve(filePath);
                  },
                  fail: (error) => {
                      reject(error);
                  }
              });
          } catch (error) {
              reject(error);
          }
      });
  }

  async saveFileDevEnv(fileName, fileData) {
      return new Promise((resolve, reject) => {
        const fs = wx.getFileSystemManager();
        const dir = `${wx.env.USER_DATA_PATH}/received_files`;
        
        try {
          try {
            fs.accessSync(dir);
          } catch (e) {
            fs.mkdirSync(dir, true);
          }
          
          const filePath = `${dir}/${fileName}`;
          fs.writeFile({
            filePath,
            data: fileData,
            success: () => {
              resolve(filePath);
            },
            fail: (err) => {
              reject(err);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
  }

  async sendPairRequest(device, pairRequest) {
      return new Promise((resolve, reject) => {
        try {
          if (!device.address) {
            reject(new Error('WiFi配对失败：设备没有IP地址'));
            return;
          }
      
          const messageStr = JSON.stringify(pairRequest);
          
          this.udp.send({
            address: device.address,
            port: this.discoveryPort,
            message: messageStr,
            success: (res) => {
              resolve(res);
            },
            fail: (err) => {
              reject(err);
            }
          });
          
        } catch (error) {
          reject(error);
        }
      });
  }

  handlePairRequest(message, remoteInfo) {
      if (this.onPairRequest) {
          this.onPairRequest(message, remoteInfo, this.udp);
      }
  }

  handlePairResponse(message, remoteInfo) {
      if (this.onPairResponse) {
          this.onPairResponse(message, remoteInfo);
      }
  }

  initPairingListener() {
      return {
          socket: this.udp,
          port: this.discoveryPort
      };
  }

  async handleFileComplete(message) {
      if (!this.isTransferring) {
          return;
      }
  
      try {
          const sortedChunks = Array.from(this.currentChunks.entries())
              .sort(([a], [b]) => a - b)
              .map(([_, chunk]) => chunk);
          
          const totalLength = sortedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  
          const completeFile = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of sortedChunks) {
              completeFile.set(new Uint8Array(chunk), offset);
              offset += chunk.byteLength;
          }
  
          if (!this.currentFileInfo) {
              this.currentFileInfo = {
                  fileName: `received_file_${Date.now()}.dat`,
                  fileSize: totalLength
              };
          }
  
          let fileName = '';
          try {
              const originalName = this.currentFileInfo.originalFileName || this.currentFileInfo.fileName;
              fileName = originalName ? decodeURIComponent(escape(originalName)) : '';
          } catch (e) {
              fileName = this.currentFileInfo.fileName || `received_file_${Date.now()}.dat`;
          }
  
          const filePath = await this.saveFile(fileName, completeFile.buffer);
  
          this.processedTransfers.set(message.transferId, {
              timestamp: Date.now(),
              fileName: fileName,
              fileSize: totalLength,
              path: filePath
          });
  
          if (this.onComplete) {
              const result = {
                  path: filePath,
                  name: fileName,
                  size: totalLength,
                  timestamp: Date.now(),
                  transferId: message.transferId
              };
              this.onComplete(result);
          }
  
          const confirmMessage = {
              type: 'FILE_RECEIVED_CONFIRM',
              transferId: message.transferId,
              fileName: fileName,
              status: 'completed',
              timestamp: Date.now()
          };
  
          if (this.transferUdp) {
              for (let i = 0; i < 3; i++) {
                  this.transferUdp.send({
                      address: '255.255.255.255',
                      port: this.transferPort,
                      message: JSON.stringify(confirmMessage)
                  });
              }
          }
  
          if (this.udp) {
              for (let i = 0; i < 3; i++) {
                  this.udp.send({
                      address: '255.255.255.255',
                      port: this.discoveryPort,
                      message: JSON.stringify(confirmMessage)
                  });
              }
          }
  
          this.resetTransferState();
  
      } catch (error) {
          this.resetTransferState();
          this.isTransferring = false;
          if (this.onError) {
              this.onError({
                  type: 'SAVE_ERROR',
                  message: '保存文件失败',
                  details: error
              });
          }
      }
  }

  cleanup() {
      if (this.discoveryInterval) {
          clearInterval(this.discoveryInterval);
          this.discoveryInterval = null;
      }
      
      if (this.udp) {
          try {
              this.udp.close();
          } catch (error) {}
          this.udp = null;
      }

      if (this.transferUdp) {
          try {
              this.transferUdp.close();
          } catch (error) {}
          this.transferUdp = null;
      }

      this.discoveryPort = null;
      this.transferPort = null;
      this.ackTimeouts.forEach(timeout => clearTimeout(timeout));
      this.ackTimeouts.clear();
      this.currentChunks.clear();
      this.retryCount.clear();
      this.foundDevices.clear();
      this.lanDevices.clear();
      this.isTransferring = false;
      this.isInitializing = false;
      this.onFileStartAck = null;
      this.processedTransfers.clear();
      this.transferLocks.clear();
      this.activeTransfers.clear();
      this.lastProcessedFile = null;
      this.processedAcks.clear();
      this.processedTransfers.clear();
      this.transferLocks.clear();
      this.activeTransfers.clear();
  }
}

export default NetworkManager;